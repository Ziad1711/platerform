-- Renforcer les RPC dashboard avec auth.uid() guard
-- Sécurité en profondeur : même si le client envoie store_ids arbitraires,
-- le RPC vérifie que l'utilisateur a accès via store_members

create or replace function public.rpc_dashboard_kpi_metrics(
  p_store_ids uuid[],
  p_start_date timestamptz default null,
  p_end_date timestamptz default null
)
returns table (
  total_orders bigint,
  total_revenue numeric,
  total_profit numeric,
  total_ads_cost numeric,
  total_confirmation_cost numeric,
  total_delivery_fee numeric,
  total_delivery_charge numeric,
  total_buy_price numeric,
  pending_orders bigint,
  delivered_orders bigint,
  returned_orders bigint,
  cancelled_orders bigint
)
language sql
stable
as $$
  select
    count(*)::bigint,
    coalesce(sum(o.total_selling_price), 0),
    coalesce(sum(o.profit), 0),
    coalesce(sum(o.ads_cost_allocated), 0),
    coalesce(sum(o.confirmation_cost_allocated), 0),
    coalesce(sum(o.delivery_fee), 0),
    coalesce(sum(o.delivery_charge_to_customer), 0),
    coalesce(sum(o.buy_price), 0),
    count(*) filter (where o.status in ('new', 'confirmation_rejected', 'follow_up_1', 'follow_up_2', 'follow_up_3', 'follow_up_4', 'follow_up_5', 'no_answer', 'wrong_number', 'voicemail'))::bigint,
    count(*) filter (where o.status = 'delivered')::bigint,
    count(*) filter (where o.status in ('returned_not_stocked', 'returned_stocked'))::bigint,
    count(*) filter (where o.status = 'cancelled')::bigint
  from public.orders o
  where o.store_id = any(p_store_ids)
    and exists (
      select 1
      from public.store_members sm
      where sm.store_id = o.store_id
        and sm.user_id = auth.uid()
    )
    and (p_start_date is null or o.order_date >= p_start_date)
    and (p_end_date is null or o.order_date <= p_end_date)
$$;

create or replace function public.rpc_dashboard_revenue_chart(
  p_store_ids uuid[],
  p_start_date timestamptz default null,
  p_end_date timestamptz default null
)
returns table (
  date_key text,
  revenue numeric,
  profit numeric,
  ads_cost numeric,
  purchase_cost numeric,
  delivery_fee numeric
)
language sql
stable
as $$
  select
    to_char(o.order_date::date, 'YYYY-MM-DD'),
    coalesce(sum(o.total_selling_price), 0),
    coalesce(sum(o.profit), 0),
    coalesce(sum(o.ads_cost_allocated), 0),
    coalesce(sum(o.buy_price), 0),
    coalesce(sum(o.delivery_fee), 0)
  from public.orders o
  where o.store_id = any(p_store_ids)
    and exists (
      select 1
      from public.store_members sm
      where sm.store_id = o.store_id
        and sm.user_id = auth.uid()
    )
    and (p_start_date is null or o.order_date >= p_start_date)
    and (p_end_date is null or o.order_date <= p_end_date)
  group by o.order_date::date
  order by o.order_date::date
$$;

create or replace function public.rpc_dashboard_ads_cost_chart(
  p_store_ids uuid[],
  p_start_date timestamptz default null,
  p_end_date timestamptz default null
)
returns table (
  date_key text,
  ads_cost numeric
)
language sql
stable
as $$
  select
    to_char(o.order_date::date, 'YYYY-MM-DD'),
    coalesce(sum(o.ads_cost_allocated), 0)
  from public.orders o
  where o.store_id = any(p_store_ids)
    and exists (
      select 1
      from public.store_members sm
      where sm.store_id = o.store_id
        and sm.user_id = auth.uid()
    )
    and (p_start_date is null or o.order_date >= p_start_date)
    and (p_end_date is null or o.order_date <= p_end_date)
  group by o.order_date::date
  order by o.order_date::date
$$;

