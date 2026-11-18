begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table saas_admin.meta_consents (
  id uuid primary key,
  user_id uuid,
  expires_at timestamptz not null default (now() + interval '180 days'),
  matching jsonb not null default '{}'::jsonb,
  page_window timestamptz not null default now(),
  page_hits integer not null default 0
);
create index meta_consent_user on saas_admin.meta_consents(user_id);
create index meta_consent_expiry on saas_admin.meta_consents(expires_at);

create table saas_admin.meta_outbox (
  id uuid primary key default gen_random_uuid(),
  consent_id uuid not null references saas_admin.meta_consents(id) on delete cascade,
  event_name text not null check (event_name in ('PageView','ViewContent','CompleteRegistration','InitiateCheckout','Subscribe')),
  business_id uuid,
  user_id uuid,
  subscription_id uuid,
  path text not null,
  matching jsonb not null,
  occurred_at timestamptz not null default now(),
  available_at timestamptz not null default now(),
  lease integer not null default 0,
  finished_at timestamptz,
  sent_at timestamptz,
  unique(event_name, business_id)
);
create index meta_outbox_ready on saas_admin.meta_outbox(available_at) where finished_at is null;
create index meta_outbox_consent on saas_admin.meta_outbox(consent_id);
create unique index meta_outbox_subscribe_subject on saas_admin.meta_outbox(subscription_id)
  where event_name = 'Subscribe' and subscription_id is not null;
alter table saas_admin.meta_consents enable row level security;
alter table saas_admin.meta_outbox enable row level security;
revoke all on saas_admin.meta_consents, saas_admin.meta_outbox from public, anon, authenticated, service_role;

create function public.rpc_meta_consent(p_old uuid, p_new uuid, p_user uuid, p_matching jsonb) returns void
language plpgsql security definer set search_path = pg_catalog as $$
begin
  if p_old is not null then delete from saas_admin.meta_consents where id = p_old; end if;
  if p_new is null and p_user is not null then
    delete from saas_admin.meta_consents where user_id = p_user;
  elsif p_new is not null then
    insert into saas_admin.meta_consents(id, user_id, matching) values (p_new, p_user, p_matching);
  end if;
end $$;

create function public.rpc_meta_page(p_consent uuid, p_page uuid, p_content uuid, p_path text, p_matching jsonb)
returns boolean language plpgsql security definer set search_path = pg_catalog as $$
declare c saas_admin.meta_consents;
begin
  if p_path not in ('/','/pricing','/features','/catalogue-integrations','/about','/contact','/faq',
    '/legal/confidentialite','/legal/conditions','/legal/mentions','/legal/suppression-des-donnees','/login','/signup','/subscribe',
    '/features/ventes','/features/publicite','/features/livraison','/features/stock','/features/assistant-ia','/features/multi-stores')
    or (p_content is not null) <> (p_path in ('/pricing','/features','/catalogue-integrations') or p_path like '/features/%') then return false; end if;
  update saas_admin.meta_consents set matching = matching || p_matching,
    page_hits = case when page_window <= now() - interval '1 minute' then 1 else page_hits + 1 end,
    page_window = case when page_window <= now() - interval '1 minute' then now() else page_window end
  where id = p_consent and expires_at > now() and (page_hits < 60 or page_window <= now() - interval '1 minute')
  returning * into c;
  if not found then return false; end if;
  insert into saas_admin.meta_outbox(id, consent_id, event_name, path, matching)
  values (p_page, c.id, 'PageView', p_path, c.matching) on conflict do nothing;
  if p_content is not null then
    insert into saas_admin.meta_outbox(id, consent_id, event_name, path, matching)
    values (p_content, c.id, 'ViewContent', p_path, c.matching) on conflict do nothing;
  end if;
  return true;
end $$;

-- The only registration authority is a real insert into auth.users, never the
-- potentially obfuscated signUp response or a subsequent confirmation click.
create function saas_admin.meta_on_signup() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
declare choice text := new.raw_user_meta_data->>'_jisra_meta_consent';
        event text := new.raw_user_meta_data->>'_jisra_meta_event';
        path text := new.raw_user_meta_data->>'_jisra_meta_path';
        c saas_admin.meta_consents;
