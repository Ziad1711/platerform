-- Lot 3 : lecture des périodes d'abonnement (actuelle + futures) pour l'espace client.
-- Aucune modification des abonnements, paiements ou justificatifs.
begin;
set local lock_timeout='5s';

create or replace function public.rpc_billing_periods()
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare out jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('error','PAYMENT_AUTH'); end if;
  select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) into out from (
    select s.id, s.status, s.started_at, s.expires_at, s.amount_paid, s.currency,
           s.payment_request_id, p.name as plan_name, p.code as plan_code,
           (s.started_at is not null and s.started_at > now()) as future
    from public.subscriptions s join public.plans p on p.id = s.plan_id
    where s.user_id = auth.uid() and s.status = 'active'
  ) q;
  return jsonb_build_object('periods', out);
end $$;
revoke all on function public.rpc_billing_periods() from public,anon,service_role;
grant execute on function public.rpc_billing_periods() to authenticated;

commit;
