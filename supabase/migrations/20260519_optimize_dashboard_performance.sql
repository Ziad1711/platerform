-- Migration: Dashboard Performance & Logic Optimization
-- This migration optimizes the dashboard RPC functions, aligns revenue logic with products, 
-- and ensures costs are only counted for delivered orders.

-- 0. Drop existing functions to allow signature changes (parameters or return types)
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
-- Logic: 
-- Revenue = Sum of (quantity * unit_selling_price) for DELIVERED orders only.
-- Charges = Sum of (buy_price + delivery_fee + confirmation_cost) for DELIVERED orders only.
-- Ads = Sum of ads_cost_allocated for ALL orders in period.
CREATE OR REPLACE FUNCTION public.rpc_dashboard_kpi_metrics(
  p_store_id uuid, -- Changed to single store to match frontend usage
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL
)
RETURNS TABLE (
  orders_count bigint,
  delivered_count bigint,
  revenue numeric,
  purchase_cost numeric,
  ad_spend numeric,
  ad_cost_allocated numeric,
  delivery_cost numeric,
  confirmation_cost numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH accessible_stores AS (
    SELECT sm.store_id
    FROM public.store_members sm
    WHERE sm.user_id = auth.uid()
      AND sm.store_id = p_store_id
  ),
  order_items_rev AS (
    SELECT 
      oi.order_id,
      coalesce(sum(oi.quantity * oi.unit_selling_price), 0) as items_rev
    FROM public.order_items oi
    INNER JOIN public.orders o ON o.id = oi.order_id
    WHERE o.store_id = p_store_id
      AND o.status = 'delivered'
      AND (p_start_date IS NULL OR o.order_date >= p_start_date)
      AND (p_end_date IS NULL OR o.order_date <= p_end_date)
    GROUP BY oi.order_id
  )
  SELECT
    count(o.id)::bigint as orders_count,
    count(o.id) FILTER (WHERE o.status = 'delivered')::bigint as delivered_count,
    coalesce(sum(oir.items_rev), 0) as revenue,
    coalesce(sum(o.buy_price) FILTER (WHERE o.status = 'delivered'), 0) as purchase_cost,
    0::numeric as ad_spend, -- placeholder if needed
    coalesce(sum(o.ads_cost_allocated), 0) as ad_cost_allocated,
    coalesce(sum(o.delivery_fee) FILTER (WHERE o.status = 'delivered'), 0) as delivery_cost,
    coalesce(sum(o.confirmation_cost_allocated) FILTER (WHERE o.status = 'delivered'), 0) as confirmation_cost
  FROM public.orders o
  INNER JOIN accessible_stores ast ON o.store_id = ast.store_id
  LEFT JOIN order_items_rev oir ON oir.order_id = o.id
  WHERE (p_start_date IS NULL OR o.order_date >= p_start_date)
    AND (p_end_date IS NULL OR o.order_date <= p_end_date)
$$;

-- 3. Optimize rpc_dashboard_top_products
-- Added explicit status = 'delivered' to match revenue logic.
CREATE OR REPLACE FUNCTION public.rpc_dashboard_top_products(
  p_store_id uuid,
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL,
  p_limit int DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  name text,
  sales bigint,
  revenue numeric,
  profit numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH accessible_stores AS (
    SELECT sm.store_id
    FROM public.store_members sm
    WHERE sm.user_id = auth.uid()
      AND sm.store_id = p_store_id
  )
  SELECT
    p.id,
    p.name,
    coalesce(sum(oi.quantity), 0)::bigint as sales,
    coalesce(sum(oi.quantity * oi.unit_selling_price), 0) as revenue,
    coalesce(sum(oi.quantity * (oi.unit_selling_price - p.buy_price)), 0) as profit
  FROM public.products p
  INNER JOIN public.order_items oi ON oi.product_id = p.id
  INNER JOIN public.orders o ON o.id = oi.order_id
  INNER JOIN accessible_stores ast ON o.store_id = ast.store_id
  WHERE o.status = 'delivered'
    AND (p_start_date IS NULL OR o.order_date >= p_start_date)
    AND (p_end_date IS NULL OR o.order_date <= p_end_date)
  GROUP BY p.id, p.name
  ORDER BY sales DESC
  LIMIT p_limit
$$;

-- 4. Optimize rpc_dashboard_revenue_chart
CREATE OR REPLACE FUNCTION public.rpc_dashboard_revenue_chart(
  p_store_id uuid,
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL,
  p_granularity text DEFAULT 'day',
  p_conversion_start timestamptz DEFAULT NULL,
  p_conversion_end timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
    v_result jsonb;
BEGIN
    WITH accessible_stores AS (
        SELECT sm.store_id
        FROM public.store_members sm
        WHERE sm.user_id = auth.uid()
          AND sm.store_id = p_store_id
    ),
    daily_stats AS (
        SELECT
            date_trunc(p_granularity, o.order_date) as d,
            coalesce(sum((SELECT sum(quantity * unit_selling_price) FROM public.order_items WHERE order_id = o.id)) FILTER (WHERE o.status = 'delivered'), 0) as rev,
            coalesce(sum(o.buy_price) FILTER (WHERE o.status = 'delivered'), 0) as buy,
            coalesce(sum(o.delivery_fee) FILTER (WHERE o.status = 'delivered'), 0) as del,
            coalesce(sum(o.ads_cost_allocated), 0) as ads
        FROM public.orders o
        INNER JOIN accessible_stores ast ON o.store_id = ast.store_id
        WHERE (p_start_date IS NULL OR o.order_date >= p_start_date)
          AND (p_end_date IS NULL OR o.order_date <= p_end_date)
        GROUP BY 1
    )
    SELECT jsonb_build_object(
        'points', coalesce(jsonb_agg(jsonb_build_object(
            'date', d,
            'revenue', rev,
            'purchase', buy,
            'delivery', del,
            'ads', ads,
            'profit', (rev - buy - del - ads)
        ) ORDER BY d), '[]'::jsonb),
        'totalRevenue', (SELECT coalesce(sum(rev), 0) FROM daily_stats),
        'totalAds', (SELECT coalesce(sum(ads), 0) FROM daily_stats),
        'totalPurchase', (SELECT coalesce(sum(buy), 0) FROM daily_stats),
        'totalProfit', (SELECT coalesce(sum(rev - buy - del - ads), 0) FROM daily_stats),
        'conversion', (
            SELECT jsonb_build_object(
                'total_orders', count(*),
                'confirmed_orders', count(*) FILTER (WHERE status IN ('confirmed', 'picked_up', 'sent', 'delivered')),
                'delivered_orders', count(*) FILTER (WHERE status = 'delivered'),
                'returned_orders', count(*) FILTER (WHERE status IN ('returned_not_stocked', 'returned_stocked')),
                'sent_orders', count(*) FILTER (WHERE status = 'sent')
            )
            FROM public.orders o
            INNER JOIN accessible_stores ast ON o.store_id = ast.store_id
            WHERE (p_conversion_start IS NULL OR o.order_date >= p_conversion_start)
              AND (p_conversion_end IS NULL OR o.order_date <= p_conversion_end)
        )
    ) INTO v_result;

    RETURN v_result;
END;
$$;

