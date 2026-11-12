-- Lot 5 : changement de forfait/période planifié à l'échéance, sans chevauchement.
begin;

-- Modification ciblée du corps existant : la période payante en cours (même
-- forfait ou autre forfait) décale le début. Aucun chevauchement, aucune
-- activation anticipée ; un historique sans échéance reste traité à la main.
do $patch$ declare definition text;
old_block constant text := $old$
   -- Aucun changement de forfait ni abonnement historique sans échéance écrasé.
   if exists(select 1 from public.subscriptions s join public.plans p on p.id=s.plan_id
     where s.user_id=r.user_id and s.status='active' and p.code<>'free'
       and (s.expires_at is null or s.expires_at>now()) and (s.plan_id<>r.plan_id or s.expires_at is null)) then
     return jsonb_build_object('error','PAYMENT_SUBSCRIPTION_CONFLICT'); end if;
   select max(expires_at) into previous_end from public.subscriptions where user_id=r.user_id and plan_id=r.plan_id
     and status='active' and expires_at>now();
$old$;
new_block constant text := $new$
   -- Toute période payante encore en cours décale le début de la nouvelle
   -- période (changement de forfait ou de durée planifié à l'échéance).
   if exists(select 1 from public.subscriptions s join public.plans p on p.id=s.plan_id
     where s.user_id=r.user_id and s.status='active' and p.code<>'free' and s.expires_at is null) then
     return jsonb_build_object('error','PAYMENT_SUBSCRIPTION_CONFLICT'); end if;
   select max(s.expires_at) into previous_end from public.subscriptions s join public.plans p on p.id=s.plan_id
     where s.user_id=r.user_id and s.status='active' and p.code<>'free' and s.expires_at>now();
$new$;
begin
  select pg_get_functiondef('public.rpc_admin_payment_decide(uuid,text,uuid,text,bigint,text,text,text,date)'::regprocedure) into definition;
  if position(old_block in definition)=0 then raise exception 'UNEXPECTED_DECIDE_BODY'; end if;
  execute replace(definition, old_block, new_block);
end $patch$;

insert into saas_admin.role_permissions(role,permission)
values ('platform_owner','subscriptions.manage') on conflict do nothing;

-- Annulation administrative : ligne conservée, aucune donnée effacée.
create or replace function public.rpc_admin_subscription_cancel(p_user uuid,p_subscription uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.subscriptions;
begin
 perform pg_advisory_xact_lock(hashtext('saas_admin_memberships'));
 if not saas_admin.has_permission('subscriptions.manage',true) then
   insert into saas_admin.audit_events(actor_id,action,target_id,outcome)
   values(auth.uid(),'subscriptions.cancel',p_subscription,'denied');
   return jsonb_build_object('error','ADMIN_FORBIDDEN');
 end if;
 if length(trim(coalesce(p_reason,''))) not between 10 and 300 then return jsonb_build_object('error','ADMIN_INVALID'); end if;
 perform pg_advisory_xact_lock(hashtext('payment_user'),hashtext(p_user::text));
 select * into s from public.subscriptions where id=p_subscription and user_id=p_user for update;
 if not found then return jsonb_build_object('error','FINANCE_NOT_FOUND'); end if;
 if s.status<>'active' then return jsonb_build_object('error','FINANCE_IMMUTABLE'); end if;
 update public.subscriptions set status='cancelled',updated_at=now() where id=s.id;
 insert into saas_admin.audit_events(actor_id,action,target_id,outcome,reason)
 values(auth.uid(),'subscriptions.cancel',s.id,'changed',trim(p_reason));
 return jsonb_build_object('ok',true,'status','cancelled');
end $$;
revoke all on function public.rpc_admin_subscription_cancel(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.rpc_admin_subscription_cancel(uuid,uuid,text) to authenticated;
revoke all on function public.rpc_admin_payment_decide(uuid,text,uuid,text,bigint,text,text,text,date) from public,anon;
grant execute on function public.rpc_admin_payment_decide(uuid,text,uuid,text,bigint,text,text,text,date) to authenticated;
commit;
