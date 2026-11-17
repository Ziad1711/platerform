-- Lot 4 : file de notifications persistante et idempotente, alimentée uniquement par
-- des événements métier confirmés (declared / validated / refused). Aucun envoi SMTP ici.
begin;
set local lock_timeout='5s';

create table public.email_outbox (
  id bigint generated always as identity primary key,
  dedupe_key text not null unique,
  recipient text not null,
  kind text not null check(kind in ('receipt','activated','scheduled','refused')),
  payload jsonb not null,
  status text not null default 'pending' check(status in ('pending','sent','failed')),
  attempts integer not null default 0 check(attempts >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index email_outbox_pending on public.email_outbox(status, id) where status = 'pending';
alter table public.email_outbox enable row level security;
revoke all on public.email_outbox from public,anon,authenticated;

-- Alimentation idempotente depuis les événements confirmés de demande de paiement.
create or replace function public.enqueue_payment_email() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_email text;
  v_kind text;
  v_req public.payment_requests;
  v_sub public.subscriptions;
  v_payload jsonb;
begin
  if new.event_type not in ('declared','validated','refused') then return new; end if;

  select u.email into v_email from auth.users u where u.id = new.user_id;
  if v_email is null then return new; end if;

  select * into v_req from public.payment_requests where id = new.request_id;
  if not found then return new; end if;

  v_payload := jsonb_build_object(
    'request_id', v_req.id::text,
    'reference', v_req.reference,
    'plan_name', v_req.plan_name,
    'amount_minor', v_req.amount_minor,
    'currency', v_req.currency,
    'duration_months', v_req.duration_months
  );

  if new.event_type = 'declared' then
    v_kind := 'receipt';
  elsif new.event_type = 'refused' then
    v_kind := 'refused';
    v_payload := v_payload || jsonb_build_object('reason', coalesce(new.reason, ''));
  else
    select * into v_sub from public.subscriptions where payment_request_id = v_req.id limit 1;
    if v_sub.id is null then return new; end if;
    v_payload := v_payload || jsonb_build_object('started_at', v_sub.started_at, 'expires_at', v_sub.expires_at);
    if v_sub.started_at is not null and v_sub.started_at <= now() then
      v_kind := 'activated';
    else
      v_kind := 'scheduled';
    end if;
  end if;

  insert into public.email_outbox(dedupe_key, recipient, kind, payload)
  values (new.id::text || ':' || v_kind, v_email, v_kind, v_payload)
  on conflict (dedupe_key) do nothing;

  return new;
end $$;

create trigger payment_events_email_enqueue after insert on public.payment_request_events
  for each row execute function public.enqueue_payment_email();

commit;
