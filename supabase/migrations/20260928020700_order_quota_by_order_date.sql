-- ============================================================================
-- Quota mensuel de commandes : comptage sur la date métier (`orders.order_date`).
--
-- Le comptage portait sur `orders.created_at` (date d'enregistrement dans Jisra).
-- Un import historique — plusieurs centaines de commandes anciennes saisies le
-- même jour — consommait donc le quota du mois à lui seul et refusait toute
-- nouvelle commande à un compte dont l'activité du mois était faible.
--
-- Le quota d'offre (« commandes / mois ») suit désormais la date de commande :
-- seule l'activité métier du mois en cours est mesurée. Une commande datée du
-- mois en cours ou d'un mois postérieur compte pour le mois en cours ; une
-- commande datée d'un mois passé appartient à ce mois passé.
--
-- Le compteur affiché dans `/subscription` (via `rpc_billing_status`) applique
-- exactement la même règle, sinon les droits réels et l'affichage divergeraient.
-- ============================================================================

create or replace function public.enforce_order_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_plan public.plans;
  v_limit integer;
  v_used integer;
begin
  for v_owner in
    select distinct st.owner_user_id
    from new_rows nr
    join public.stores st on st.id = nr.store_id
    where st.owner_user_id is not null
    order by st.owner_user_id
  loop
    perform pg_advisory_xact_lock(hashtext('jisra_quota_orders'), hashtext(v_owner::text));

    v_plan := public.resolve_effective_plan(v_owner);
    if v_plan.id is null then
      continue;
    end if;

    v_limit := v_plan.order_limit;
    if public.plan_limit_is_unlimited(v_limit) then
      continue;
    end if;

    select count(*) into v_used
    from public.orders o
    join public.stores st on st.id = o.store_id
    where st.owner_user_id = v_owner
      and o.order_date >= date_trunc('month', now());

    if v_used > v_limit then
      raise exception 'QUOTA_ORDER_LIMIT_REACHED' using errcode = 'P0001';
    end if;
  end loop;

  return null;
end;
$$;

comment on function public.enforce_order_quota() is
  'Quota mensuel de commandes par propriétaire, mesuré sur la date métier (orders.order_date). Verrou par propriétaire pour un comptage fiable sous concurrence.';

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
  v_subscription public.subscriptions;
  v_latest public.subscriptions;
  v_orders integer := 0;
  v_stores integer := 0;
  v_agents integer := 0;
  v_credits integer := 0;
  v_has_expired_subscription boolean := false;
begin
  if v_user is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;

  v_plan := public.resolve_effective_plan(v_user);

  -- Abonnement appliqué : même tri que `resolve_effective_plan`.
  select s.* into v_subscription
  from public.subscriptions s
  join public.plans p on p.id = s.plan_id
  where s.user_id = v_user
    and s.status = 'active'
    and (s.expires_at is null or s.expires_at > now())
  order by p.price desc, s.started_at desc nulls last, s.created_at desc
  limit 1;

  -- Dernière ligne d'abonnement, quel que soit son statut ou son échéance.
  select s.* into v_latest
  from public.subscriptions s
  where s.user_id = v_user
  order by s.started_at desc nulls last, s.created_at desc
  limit 1;

  select exists (
    select 1
    from public.subscriptions s
    where s.user_id = v_user
      and s.expires_at is not null
      and s.expires_at <= now()
  ) into v_has_expired_subscription;

  -- Même règle que `enforce_order_quota` : date métier, pas date de saisie.
  select count(*) into v_orders
  from public.orders o
  join public.stores st on st.id = o.store_id
  where st.owner_user_id = v_user
    and o.order_date >= date_trunc('month', now());

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
    'subscription', case when v_subscription.id is null then null else jsonb_build_object(
      'id', v_subscription.id,
      'status', v_subscription.status,
      'amount_paid', v_subscription.amount_paid,
      'currency', v_subscription.currency,
      'started_at', v_subscription.started_at,
      'expires_at', v_subscription.expires_at,
      'plan_name', v_plan.name
    ) end,
    'latest_subscription', case when v_latest.id is null then null else jsonb_build_object(
      'id', v_latest.id,
      'status', v_latest.status,
      'amount_paid', v_latest.amount_paid,
      'currency', v_latest.currency,
      'started_at', v_latest.started_at,
      'expires_at', v_latest.expires_at
    ) end,
    'has_expired_subscription', v_has_expired_subscription,
    'orders', jsonb_build_object('used', v_orders, 'limit', v_plan.order_limit, 'enforced', true),
    'stores', jsonb_build_object('used', v_stores, 'limit', v_plan.stores_limit, 'enforced', true),
    'agents', jsonb_build_object('used', v_agents, 'limit', v_plan.confirmation_agents_limit, 'enforced', false),
    'credits', jsonb_build_object('used', coalesce(v_credits, 0), 'limit', v_plan.ai_credits_monthly, 'enforced', true)
  );
end;
$$;

comment on function public.rpc_billing_status() is
  'État de facturation d''un compte : plan effectif, abonnement appliqué, consommation du mois (commandes par date métier) et limites réellement bloquantes.';

revoke all on function public.rpc_billing_status() from public, anon;
grant execute on function public.rpc_billing_status() to authenticated;
