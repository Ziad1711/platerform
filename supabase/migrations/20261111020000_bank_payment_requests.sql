-- Lot 3 : demandes uniquement. Aucun encaissement ni activation.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create table public.billing_bank_settings (
  id boolean primary key default true check(id),
  enabled boolean not null default false,
  beneficiary text,
  bank_name text,
  rib text,
  instructions text,
  updated_at timestamptz not null default now(),
  check(not enabled or (length(trim(beneficiary))>=2 and length(trim(bank_name))>=2 and rib ~ '^[0-9]{24}$'))
);
insert into public.billing_bank_settings(id) values(true);
create table public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  price_id uuid not null references public.plan_prices(id) on delete restrict,
  reference text not null unique default ('JIS-'||upper(replace(gen_random_uuid()::text,'-',''))),
  idempotency_key uuid not null,
  plan_id uuid not null references public.plans(id),
  plan_code text not null,
  plan_name text not null,
  billing_period text not null check(billing_period in ('monthly','yearly')),
  duration_months integer not null,
  price_version integer not null check(price_version>0),
  amount_minor bigint not null check(amount_minor>0),
  currency text not null check(currency='MAD'),
  status text not null default 'pending' check(status in ('pending','review','validated','refused','cancelled','expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default(now()+interval '7 days'),
  declared_at timestamptz,
  bank_snapshot jsonb,
  unique(user_id,idempotency_key),
  check(expires_at>created_at),
  check((billing_period='monthly' and duration_months=1) or (billing_period='yearly' and duration_months=12))
);
create unique index payment_requests_one_open on public.payment_requests(user_id,plan_id,billing_period)
  where status in ('pending','review');
create index payment_requests_user_created on public.payment_requests(user_id,created_at desc);
create table public.payment_proofs (
  id uuid primary key,
  request_id uuid not null references public.payment_requests(id) on delete restrict,
  user_id uuid not null references public.profiles(id),
  object_path text not null unique,
  mime_type text not null check(mime_type in ('application/pdf','image/png','image/jpeg')),
  size_bytes integer not null check(size_bytes between 1 and 5242880),
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique(request_id,sha256)
);
create table public.payment_request_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.payment_requests(id),
  user_id uuid not null references public.profiles(id),
  event_type text not null check(event_type in ('created','declared','proof_added','expired','cancelled')),
  created_at timestamptz not null default now()
);
create index payment_events_request on public.payment_request_events(request_id,id);
alter table public.billing_bank_settings enable row level security;
alter table public.payment_requests enable row level security;
alter table public.payment_proofs enable row level security;
alter table public.payment_request_events enable row level security;
revoke all on public.billing_bank_settings,public.payment_requests,public.payment_proofs,public.payment_request_events from public,anon,authenticated;
grant select on public.payment_requests,public.payment_proofs,public.payment_request_events to authenticated;
grant select on public.billing_bank_settings,public.payment_requests,public.payment_proofs,public.payment_request_events to service_role;
create policy payment_requests_own on public.payment_requests for select to authenticated using(user_id=auth.uid());
create policy payment_proofs_own on public.payment_proofs for select to authenticated using(user_id=auth.uid());
create policy payment_events_own on public.payment_request_events for select to authenticated using(user_id=auth.uid());

