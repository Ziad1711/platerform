-- Lot 4E (suite). Tunnel commercial interne : aucune donnée de boutique.
begin;
create function public.rpc_admin_commercial_funnel(p_from date,p_until date) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare start_t timestamptz:=p_from::timestamp at time zone 'UTC';end_t timestamptz:=p_until::timestamp at time zone 'UTC';
 accounts bigint;requests bigint;activations jsonb;
begin
 if not saas_admin.has_permission('analytics.read',true) then return jsonb_build_object('error','ADMIN_FORBIDDEN'); end if;
 if p_until<=p_from or p_until>p_from+92 then return jsonb_build_object('error','ADMIN_INVALID'); end if;
 select count(*) into accounts from auth.users u where u.created_at>=start_t and u.created_at<end_t
   and not exists(select 1 from saas_admin.account_classification c where c.user_id=u.id and c.classification<>'customer');
 select count(*) into requests from public.payment_requests r where r.created_at>=start_t and r.created_at<end_t;
 select coalesce(jsonb_agg(x),'[]'::jsonb) into activations from (
   select p.currency,sum(p.amount_minor) amount_minor,count(*) count from saas_admin.payments p
   where p.verified_at>=start_t and p.verified_at<end_t group by p.currency) x;
 return jsonb_build_object('accounts_created',accounts,'payment_requests_created',requests,
   'paid_activations',(select coalesce(sum((q->>'count')::bigint),0) from jsonb_array_elements(activations) q),
   'paid_activations_currency',activations,
   'sources',jsonb_build_object('accounts','Auth Jisra','requests','payment_requests','activations','saas_admin.payments vérifiés'));
end $$;
revoke all on function public.rpc_admin_commercial_funnel(date,date) from public,anon,service_role;
grant execute on function public.rpc_admin_commercial_funnel(date,date) to authenticated;
commit;
