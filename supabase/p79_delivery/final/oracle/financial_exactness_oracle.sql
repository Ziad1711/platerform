-- JISRA — Oracle d'exactitude financière et multi-boutiques (LECTURE SEULE).
--
-- Recalcule les composantes additives de `dashboard_daily_metrics` (axe order)
-- depuis orders / order_items, puis compare les deux chemins. Aucune écriture.
--
-- Usage :
--   psql "$URL" -v ON_ERROR_STOP=1 -v from=2026-09-01 -v to=2026-10-01 \
--        -v store= -f financial_exactness_oracle.sql
\set ON_ERROR_STOP on
\pset pager off
\if :{?from}
\else
  \echo 'ERREUR : -v from=YYYY-MM-DD obligatoire'
  \q
\endif
\if :{?to}
\else
  \echo 'ERREUR : -v to=YYYY-MM-DD obligatoire'
  \q
\endif
\if :{?store}
\else
  \set store ''
\endif

-- 1. Écarts PAR JOUR (journée métier dans le fuseau de la boutique).
WITH p AS (
  SELECT :'from'::date d_from, :'to'::date d_to, nullif(:'store','')::uuid only_store
), exp AS (
  SELECT o.store_id, (o.order_date AT TIME ZONE st.tz)::date AS bd,
         jsonb_build_object(
           'orders', count(*),
           'delivered', count(*) FILTER (WHERE o.status='delivered'),
           'cancelled', count(*) FILTER (WHERE o.status='cancelled'),
           'returned', count(*) FILTER (WHERE o.status IN ('returned_stocked','returned_not_stocked')),
           'pending', count(*) FILTER (WHERE o.status IN ('new','follow_up_1','follow_up_2','follow_up_3',
                'follow_up_4','follow_up_5','no_answer','wrong_number','voicemail','confirmation_rejected')),
           'confirmed_like', count(*) FILTER (WHERE o.status IN ('confirmed','picked_up','sent','delivered',
                'returned_not_stocked','returned_stocked')),
           'unclassified', count(*) FILTER (WHERE coalesce(o.status,'') NOT IN ('delivered','cancelled',
                'returned_stocked','returned_not_stocked','new','follow_up_1','follow_up_2','follow_up_3',
                'follow_up_4','follow_up_5','no_answer','wrong_number','voicemail','confirmation_rejected',
                'confirmed','picked_up','sent')),
           'revenue', coalesce(sum(it.rev) FILTER (WHERE o.status='delivered'),0),
           'purchase_cost', coalesce(sum(public.order_purchase_cost(o.buy_price_source,o.buy_price,
                coalesce(it.pc,o.buy_price,0))) FILTER (WHERE o.status='delivered'),0),
           'delivery_fee', coalesce(sum(o.delivery_fee) FILTER (WHERE o.status='delivered'),0),
           'confirmation_cost', coalesce(sum(o.confirmation_cost_allocated) FILTER (WHERE o.status='delivered'),0),
           'orders_without_lines', count(*) FILTER (WHERE it.n_lines IS NULL),
           'line_vs_total_mismatch', count(*) FILTER (WHERE o.status='delivered'
                AND abs(coalesce(it.rev,0)-coalesce(o.total_selling_price,0))>0.01)
         ) AS exp_json
    FROM public.orders o
    JOIN public.dashboard_kpi_store_state st ON st.store_id=o.store_id
    CROSS JOIN p
    LEFT JOIN LATERAL (
      SELECT sum(coalesce(oi.quantity,0)*coalesce(oi.unit_selling_price,0)) AS rev,
             sum(coalesce(oi.quantity,0)*coalesce(oi.unit_purchase_cost_snapshot,0)) AS pc,
             count(*) AS n_lines
        FROM public.order_items oi WHERE oi.order_id=o.id) it ON true
   WHERE (p.only_store IS NULL OR o.store_id=p.only_store)
     AND o.order_date >= (p.d_from AT TIME ZONE st.tz)
     AND o.order_date <  (p.d_to   AT TIME ZONE st.tz)
   GROUP BY o.store_id, st.tz, (o.order_date AT TIME ZONE st.tz)::date
), act AS (
  SELECT m.store_id, m.business_date AS bd,
         jsonb_build_object(
           'orders', m.orders_count, 'delivered', m.delivered_count, 'cancelled', m.cancelled_count,
           'returned', m.returned_count, 'pending', m.pending_count,
           'confirmed_like', m.confirmed_like_count, 'unclassified', m.unclassified_count,
           'revenue', m.revenue_items_gross, 'purchase_cost', m.purchase_cost,
           'delivery_fee', m.delivery_fee_cost, 'confirmation_cost', m.confirmation_cost,
           'orders_without_lines', m.orders_without_lines,
           'line_vs_total_mismatch', m.line_vs_total_mismatch
         ) AS act_json
    FROM public.dashboard_daily_metrics m
    CROSS JOIN p
    JOIN public.dashboard_kpi_store_state st ON st.store_id=m.store_id
   WHERE (p.only_store IS NULL OR m.store_id=p.only_store)
     AND m.axis='order' AND m.definition_version=st.active_definition_version
     AND m.business_date >= p.d_from AND m.business_date < p.d_to
)
SELECT coalesce(e.store_id,a.store_id) AS store_id,
       coalesce(e.bd,a.bd) AS business_date,
       e.exp_json AS expected, a.act_json AS actual,
       CASE WHEN e.exp_json = a.act_json THEN 'PASS' ELSE 'FAIL' END AS check_status
  FROM exp e FULL OUTER JOIN act a ON a.store_id=e.store_id AND a.bd=e.bd
 WHERE e.exp_json IS DISTINCT FROM a.act_json