-- Ces RPC sont réservées au backend. p_user provient obligatoirement de getUser().
create function public.rpc_payment_create(p_user uuid,p_price uuid,p_key uuid)
returns public.payment_requests language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.payment_requests; pr public.plan_prices; pl public.plans;
begin
 if p_user is null or p_key is null then raise exception 'PAYMENT_INVALID'; end if;
 perform pg_advisory_xact_lock(hashtext('payment_user'),hashtext(p_user::text));
 select * into r from public.payment_requests where user_id=p_user and idempotency_key=p_key;
 if found then
   if r.price_id<>p_price then raise exception 'PAYMENT_IDEMPOTENCY_CONFLICT'; end if;
   return r;
 end if;
 select * into pr from public.plan_prices where id=p_price for share;
 if not found or not pr.available or pr.valid_from>now() or pr.valid_until<=now() or pr.amount_minor<=0 then
   raise exception 'PAYMENT_PRICE_UNAVAILABLE';
 end if;
 select * into pl from public.plans where id=pr.plan_id;
 with expired as (
   update public.payment_requests set status='expired' where user_id=p_user and status='pending' and expires_at<=now() returning id,user_id
 ) insert into public.payment_request_events(request_id,user_id,event_type) select id,user_id,'expired' from expired;
 select * into r from public.payment_requests where user_id=p_user and plan_id=pr.plan_id and billing_period=pr.billing_period and status in ('pending','review');
 if found then return r; end if;
 if (select count(*) from public.payment_requests where user_id=p_user and created_at>now()-interval '1 day')>=10 then raise exception 'PAYMENT_RATE_LIMIT'; end if;
 insert into public.payment_requests(user_id,price_id,idempotency_key,plan_id,plan_code,plan_name,billing_period,duration_months,price_version,amount_minor,currency)
 values(p_user,pr.id,p_key,pl.id,pl.code,pl.name,pr.billing_period,pr.duration_months,pr.version,pr.amount_minor,pr.currency) returning * into r;
 insert into public.payment_request_events(request_id,user_id,event_type) values(r.id,p_user,'created');
 return r;
end $$;

create function public.rpc_payment_action(p_user uuid,p_request uuid,p_action text,p_proof jsonb default null)
returns public.payment_requests language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.payment_requests; b public.billing_bank_settings;
begin
 perform pg_advisory_xact_lock(hashtext('payment_user'),hashtext(p_user::text));
 select * into r from public.payment_requests where id=p_request and user_id=p_user for update;
 if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
 if r.status='pending' and r.expires_at<=now() then
   update public.payment_requests set status='expired' where id=r.id returning * into r;
   insert into public.payment_request_events(request_id,user_id,event_type) values(r.id,p_user,'expired');
 end if;
 if p_action='read' then return r; end if;
 if p_action='cancel' and r.status='pending' then
   update public.payment_requests set status='cancelled' where id=r.id returning * into r;
   insert into public.payment_request_events(request_id,user_id,event_type) values(r.id,p_user,'cancelled');
   return r;
 end if;
 if r.status not in ('pending','review') then raise exception 'PAYMENT_CLOSED'; end if;
 select * into b from public.billing_bank_settings where id=true for share;
 if b.enabled is not true then raise exception 'PAYMENT_UNAVAILABLE'; end if;
 if p_action='declare' then
   if r.status='review' then return r; end if;
   update public.payment_requests set status='review',declared_at=now(),
     bank_snapshot=jsonb_build_object('beneficiary',b.beneficiary,'bank_name',b.bank_name,'rib',b.rib,'instructions',b.instructions)
     where id=r.id returning * into r;
   insert into public.payment_request_events(request_id,user_id,event_type) values(r.id,p_user,'declared');
 elsif p_action='proof' then
   if exists(select 1 from public.payment_proofs where request_id=r.id and sha256=p_proof->>'sha256') then return r; end if;
   if (select count(*) from public.payment_proofs where request_id=r.id)>=3 then raise exception 'PAYMENT_PROOF_LIMIT'; end if;
   if p_proof->>'object_path'<>p_user::text||'/'||r.id::text||'/'||(p_proof->>'id') then raise exception 'PAYMENT_INVALID'; end if;
   insert into public.payment_proofs(id,request_id,user_id,object_path,mime_type,size_bytes,sha256)
   values((p_proof->>'id')::uuid,r.id,p_user,p_proof->>'object_path',p_proof->>'mime_type',(p_proof->>'size_bytes')::integer,p_proof->>'sha256');
   insert into public.payment_request_events(request_id,user_id,event_type) values(r.id,p_user,'proof_added');
 else raise exception 'PAYMENT_INVALID'; end if;
 return r;
end $$;
revoke all on function public.rpc_payment_create(uuid,uuid,uuid),public.rpc_payment_action(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.rpc_payment_create(uuid,uuid,uuid),public.rpc_payment_action(uuid,uuid,text,jsonb) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('payment-proofs','payment-proofs',false,5242880,array['application/pdf','image/png','image/jpeg']);
-- Aucun INSERT/UPDATE/DELETE client : upload validé exclusivement par l'API.
create policy payment_proof_owner_download on storage.objects for select to authenticated using(
 bucket_id='payment-proofs' and exists(select 1 from public.payment_proofs p where p.user_id=auth.uid() and p.object_path=name));
commit;