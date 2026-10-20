-- JISRA — Harnais B13 / scénarios. ENVIRONNEMENT ISOLÉ AUTORISÉ UNIQUEMENT.
-- N'exécuter ni sur jisra-test partagé, ni en Production.
--
-- psql "$URL" -v ON_ERROR_STOP=1 \
--   -c "set p79.bench_env='isolated'" \
--   -c "set p79.bench_variant='A'" \
--   -v iterations=100 -v import_batch=200 -v import_rounds=10 -f scenarios.sql

\set ON_ERROR_STOP on
\pset pager off

DO $guard$
DECLARE v_stores int;
BEGIN
  IF current_setting('p79.bench_env', true) IS DISTINCT FROM 'isolated' THEN
    RAISE EXCEPTION 'P79_BENCH_NOT_AUTHORIZED';
  END IF;
  SELECT count(*) INTO v_stores FROM public.stores;
  IF v_stores > 20 THEN
    RAISE EXCEPTION 'P79_BENCH_SHARED_ENVIRONMENT (% boutiques) — cible isolée requise', v_stores;
  END IF;
  IF to_regprocedure('public.dashboard_kpi_invalidate_orders_quality_trg()') IS NULL THEN
    RAISE EXCEPTION 'P79_BENCH_PACKAGE_MISSING';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION p79_bench_setup()
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  INSERT INTO public.stores (id, owner_user_id, name, currency, country)
  VALUES ('7f000000-0000-4000-8000-0000000000b1',
          '33333333-3333-4333-8333-333333333333', 'P7.9 B13 bench', 'MAD', 'MA')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.products (id, store_id, name)
  VALUES ('7f000000-0000-4000-8000-0000000000b2',
          '7f000000-0000-4000-8000-0000000000b1', 'P7.9 bench produit')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.dashboard_kpi_store_state
    (store_id, tz, active_definition_version, coverage_from, coverage_to, backfill_state)
  VALUES ('7f000000-0000-4000-8000-0000000000b1', 'Africa/Casablanca', 1,
          date '2035-01-01', date '2035-01-01', 'running')
  ON CONFLICT (store_id) DO NOTHING;
END
$fn$;

CREATE OR REPLACE FUNCTION p79_bench_teardown()
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  DELETE FROM public.order_items WHERE store_id = '7f000000-0000-4000-8000-0000000000b1';
  DELETE FROM public.orders      WHERE store_id = '7f000000-0000-4000-8000-0000000000b1';
  DELETE FROM public.products    WHERE store_id = '7f000000-0000-4000-8000-0000000000b1';
  DELETE FROM public.stores      WHERE id       = '7f000000-0000-4000-8000-0000000000b1';
  DELETE FROM public.dashboard_kpi_invalidation
   WHERE store_id = '7f000000-0000-4000-8000-0000000000b1';
END
$fn$;

CREATE OR REPLACE FUNCTION p79_bench_create(p_i int)
RETURNS uuid LANGUAGE plpgsql AS $fn$
DECLARE v_id uuid := gen_random_uuid(); v_day timestamptz;
BEGIN
  v_day := timestamptz '2035-01-01 10:00:00+00' + (p_i % 20) * interval '1 minute';
  INSERT INTO public.orders (id, store_id, status, order_date, subtotal_amount, discount_amount,
    delivery_charge_to_customer, rounding_adjustment, total_selling_price, delivery_fee,
    discount_type, discount_value, city, customer_name, source)
  VALUES (v_id, '7f000000-0000-4000-8000-0000000000b1', 'new', v_day, 0, 0, 0, 0, 0, 0,
          'fixed', 0, 'Rabat', 'B13 bench', 'organic');
  INSERT INTO public.order_items (store_id, order_id, product_id, quantity,
    unit_selling_price, unit_purchase_cost_snapshot, item_type)
  VALUES ('7f000000-0000-4000-8000-0000000000b1', v_id, '7f000000-0000-4000-8000-0000000000b2', 1, 100.00, 40.00, 'main'),
         ('7f000000-0000-4000-8000-0000000000b1', v_id, '7f000000-0000-4000-8000-0000000000b2', 1, 200.00, 50.00, 'main');
  RETURN v_id;
END
$fn$;

