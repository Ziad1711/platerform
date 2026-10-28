-- ============================================================================
-- PROPOSITION v2 — NE PAS EXÉCUTER. Remplace 05_assistant_atomic_finalization.
-- Contrat aligné sur lib/assistant/finalization.ts :
--   rpc_assistant_finalize_request(p_user_id, p_thread_id, p_request_id,
--     p_request_fingerprint, p_attempt_token, p_store_id, p_intent,
--     p_user_message, p_assistant_content, p_assistant_metadata, p_credits,
--     p_usage, p_next_title) RETURNS (assistant_message jsonb, credit_status text, replayed boolean)
--
-- Réservé à service_role ; identité et périmètre vérifiés explicitement ;
-- aucune écriture `assistant`/`system` possible via PostgREST authentifié.
-- Prérequis : 01_, 02_, 03b.
-- ============================================================================
begin;

create or replace function public.rpc_assistant_finalize_request(
  p_user_id uuid, p_thread_id uuid, p_request_id text, p_request_fingerprint text,
  p_attempt_token uuid, p_store_id uuid, p_intent text, p_user_message text,
  p_assistant_content text, p_assistant_metadata jsonb, p_credits integer,
  p_usage jsonb, p_next_title text
)
returns table (assistant_message jsonb, credit_status text, replayed boolean)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_credits integer := greatest(0, coalesce(p_credits, 0));
  v_thread public.chat_threads;
  v_row public.assistant_requests;
  v_message public.chat_messages;
  v_wallet public.ai_credit_wallets;
  v_status text := 'charged';
begin
  if p_user_id is null then raise exception 'UNAUTHORIZED' using errcode = 'P0001'; end if;

  select * into v_thread from public.chat_threads ct
   where ct.id = p_thread_id and ct.user_id = p_user_id;
  if not found then raise exception 'THREAD_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_thread.store_id is distinct from p_store_id then
    raise exception 'THREAD_STORE_MISMATCH' using errcode = 'P0001';
  end if;

  select * into v_row from public.assistant_requests r
   where r.user_id = p_user_id and r.request_id = p_request_id for update;
  if not found then raise exception 'IDEMPOTENCY_TOKEN_MISMATCH' using errcode = 'P0001'; end if;

  if v_row.fingerprint <> p_request_fingerprint
     or v_row.store_id <> p_store_id
     or (v_row.thread_id is not null and v_row.thread_id <> p_thread_id) then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
  end if;

  -- Rejeu : statut de débit réel conservé, aucune nouvelle écriture.
  if v_row.state = 'completed' then
    select to_jsonb(m) into assistant_message from public.chat_messages m
     where m.id = v_row.assistant_message_id;
    return query select assistant_message, v_row.credit_status, true;
    return;
  end if;

  if v_row.attempt_token <> p_attempt_token then
    raise exception 'IDEMPOTENCY_TOKEN_MISMATCH' using errcode = 'P0001';
  end if;
  if v_row.lease_until < now() then
    raise exception 'IDEMPOTENCY_LEASE_LOST' using errcode = 'P0001';
  end if;

  insert into public.chat_messages (thread_id, role, content, credits_used, metadata)
  values (p_thread_id, 'user', p_user_message, 0,
          jsonb_build_object('request_id', p_request_id, 'request_fingerprint', p_request_fingerprint));

  insert into public.chat_messages (thread_id, role, content, credits_used, metadata)
  values (p_thread_id, 'assistant', p_assistant_content, v_credits, p_assistant_metadata)
  returning * into v_message;

  update public.chat_threads ct
     set updated_at = now(), title = coalesce(nullif(p_next_title, ''), ct.title)
   where ct.id = p_thread_id;

  insert into public.ai_usage (user_id, store_id, thread_id, feature, credits_used,
                               input_tokens, output_tokens, provider_name, model_name, provider_cost_usd)
  values (p_user_id, p_store_id, p_thread_id, 'chatbot', v_credits,
          coalesce((p_usage->>'input_tokens')::integer, 0),
          coalesce((p_usage->>'output_tokens')::integer, 0),
          p_usage->>'provider_name', p_usage->>'model_name',
          coalesce((p_usage->>'provider_cost_usd')::numeric, 0));

  select * into v_wallet from public.ai_credit_wallets w where w.user_id = p_user_id for update;
  if not found or (v_wallet.monthly_credits - v_wallet.credits_used) < v_credits then
    v_status := 'insufficient';
  else
    update public.ai_credit_wallets w
       set credits_used = w.credits_used + v_credits, updated_at = now()
     where w.id = v_wallet.id;
  end if;

  update public.assistant_requests r
     set state = 'completed', assistant_message_id = v_message.id,
         credit_status = v_status,
         credits_charged = case when v_status = 'charged' then v_credits else 0 end,
         lease_until = now(), updated_at = now()
   where r.user_id = p_user_id and r.request_id = p_request_id
     and r.attempt_token = p_attempt_token;

  assistant_message := to_jsonb(v_message);
  return query select assistant_message, v_status, false;
end;
$$;

revoke all on function public.rpc_assistant_finalize_request(
  uuid, uuid, text, text, uuid, uuid, text, text, text, jsonb, integer, jsonb, text
) from public, anon, authenticated;
grant execute on function public.rpc_assistant_finalize_request(
  uuid, uuid, text, text, uuid, uuid, text, text, text, jsonb, integer, jsonb, text
) to service_role;

commit;