begin
  new.raw_user_meta_data := new.raw_user_meta_data - array['_jisra_meta_consent','_jisra_meta_event','_jisra_meta_path'];
  if choice is null or event is null or coalesce(path,'') not in ('/login','/signup') then return new; end if;
  begin
    update saas_admin.meta_consents set user_id = new.id
    where id = choice::uuid and expires_at > now() and user_id is null returning * into c;
    if found then
      insert into saas_admin.meta_outbox(id, consent_id, event_name, business_id, user_id, path, matching)
      values (event::uuid, c.id, 'CompleteRegistration', new.id, new.id, path, c.matching) on conflict do nothing;
    end if;
  exception when others then null; -- tracking must not abort account creation
  end;
  return new;
end $$;
create trigger jisra_meta_on_signup before insert on auth.users
for each row execute function saas_admin.meta_on_signup();

create function public.rpc_meta_registration_event(p_event uuid, p_consent uuid, p_user uuid) returns boolean
language sql security definer set search_path = pg_catalog as $$
  select exists(select 1 from saas_admin.meta_outbox o join saas_admin.meta_consents c on c.id = o.consent_id
    where o.id = p_event and o.consent_id = p_consent and o.user_id = p_user
    and o.event_name = 'CompleteRegistration' and c.expires_at > now());
$$;