CREATE OR REPLACE FUNCTION p79_bench_update(p_kind text, p_i int)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.orders
   WHERE store_id = '7f000000-0000-4000-8000-0000000000b1' ORDER BY order_date LIMIT 1;
  IF v_id IS NULL THEN RAISE EXCEPTION 'P79_BENCH_NO_ORDER'; END IF;

  IF p_kind = 'rounding' THEN
    UPDATE public.orders SET rounding_adjustment = CASE WHEN p_i % 2 = 0 THEN 0.5 ELSE 0 END WHERE id = v_id;
  ELSIF p_kind = 'subtotal' THEN
    UPDATE public.orders SET subtotal_amount = coalesce(subtotal_amount, 0) + 1.00 WHERE id = v_id;
  ELSIF p_kind = 'unrelated' THEN
    UPDATE public.orders SET customer_name = 'B13 bench ' || p_i WHERE id = v_id;
  ELSE
    RAISE EXCEPTION 'P79_BENCH_BAD_KIND';
  END IF;
END
$fn$;

CREATE OR REPLACE FUNCTION p79_bench_import(p_n int)
RETURNS int LANGUAGE plpgsql AS $fn$
DECLARE i int; v_count int;
BEGIN
  FOR i IN 1..p_n LOOP
    PERFORM p79_bench_create(i);
  END LOOP;
  SELECT count(*) INTO v_count FROM public.orders
   WHERE store_id = '7f000000-0000-4000-8000-0000000000b1';
  RETURN v_count;
END
$fn$;

-- ---------------------------------------------------------------------------
-- Bascule des producteurs KPI : variante A (sans) / C (avec).
-- Sur un environnement isolé uniquement ; restaurée en fin de campagne.
-- ---------------------------------------------------------------------------
DO $switch$
BEGIN
  IF current_setting('p79.bench_variant', true) = 'A' THEN
    ALTER TABLE public.orders         DISABLE TRIGGER trg_kpi_invalidate_orders;
    ALTER TABLE public.orders         DISABLE TRIGGER trg_kpi_invalidate_orders_insert;
    ALTER TABLE public.orders         DISABLE TRIGGER trg_kpi_invalidate_orders_quality;
    ALTER TABLE public.order_items    DISABLE TRIGGER trg_kpi_invalidate_order_items;
    ALTER TABLE public.ad_spend_daily DISABLE TRIGGER trg_kpi_invalidate_ad_spend;
  ELSE
    ALTER TABLE public.orders         ENABLE TRIGGER trg_kpi_invalidate_orders;
    ALTER TABLE public.orders         ENABLE TRIGGER trg_kpi_invalidate_orders_insert;
    ALTER TABLE public.orders         ENABLE TRIGGER trg_kpi_invalidate_orders_quality;
    ALTER TABLE public.order_items    ENABLE TRIGGER trg_kpi_invalidate_order_items;
    ALTER TABLE public.ad_spend_daily ENABLE TRIGGER trg_kpi_invalidate_ad_spend;
  END IF;
END
$switch$;

SELECT p79_bench_setup();

-- Une instruction par itération => une transaction par itération (autocommit),
-- donc aucune déduplication inter-itérations.
\timing on
SELECT format('select p79_bench_create(%s);', g) FROM generate_series(1, :iterations) g \gexec
SELECT format('select p79_bench_update(''rounding'', %s);', g) FROM generate_series(1, :iterations) g \gexec
SELECT format('select p79_bench_update(''subtotal'', %s);', g) FROM generate_series(1, :iterations) g \gexec
SELECT format('select p79_bench_update(''unrelated'', %s);', g) FROM generate_series(1, :iterations) g \gexec
SELECT format('select p79_bench_import(%s);', :import_batch) FROM generate_series(1, :import_rounds) g \gexec
\timing off

-- Compteurs de campagne.
SELECT 'pending_events' AS metric, count(*)::text AS value
  FROM public.dashboard_kpi_invalidation
 WHERE store_id = '7f000000-0000-4000-8000-0000000000b1' AND processed_at IS NULL
UNION ALL
SELECT 'orders_created', count(*)::text FROM public.orders
 WHERE store_id = '7f000000-0000-4000-8000-0000000000b1'
UNION ALL
SELECT 'distinct_days', count(DISTINCT business_date)::text
  FROM public.dashboard_kpi_invalidation
 WHERE store_id = '7f000000-0000-4000-8000-0000000000b1';

