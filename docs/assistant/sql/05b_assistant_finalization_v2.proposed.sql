-- ============================================================================
-- 05b — Finalisation transactionnelle v2 (messages + journal + débit + registre)
-- PROPOSITION — ne pas exécuter sans docs/assistant/sql/RUNBOOK.md
--
-- Remplace 05_assistant_atomic_finalization (historique seulement).
-- Rejouable : oui (drop function if exists avant création, type de retour changé).
-- Prérequis : 01 → 02 → 03b.
-- Activation : ASSISTANT_FINALIZE_ATOMIC=enabled + ASSISTANT_IDEMPOTENCY_REGISTRY=enabled
--
-- Contrat consommé par lib/assistant/finalization.ts :
--   rpc_assistant_finalize_request(p_user_id, p_thread_id, p_request_id,
--     p_request_fingerprint, p_attempt_token, p_store_id, p_intent,
--     p_user_message, p_assistant_content, p_assistant_metadata, p_credits,
--     p_usage, p_next_title)
--   -> (assistant_message jsonb, credit_status text, replayed boolean,
--       credits_consumed integer, credits_charged integer)
--
-- Réservé à `service_role`. L'identité est EXPLICITE (`p_user_id`) : aucun
-- contrôle ne dépend de `auth.uid()`, y compris pour les rejeux.
--
-- ## Propriétés garanties par la transaction
--   * un seul tour écrit par clé d'idempotence, y compris entre instances ;
--   * messages + journal + débit + clôture du registre dans la MÊME transaction ;
--   * toute exception annule l'ensemble (aucun débit sans réponse, aucune
--     réponse sans trace de consommation) ;
--   * le rejeu relit le message existant sans réécrire ni redébiter.
--
-- ## Décision provisoire — crédits insuffisants (documentée, non définitive)
--   Si le solde est insuffisant au moment du débit, la réponse est CONSERVÉE,
--   le journal d'usage est écrit, le débit est de 0 et le registre porte
--   `credit_status = 'insufficient'`. Ce n'est PAS un « tout ou rien »
--   financier : c'est un choix produit provisoire (ne pas perdre une réponse
--   déjà payée au fournisseur) qui doit être réévalué avec la facturation.
--   `credits_consumed > 0` et `credits_charged = 0` doivent rester distincts
--   dans tous les rapports.
-- ============================================================================
begin;

-- ---------------------------------------------------------------------------
-- 1. Lecture stricte du journal (aucune conversion implicite silencieuse)
-- ---------------------------------------------------------------------------
create or replace function public.assistant_usage_integer(p_usage jsonb, p_key text)
returns integer
language plpgsql
immutable
set search_path = pg_temp
as $$
declare
  v_text text;
begin
  if p_usage is null or jsonb_typeof(p_usage) <> 'object' then
    raise exception 'INVALID_USAGE' using errcode = 'P0001';
  end if;
  v_text := nullif(btrim(coalesce(p_usage ->> p_key, '')), '');
  if v_text is null then
    return 0;
  end if;
  if v_text !~ '^[0-9]{1,9}$' then
    raise exception 'INVALID_USAGE' using errcode = 'P0001';
  end if;
  return v_text::integer;
end;
$$;

create or replace function public.assistant_usage_numeric(p_usage jsonb, p_key text)
returns numeric
language plpgsql
immutable
set search_path = pg_temp
as $$
declare
  v_text text;
begin
  if p_usage is null or jsonb_typeof(p_usage) <> 'object' then
    raise exception 'INVALID_USAGE' using errcode = 'P0001';
  end if;
  v_text := nullif(btrim(coalesce(p_usage ->> p_key, '')), '');
  if v_text is null then
    return 0::numeric;
  end if;
  if v_text !~ '^[0-9]{1,12}(\.[0-9]{1,9})?$' then
    raise exception 'INVALID_USAGE' using errcode = 'P0001';
  end if;
  return v_text::numeric;
end;
$$;

