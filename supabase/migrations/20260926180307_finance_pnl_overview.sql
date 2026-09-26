-- ============================================================
-- Finance — résultat opérationnel global du store
-- ============================================================
create or replace function public.rpc_finance_overview(
  p_store_id uuid,
  p_start_date timestamptz default null,
  p_end_date timestamptz default null
)
returns table (
  store_id uuid,
  currency text,
  revenue numeric,
  cost_of_goods numeric,
  delivery_cost numeric,
  ad_spend numeric,
  commission numeric,
  other_expenses numeric,
  operating_result numeric,
  delivered_orders bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with scoped_orders as (
    select o.*
    from public.orders o
    where o.store_id = p_store_id
      and (p_start_date is null or o.order_date >= p_start_date)
      and (p_end_date is null or o.order_date < p_end_date)
  ),
  order_item_totals as (
    select
      oi.order_id,
      sum(coalesce(oi.quantity, 0) * coalesce(oi.unit_selling_price, 0))::numeric as item_revenue,
      sum(coalesce(oi.quantity, 0) * coalesce(oi.unit_purchase_cost_snapshot, 0))::numeric as item_purchase_cost
    from public.order_items oi
    join scoped_orders so on so.id = oi.order_id
    group by oi.order_id
  ),
  ads_daily as (
    select coalesce(sum(coalesce(a.spend_converted, a.spend, 0)), 0)::numeric as total
    from public.ad_spend_daily a
    where a.store_id = p_store_id
      and (p_start_date is null or a.spend_date >= p_start_date)
      and (p_end_date is null or a.spend_date < p_end_date)
  ),
  ads_allocated as (
    select coalesce(sum(coalesce(so.ads_cost_allocated, 0)), 0)::numeric as total
    from scoped_orders so
  ),
  other_exp as (
    select coalesce(sum(coalesce(e.amount, 0)), 0)::numeric as total
    from public.expenses e
    where e.store_id = p_store_id
      and e.status = 'active'
      and (p_start_date is null or e.expense_date >= p_start_date)
      and (p_end_date is null or e.expense_date < p_end_date)
  ),
  base as (
    select
      coalesce(sum(coalesce(oit.item_revenue, 0)) filter (where so.status = 'delivered'), 0)::numeric as revenue,
      coalesce(sum(coalesce(oit.item_purchase_cost, so.buy_price, 0)) filter (where so.status = 'delivered'), 0)::numeric as cogs,
      coalesce(sum(coalesce(so.delivery_fee, 0)) filter (where so.status = 'delivered'), 0)::numeric as delivery,
      coalesce(sum(coalesce(so.confirmation_cost_allocated, 0)) filter (where so.status = 'delivered'), 0)::numeric as commission,
      count(so.id) filter (where so.status = 'delivered')::bigint as delivered
    from scoped_orders so
    left join order_item_totals oit on oit.order_id = so.id
  )
  select
    p_store_id,
    (select s.currency from public.stores s where s.id = p_store_id),
    b.revenue,
    b.cogs,
    b.delivery,
    case when (select total from ads_daily) > 0 then (select total from ads_daily) else (select total from ads_allocated) end,
    b.commission,
    (select total from other_exp),
    b.revenue - b.cogs - b.delivery
      - case when (select total from ads_daily) > 0 then (select total from ads_daily) else (select total from ads_allocated) end
      - b.commission
      - (select total from other_exp),
    b.delivered
  from base b
  where public.can_view_store_finances(p_store_id);
$$;

revoke all on function public.rpc_finance_overview(uuid, timestamptz, timestamptz) from public;
grant execute on function public.rpc_finance_overview(uuid, timestamptz, timestamptz) to authenticated;