-- 2. Périodes : courante vs précédente (même longueur), ratios sur composantes.
--    `delta_*` doit être 0 : les deux périodes passent par le même agrégat.
WITH p AS (
  SELECT :'from'::date d_from, :'to'::date d_to,
         nullif(:'store','')::uuid only_store,
         (:'to'::date - :'from'::date) n_days
), per AS (
  SELECT m.store_id,
         CASE WHEN m.business_date >= p.d_from THEN 'current' ELSE 'previous' END AS period,
         sum(m.orders_count) o, sum(m.delivered_count) d,
         sum(m.cancelled_count) c, sum(m.returned_count) r,
         sum(m.revenue_items_gross) rev, sum(m.purchase_cost) pc,
         sum(m.delivery_fee_cost) df, sum(m.confirmation_cost) cf,
         count(*) FILTER (WHERE m.orders_count > 0) days
    FROM public.dashboard_daily_metrics m
    CROSS JOIN p
    JOIN public.dashboard_kpi_store_state st ON st.store_id=m.store_id
   WHERE (p.only_store IS NULL OR m.store_id=p.only_store)
     AND m.axis='order' AND m.definition_version=st.active_definition_version
     AND m.business_date >= (p.d_from - p.n_days) AND m.business_date < p.d_to
   GROUP BY m.store_id, CASE WHEN m.business_date >= p.d_from THEN 'current' ELSE 'previous' END
)
SELECT store_id, period, o AS orders, d AS delivered, c AS cancelled, r AS returned,
       rev AS revenue, pc AS purchase_cost, df AS delivery_fee, cf AS confirmation_cost,
       CASE WHEN d > 0 THEN round(rev/d, 6) ELSE 0 END AS aov,
       CASE WHEN o > 0 THEN round(100.0*d/o, 6) ELSE 0 END AS delivery_rate,
       CASE WHEN rev <> 0 THEN round(100.0*(rev-pc-df-cf)/rev, 6) ELSE 0 END AS margin_rate,
       CASE WHEN o > 0 THEN round(100.0*c/o, 6) ELSE 0 END AS cancellation_rate,
       days,
       -- Libellé explicite : une période sans couverture ne doit jamais être
       -- présentée comme comparable.
       CASE WHEN days = 0 THEN 'NO_COVERAGE'
            WHEN period = 'previous' AND days < 1 THEN 'INCOMPARABLE'
            ELSE 'COMPARABLE' END AS comparability
  FROM per
 ORDER BY store_id, period;