create or replace function public.rpc_dashboard_profit_chart(
  p_store_ids uuid[],
  p_start_date timestamptz default null,
  p_end_date timestamptz default null
)
returns table (
  date_key text,
  profit numeric
)
language sql
stable
as $$
  select
    to_char(o.order_date::date, 'YYYY-MM-DD'),
    coalesce(sum(o.profit), 0)
  from public.orders o
  where o.store_id = any(p_store_ids)
    and exists (
      select 1
      from public.store_members sm
      where sm.store_id = o.store_id
        and sm.user_id = auth.uid()
    )
    and (p_start_date is null or o.order_date >= p_start_date)
    and (p_end_date is null or o.order_date <= p_end_date)
  group by o.order_date::date
  order by o.order_date::date
$$;

create or replace function public.rpc_dashboard_top_products(
  p_store_ids uuid[],
  p_start_date timestamptz default null,
  p_end_date timestamptz default null,
  p_limit int default 10
)
returns table (
  product_id uuid,
  product_name text,
  total_quantity bigint,
  total_revenue numeric
)
language sql
stable
as $$
  select
    p.id,
    p.name,
    coalesce(sum(oi.quantity), 0)::bigint,
    coalesce(sum(oi.quantity * oi.unit_selling_price), 0)
  from public.products p
  inner join public.order_items oi on oi.product_id = p.id
  inner join public.orders o on o.id = oi.order_id
  where p.store_id = any(p_store_ids)
    and exists (
      select 1
      from public.store_members sm
      where sm.store_id = p.store_id
        and sm.user_id = auth.uid()
    )
    and (p_start_date is null or o.order_date >= p_start_date)
    and (p_end_date is null or o.order_date <= p_end_date)
  group by p.id, p.name
  order by total_quantity desc
  limit p_limit
$$;

create or replace function public.rpc_dashboard_city_performance(
  p_store_ids uuid[],
  p_start_date timestamptz default null,
  p_end_date timestamptz default null
)
returns table (
  city text,
  total_orders bigint,
  confirmed_orders bigint,
  delivered_orders bigint,
  returned_orders bigint,
  cancelled_orders bigint,
  total_revenue numeric
)
language sql
stable
as $$
  select
    o.city,
    count(*)::bigint,
    count(*) filter (where o.status in ('confirmed', 'picked_up', 'sent', 'delivered'))::bigint,
    count(*) filter (where o.status = 'delivered')::bigint,
    count(*) filter (where o.status in ('returned_not_stocked', 'returned_stocked'))::bigint,
    count(*) filter (where o.status = 'cancelled')::bigint,
    coalesce(sum(o.total_selling_price), 0)
  from public.orders o
  where o.store_id = any(p_store_ids)
    and exists (
      select 1
      from public.store_members sm
      where sm.store_id = o.store_id
        and sm.user_id = auth.uid()
    )
    and (p_start_date is null or o.order_date >= p_start_date)
    and (p_end_date is null or o.order_date <= p_end_date)
  group by o.city
  order by total_orders desc
$$;

create or replace function public.rpc_dashboard_confirmation_performance(
  p_store_ids uuid[],
  p_start_date timestamptz default null,
  p_end_date timestamptz default null
)
returns table (
  agent_id uuid,
  agent_name text,
  total_orders bigint,
  confirmed_orders bigint,
  delivered_orders bigint,
  returned_orders bigint,
  cancelled_orders bigint
)
language sql
stable
as $$
  select
    ca.id,
    ca.name,
    count(*)::bigint,
    count(*) filter (where o.status in ('confirmed', 'picked_up', 'sent', 'delivered'))::bigint,
    count(*) filter (where o.status = 'delivered')::bigint,
    count(*) filter (where o.status in ('returned_not_stocked', 'returned_stocked'))::bigint,
    count(*) filter (where o.status = 'cancelled')::bigint
  from public.confirmation_agents ca
  inner join public.orders o on o.confirmation_agent_id = ca.id
  where ca.store_id = any(p_store_ids)
    and exists (
      select 1
      from public.store_members sm
      where sm.store_id = ca.store_id
        and sm.user_id = auth.uid()
    )
    and (p_start_date is null or o.order_date >= p_start_date)
    and (p_end_date is null or o.order_date <= p_end_date)
  group by ca.id, ca.name
  order by total_orders desc
$$;
