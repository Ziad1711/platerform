-- Lot 4B : encaissement bancaire vérifié et période acquise dans une transaction.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
insert into saas_admin.role_permissions(role,permission) values
 ('platform_owner','payments.read'),('platform_owner','payments.approve'),('platform_owner','bank_settings.manage');

alter table public.billing_bank_settings add column commercial_conditions_approved boolean not null default false;
alter table public.billing_bank_settings add constraint bank_enabled_complete check(not enabled or (
 beneficiary is not null and length(trim(beneficiary))>=2 and bank_name is not null
 and length(trim(bank_name))>=2 and rib is not null and rib ~ '^[0-9]{24}$' and commercial_conditions_approved));
alter table public.payment_requests add constraint payment_request_owner_key unique(id,user_id);
alter table public.payment_proofs add constraint payment_proof_request_owner
 foreign key(request_id,user_id) references public.payment_requests(id,user_id);
alter table public.payment_request_events add column actor_id uuid;
alter table public.payment_request_events add column reason text;
alter table public.payment_request_events drop constraint payment_request_events_event_type_check;
alter table public.payment_request_events add constraint payment_event_type check(event_type in
 ('created','declared','proof_added','expired','cancelled','validated','refused'));

create table saas_admin.payments (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null unique references public.payment_requests(id),
 bank_account text not null check(length(bank_account) between 2 and 80),
 bank_reference text not null check(length(bank_reference) between 3 and 120),
 amount_minor bigint not null check(amount_minor>0),
 currency text not null check(currency='MAD'),
 value_date date not null,
 verified_by uuid not null references auth.users(id),
 verified_at timestamptz not null default now(),
 decision_key uuid not null unique,
 reason text not null check(length(reason) between 10 and 300),
 unique(bank_account,bank_reference)
);
create table saas_admin.payment_allocations (
 payment_id uuid primary key references saas_admin.payments(id),
 request_id uuid not null unique references public.payment_requests(id),
 subscription_id uuid not null unique references public.subscriptions(id),
 amount_minor bigint not null check(amount_minor>0),
 created_at timestamptz not null default now()
);
alter table public.subscriptions add column payment_request_id uuid unique references public.payment_requests(id);
alter table public.subscriptions add column price_id uuid references public.plan_prices(id);
create table saas_admin.bank_settings_history (
 id bigint generated always as identity primary key,
 actor_id uuid not null,
 beneficiary text,bank_name text,rib text,instructions text,
 commercial_conditions_approved boolean not null,
 reason text not null,
 created_at timestamptz not null default now()
);
create table saas_admin.action_limits (
 actor_id uuid not null,action text not null,window_start timestamptz not null,hits integer not null,
 primary key(actor_id,action)
);
create table saas_admin.payment_decisions (
 decision_key uuid primary key,
 request_id uuid not null unique references public.payment_requests(id),
 actor_id uuid not null,
 action text not null check(action in ('approve','refuse')),
 reason text not null,
 created_at timestamptz not null default now()
);
alter table saas_admin.payments enable row level security;
alter table saas_admin.payment_allocations enable row level security;
alter table saas_admin.bank_settings_history enable row level security;
alter table saas_admin.action_limits enable row level security;
alter table saas_admin.payment_decisions enable row level security;
revoke all on all tables in schema saas_admin from public,anon,authenticated,service_role;
revoke all on all sequences in schema saas_admin from public,anon,authenticated,service_role;

create function saas_admin.append_only() returns trigger language plpgsql as $$
begin raise exception 'AUDIT_APPEND_ONLY'; end $$;
create trigger admin_audit_append_only before update or delete on saas_admin.audit_events
 for each row execute function saas_admin.append_only();
create trigger payment_events_append_only before update or delete on public.payment_request_events
 for each row execute function saas_admin.append_only();
create trigger bank_history_append_only before update or delete on saas_admin.bank_settings_history
 for each row execute function saas_admin.append_only();
create trigger payments_append_only before update or delete on saas_admin.payments
 for each row execute function saas_admin.append_only();
create trigger allocations_append_only before update or delete on saas_admin.payment_allocations
 for each row execute function saas_admin.append_only();
create trigger decisions_append_only before update or delete on saas_admin.payment_decisions
 for each row execute function saas_admin.append_only();

