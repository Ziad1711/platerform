-- ============================================================================
-- État d'abonnement consolidé pour l'interface : plan effectif + consommation
-- (commandes du mois, stores, agents, crédits IA), en lecture seule.
-- ============================================================================

create or replace function public.rpc_billing_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_plan public.plans;
  v_orders integer := 0;
  v_stores integer := 0;
  v_agents integer := 0;
  v_credits integer := 0;
begin
  if v_user is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;

  v_plan := public.resolve_effective_plan(v_user);

  select count(*) into v_orders
  from public.orders o
  join public.stores st on st.id = o.store_id
  where st.owner_user_id = v_user
    and o.created_at >= date_trunc('month', now());

  select count(*) into v_stores
  from public.stores st
  where st.owner_user_id = v_user;

  select count(*) into v_agents
  from public.confirmation_agents a
  join public.stores st on st.id = a.store_id
  where st.owner_user_id = v_user
    and a.is_active;

  select w.credits_used into v_credits
  from public.ai_credit_wallets w
  where w.user_id = v_user;

  return jsonb_build_object(
    'period_start', date_trunc('month', now())::date,
    'plan', jsonb_build_object(
      'id', v_plan.id,
      'name', v_plan.name,
      'price', v_plan.price,
      'order_limit', v_plan.order_limit,
      'stores_limit', v_plan.stores_limit,
      'confirmation_agents_limit', v_plan.confirmation_agents_limit,
      'delivery_integrations_limit', v_plan.delivery_integrations_limit,
      'ai_credits_monthly', v_plan.ai_credits_monthly
    ),
    'orders', jsonb_build_object('used', v_orders, 'limit', v_plan.order_limit),
    'stores', jsonb_build_object('used', v_stores, 'limit', v_plan.stores_limit),
    'agents', jsonb_build_object('used', v_agents, 'limit', v_plan.confirmation_agents_limit),
    'credits', jsonb_build_object('used', coalesce(v_credits, 0), 'limit', v_plan.ai_credits_monthly)
  );
end;
$$;

revoke all on function public.rpc_billing_status() from public, anon;
grant execute on function public.rpc_billing_status() to authenticated;
