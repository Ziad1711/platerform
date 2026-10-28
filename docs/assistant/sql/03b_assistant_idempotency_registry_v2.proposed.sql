-- ============================================================================
-- PROPOSITION v2 — NE PAS EXÉCUTER. Remplace 03_assistant_idempotency_guard.
-- Contrat aligné sur lib/assistant/idempotency.ts (fencing + statut de débit).
-- begin -> (state, attempt_token, assistant_message_id, credit_status)
-- complete(p_request_id, p_attempt_token, p_assistant_message_id, p_credit_status)
-- fail(p_request_id, p_attempt_token, p_reason)
-- Prérequis : 01_, 02_. Ordre : 01 → 02 → 03b → 05b.
-- ============================================================================
begin;

create table if not exists public.assistant_requests (
  user_id              uuid        not null references public.profiles(id) on delete cascade,
  request_id           text        not null check (char_length(request_id) between 8 and 100),
  store_id             uuid        not null references public.stores(id) on delete cascade,
  thread_id            uuid        references public.chat_threads(id) on delete set null,
  fingerprint          text        not null check (char_length(fingerprint) = 64),
  state                text        not null default 'in_progress'
                                   check (state in ('in_progress','completed','failed')),
  attempt_token        uuid        not null default gen_random_uuid(),
  lease_until          timestamptz not null default (now() + interval '2 minutes'),
  assistant_message_id uuid        references public.chat_messages(id) on delete set null,
  credit_status        text        not null default 'not_charged'
                                   check (credit_status in ('charged','insufficient','failed','not_charged')),
  credits_reserved     integer     not null default 0 check (credits_reserved >= 0),
  credits_charged      integer     not null default 0 check (credits_charged >= 0),
  last_error           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  primary key (user_id, request_id)
);

alter table public.assistant_requests enable row level security;
revoke all on public.assistant_requests from anon, authenticated;

create or replace function public.rpc_assistant_begin_request(
  p_request_id text, p_store_id uuid, p_thread_id uuid, p_fingerprint text
)
returns table (state text, attempt_token uuid, assistant_message_id uuid, credit_status text)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user uuid := auth.uid(); v_row public.assistant_requests;
begin
  if v_user is null then raise exception 'UNAUTHORIZED' using errcode = 'P0001'; end if;
  if not public.assistant_can_read_thread(p_store_id) then
    raise exception 'FORBIDDEN_STORE' using errcode = 'P0001';
  end if;

  insert into public.assistant_requests (user_id, request_id, store_id, thread_id, fingerprint)
  values (v_user, p_request_id, p_store_id, p_thread_id, p_fingerprint)
  on conflict (user_id, request_id) do nothing;

  select * into v_row from public.assistant_requests r
   where r.user_id = v_user and r.request_id = p_request_id for update;

  if v_row.fingerprint <> p_fingerprint or v_row.store_id <> p_store_id
     or (v_row.thread_id is not null and p_thread_id is not null and v_row.thread_id <> p_thread_id) then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
  end if;

  if v_row.state = 'completed' then
    return query select 'completed'::text, v_row.attempt_token, v_row.assistant_message_id, v_row.credit_status;
    return;
  end if;

  if v_row.state = 'in_progress' and v_row.lease_until > now() then
    raise exception 'IDEMPOTENCY_IN_PROGRESS' using errcode = 'P0001';
  end if;

  update public.assistant_requests r
     set state = 'in_progress', attempt_token = gen_random_uuid(),
         lease_until = now() + interval '2 minutes', updated_at = now()
   where r.user_id = v_user and r.request_id = p_request_id
   returning * into v_row;

  return query select 'in_progress'::text, v_row.attempt_token, null::uuid, v_row.credit_status;
end;
$$;

create or replace function public.rpc_assistant_complete_request(
  p_request_id text, p_attempt_token uuid, p_assistant_message_id uuid, p_credit_status text
)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED' using errcode = 'P0001'; end if;
  if p_credit_status not in ('charged','insufficient','failed','not_charged') then
    raise exception 'INVALID_CREDIT_STATUS' using errcode = 'P0001';
  end if;

  update public.assistant_requests r
     set state = 'completed', assistant_message_id = p_assistant_message_id,
         credit_status = p_credit_status,
         credits_charged = case when p_credit_status = 'charged' then r.credits_reserved else 0 end,
         lease_until = now(), updated_at = now()
   where r.user_id = auth.uid() and r.request_id = p_request_id
     and r.attempt_token = p_attempt_token and r.state = 'in_progress';

  if not found then raise exception 'IDEMPOTENCY_TOKEN_MISMATCH' using errcode = 'P0001'; end if;
end;
$$;

create or replace function public.rpc_assistant_fail_request(
  p_request_id text, p_attempt_token uuid, p_reason text
)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED' using errcode = 'P0001'; end if;

  update public.assistant_requests r
     set state = 'failed', lease_until = now(),
         last_error = left(coalesce(p_reason, ''), 200), updated_at = now()
   where r.user_id = auth.uid() and r.request_id = p_request_id
     and r.attempt_token = p_attempt_token and r.state = 'in_progress';
end;
$$;

revoke all on function public.rpc_assistant_begin_request(text, uuid, uuid, text) from public, anon;
revoke all on function public.rpc_assistant_complete_request(text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.rpc_assistant_fail_request(text, uuid, text) from public, anon;
grant execute on function public.rpc_assistant_begin_request(text, uuid, uuid, text) to authenticated;
grant execute on function public.rpc_assistant_complete_request(text, uuid, uuid, text) to service_role;
grant execute on function public.rpc_assistant_fail_request(text, uuid, text) to authenticated;

commit;