-- Reuse the existing idempotent RPC unchanged; the transaction-local context
-- is visible only to the verified 'created' business event emitted by it.
create function public.rpc_meta_payment_create(p_user uuid, p_price uuid, p_key uuid, p_consent uuid, p_matching jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare r public.payment_requests; event_id uuid := gen_random_uuid();
begin
  perform set_config('jisra.meta_checkout', jsonb_build_object('id',event_id,'consent',p_consent,'matching',p_matching)::text, true);
  r := public.rpc_payment_create(p_user, p_price, p_key);
  perform set_config('jisra.meta_checkout', '', true);
  return jsonb_build_object('id', r.id, 'event_id', (select id from saas_admin.meta_outbox where id = event_id));
end $$;

create function saas_admin.meta_on_payment() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
declare ctx jsonb; c saas_admin.meta_consents;
begin
  if new.event_type = 'created' then
    ctx := nullif(current_setting('jisra.meta_checkout', true), '')::jsonb;
    if ctx is null then return new; end if;
    update saas_admin.meta_consents set user_id = new.user_id, matching = matching || (ctx->'matching')
    where id = (ctx->>'consent')::uuid and expires_at > now() and (user_id is null or user_id = new.user_id)
    returning * into c;
    if found then
      insert into saas_admin.meta_outbox(id, consent_id, event_name, business_id, user_id, path, matching)
      values ((ctx->>'id')::uuid, c.id, 'InitiateCheckout', new.request_id, new.user_id, '/subscribe', c.matching)
      on conflict do nothing;
    end if;
  elsif new.event_type = 'validated' then
    -- A scheduled period does not grant current rights. The existing bank RPC
    -- schedules behind a non-free period; never infer a new conversion from its date.
    insert into saas_admin.meta_outbox(consent_id, event_name, business_id, user_id, subscription_id, path, matching)
    select consent_choice.id, 'Subscribe', r.user_id, r.user_id, s.id, '/subscribe', consent_choice.matching
    from public.payment_requests r
    join saas_admin.payments p on p.request_id = r.id
    join saas_admin.payment_allocations a on a.request_id = r.id and a.payment_id = p.id
    join public.subscriptions s on s.id = a.subscription_id and s.payment_request_id = r.id and s.user_id = r.user_id
    join public.plans plan on plan.id = s.plan_id
    join lateral (select choice.* from saas_admin.meta_consents choice
      where choice.user_id = r.user_id and choice.expires_at > now() order by choice.expires_at desc, choice.id limit 1) consent_choice on true
    where r.id = new.request_id and r.user_id = new.user_id and r.status = 'validated'
      and p.amount_minor > 0 and a.amount_minor = p.amount_minor and s.amount_paid > 0 and s.status = 'active'
      and s.started_at <= now() and plan.code <> 'free'
      and not exists (select 1 from public.subscriptions prior join public.plans prior_plan on prior_plan.id = prior.plan_id
        where prior.user_id = r.user_id and prior.id <> s.id and prior.amount_paid > 0 and prior_plan.code <> 'free')
    on conflict do nothing;
  end if;
  return new;
exception when others then return new; -- never undo a verified business operation for analytics
end $$;
create trigger jisra_meta_on_payment after insert on public.payment_request_events
for each row when (new.event_type in ('created','validated')) execute function saas_admin.meta_on_payment();

create function public.rpc_meta_claim(p_subscription uuid default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog as $$
declare batch jsonb;
begin
  if p_subscription is null then
    delete from saas_admin.meta_consents where expires_at <= now();
    update saas_admin.meta_outbox set finished_at = now(), matching = '{}'::jsonb
    where finished_at is null and (occurred_at <= now() - interval '24 hours' or lease >= 24) and available_at <= now();
    delete from saas_admin.meta_outbox where finished_at <= now() - interval '7 days';
  end if;
  with ready as (
    select o.id from saas_admin.meta_outbox o join saas_admin.meta_consents c on c.id = o.consent_id
    where o.finished_at is null and o.available_at <= now() and o.occurred_at > now() - interval '24 hours'
      and o.lease < 24 and c.expires_at > now()
      and (p_subscription is null or (o.event_name = 'Subscribe' and o.subscription_id = p_subscription and o.lease = 0))
    order by o.available_at limit 30 for update of o skip locked
  ), claimed as (
    update saas_admin.meta_outbox o set available_at = now() + interval '5 minutes', lease = lease + 1
    from ready where o.id = ready.id returning o.id,o.lease,o.event_name,o.occurred_at,o.path,o.user_id,o.matching
  ) select coalesce(jsonb_agg(to_jsonb(claimed)), '[]'::jsonb) into batch from claimed;
  return batch;
end $$;

create function public.rpc_meta_can_send(p_event uuid, p_lease integer) returns boolean
language sql security definer set search_path = pg_catalog as $$
  select exists(select 1 from saas_admin.meta_outbox o join saas_admin.meta_consents c on c.id = o.consent_id
    where o.id = p_event and p_lease > 0 and o.lease = p_lease and o.finished_at is null and o.available_at > now()
      and o.occurred_at > now() - interval '24 hours' and c.expires_at > now());
$$;

create function public.rpc_meta_finish(p_event uuid,p_lease integer,p_sent boolean) returns void
language sql security definer set search_path = pg_catalog as $$
  update saas_admin.meta_outbox set finished_at = now(), sent_at = now(), matching = '{}'::jsonb
  where id = p_event and p_lease > 0 and lease = p_lease and finished_at is null and p_sent;
$$;

revoke all on function saas_admin.meta_on_signup(),saas_admin.meta_on_payment() from public,anon,authenticated,service_role;
revoke all on function public.rpc_meta_consent(uuid,uuid,uuid,jsonb),public.rpc_meta_page(uuid,uuid,uuid,text,jsonb),
  public.rpc_meta_registration_event(uuid,uuid,uuid),public.rpc_meta_payment_create(uuid,uuid,uuid,uuid,jsonb),
  public.rpc_meta_claim(uuid),public.rpc_meta_can_send(uuid,integer),public.rpc_meta_finish(uuid,integer,boolean) from public,anon,authenticated;
grant execute on function public.rpc_meta_consent(uuid,uuid,uuid,jsonb),public.rpc_meta_page(uuid,uuid,uuid,text,jsonb),
  public.rpc_meta_registration_event(uuid,uuid,uuid),public.rpc_meta_payment_create(uuid,uuid,uuid,uuid,jsonb),
  public.rpc_meta_claim(uuid),public.rpc_meta_can_send(uuid,integer),public.rpc_meta_finish(uuid,integer,boolean) to service_role;
commit;