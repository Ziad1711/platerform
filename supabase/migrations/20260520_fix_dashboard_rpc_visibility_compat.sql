-- Fix dashboard RPC visibility after performance optimization.
-- Restores p_store_id overloads used by the current frontend.

create or replace function public.rpc_dashboard_kpi_metrics(
  p_store_id uuid,
  p_start_date timestamptz default null,
  p_end_date timestamptz default null
)
returns table (
  orders_count bigint,
  delivered_count bigint,
  revenue numeric,
  purchase_cost numeric,
  ad_spend numeric,
  ad_cost_allocated numeric,
  delivery_cost numeric,
  confirmation_cost numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with scoped_orders as (
    select o.*
    from public.orders o
    where (p_store_id is null or o.store_id = p_store_id)
      and exists (
        select 1
        from public.store_members sm
        where sm.store_id = o.store_id
          and sm.user_id = auth.uid()
          and sm.status = 'active'
      )
      and (p_start_date is null or o.order_date >= p_start_date)
      and (p_end_date is null or o.order_date < p_end_date)
  ), order_item_totals as (
    select
      oi.order_id,
      sum(coalesce(oi.quantity, 0) * coalesce(oi.unit_selling_price, 0))::numeric as item_revenue,
      sum(coalesce(oi.quantity, 0) * coalesce(oi.unit_purchase_cost_snapshot, 0))::numeric as item_purchase_cost
    from public.order_items oi
    join scoped_orders so on so.id = oi.order_id
    group by oi.order_id
  ), ads_daily as (
    select coalesce(sum(coalesce(a.spend_converted, a.spend, 0)), 0)::numeric as total
    from public.ad_spend_daily a
    where (p_store_id is null or a.store_id = p_store_id)
      and exists (
        select 1
        from public.store_members sm
        where sm.store_id = a.store_id
          and sm.user_id = auth.uid()
          and sm.status = 'active'
      )
      and (p_start_date is null or a.spend_date >= p_start_date)
      and (p_end_date is null or a.spend_date < p_end_date)
  )
  select
    count(so.id)::bigint,
    count(so.id) filter (where so.status = 'delivered')::bigint,
    coalesce(sum(coalesce(oit.item_revenue, 0)) filter (where so.status = 'delivered'), 0)::numeric,
    coalesce(sum(coalesce(oit.item_purchase_cost, so.buy_price, 0)) filter (where so.status = 'delivered'), 0)::numeric,
    (select total from ads_daily),
    coalesce(sum(coalesce(so.ads_cost_allocated, 0)), 0)::numeric,
    coalesce(sum(coalesce(so.delivery_fee, 0)) filter (where so.status = 'delivered'), 0)::numeric,
    coalesce(sum(coalesce(so.confirmation_cost_allocated, 0)) filter (where so.status = 'delivered'), 0)::numeric
  from scoped_orders so
  left join order_item_totals oit on oit.order_id = so.id;
$$;

create or replace function public.rpc_dashboard_revenue_chart(
  p_store_id uuid,
  p_start_date timestamptz default null,
  p_end_date timestamptz default null,
  p_granularity text default 'day',
  p_conversion_start timestamptz default null,
  p_conversion_end timestamptz default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with scoped_orders as (
    select o.*
    from public.orders o
    where (p_store_id is null or o.store_id = p_store_id)
      and exists (
        select 1
        from public.store_members sm
        where sm.store_id = o.store_id
          and sm.user_id = auth.uid()
          and sm.status = 'active'
      )
      and (p_start_date is null or o.order_date >= p_start_date)
      and (p_end_date is null or o.order_date < p_end_date)
  ), order_item_totals as (
    select
      oi.order_id,
      sum(coalesce(oi.quantity, 0) * coalesce(oi.unit_selling_price, 0))::numeric as item_revenue,
      sum(coalesce(oi.quantity, 0) * coalesce(oi.unit_purchase_cost_snapshot, 0))::numeric as item_purchase_cost
    from public.order_items oi
    join scoped_orders so on so.id = oi.order_id
    group by oi.order_id
  ), bucketed as (
    select
      date_trunc(case when p_granularity in ('day', 'week', 'month') then p_granularity else 'day' end, so.order_date)::date as bucket_date,
      coalesce(sum(coalesce(oit.item_revenue, 0)) filter (where so.status = 'delivered'), 0)::numeric as revenue,
      coalesce(sum(
        coalesce(oit.item_revenue, 0)
        - coalesce(oit.item_purchase_cost, so.buy_price, 0)
        - coalesce(so.delivery_fee, 0)
        - coalesce(so.confirmation_cost_allocated, 0)
        - coalesce(so.ads_cost_allocated, 0)
      ) filter (where so.status = 'delivered'), 0)::numeric as profit,
      coalesce(sum(coalesce(so.ads_cost_allocated, 0)), 0)::numeric as ads,
      coalesce(sum(coalesce(oit.item_purchase_cost, so.buy_price, 0)) filter (where so.status = 'delivered'), 0)::numeric as purchase,
      coalesce(sum(coalesce(so.delivery_fee, 0)) filter (where so.status = 'delivered'), 0)::numeric as delivery
    from scoped_orders so
    left join order_item_totals oit on oit.order_id = so.id
    group by 1
  ), conv_orders as (
    select o.*
    from public.orders o
    where (p_store_id is null or o.store_id = p_store_id)
      and exists (
        select 1
        from public.store_members sm
        where sm.store_id = o.store_id
          and sm.user_id = auth.uid()
          and sm.status = 'active'
      )
      and (coalesce(p_conversion_start, p_start_date) is null or o.order_date >= coalesce(p_conversion_start, p_start_date))
      and (coalesce(p_conversion_end, p_end_date) is null or o.order_date < coalesce(p_conversion_end, p_end_date))
  ), conversion as (
    select
      count(*)::bigint as total_orders,
      count(*) filter (where status in ('confirmed', 'picked_up', 'sent', 'delivered'))::bigint as confirmed_orders,
      count(*) filter (where status in ('sent', 'delivered'))::bigint as sent_orders,
      count(*) filter (where status = 'delivered')::bigint as delivered_orders,
      count(*) filter (where status in ('returned_not_stocked', 'returned_stocked'))::bigint as returned_orders
    from conv_orders
  )
  select jsonb_build_object(
    'points', coalesce((
      select jsonb_agg(jsonb_build_object('date', bucket_date::text, 'revenue', revenue, 'profit', profit, 'ads', ads, 'purchase', purchase, 'delivery', delivery) order by bucket_date)
      from bucketed
    ), '[]'::jsonb),
    'totalRevenue', coalesce((select sum(revenue) from bucketed), 0),
    'totalProfit', coalesce((select sum(profit) from bucketed), 0),
    'totalAds', coalesce((select sum(ads) from bucketed), 0),
    'totalPurchase', coalesce((select sum(purchase) from bucketed), 0),
    'conversion', (select to_jsonb(conversion) from conversion)
  );
$$;

create or replace function public.rpc_dashboard_top_products(
  p_store_id uuid,
  p_start_date timestamptz default null,
  p_end_date timestamptz default null
)
returns table (id text, name text, sales numeric, revenue numeric, profit numeric)
language sql
stable
security definer
set search_path = public
as $$
  with delivered_orders as (
    select o.*
    from public.orders o
    where (p_store_id is null or o.store_id = p_store_id)
      and o.status = 'delivered'
      and exists (
        select 1
        from public.store_members sm
        where sm.store_id = o.store_id
          and sm.user_id = auth.uid()
          and sm.status = 'active'
      )
      and (p_start_date is null or o.order_date >= p_start_date)
      and (p_end_date is null or o.order_date < p_end_date)
  ), order_item_totals as (
    select oi.order_id, sum(coalesce(oi.quantity, 0) * coalesce(oi.unit_selling_price, 0))::numeric as order_items_revenue
    from public.order_items oi
    join delivered_orders d on d.id = oi.order_id
    group by oi.order_id
  ), lines as (
    select
      coalesce(oi.product_id::text, 'inconnu') as product_id,
      coalesce(p.name, 'Produit') as product_name,
      coalesce(oi.quantity, 0)::numeric as quantity,
      (coalesce(oi.quantity, 0) * coalesce(oi.unit_selling_price, 0))::numeric as line_revenue,
      (coalesce(oi.quantity, 0) * coalesce(oi.unit_purchase_cost_snapshot, 0))::numeric as line_purchase_cost,
      case
        when coalesce(oit.order_items_revenue, 0) > 0 then
          ((coalesce(oi.quantity, 0) * coalesce(oi.unit_selling_price, 0)) / oit.order_items_revenue)
          * (coalesce(d.ads_cost_allocated, 0) + coalesce(d.confirmation_cost_allocated, 0) + coalesce(d.delivery_fee, 0))
        else 0
      end as allocated_order_cost
    from public.order_items oi
    join delivered_orders d on d.id = oi.order_id
    left join order_item_totals oit on oit.order_id = oi.order_id
    left join public.products p on p.id = oi.product_id
    where (p_store_id is null or oi.store_id = p_store_id)
  )
  select
    l.product_id,
    l.product_name,
    coalesce(sum(l.quantity), 0),
    coalesce(sum(l.line_revenue), 0),
    coalesce(sum(l.line_revenue - l.line_purchase_cost - l.allocated_order_cost), 0)
  from lines l
  group by l.product_id, l.product_name
  order by revenue desc;
$$;

grant execute on function public.rpc_dashboard_kpi_metrics(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.rpc_dashboard_revenue_chart(uuid, timestamptz, timestamptz, text, timestamptz, timestamptz) to authenticated;
grant execute on function public.rpc_dashboard_top_products(uuid, timestamptz, timestamptz) to authenticated;