-- 3. Couverture et fraîcheur : journées attendues vs agrégées, retards, sales.
WITH p AS (
  SELECT :'from'::date d_from, :'to'::date d_to, nullif(:'store','')::uuid only_store
)
SELECT st.store_id,
       p.d_from, p.d_to,
       (p.d_to - p.d_from) AS days_requested,
       count(m.business_date) FILTER (WHERE m.orders_count > 0) AS days_with_activity,
       count(m.business_date) AS days_aggregated,
       st.coverage_from, st.coverage_to, st.backfill_state,
       st.dirty_days, st.pending_partitions,
       round(extract(epoch FROM (clock_timestamp() - st.last_rebuild_at))::numeric, 1) AS age_last_rebuild_s,
       (SELECT count(*) FROM public.dashboard_kpi_invalidation i
         WHERE i.store_id = st.store_id AND i.processed_at IS NULL) AS pending_events,
       (SELECT count(*) FROM public.dashboard_kpi_invalidation i
         WHERE i.store_id = st.store_id AND i.processed_at IS NULL
           AND i.occurred_at < clock_timestamp() - interval '60 seconds') AS pending_over_60s,
       (SELECT count(*) FROM public.dashboard_kpi_invalidation i
         WHERE i.store_id = st.store_id AND i.attempts > 0 AND i.processed_at IS NULL) AS retried_events
  FROM public.dashboard_kpi_store_state st
  CROSS JOIN p
  LEFT JOIN public.dashboard_daily_metrics m
         ON m.store_id = st.store_id AND m.axis='order'
        AND m.definition_version = st.active_definition_version
        AND m.business_date >= p.d_from AND m.business_date < p.d_to
 WHERE (p.only_store IS NULL OR st.store_id = p.only_store)
 GROUP BY st.store_id, p.d_from, p.d_to, st.coverage_from, st.coverage_to,
          st.backfill_state, st.dirty_days, st.pending_partitions, st.last_rebuild_at
 ORDER BY st.store_id;

-- 4. Invariants d'exploitation : publication, séquences, cohérence des buckets.
SELECT st.store_id,
       st.last_event_seq,
       (SELECT coalesce(max(i.seq),0) FROM public.dashboard_kpi_invalidation i
         WHERE i.store_id = st.store_id AND i.processed_at IS NOT NULL) AS max_processed_seq,
       st.publish_counter,
       st.updated_at,
       st.last_rebuild_at,
       CASE WHEN st.last_rebuild_at IS NOT NULL AND st.updated_at < st.last_rebuild_at
            THEN 'FAIL_updated_at_before_rebuild' ELSE 'PASS' END AS updated_at_invariant,
       CASE WHEN st.computed_days < 0 OR st.dirty_days < 0 THEN 'FAIL_negative_counters' ELSE 'PASS' END AS counters_invariant,
       CASE WHEN st.last_event_seq > (SELECT coalesce(max(i.seq),0) FROM public.dashboard_kpi_invalidation i
                                       WHERE i.store_id = st.store_id)
            THEN 'FAIL_seq_ahead_of_journal' ELSE 'PASS' END AS journal_invariant,
       w.enabled AS worker_enabled, w.max_partitions, w.max_events, w.statement_timeout_ms,
       (SELECT enabled FROM public.dashboard_kpi_worker_config WHERE id = 1) AS worker_global_enabled
  FROM public.dashboard_kpi_store_state st
  LEFT JOIN public.dashboard_kpi_worker_config w ON w.id = 1
 ORDER BY st.store_id;

-- 5. Buckets non additifs : contrôle de recouvrement assumé (jamais de somme naive).
SELECT m.store_id, m.business_date,
       m.orders_count, m.delivered_count, m.cancelled_count, m.returned_count,
       m.refused_count, m.pending_count, m.confirmed_like_count, m.sent_like_count,
       m.unclassified_count,
       CASE WHEN m.confirmed_like_count > m.orders_count
              OR m.sent_like_count > m.confirmed_like_count
            THEN 'FAIL_funnel_overlap' ELSE 'PASS' END AS funnel_invariant
  FROM public.dashboard_daily_metrics m
  CROSS JOIN (SELECT :'from'::date d_from, :'to'::date d_to) p
 WHERE m.axis='order'
   AND m.business_date >= p.d_from AND m.business_date < p.d_to
   AND (m.confirmed_like_count > m.orders_count OR m.sent_like_count > m.confirmed_like_count)
 ORDER BY m.store_id, m.business_date;

 ORDER BY store_id, business_date;
