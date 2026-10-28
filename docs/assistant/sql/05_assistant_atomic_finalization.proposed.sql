-- ============================================================================
-- OBSOLÈTE — NE PAS APPLIQUER. Remplacé par 05b_assistant_finalization_v2
-- (p_user_id, p_attempt_token, retour credit_status/replayed). Historique seulement.
-- PROPOSITION — NE PAS EXÉCUTER SANS VALIDATION EXPLICITE
-- Objet : finalisation transactionnelle d'un tour (messages + journal + débit).
--
-- Aujourd'hui les écritures sont séquentielles : un échec intermédiaire peut
-- laisser une réponse sans débit. Cette fonction regroupe tout dans UNE transaction.
--
-- Contraintes : AUCUNE fonction d'écriture fiable accordée à `authenticated` ;
-- réservée à `service_role` (backend Jisra) ; identité et périmètre vérifiés
-- explicitement ; montant facturé validé ici ; bail d'idempotence clôturé dans
-- la même transaction.
--
-- Prérequis : 03_. Activation : ASSISTANT_FINALIZE_ATOMIC=enabled
-- ============================================================================
begin;

create or replace function public.rpc_assistant_finalize_request(
  p_user_id uuid,
  p_thread_id uuid,
  p_request_id text,
  p_request_fingerprint text,
  p_store_id uuid,
  p_intent text,
  p_user_message text,
  p_assistant_content text,
  p_assistant_metadata jsonb,
  p_credits integer,
  p_usage jsonb,
  p_next_title text
)
returns table (assistant_message jsonb, credit_status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_credits integer := greatest(0, coalesce(p_credits, 0));
  v_thread public.chat_threads;
  v_request public.assistant_requests;
  v_message public.chat_messages;
  v_wallet public.ai_credit_wallets;
  v_status text := 'charged';
begin
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;

  select * into v_thread from public.chat_threads ct
   where ct.id = p_thread_id and ct.user_id = p_user_id;
  if not found then
    raise exception 'THREAD_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_thread.store_id is distinct from p_store_id then
    raise exception 'THREAD_STORE_MISMATCH' using errcode = 'P0001';
  end if;

  select * into v_request from public.assistant_requests r
   where r.user_id = p_user_id and r.request_id = p_request_id
   for update;
  if found then
    if v_request.fingerprint <> p_request_fingerprint then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;
    if v_request.state = 'completed' then
      select to_jsonb(m) into assistant_message
        from public.chat_messages m where m.id = v_request.assistant_message_id;
      return query select assistant_message, 'not_charged'::text;
      return;
    end if;
  end if;

  insert into public.chat_messages (thread_id, role, content, credits_used, metadata)
  values (p_thread_id, 'user', p_user_message, 0,
          jsonb_build_object('request_id', p_request_id, 'request_fingerprint', p_request_fingerprint));

  insert into public.chat_messages (thread_id, role, content, credits_used, metadata)
  values (p_thread_id, 'assistant', p_assistant_content, v_credits, p_assistant_metadata)
  returning * into v_message;

  update public.chat_threads ct
     set updated_at = now(),
         title = coalesce(nullif(p_next_title, ''), ct.title)
   where ct.id = p_thread_id;

  insert into public.ai_usage (user_id, store_id, thread_id, feature, credits_used,
                               input_tokens, output_tokens, provider_name, model_name, provider_cost_usd)
  values (p_user_id, p_store_id, p_thread_id, 'chatbot', v_credits,
          coalesce((p_usage->>'input_tokens')::integer, 0),
          coalesce((p_usage->>'output_tokens')::integer, 0),
          p_usage->>'provider_name', p_usage->>'model_name',
          coalesce((p_usage->>'provider_cost_usd')::numeric, 0));

  -- Débit direct du portefeuille de l'utilisateur ciblé : la finalisation est
  -- appelée par le backend (service_role), où `auth.uid()` est NULL — appeler
  -- `rpc_debit_ai_credits` (basée sur auth.uid()) échouerait systématiquement.
  select * into v_wallet from public.ai_credit_wallets w
   where w.user_id = p_user_id
   for update;

  if not found then
    v_status := 'insufficient';
  elsif (v_wallet.monthly_credits - v_wallet.credits_used) < v_credits then
    v_status := 'insufficient';
  else
    update public.ai_credit_wallets w
       set credits_used = w.credits_used + v_credits,
           updated_at = now()
     where w.id = v_wallet.id;
  end if;

  update public.assistant_requests r
     set state = 'completed',
         assistant_message_id = v_message.id,
         credits_charged = case when v_status = 'charged' then v_credits else 0 end,
         lease_until = now(),
         updated_at = now()
   where r.user_id = p_user_id and r.request_id = p_request_id
     and r.fingerprint = p_request_fingerprint;

  assistant_message := to_jsonb(v_message);
  return query select assistant_message, v_status;
end;
$$;

revoke all on function public.rpc_assistant_finalize_request(
  uuid, uuid, text, text, uuid, text, text, text, jsonb, integer, jsonb, text
) from public, anon, authenticated;
grant execute on function public.rpc_assistant_finalize_request(
  uuid, uuid, text, text, uuid, text, text, text, jsonb, integer, jsonb, text
) to service_role;

commit;

-- Réservation souple (facultative) : mémorise le montant prévu sur la requête.
-- Ce n'est PAS un verrou de portefeuille ; la garantie financière reste le débit
-- atomique ci-dessus. Activation : ASSISTANT_CREDIT_RESERVATION=enabled
begin;

create or replace function public.rpc_assistant_reserve_credits(p_request_id text, p_credits integer)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;

  update public.assistant_requests r
     set credits_reserved = greatest(0, coalesce(p_credits, 0)), updated_at = now()
   where r.user_id = auth.uid()
     and r.request_id = p_request_id
     and r.state = 'in_progress';
end;
$$;

create or replace function public.rpc_assistant_release_credits(p_request_id text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;

  update public.assistant_requests r
     set credits_reserved = 0, updated_at = now()
   where r.user_id = auth.uid() and r.request_id = p_request_id;
end;
$$;

revoke all on function public.rpc_assistant_reserve_credits(text, integer) from public, anon;
revoke all on function public.rpc_assistant_release_credits(text) from public, anon;
grant execute on function public.rpc_assistant_reserve_credits(text, integer) to authenticated;
grant execute on function public.rpc_assistant_release_credits(text) to authenticated;

commit;

-- Rollback 05 :
--   drop function if exists public.rpc_assistant_release_credits(text);
--   drop function if exists public.rpc_assistant_reserve_credits(text, integer);
--   drop function if exists public.rpc_assistant_finalize_request(
--     uuid, uuid, text, text, uuid, text, text, text, jsonb, integer, jsonb, text);

