-- Migration: Dashboard Performance Optimization
-- This migration optimizes the dashboard RPC functions and adds necessary indexes.

-- 1. Add missing indexes for faster dashboard queries
-- Optimized for: filtering by store and date range
CREATE INDEX IF NOT EXISTS idx_orders_store_date ON public.orders (store_id, order_date DESC);
-- Optimized for: filtering by store and status (KPI counts)
CREATE INDEX IF NOT EXISTS idx_orders_store_status ON public.orders (store_id, status);
-- Optimized for: order items lookups by order
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON public.order_items (order_id);

-- 2. Optimize rpc_dashboard_kpi_metrics
-- Optimization: Move the security check into a single CTE to avoid per-row exists check.
CREATE OR REPLACE FUNCTION public.rpc_dashboard_kpi_metrics(
  p_store_ids uuid[],
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL
)
RETURNS TABLE (
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
LANGUAGE sql
STABLE
SECURITY DEFINER -- Ensures the function can access tables even if RLS is strict, but we still filter by accessible stores
AS $$
  WITH accessible_stores AS (
    -- Pre-calculate stores the user is actually allowed to see
    SELECT sm.store_id
    FROM public.store_members sm
    WHERE sm.user_id = auth.uid()
      AND sm.store_id = ANY(p_store_ids)
  )
  SELECT
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
  FROM public.orders o
  INNER JOIN accessible_stores as on o.store_id = as.store_id
  WHERE (p_start_date IS NULL OR o.order_date >= p_start_date)
    AND (p_end_date IS NULL OR o.order_date <= p_end_date)
$$;

-- 3. Optimize rpc_dashboard_revenue_chart
CREATE OR REPLACE FUNCTION public.rpc_dashboard_revenue_chart(
  p_store_ids uuid[],
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL
)
RETURNS TABLE (
  date_key text,
  revenue numeric,
  profit numeric,
  ads_cost numeric,
  purchase_cost numeric,
  delivery_fee numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH accessible_stores AS (
    SELECT sm.store_id
    FROM public.store_members sm
    WHERE sm.user_id = auth.uid()
      AND sm.store_id = ANY(p_store_ids)
  )
  SELECT
    to_char(o.order_date::date, 'YYYY-MM-DD'),
    coalesce(sum(o.total_selling_price), 0),
    coalesce(sum(o.profit), 0),
    coalesce(sum(o.ads_cost_allocated), 0),
    coalesce(sum(o.buy_price), 0),
    coalesce(sum(o.delivery_fee), 0)
  FROM public.orders o
  INNER JOIN accessible_stores as on o.store_id = as.store_id
  WHERE (p_start_date IS NULL OR o.order_date >= p_start_date)
    AND (p_end_date IS NULL OR o.order_date <= p_end_date)
  GROUP BY o.order_date::date
  ORDER BY o.order_date::date
$$;

-- 4. Optimize rpc_dashboard_top_products
CREATE OR REPLACE FUNCTION public.rpc_dashboard_top_products(
  p_store_ids uuid[],
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL,
  p_limit int DEFAULT 10
)
RETURNS TABLE (
  product_id uuid,
  product_name text,
  total_quantity bigint,
  total_revenue numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH accessible_stores AS (
    SELECT sm.store_id
    FROM public.store_members sm
    WHERE sm.user_id = auth.uid()
      AND sm.store_id = ANY(p_store_ids)
  )
  SELECT
    p.id,
    p.name,
    coalesce(sum(oi.quantity), 0)::bigint,
    coalesce(sum(oi.quantity * oi.unit_selling_price), 0)
  FROM public.products p
  INNER JOIN public.order_items oi ON oi.product_id = p.id
  INNER JOIN public.orders o ON o.id = oi.order_id
  INNER JOIN accessible_stores as on o.store_id = as.store_id
  WHERE p.store_id = as.store_id -- redundant but good for optimizer
    AND (p_start_date IS NULL OR o.order_date >= p_start_date)
    AND (p_end_date IS NULL OR o.order_date <= p_end_date)
  GROUP BY p.id, p.name
  ORDER BY total_quantity DESC
  LIMIT p_limit
$$;

-- 5. Optimize rpc_dashboard_city_performance
CREATE OR REPLACE FUNCTION public.rpc_dashboard_city_performance(
  p_store_ids uuid[],
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL
)
RETURNS TABLE (
  city text,
  total_orders bigint,
  confirmed_orders bigint,
  delivered_orders bigint,
  returned_orders bigint,
  cancelled_orders bigint,
  total_revenue numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH accessible_stores AS (
    SELECT sm.store_id
    FROM public.store_members sm
    WHERE sm.user_id = auth.uid()
      AND sm.store_id = ANY(p_store_ids)
  )
  SELECT
    o.city,
    count(*)::bigint,
    count(*) FILTER (WHERE o.status IN ('confirmed', 'picked_up', 'sent', 'delivered'))::bigint,
    count(*) FILTER (WHERE o.status = 'delivered')::bigint,
    count(*) FILTER (WHERE o.status IN ('returned_not_stocked', 'returned_stocked'))::bigint,
    count(*) FILTER (WHERE o.status = 'cancelled')::bigint,
    coalesce(sum(o.total_selling_price), 0)
  FROM public.orders o
  INNER JOIN accessible_stores as on o.store_id = as.store_id
  WHERE (p_start_date IS NULL OR o.order_date >= p_start_date)
    AND (p_end_date IS NULL OR o.order_date <= p_end_date)
  GROUP BY o.city
  ORDER BY total_orders DESC
$$;
