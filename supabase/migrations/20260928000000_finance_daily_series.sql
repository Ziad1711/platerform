-- ============================================================
-- Finance — Série quotidienne pour le graphique CA / résultat
-- ------------------------------------------------------------
-- Série temporelle alignée sur le contrat de calcul de
-- `rpc_finance_overview` : ventes reconnues à la livraison,
-- coût produit, livraison, publicité (suivi quotidien + repli
-- commandes pour les journées non suivies), commissions acquises
-- et autres charges, regroupés par journée locale (Africa/Casablanca).
-- Aucune journée comptée deux fois ; les montants restent par devise.
-- ============================================================

drop function if exists public.rpc_finance_daily_series(uuid, timestamptz, timestamptz);

create or replace function public.rpc_finance_daily_series(
  p_store_id uuid,
  p_start_date timestamptz default null,
  p_end_date timestamptz default null
)
returns table (
  day date,
  revenue numeric,
  cost_of_goods numeric,
  delivery_cost numeric,
  ad_spend numeric,
  commission numeric,
  other_expenses numeric,
  operating_result numeric,
  currency text
)
language sql
stable
security definer
set search_path = public
as $$
  with delivered_orders as (
    select
      o.id,
      (coalesce(o.delivered_at, o.order_date) at time zone public.finance_business_timezone())::date as day,
      o.total_selling_price,
      o.buy_price,
      o.delivery_fee,
      o.confirmation_cost_allocated
    from public.orders o
    where o.store_id = p_store_id
      and o.status = 'delivered'
      and (p_start_date is null or coalesce(o.delivered_at, o.order_date) >= p_start_date)
      and (p_end_date is null or coalesce(o.delivered_at, o.order_date) < p_end_date)
  ),
  order_item_totals as (
    select
      oi.order_id,
      sum(coalesce(oi.quantity, 0) * coalesce(oi.unit_selling_price, 0))::numeric as item_revenue,
      sum(coalesce(oi.quantity, 0) * coalesce(oi.unit_purchase_cost_snapshot, 0))::numeric as item_purchase_cost
    from public.order_items oi
    join delivered_orders d on d.id = oi.order_id
    group by oi.order_id
  ),
  sales_per_day as (
    select
      d.day,
      coalesce(sum(case when oit.order_id is not null then coalesce(oit.item_revenue, 0) else 0 end), 0)::numeric as revenue_reliable,
      coalesce(sum(case when oit.order_id is null then coalesce(d.total_selling_price, 0) else 0 end), 0)::numeric as revenue_estimated,
      coalesce(sum(coalesce(oit.item_purchase_cost, d.buy_price, 0)), 0)::numeric as cogs,
      coalesce(sum(coalesce(d.delivery_fee, 0)), 0)::numeric as delivery,
      coalesce(sum(coalesce(d.confirmation_cost_allocated, 0)), 0)::numeric as commission
    from delivered_orders d
    left join order_item_totals oit on oit.order_id = d.id
    group by d.day
  ),
  ads_days_tracked as (
    select
      (a.spend_date at time zone public.finance_business_timezone())::date as day,
      sum(coalesce(a.spend_converted, a.spend, 0))::numeric as ad_total
    from public.ad_spend_daily a
    where a.store_id = p_store_id
      and (p_start_date is null or a.spend_date >= p_start_date)
      and (p_end_date is null or a.spend_date < p_end_date)
    group by 1
  ),
  ads_orders as (
    select
      (o.order_date at time zone public.finance_business_timezone())::date as day,
      coalesce(o.ads_cost_allocated, 0)::numeric as ads_cost
    from public.orders o
    where o.store_id = p_store_id
      and (p_start_date is null or o.order_date >= p_start_date)
      and (p_end_date is null or o.order_date < p_end_date)
  ),
  ads_fallback as (
    select
      ao.day,
      sum(ao.ads_cost)::numeric as fallback_total
    from ads_orders ao
    left join ads_days_tracked ad on ad.day = ao.day
    where ad.day is null
    group by ao.day
  ),
  ads_per_day as (
    select day, ad_total as ad_spend from ads_days_tracked
    union all
    select day, fallback_total from ads_fallback
  ),
  expenses_per_day as (
    select
      (e.expense_date at time zone public.finance_business_timezone())::date as day,
      sum(coalesce(e.amount, 0))::numeric as other_expenses
    from public.expenses e
    where e.store_id = p_store_id
      and e.status = 'active'
      and (p_start_date is null or e.expense_date >= p_start_date)
      and (p_end_date is null or e.expense_date < p_end_date)
    group by 1
  ),
  days as (
    select day from sales_per_day
    union
    select day from ads_per_day
    union
    select day from expenses_per_day
  )
  select
    d.day,
    (coalesce(s.revenue_reliable, 0) + coalesce(s.revenue_estimated, 0))::numeric as revenue,
    coalesce(s.cogs, 0)::numeric as cost_of_goods,
    coalesce(s.delivery, 0)::numeric as delivery_cost,
    coalesce(a.ad_spend, 0)::numeric as ad_spend,
    coalesce(s.commission, 0)::numeric as commission,
    coalesce(e.other_expenses, 0)::numeric as other_expenses,
    (coalesce(s.revenue_reliable, 0) + coalesce(s.revenue_estimated, 0)
      - coalesce(s.cogs, 0)
      - coalesce(s.delivery, 0)
      - coalesce(a.ad_spend, 0)
      - coalesce(s.commission, 0)
      - coalesce(e.other_expenses, 0))::numeric as operating_result,
    (select st.currency from public.stores st where st.id = p_store_id)::text as currency
  from days d
  left join sales_per_day s on s.day = d.day
  left join ads_per_day a on a.day = d.day
  left join expenses_per_day e on e.day = d.day
  where public.can_view_store_finances(p_store_id)
  order by d.day;
$$;

revoke all on function public.rpc_finance_daily_series(uuid, timestamptz, timestamptz) from public;
revoke all on function public.rpc_finance_daily_series(uuid, timestamptz, timestamptz) from anon;
grant execute on function public.rpc_finance_daily_series(uuid, timestamptz, timestamptz) to authenticated;
