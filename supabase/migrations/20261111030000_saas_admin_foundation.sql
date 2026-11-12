-- Lot 4A uniquement : aucun droit de boutique, paiement ou accès opérationnel.
begin;
set local lock_timeout='5s';
create schema saas_admin;
revoke all on schema saas_admin from public,anon,authenticated,service_role;
create table saas_admin.role_permissions (
 role text not null check(role in ('platform_owner','security_admin','commercial_reader')),
 permission text not null,
 primary key(role,permission)
);
insert into saas_admin.role_permissions values
 ('platform_owner','admin.access'),('platform_owner','security.read'),('platform_owner','admins.manage'),
 ('security_admin','admin.access'),('security_admin','security.read'),
 ('commercial_reader','admin.access');
create table saas_admin.memberships (
 user_id uuid primary key references auth.users(id) on delete restrict,
 role text not null check(role in ('platform_owner','security_admin','commercial_reader')),
 active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 changed_by uuid references auth.users(id)
);
create table saas_admin.audit_events (
 id bigint generated always as identity primary key,
 actor_id uuid,
 action text not null,
 target_id uuid,
 outcome text not null check(outcome in ('allowed','denied','changed')),
 reason text,
 created_at timestamptz not null default now()
);
create index admin_audit_created on saas_admin.audit_events(created_at desc,id desc);
alter table saas_admin.memberships enable row level security;
alter table saas_admin.role_permissions enable row level security;
alter table saas_admin.audit_events enable row level security;
revoke all on all tables in schema saas_admin from public,anon,authenticated,service_role;
revoke all on all sequences in schema saas_admin from public,anon,authenticated,service_role;

create function saas_admin.identity_valid() returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select auth.uid() is not null and
   coalesce((auth.jwt()->>'exp')::bigint,0)>extract(epoch from now()) and
   exists(select 1 from auth.sessions s where s.id::text=auth.jwt()->>'session_id'
     and s.user_id=auth.uid() and (s.not_after is null or s.not_after>now()));
$$;
create function saas_admin.has_permission(p_permission text,p_sensitive boolean default true) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select saas_admin.identity_valid() and exists(
   select 1 from saas_admin.memberships m join saas_admin.role_permissions rp on rp.role=m.role
   where m.user_id=auth.uid() and m.active and rp.permission=p_permission)
 and (not p_sensitive or (
   auth.jwt()->>'aal'='aal2'
   and exists(select 1 from auth.mfa_factors f where f.user_id=auth.uid() and f.status='verified' and f.factor_type='totp')
   and exists(select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]'::jsonb)) a
     where a->>'method'='totp' and (a->>'timestamp')::bigint between extract(epoch from now()-interval '15 minutes') and extract(epoch from now())+30)));
$$;

create function public.rpc_saas_admin_context() returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare allowed boolean; permissions jsonb; strong boolean;
begin
 allowed:=saas_admin.has_permission('admin.access',false);
 strong:=allowed and saas_admin.has_permission('admin.access',true);
 insert into saas_admin.audit_events(actor_id,action,outcome)
 values(auth.uid(),'admin.access',case when allowed then 'allowed' else 'denied' end);
 if not allowed then return jsonb_build_object('allowed',false); end if;
 select jsonb_agg(rp.permission order by rp.permission) into permissions
 from saas_admin.memberships m join saas_admin.role_permissions rp on rp.role=m.role
 where m.user_id=auth.uid() and m.active;
 return jsonb_build_object('allowed',true,'permissions',permissions,'strong',strong);
end $$;

create function public.rpc_saas_admin_security() returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare members jsonb; events jsonb;
begin
 if not saas_admin.has_permission('security.read',true) then
   insert into saas_admin.audit_events(actor_id,action,outcome) values(auth.uid(),'security.read','denied');
   return jsonb_build_object('error','ADMIN_FORBIDDEN');
 end if;
 insert into saas_admin.audit_events(actor_id,action,outcome) values(auth.uid(),'security.read','allowed');
 select coalesce(jsonb_agg(to_jsonb(m)),'[]'::jsonb) into members from (
   select user_id,role,active,updated_at from saas_admin.memberships order by created_at limit 100) m;
 select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) into events from (
   select id,actor_id,action,target_id,outcome,reason,created_at from saas_admin.audit_events order by id desc limit 100) a;
 return jsonb_build_object('members',members,'events',events);
end $$;

create function public.rpc_saas_admin_membership(p_target uuid,p_role text,p_active boolean,p_reason text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 perform pg_advisory_xact_lock(hashtext('saas_admin_memberships'));
 if not saas_admin.has_permission('admins.manage',true) then
   insert into saas_admin.audit_events(actor_id,action,target_id,outcome) values(auth.uid(),'admins.manage',p_target,'denied');
   return jsonb_build_object('error','ADMIN_FORBIDDEN');
 end if;
 if p_target is null or p_target=auth.uid() or p_role not in ('platform_owner','security_admin','commercial_reader')
   or p_active is null or length(trim(coalesce(p_reason,''))) not between 10 and 300
   or not exists(select 1 from auth.users where id=p_target) then
   return jsonb_build_object('error','ADMIN_INVALID');
 end if;
 insert into saas_admin.memberships(user_id,role,active,changed_by)
 values(p_target,p_role,p_active,auth.uid()) on conflict(user_id) do update
 set role=excluded.role,active=excluded.active,changed_by=excluded.changed_by,updated_at=now();
 insert into saas_admin.audit_events(actor_id,action,target_id,outcome,reason)
 values(auth.uid(),'admins.manage',p_target,'changed',trim(p_reason));
 return jsonb_build_object('ok',true);
end $$;

-- Bootstrap hors HTTP : opérateur PostgreSQL seulement, une fois, UUID explicite.
create function saas_admin.bootstrap_owner(p_target uuid,p_reason text) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 perform pg_advisory_xact_lock(hashtext('saas_admin_memberships'));
 if exists(select 1 from saas_admin.memberships) then raise exception 'BOOTSTRAP_ALREADY_DONE'; end if;
 if p_target is null or length(trim(coalesce(p_reason,''))) not between 10 and 300 then raise exception 'BOOTSTRAP_INVALID'; end if;
 insert into saas_admin.memberships(user_id,role) values(p_target,'platform_owner');
 insert into saas_admin.audit_events(action,target_id,outcome,reason) values('bootstrap.owner',p_target,'changed',p_reason);
end $$;
revoke all on all functions in schema saas_admin from public,anon,authenticated,service_role;
revoke all on function public.rpc_saas_admin_context(),public.rpc_saas_admin_security(),
 public.rpc_saas_admin_membership(uuid,text,boolean,text) from public,anon,service_role;
grant execute on function public.rpc_saas_admin_context(),public.rpc_saas_admin_security(),
 public.rpc_saas_admin_membership(uuid,text,boolean,text) to authenticated;
-- Aucune attribution bootstrap dans cette migration. Exécution manuelle par
-- supabase_admin : select saas_admin.bootstrap_owner(UUID_VERIFIE, MOTIF);
commit;