revoke all on function public.assistant_usage_integer(jsonb, text) from public, anon, authenticated;
revoke all on function public.assistant_usage_numeric(jsonb, text) from public, anon, authenticated;
grant execute on function public.assistant_usage_integer(jsonb, text) to service_role;
grant execute on function public.assistant_usage_numeric(jsonb, text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Retrait des signatures héritées (y compris réserve/libération de 05)
-- ---------------------------------------------------------------------------
drop function if exists public.rpc_assistant_finalize_request(
  uuid, uuid, text, text, uuid, text, text, text, jsonb, integer, jsonb, text);
drop function if exists public.rpc_assistant_finalize_request(
  uuid, uuid, text, text, uuid, uuid, text, text, text, jsonb, integer, jsonb, text);
drop function if exists public.rpc_assistant_reserve_credits(text, integer);
drop function if exists public.rpc_assistant_release_credits(text);

-- ---------------------------------------------------------------------------
-- 3. Finalisation atomique
-- ---------------------------------------------------------------------------
create or replace function public.rpc_assistant_finalize_request(
  p_user_id uuid,
  p_thread_id uuid,
  p_request_id text,
  p_request_fingerprint text,
  p_attempt_token uuid,
  p_store_id uuid,
  p_intent text,
  p_user_message text,
  p_assistant_content text,
  p_assistant_metadata jsonb,
  p_credits integer,
  p_usage jsonb,
  p_next_title text
)
returns table (
  assistant_message jsonb,
  credit_status text,
  replayed boolean,
  credits_consumed integer,
  credits_charged integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_credits integer := greatest(0, coalesce(p_credits, 0));
  v_thread public.chat_threads;
  v_row public.assistant_requests;
  v_message public.chat_messages;
  v_wallet public.ai_credit_wallets;
  v_status text := 'charged';
  v_charged integer := 0;
  v_input_tokens integer;
  v_output_tokens integer;
  v_cost numeric;
  v_now timestamptz;
begin
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;
  if p_thread_id is null or p_request_id is null then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001';
  end if;
  if p_request_fingerprint is null or char_length(p_request_fingerprint) <> 64 then
    raise exception 'INVALID_FINGERPRINT' using errcode = 'P0001';
  end if;
  if p_user_message is null or p_assistant_content is null then
    raise exception 'INVALID_MESSAGE_CONTENT' using errcode = 'P0001';
  end if;
  if p_assistant_metadata is not null and jsonb_typeof(p_assistant_metadata) <> 'object' then
    raise exception 'INVALID_METADATA' using errcode = 'P0001';
  end if;

  -- Permission COURANTE, y compris pour un rejeu : une révocation ferme
  -- l'accès, même si la réponse existe déjà.
  if not public.assistant_can_use_store(p_store_id, p_user_id) then
    raise exception 'FORBIDDEN_STORE' using errcode = 'P0001';
  end if;

  v_input_tokens := public.assistant_usage_integer(p_usage, 'input_tokens');
  v_output_tokens := public.assistant_usage_integer(p_usage, 'output_tokens');
  v_cost := public.assistant_usage_numeric(p_usage, 'provider_cost_usd');

  -- Ordre global : identité → conversation → registre → portefeuille.
  perform public.assistant_lock_identity(p_user_id, p_store_id);
  v_thread := public.assistant_lock_thread(p_thread_id, p_user_id);

  if v_thread.store_id is distinct from p_store_id then
    raise exception 'THREAD_STORE_MISMATCH' using errcode = 'P0001';
  end if;

  select * into v_row
    from public.assistant_requests r
   where r.user_id = p_user_id and r.request_id = p_request_id
   for update;

  if not found then
    raise exception 'IDEMPOTENCY_TOKEN_MISMATCH' using errcode = 'P0001';
  end if;

  if v_row.fingerprint <> p_request_fingerprint
     or v_row.store_id <> p_store_id
     or (v_row.thread_id is not null and v_row.thread_id <> p_thread_id) then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
  end if;

  -- Rejeu : lecture seule, statut de débit réel conservé.
  if v_row.state = 'completed' then
    if v_row.assistant_message_id is null then
      raise exception 'IDEMPOTENCY_REPLAY_UNAVAILABLE' using errcode = 'P0001';
    end if;
    select to_jsonb(m) into assistant_message
      from public.chat_messages m
     where m.id = v_row.assistant_message_id;
    if assistant_message is null then
      raise exception 'IDEMPOTENCY_REPLAY_UNAVAILABLE' using errcode = 'P0001';
    end if;
    return query
      select assistant_message, v_row.credit_status, true,
             v_row.credits_consumed, v_row.credits_charged;
    return;
  end if;

  if v_row.state <> 'in_progress' then
    raise exception 'IDEMPOTENCY_LEASE_LOST' using errcode = 'P0001';
  end if;
  if p_attempt_token is null or v_row.attempt_token <> p_attempt_token then
    raise exception 'IDEMPOTENCY_TOKEN_MISMATCH' using errcode = 'P0001';
  end if;

  -- Bail mesuré APRÈS les verrous, à l'horloge réelle.
  v_now := clock_timestamp();

  if v_row.lease_until <= v_now then
    raise exception 'IDEMPOTENCY_LEASE_LOST' using errcode = 'P0001';
  end if;

  -- Seconde appréciation, désormais sous verrous : réduit la fenêtre où une
  -- révocation committée serait ignorée. La sérialisation stricte avec
  -- `store_members` n'est PAS assurée (RUNBOOK §9.4).
  if not public.assistant_can_use_store(p_store_id, p_user_id) then
    raise exception 'FORBIDDEN_STORE' using errcode = 'P0001';
  end if;

  insert into public.chat_messages (thread_id, role, content, credits_used, metadata)
  values (
    p_thread_id, 'user', p_user_message, 0,
    jsonb_build_object(
      'request_id', p_request_id,
      'request_fingerprint', p_request_fingerprint
    )
  );

  insert into public.chat_messages (thread_id, role, content, credits_used, metadata)
  values (
    p_thread_id, 'assistant', p_assistant_content, v_credits, p_assistant_metadata
  )
  returning * into v_message;

  update public.chat_threads ct
     set updated_at = v_now,
         title = coalesce(nullif(btrim(p_next_title), ''), ct.title)
   where ct.id = p_thread_id;

  insert into public.ai_usage (
    user_id, store_id, thread_id, feature, credits_used,
    input_tokens, output_tokens, provider_name, model_name, provider_cost_usd
  )
  values (
    p_user_id, p_store_id, p_thread_id, 'chatbot', v_credits,
    v_input_tokens, v_output_tokens,
    nullif(btrim(coalesce(p_usage ->> 'provider_name', '')), ''),
    nullif(btrim(coalesce(p_usage ->> 'model_name', '')), ''),
    v_cost
  );

  -- Portefeuille : la source de vérité (`resolve_effective_plan` +
  -- `sync_ai_credit_wallet_for_plan`) est réutilisée, jamais dupliquée.
  -- Elle gère la recharge mensuelle, le changement d'offre et le verrou de
  -- ligne (dernier verrou de l'ordre global).
  v_wallet := public.sync_ai_credit_wallet_for_plan(
    p_user_id,
    public.resolve_effective_plan(p_user_id)
  );

  if v_wallet.id is null
     or (v_wallet.monthly_credits - v_wallet.credits_used) < v_credits then
    -- Décision provisoire : réponse conservée, consommation tracée, débit nul.
    v_status := 'insufficient';
    v_charged := 0;
  else
    update public.ai_credit_wallets w
       set credits_used = w.credits_used + v_credits,
           updated_at = v_now
     where w.id = v_wallet.id;
    v_status := 'charged';
    v_charged := v_credits;
  end if;

  update public.assistant_requests r
     set state = 'completed',
         assistant_message_id = v_message.id,
         thread_id = coalesce(r.thread_id, p_thread_id),
         credit_status = v_status,
         credits_consumed = v_credits,
         credits_charged = v_charged,
         lease_until = v_now,
         updated_at = v_now,
         last_error = null
   where r.user_id = p_user_id
     and r.request_id = p_request_id
     and r.attempt_token = p_attempt_token
     and r.state = 'in_progress';

  if not found then
    raise exception 'IDEMPOTENCY_TOKEN_MISMATCH' using errcode = 'P0001';
  end if;

  assistant_message := to_jsonb(v_message);
  return query select assistant_message, v_status, false, v_credits, v_charged;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Privilèges : backend uniquement
-- ---------------------------------------------------------------------------
revoke all on function public.rpc_assistant_finalize_request(
  uuid, uuid, text, text, uuid, uuid, text, text, text, jsonb, integer, jsonb, text
) from public, anon, authenticated;
grant execute on function public.rpc_assistant_finalize_request(
  uuid, uuid, text, text, uuid, uuid, text, text, text, jsonb, integer, jsonb, text
) to service_role;

commit;

-- ============================================================================
-- Contrôles après application (lecture seule)
--   select has_function_privilege('authenticated',
--            'public.rpc_assistant_finalize_request(uuid,uuid,text,text,uuid,uuid,text,text,text,jsonb,integer,jsonb,text)',
--            'EXECUTE') as authenticated_can_finalize;  -- attendu : false
--   select has_function_privilege('service_role',
--            'public.rpc_assistant_finalize_request(uuid,uuid,text,text,uuid,uuid,text,text,text,jsonb,integer,jsonb,text)',
--            'EXECUTE') as service_can_finalize;        -- attendu : true
--   select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'rpc_assistant_finalize_request';
--                                                       -- attendu : 1
--
-- Réconciliation (lecture seule, à surveiller après activation) :
--   select r.credit_status,
--          count(*) as requests,
--          sum(r.credits_consumed) as consumed,
--          sum(r.credits_charged) as charged
--     from public.assistant_requests r
--    where r.state = 'completed'
--    group by r.credit_status;
--   -- credits_charged doit toujours être <= credits_consumed ;
--   -- l'écart correspond aux réponses conservées sans débit (`insufficient`).
--
-- Rollback 05b :
--   drop function if exists public.rpc_assistant_finalize_request(
--     uuid, uuid, text, text, uuid, uuid, text, text, text, jsonb, integer, jsonb, text);
--   drop function if exists public.assistant_usage_numeric(jsonb, text);
--   drop function if exists public.assistant_usage_integer(jsonb, text);
--   désactiver ASSISTANT_FINALIZE_ATOMIC (et ASSISTANT_CREDIT_RESERVATION)
--   AVANT de retirer les fonctions utilisées par le code.
-- ============================================================================


