-- Migration: Dashboard Performance & Logic Optimization (FIXED DATA VISIBILITY)
-- This migration optimizes the dashboard RPC functions, aligns revenue logic with products, 
-- and ensures costs are only counted for delivered orders.

-- 0. Drop existing functions to allow signature changes
DROP FUNCTION IF EXISTS public.rpc_dashboard_kpi_metrics(uuid[], timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.rpc_dashboard_kpi_metrics(uuid, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.rpc_dashboard_revenue_chart(uuid[], timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.rpc_dashboard_revenue_chart(uuid, timestamptz, timestamptz, text, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.rpc_dashboard_top_products(uuid[], timestamptz, timestamptz, int);
DROP FUNCTION IF EXISTS public.rpc_dashboard_top_products(uuid, timestamptz, timestamptz, int);
DROP FUNCTION IF EXISTS public.rpc_dashboard_city_performance(uuid[], timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.rpc_dashboard_city_performance(uuid, timestamptz, timestamptz);

-- 1. Add missing indexes for faster dashboard queries
CREATE INDEX IF NOT EXISTS idx_orders_store_date ON public.orders (store_id, order_date DESC);
CREATE INDEX IF NOT EXISTS idx_orders_store_status ON public.orders (store_id, status);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON public.order_items (order_id);

-- 2. Optimize rpc_dashboard_kpi_metrics
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
SECURITY DEFINER
AS $$
  SELECT
    count(o.id)::bigint as total_orders,
    coalesce(sum((SELECT sum(quantity * unit_selling_price) FROM public.order_items WHERE order_id = o.id)) FILTER (WHERE o.status = 'delivered'), 0) as total_revenue,
    coalesce(sum((SELECT sum(quantity * (unit_selling_price - unit_purchase_cost_snapshot)) FROM public.order_items WHERE order_id = o.id) - o.delivery_fee - o.confirmation_cost_allocated - o.ads_cost_allocated) FILTER (WHERE o.status = 'delivered'), 0) as total_profit,
    coalesce(sum(o.ads_cost_allocated), 0) as total_ads_cost,
    coalesce(sum(o.confirmation_cost_allocated) FILTER (WHERE o.status = 'delivered'), 0) as total_confirmation_cost,
    coalesce(sum(o.delivery_fee) FILTER (WHERE o.status = 'delivered'), 0) as total_delivery_fee,
    coalesce(sum(o.delivery_charge_to_customer) FILTER (WHERE o.status = 'delivered'), 0) as total_delivery_charge,
    coalesce(sum(o.buy_price) FILTER (WHERE o.status = 'delivered'), 0) as total_buy_price,
    count(o.id) FILTER (WHERE o.status in ('new', 'confirmation_rejected', 'follow_up_1', 'follow_up_2', 'follow_up_3', 'follow_up_4', 'follow_up_5', 'no_answer', 'wrong_number', 'voicemail'))::bigint as pending_orders,
    count(o.id) FILTER (WHERE o.status = 'delivered')::bigint as delivered_orders,
    count(o.id) FILTER (WHERE o.status in ('returned_not_stocked', 'returned_stocked'))::bigint as returned_orders,
    count(o.id) FILTER (WHERE o.status = 'cancelled')::bigint as cancelled_orders
  FROM public.orders o
  WHERE o.store_id = ANY(p_store_ids)
    AND EXISTS (
      SELECT 1 FROM public.store_members sm
      WHERE sm.store_id = o.store_id AND sm.user_id = auth.uid() AND sm.status = 'active'
    )
    AND (p_start_date IS NULL OR o.order_date >= p_start_date)
    AND (p_end_date IS NULL OR o.order_date <= p_end_date)
$$;

-- 3. Optimize rpc_dashboard_top_products
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
  total_revenue numeric,
  profit numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    p.id as product_id,
    p.name as product_name,
    coalesce(sum(oi.quantity), 0)::bigint as total_quantity,
    coalesce(sum(oi.quantity * oi.unit_selling_price), 0) as total_revenue,
    coalesce(sum(oi.quantity * (oi.unit_selling_price - oi.unit_purchase_cost_snapshot)), 0) as profit
  FROM public.products p
  INNER JOIN public.order_items oi ON oi.product_id = p.id
  INNER JOIN public.orders o ON o.id = oi.order_id
  WHERE o.store_id = ANY(p_store_ids)
    AND o.status = 'delivered'
    AND EXISTS (
      SELECT 1 FROM public.store_members sm
      WHERE sm.store_id = o.store_id AND sm.user_id = auth.uid() AND sm.status = 'active'
    )
    AND (p_start_date IS NULL OR o.order_date >= p_start_date)
    AND (p_end_date IS NULL OR o.order_date <= p_end_date)
  GROUP BY p.id, p.name
  ORDER BY total_quantity DESC
  LIMIT p_limit
$$;

-- 4. Optimize rpc_dashboard_revenue_chart
CREATE OR REPLACE FUNCTION public.rpc_dashboard_revenue_chart(
  p_store_ids uuid[],
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL,
  p_granularity text DEFAULT 'day',
  p_conversion_start timestamptz DEFAULT NULL,
  p_conversion_end timestamptz DEFAULT NULL
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
  SELECT
    to_char(date_trunc(p_granularity, o.order_date), 'YYYY-MM-DD') as date_key,
    coalesce(sum((SELECT sum(quantity * unit_selling_price) FROM public.order_items WHERE order_id = o.id)) FILTER (WHERE o.status = 'delivered'), 0) as revenue,
    coalesce(sum((SELECT sum(quantity * (unit_selling_price - unit_purchase_cost_snapshot)) FROM public.order_items WHERE order_id = o.id) - o.delivery_fee - o.confirmation_cost_allocated - o.ads_cost_allocated) FILTER (WHERE o.status = 'delivered'), 0) as profit,
    coalesce(sum(o.ads_cost_allocated), 0) as ads_cost,
    coalesce(sum(o.buy_price) FILTER (WHERE o.status = 'delivered'), 0) as purchase_cost,
    coalesce(sum(o.delivery_fee) FILTER (WHERE o.status = 'delivered'), 0) as delivery_fee
  FROM public.orders o
  WHERE o.store_id = ANY(p_store_ids)
    AND EXISTS (
      SELECT 1 FROM public.store_members sm
      WHERE sm.store_id = o.store_id AND sm.user_id = auth.uid() AND sm.status = 'active'
    )
    AND (p_start_date IS NULL OR o.order_date >= p_start_date)
    AND (p_end_date IS NULL OR o.order_date <= p_end_date)
  GROUP BY 1
  ORDER BY 1
$$;