create function saas_admin.admit_action(p_action text) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
declare n integer;
begin
 insert into saas_admin.action_limits(actor_id,action,window_start,hits) values(auth.uid(),p_action,clock_timestamp(),1)
 on conflict(actor_id,action) do update set
 hits=case when saas_admin.action_limits.window_start<clock_timestamp()-interval '1 minute' then 1 else saas_admin.action_limits.hits+1 end,
 window_start=case when saas_admin.action_limits.window_start<clock_timestamp()-interval '1 minute' then clock_timestamp() else saas_admin.action_limits.window_start end
 returning hits into n;
 return n<=20;
end $$;

create function public.rpc_admin_payment_decide(p_request uuid,p_action text,p_key uuid,p_reason text,
 p_amount bigint default null,p_currency text default null,p_bank_account text default null,
 p_bank_reference text default null,p_value_date date default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.payment_requests; pay saas_admin.payments; dec saas_admin.payment_decisions;
 sub_id uuid; start_at timestamptz; end_at timestamptz; previous_end timestamptz;
begin
 -- Synchronisation avec attribution/révocation des rôles, puis contrôle relu.
 perform pg_advisory_xact_lock(hashtext('saas_admin_memberships'));
 if not saas_admin.has_permission('payments.approve',true) then
   insert into saas_admin.audit_events(actor_id,action,target_id,outcome) values(auth.uid(),'payments.approve',p_request,'denied');
   return jsonb_build_object('error','ADMIN_FORBIDDEN');
 end if;
 if not saas_admin.admit_action('payments.approve') then return jsonb_build_object('error','ADMIN_RATE_LIMIT'); end if;
 if p_action not in ('approve','refuse') or p_action is null or p_key is null
   or length(trim(coalesce(p_reason,''))) not between 10 and 300 then return jsonb_build_object('error','ADMIN_INVALID'); end if;
 select * into r from public.payment_requests where id=p_request;
 if not found then return jsonb_build_object('error','PAYMENT_NOT_FOUND'); end if;
 perform pg_advisory_xact_lock(hashtext('payment_user'),hashtext(r.user_id::text));
 select * into r from public.payment_requests where id=p_request for update;
 if r.user_id=auth.uid() then return jsonb_build_object('error','PAYMENT_SELF_APPROVAL'); end if;
 select * into dec from saas_admin.payment_decisions where decision_key=p_key;
 if found and (dec.request_id<>r.id or dec.action<>p_action) then return jsonb_build_object('error','PAYMENT_IDEMPOTENCY_CONFLICT'); end if;
 if r.status in ('validated','refused') then
   select * into dec from saas_admin.payment_decisions where request_id=r.id;
   if dec.action<>p_action then return jsonb_build_object('error','PAYMENT_CLOSED'); end if;
   if p_action='approve' then
     select * into pay from saas_admin.payments where request_id=r.id;
     if pay.amount_minor is distinct from p_amount or pay.currency is distinct from p_currency
       or pay.bank_account is distinct from upper(trim(p_bank_account)) or pay.bank_reference is distinct from upper(trim(p_bank_reference))
       or pay.value_date is distinct from p_value_date then return jsonb_build_object('error','PAYMENT_IDEMPOTENCY_CONFLICT'); end if;
   end if;
   return jsonb_build_object('ok',true,'replayed',true,'status',r.status);
 end if;
 if r.status not in ('pending','review') or (r.status='pending' and r.expires_at<=now()) then return jsonb_build_object('error','PAYMENT_CLOSED'); end if;
 if p_action='refuse' then
   update public.payment_requests set status='refused' where id=r.id;
 else
   if p_amount is distinct from r.amount_minor or p_currency is distinct from r.currency then return jsonb_build_object('error','PAYMENT_AMOUNT_MISMATCH'); end if;
   if p_bank_account is null or length(trim(p_bank_account)) not between 2 and 80
     or p_bank_reference is null or length(trim(p_bank_reference)) not between 3 and 120
     or p_value_date is null or p_value_date>(now() at time zone 'UTC')::date then return jsonb_build_object('error','ADMIN_INVALID'); end if;
   perform pg_advisory_xact_lock(hashtext('bank_transaction'),hashtext(upper(trim(p_bank_account))||':'||upper(trim(p_bank_reference))));
   if exists(select 1 from saas_admin.payments where bank_account=upper(trim(p_bank_account)) and bank_reference=upper(trim(p_bank_reference))) then
     return jsonb_build_object('error','PAYMENT_BANK_REFERENCE_USED'); end if;
   -- Aucun changement de forfait ni abonnement historique sans échéance écrasé.
   if exists(select 1 from public.subscriptions s join public.plans p on p.id=s.plan_id
     where s.user_id=r.user_id and s.status='active' and p.code<>'free'
       and (s.expires_at is null or s.expires_at>now()) and (s.plan_id<>r.plan_id or s.expires_at is null)) then
     return jsonb_build_object('error','PAYMENT_SUBSCRIPTION_CONFLICT'); end if;
   select max(expires_at) into previous_end from public.subscriptions where user_id=r.user_id and plan_id=r.plan_id
     and status='active' and expires_at>now();
   start_at:=greatest(now(),coalesce(previous_end,now()));
   end_at:=((start_at at time zone 'UTC')+make_interval(months=>r.duration_months)) at time zone 'UTC';
   insert into saas_admin.payments(request_id,bank_account,bank_reference,amount_minor,currency,value_date,verified_by,decision_key,reason)
   values(r.id,upper(trim(p_bank_account)),upper(trim(p_bank_reference)),r.amount_minor,r.currency,p_value_date,auth.uid(),p_key,trim(p_reason)) returning * into pay;
   insert into public.subscriptions(user_id,plan_id,status,amount_paid,currency,started_at,expires_at,payment_request_id,price_id)
   values(r.user_id,r.plan_id,'active',r.amount_minor::numeric/100,r.currency,start_at,end_at,r.id,r.price_id) returning id into sub_id;
   insert into saas_admin.payment_allocations(payment_id,request_id,subscription_id,amount_minor) values(pay.id,r.id,sub_id,r.amount_minor);
   update public.payment_requests set status='validated' where id=r.id;
 end if;
 insert into saas_admin.payment_decisions(decision_key,request_id,actor_id,action,reason) values(p_key,r.id,auth.uid(),p_action,trim(p_reason));
 insert into public.payment_request_events(request_id,user_id,event_type,actor_id,reason)
 values(r.id,r.user_id,case when p_action='approve' then 'validated' else 'refused' end,auth.uid(),trim(p_reason));
 insert into saas_admin.audit_events(actor_id,action,target_id,outcome,reason) values(auth.uid(),'payments.'||p_action,r.id,'changed',trim(p_reason));
 return jsonb_build_object('ok',true,'replayed',false,'status',case when p_action='approve' then 'validated' else 'refused' end,
   'subscription_id',sub_id,'started_at',start_at,'expires_at',end_at);
end $$;

create function public.rpc_admin_payment_list(p_search text default '',p_status text default '',p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare rows jsonb;
begin
 if not saas_admin.has_permission('payments.read',true) then return jsonb_build_object('error','ADMIN_FORBIDDEN'); end if;
 if length(coalesce(p_search,''))>100 or p_offset<0 or p_offset>100000 then return jsonb_build_object('error','ADMIN_INVALID'); end if;
 select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into rows from (
   select r.*,p.full_name as client_name from public.payment_requests r join public.profiles p on p.id=r.user_id
   where (coalesce(p_status,'')='' or r.status=p_status)
    and (coalesce(p_search,'')='' or r.reference ilike '%'||p_search||'%' or p.full_name ilike '%'||p_search||'%' or r.user_id::text=p_search)
   order by r.created_at desc,r.id limit 50 offset p_offset) q;
 insert into saas_admin.audit_events(actor_id,action,outcome) values(auth.uid(),'payments.list','allowed');
 return jsonb_build_object('requests',rows);
end $$;

create function public.rpc_admin_payment_detail(p_request uuid,p_proof uuid default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare row_data jsonb; proofs jsonb; events jsonb; receipt jsonb; object_path text;
begin
 if not saas_admin.has_permission('payments.read',true) then return jsonb_build_object('error','ADMIN_FORBIDDEN'); end if;
 select to_jsonb(r)||jsonb_build_object('client_name',p.full_name) into row_data
 from public.payment_requests r join public.profiles p on p.id=r.user_id where r.id=p_request;
 if row_data is null then return jsonb_build_object('error','PAYMENT_NOT_FOUND'); end if;
 if p_proof is not null then
   select pp.object_path into object_path from public.payment_proofs pp where pp.id=p_proof and pp.request_id=p_request;
   if object_path is null then return jsonb_build_object('error','PAYMENT_NOT_FOUND'); end if;
   insert into saas_admin.audit_events(actor_id,action,target_id,outcome) values(auth.uid(),'payments.proof.download',p_proof,'allowed');
   return jsonb_build_object('object_path',object_path);
 end if;
 select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into proofs from (
   select id,mime_type,size_bytes,created_at from public.payment_proofs where request_id=p_request order by created_at) q;
 select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]'::jsonb) into events from public.payment_request_events e where request_id=p_request;
 select to_jsonb(p)||jsonb_build_object('subscription_id',a.subscription_id,'started_at',s.started_at,'expires_at',s.expires_at) into receipt
 from saas_admin.payments p join saas_admin.payment_allocations a on a.payment_id=p.id join public.subscriptions s on s.id=a.subscription_id where p.request_id=p_request;
 insert into saas_admin.audit_events(actor_id,action,target_id,outcome) values(auth.uid(),'payments.detail',p_request,'allowed');
 return jsonb_build_object('request',row_data,'proofs',proofs,'events',events,'receipt',receipt);
end $$;

create function public.rpc_admin_bank_settings(p_values jsonb default null,p_reason text default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare b public.billing_bank_settings;
begin
 perform pg_advisory_xact_lock(hashtext('saas_admin_memberships'));
 if not saas_admin.has_permission('bank_settings.manage',true) then return jsonb_build_object('error','ADMIN_FORBIDDEN'); end if;
 if p_values is not null then
   if not saas_admin.admit_action('bank_settings.manage') then return jsonb_build_object('error','ADMIN_RATE_LIMIT'); end if;
   if length(trim(coalesce(p_reason,''))) not between 10 and 300 or coalesce((p_values->>'enabled')::boolean,false) then
     return jsonb_build_object('error','BANK_PUBLIC_ENABLE_NOT_AUTHORIZED'); end if;
   if p_values->>'rib' is not null and p_values->>'rib' !~ '^[0-9]{24}$' then return jsonb_build_object('error','ADMIN_INVALID'); end if;
   update public.billing_bank_settings set enabled=false,beneficiary=nullif(trim(p_values->>'beneficiary'),''),
     bank_name=nullif(trim(p_values->>'bank_name'),''),rib=nullif(trim(p_values->>'rib'),''),instructions=p_values->>'instructions',
     commercial_conditions_approved=false,updated_at=now() where id=true returning * into b;
   insert into saas_admin.bank_settings_history(actor_id,beneficiary,bank_name,rib,instructions,commercial_conditions_approved,reason)
   values(auth.uid(),b.beneficiary,b.bank_name,b.rib,b.instructions,false,trim(p_reason));
   insert into saas_admin.audit_events(actor_id,action,outcome,reason) values(auth.uid(),'bank_settings.update','changed',trim(p_reason));
 else
   select * into b from public.billing_bank_settings where id=true;
   insert into saas_admin.audit_events(actor_id,action,outcome) values(auth.uid(),'bank_settings.read','allowed');
 end if;
 return jsonb_build_object('settings',to_jsonb(b),'public_enable_locked',true);
end $$;
revoke all on all functions in schema saas_admin from public,anon,authenticated,service_role;
revoke all on function public.rpc_admin_payment_decide(uuid,text,uuid,text,bigint,text,text,text,date),
 public.rpc_admin_payment_list(text,text,integer),public.rpc_admin_payment_detail(uuid,uuid),public.rpc_admin_bank_settings(jsonb,text)
 from public,anon,service_role;
grant execute on function public.rpc_admin_payment_decide(uuid,text,uuid,text,bigint,text,text,text,date),
 public.rpc_admin_payment_list(text,text,integer),public.rpc_admin_payment_detail(uuid,uuid),public.rpc_admin_bank_settings(jsonb,text) to authenticated;
commit;