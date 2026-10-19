-- R-BL4 — sécurisation des RPC Dashboard legacy.
-- Les calculs existants sont conservés à l'identique dans des implémentations
-- internes. Les signatures publiques filtrent l'accès et masquent les champs
-- financiers pour les accès commerciaux (marketer / viewer).

create or replace function public.dashboard_legacy_access(p_store_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_store_id is null or auth.uid() is null then null
    when public.can_view_store_finances(p_store_id) then 'full'
    when exists (
      select 1
      from public.store_members sm
      where sm.store_id = p_store_id
        and sm.user_id = auth.uid()
        and sm.status = 'active'
        and sm.role in ('marketer', 'viewer')
    ) then 'commercial'
    else null
  end;
$$;

revoke all on function public.dashboard_legacy_access(uuid) from public, anon, authenticated;
grant execute on function public.dashboard_legacy_access(uuid) to service_role;

alter function public.rpc_dashboard_kpi_metrics(uuid, timestamptz, timestamptz)
  rename to _rbl4_impl_dashboard_kpi_metrics;
alter function public.rpc_dashboard_kpi_metrics(uuid[], timestamptz, timestamptz)
  rename to _rbl4_impl_dashboard_kpi_metrics;
alter function public.rpc_dashboard_revenue_chart(uuid, timestamptz, timestamptz, text, timestamptz, timestamptz)
  rename to _rbl4_impl_dashboard_revenue_chart;
alter function public.rpc_dashboard_revenue_chart(uuid[], timestamptz, timestamptz, text, timestamptz, timestamptz)
  rename to _rbl4_impl_dashboard_revenue_chart;
alter function public.rpc_dashboard_ads_cost_chart(uuid, timestamptz, timestamptz, text)
  rename to _rbl4_impl_dashboard_ads_cost_chart;
alter function public.rpc_dashboard_profit_chart(uuid, timestamptz, timestamptz)
  rename to _rbl4_impl_dashboard_profit_chart;
alter function public.rpc_dashboard_top_products(uuid, timestamptz, timestamptz)
  rename to _rbl4_impl_dashboard_top_products;
alter function public.rpc_dashboard_top_products(uuid[], timestamptz, timestamptz, integer)
  rename to _rbl4_impl_dashboard_top_products;

revoke all on function public._rbl4_impl_dashboard_kpi_metrics(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public._rbl4_impl_dashboard_kpi_metrics(uuid[], timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public._rbl4_impl_dashboard_revenue_chart(uuid, timestamptz, timestamptz, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public._rbl4_impl_dashboard_revenue_chart(uuid[], timestamptz, timestamptz, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public._rbl4_impl_dashboard_ads_cost_chart(uuid, timestamptz, timestamptz, text) from public, anon, authenticated;
revoke all on function public._rbl4_impl_dashboard_profit_chart(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public._rbl4_impl_dashboard_top_products(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public._rbl4_impl_dashboard_top_products(uuid[], timestamptz, timestamptz, integer) from public, anon, authenticated;

grant execute on function public._rbl4_impl_dashboard_kpi_metrics(uuid, timestamptz, timestamptz) to service_role;
grant execute on function public._rbl4_impl_dashboard_kpi_metrics(uuid[], timestamptz, timestamptz) to service_role;
grant execute on function public._rbl4_impl_dashboard_revenue_chart(uuid, timestamptz, timestamptz, text, timestamptz, timestamptz) to service_role;
grant execute on function public._rbl4_impl_dashboard_revenue_chart(uuid[], timestamptz, timestamptz, text, timestamptz, timestamptz) to service_role;
grant execute on function public._rbl4_impl_dashboard_ads_cost_chart(uuid, timestamptz, timestamptz, text) to service_role;
grant execute on function public._rbl4_impl_dashboard_profit_chart(uuid, timestamptz, timestamptz) to service_role;
grant execute on function public._rbl4_impl_dashboard_top_products(uuid, timestamptz, timestamptz) to service_role;
grant execute on function public._rbl4_impl_dashboard_top_products(uuid[], timestamptz, timestamptz, integer) to service_role;

create function public.rpc_dashboard_kpi_metrics(
  p_store_id uuid,
  p_start_date timestamptz default null,
  p_end_date timestamptz default null
)
returns table(
  orders_count bigint, delivered_count bigint, revenue numeric,
  purchase_cost numeric, ad_spend numeric, ad_cost_allocated numeric,
  delivery_cost numeric, confirmation_cost numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_access text := public.dashboard_legacy_access(p_store_id);
begin
  if v_access is null then raise exception 'DASHBOARD_NO_ACCESS'; end if;
  return query
  select x.orders_count, x.delivered_count, x.revenue,
         case when v_access = 'full' then x.purchase_cost else null::numeric end,
         x.ad_spend, x.ad_cost_allocated,
         case when v_access = 'full' then x.delivery_cost else null::numeric end,
         case when v_access = 'full' then x.confirmation_cost else null::numeric end
  from public._rbl4_impl_dashboard_kpi_metrics(p_store_id, p_start_date, p_end_date) x;
end;
$$;

create function public.rpc_dashboard_kpi_metrics(
  p_store_ids uuid[],
  p_start_date timestamptz default null,
  p_end_date timestamptz default null
)
returns table(
  total_orders bigint, total_revenue numeric, total_profit numeric,
  total_ads_cost numeric, total_confirmation_cost numeric,
  total_delivery_fee numeric, total_delivery_charge numeric,
  total_buy_price numeric, pending_orders bigint, delivered_orders bigint,
  returned_orders bigint, cancelled_orders bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids uuid[];
  v_full boolean;
begin
  select array_agg(id order by id), bool_and(public.dashboard_legacy_access(id) = 'full')
    into v_ids, v_full
  from (select distinct unnest(p_store_ids) id) requested
  where public.dashboard_legacy_access(id) is not null;
  if coalesce(cardinality(v_ids), 0) <> coalesce((select count(distinct id) from unnest(p_store_ids) id), 0)
     or coalesce(cardinality(v_ids), 0) = 0 then
    raise exception 'DASHBOARD_NO_ACCESS';
  end if;
  return query
  select x.total_orders, x.total_revenue,
         case when v_full then x.total_profit else null::numeric end,
         x.total_ads_cost,
         case when v_full then x.total_confirmation_cost else null::numeric end,
         case when v_full then x.total_delivery_fee else null::numeric end,
         x.total_delivery_charge,
         case when v_full then x.total_buy_price else null::numeric end,
         x.pending_orders, x.delivered_orders, x.returned_orders, x.cancelled_orders
  from public._rbl4_impl_dashboard_kpi_metrics(v_ids, p_start_date, p_end_date) x;
end;
$$;

create function public.rpc_dashboard_revenue_chart(
  p_store_id uuid,
  p_start_date timestamptz default null,
  p_end_date timestamptz default null,
  p_granularity text default 'day',
  p_conversion_start timestamptz default null,
  p_conversion_end timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_access text := public.dashboard_legacy_access(p_store_id);
  v_payload jsonb;
  v_points jsonb;
begin
  if v_access is null then raise exception 'DASHBOARD_NO_ACCESS'; end if;
  v_payload := public._rbl4_impl_dashboard_revenue_chart(
    p_store_id, p_start_date, p_end_date, p_granularity,
    p_conversion_start, p_conversion_end
  );
  if v_access = 'full' then return v_payload; end if;
  select coalesce(jsonb_agg(point || jsonb_build_object(
    'profit', null, 'purchase', null, 'delivery', null
  )), '[]'::jsonb)
  into v_points
  from jsonb_array_elements(coalesce(v_payload->'points', '[]'::jsonb)) point;
  return v_payload || jsonb_build_object(
    'points', v_points,
    'totalProfit', null,
    'totalPurchase', null
  );
end;
$$;

create function public.rpc_dashboard_revenue_chart(
  p_store_ids uuid[],
  p_start_date timestamptz default null,
  p_end_date timestamptz default null,
  p_granularity text default 'day',
  p_conversion_start timestamptz default null,
  p_conversion_end timestamptz default null
)
returns table(
  date_key text, revenue numeric, profit numeric, ads_cost numeric,
  purchase_cost numeric, delivery_fee numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids uuid[];
  v_full boolean;
begin
  select array_agg(id order by id), bool_and(public.dashboard_legacy_access(id) = 'full')
    into v_ids, v_full
  from (select distinct unnest(p_store_ids) id) requested
  where public.dashboard_legacy_access(id) is not null;
  if coalesce(cardinality(v_ids), 0) <> coalesce((select count(distinct id) from unnest(p_store_ids) id), 0)
     or coalesce(cardinality(v_ids), 0) = 0 then
    raise exception 'DASHBOARD_NO_ACCESS';
  end if;
  return query
  select x.date_key, x.revenue,
         case when v_full then x.profit else null::numeric end,
         x.ads_cost,
         case when v_full then x.purchase_cost else null::numeric end,
         case when v_full then x.delivery_fee else null::numeric end
  from public._rbl4_impl_dashboard_revenue_chart(
    v_ids, p_start_date, p_end_date, p_granularity,
    p_conversion_start, p_conversion_end
  ) x;
end;
$$;

create function public.rpc_dashboard_ads_cost_chart(
  p_store_id uuid default null,
  p_start_date timestamptz default null,
  p_end_date timestamptz default null,
  p_granularity text default 'day'
)
returns table(date text, ads numeric, orders_count bigint, delivered_count bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if public.dashboard_legacy_access(p_store_id) is null then
    raise exception 'DASHBOARD_NO_ACCESS';
  end if;
  return query
  select x.date, x.ads, x.orders_count, x.delivered_count
  from public._rbl4_impl_dashboard_ads_cost_chart(
    p_store_id, p_start_date, p_end_date, p_granularity
  ) x;
end;
$$;

create function public.rpc_dashboard_profit_chart(
  p_store_id uuid,
  p_start_date timestamptz,
  p_end_date timestamptz
)
returns table(date_key date, profit numeric)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_access text := public.dashboard_legacy_access(p_store_id);
begin
  if v_access is null then raise exception 'DASHBOARD_NO_ACCESS'; end if;
  return query
  select x.date_key, case when v_access = 'full' then x.profit else null::numeric end
  from public._rbl4_impl_dashboard_profit_chart(p_store_id, p_start_date, p_end_date) x;
end;
$$;

create function public.rpc_dashboard_top_products(
  p_store_id uuid,
  p_start_date timestamptz default null,
  p_end_date timestamptz default null
)
returns table(id text, name text, sales numeric, revenue numeric, profit numeric)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_access text := public.dashboard_legacy_access(p_store_id);
begin
  if v_access is null then raise exception 'DASHBOARD_NO_ACCESS'; end if;
  return query
  select x.id, x.name, x.sales, x.revenue,
         case when v_access = 'full' then x.profit else null::numeric end
  from public._rbl4_impl_dashboard_top_products(p_store_id, p_start_date, p_end_date) x;
end;
$$;

create function public.rpc_dashboard_top_products(
  p_store_ids uuid[],
  p_start_date timestamptz default null,
  p_end_date timestamptz default null,
  p_limit integer default 10
)
returns table(
  product_id uuid, product_name text, total_quantity bigint,
  total_revenue numeric, profit numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids uuid[];
  v_full boolean;
begin
  select array_agg(id order by id), bool_and(public.dashboard_legacy_access(id) = 'full')
    into v_ids, v_full
  from (select distinct unnest(p_store_ids) id) requested
  where public.dashboard_legacy_access(id) is not null;
  if coalesce(cardinality(v_ids), 0) <> coalesce((select count(distinct id) from unnest(p_store_ids) id), 0)
     or coalesce(cardinality(v_ids), 0) = 0 then
    raise exception 'DASHBOARD_NO_ACCESS';
  end if;
  return query
  select x.product_id, x.product_name, x.total_quantity, x.total_revenue,
         case when v_full then x.profit else null::numeric end
  from public._rbl4_impl_dashboard_top_products(v_ids, p_start_date, p_end_date, p_limit) x;
end;
$$;

revoke all on function public.rpc_dashboard_kpi_metrics(uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.rpc_dashboard_kpi_metrics(uuid[], timestamptz, timestamptz) from public, anon;
revoke all on function public.rpc_dashboard_revenue_chart(uuid, timestamptz, timestamptz, text, timestamptz, timestamptz) from public, anon;
revoke all on function public.rpc_dashboard_revenue_chart(uuid[], timestamptz, timestamptz, text, timestamptz, timestamptz) from public, anon;
revoke all on function public.rpc_dashboard_ads_cost_chart(uuid, timestamptz, timestamptz, text) from public, anon;
revoke all on function public.rpc_dashboard_profit_chart(uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.rpc_dashboard_top_products(uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.rpc_dashboard_top_products(uuid[], timestamptz, timestamptz, integer) from public, anon;

grant execute on function public.rpc_dashboard_kpi_metrics(uuid, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.rpc_dashboard_kpi_metrics(uuid[], timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.rpc_dashboard_revenue_chart(uuid, timestamptz, timestamptz, text, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.rpc_dashboard_revenue_chart(uuid[], timestamptz, timestamptz, text, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.rpc_dashboard_ads_cost_chart(uuid, timestamptz, timestamptz, text) to authenticated, service_role;
grant execute on function public.rpc_dashboard_profit_chart(uuid, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.rpc_dashboard_top_products(uuid, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.rpc_dashboard_top_products(uuid[], timestamptz, timestamptz, integer) to authenticated, service_role;