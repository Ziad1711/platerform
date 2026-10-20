-- JISRA — Harnais B13 (v2) / scénarios. ENVIRONNEMENT ISOLÉ AUTORISÉ UNIQUEMENT.
--
-- Trois garde-fous indépendants, tous obligatoires :
--   1. p79.bench_env = 'isolated'
--   2. p79.bench_confirm = 'SCHEDULED-ISOLATED-RUN'
--   3. aucune sentinelle de jisra-test n'est présente
--
-- psql "$URL" -v ON_ERROR_STOP=1 \
--   -c "set p79.bench_env='isolated'" \
--   -c "set p79.bench_confirm='SCHEDULED-ISOLATED-RUN'" \
--   -c "set p79.bench_variant='A'" \
--   -v iterations=100 -v import_batch=200 -v import_rounds=10 -f scenarios.sql

\set ON_ERROR_STOP on
\pset pager off

DO $guard$
DECLARE v_stores int; v_sentinels int;
BEGIN
  IF current_setting('p79.bench_env', true) IS DISTINCT FROM 'isolated' THEN
    RAISE EXCEPTION 'P79_BENCH_NOT_AUTHORIZED (p79.bench_env)';
  END IF;
  IF current_setting('p79.bench_confirm', true) IS DISTINCT FROM 'SCHEDULED-ISOLATED-RUN' THEN
    RAISE EXCEPTION 'P79_BENCH_NOT_CONFIRMED (p79.bench_confirm)';
  END IF;

  SELECT count(*) INTO v_sentinels
    FROM public.stores
   WHERE id IN ('d6bfa510-3411-e642-3bd4-1fdff95cbc25',
                '1a1bdb7f-999e-5321-e2d9-4c1409841338',
                '57d00a07-d6e8-218b-a45f-3b0d7d4d7a45',
                '6872472a-9f7c-ee2c-712a-9613ff65abf9',
                '8d8c39d2-c4a7-4810-e2da-2d25cfc595c3',
                'aaaaaaaa-0000-4000-8000-000000000001',
                'aaaaaaaa-0000-4000-8000-000000000002',
                'aaaaaaaa-0000-4000-8000-000000000003');
  IF v_sentinels > 0 THEN
    RAISE EXCEPTION 'P79_BENCH_SHARED_ENVIRONMENT (sentinelles jisra-test presentes)';
  END IF;

  SELECT count(*) INTO v_stores FROM public.stores;
  IF v_stores > 20 THEN
    RAISE EXCEPTION 'P79_BENCH_SHARED_ENVIRONMENT (% boutiques)', v_stores;
  END IF;

  IF to_regprocedure('public.dashboard_kpi_invalidate_orders_quality_trg()') IS NULL THEN
    RAISE EXCEPTION 'P79_BENCH_PACKAGE_MISSING';
  END IF;
END
$guard$;

-- Réinitialisation : état initial identique pour chaque variante et chaque tour.
CREATE OR REPLACE FUNCTION p79_bench_reset()
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  DELETE FROM public.order_items WHERE store_id = '7f000000-0000-4000-8000-0000000000b1';
  DELETE FROM public.orders      WHERE store_id = '7f000000-0000-4000-8000-0000000000b1';
  DELETE FROM public.dashboard_daily_metrics
   WHERE store_id = '7f000000-0000-4000-8000-0000000000b1';
  DELETE FROM public.dashboard_kpi_invalidation
   WHERE store_id = '7f000000-0000-4000-8000-0000000000b1';
  DELETE FROM public.dashboard_kpi_store_state
   WHERE store_id = '7f000000-0000-4000-8000-0000000000b1';
END
$fn$;

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

CREATE OR REPLACE FUNCTION p79_bench_begin()
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM p79_bench_setup();
  PERFORM p79_bench_reset();
  PERFORM p79_bench_setup();
END
$fn$;

CREATE OR REPLACE FUNCTION p79_bench_teardown()
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM p79_bench_reset();
  DELETE FROM public.products WHERE store_id = '7f000000-0000-4000-8000-0000000000b1';
  DELETE FROM public.stores   WHERE id       = '7f000000-0000-4000-8000-0000000000b1';
  DELETE FROM public.dashboard_kpi_invalidation
   WHERE store_id = '7f000000-0000-4000-8000-0000000000b1';
END
$fn$;


-- Création UNITAIRE : une commande + 2 lignes par instruction.
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

-- IMPORT RÉEL GROUPÉ : deux INSERT ensemblistes (commandes, puis lignes),
-- comme un import applicatif par lot, et non une boucle de créations unitaires.
CREATE OR REPLACE FUNCTION p79_bench_import_bulk(p_n int)
RETURNS int LANGUAGE plpgsql AS $fn$
DECLARE v_orders int;
BEGIN
  WITH ins AS (
    INSERT INTO public.orders (id, store_id, status, order_date, subtotal_amount, discount_amount,
      delivery_charge_to_customer, rounding_adjustment, total_selling_price, delivery_fee,
      discount_type, discount_value, city, customer_name, source)
    SELECT gen_random_uuid(), '7f000000-0000-4000-8000-0000000000b1', 'new',
           timestamptz '2035-01-02 10:00:00+00' + (g % 20) * interval '1 minute',
           0, 0, 0, 0, 0, 0, 'fixed', 0, 'Rabat', 'B13 bulk', 'organic'
      FROM generate_series(1, p_n) g
    RETURNING id
  )
  INSERT INTO public.order_items (store_id, order_id, product_id, quantity,
    unit_selling_price, unit_purchase_cost_snapshot, item_type)
  SELECT '7f000000-0000-4000-8000-0000000000b1', i.id,
         '7f000000-0000-4000-8000-0000000000b2', 1,
         CASE WHEN l.n = 1 THEN 100.00 ELSE 200.00 END,
         CASE WHEN l.n = 1 THEN 40.00 ELSE 50.00 END, 'main'
    FROM ins i CROSS JOIN (VALUES (1),(2)) AS l(n);

  SELECT count(*) INTO v_orders FROM public.orders
   WHERE store_id = '7f000000-0000-4000-8000-0000000000b1';
  RETURN v_orders;
END
$fn$;

-- Import par boucle conservé uniquement pour comparaison explicite avec le groupé.
CREATE OR REPLACE FUNCTION p79_bench_import_loop(p_n int)
RETURNS int LANGUAGE plpgsql AS $fn$
DECLARE i int;
BEGIN
  FOR i IN 1..p_n LOOP
    PERFORM p79_bench_create(i);
  END LOOP;
  RETURN p_n;
END
$fn$;

-- Modification : trois natures, pour distinguer coût KPI et coût métier.
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

-- ---------------------------------------------------------------------------
-- Bascule des producteurs KPI.
-- Variante A : TOUS les producteurs KPI sont désactivés, y compris le marqueur
-- BEFORE INSERT et le trigger qualité P7.9.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION p79_bench_set_triggers(p_enabled boolean)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY[
    'trg_kpi_mark_order_insert',
    'trg_kpi_invalidate_orders',
    'trg_kpi_invalidate_orders_insert',
    'trg_kpi_invalidate_orders_quality'
  ] LOOP
    IF p_enabled THEN
      EXECUTE format('ALTER TABLE public.orders ENABLE TRIGGER %I', v);
    ELSE
      EXECUTE format('ALTER TABLE public.orders DISABLE TRIGGER %I', v);
    END IF;
  END LOOP;

  IF p_enabled THEN
    ALTER TABLE public.order_items    ENABLE TRIGGER trg_kpi_invalidate_order_items;
    ALTER TABLE public.ad_spend_daily ENABLE TRIGGER trg_kpi_invalidate_ad_spend;
  ELSE
    ALTER TABLE public.order_items    DISABLE TRIGGER trg_kpi_invalidate_order_items;
    ALTER TABLE public.ad_spend_daily DISABLE TRIGGER trg_kpi_invalidate_ad_spend;
  END IF;
END
$fn$;

-- Contrôle de la variante : renvoie l'état effectif des producteurs.
CREATE OR REPLACE FUNCTION p79_bench_producer_state()
RETURNS TABLE(trigger_name text, enabled boolean) LANGUAGE sql AS $fn$
  SELECT t.tgname::text, (t.tgenabled = 'O')
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
   WHERE NOT t.tgisinternal
     AND t.tgname LIKE 'trg_kpi_%'
     AND c.relname IN ('orders', 'order_items', 'ad_spend_daily')
     AND t.tgname <> 'trg_kpi_wakeup'
   ORDER BY t.tgname;
$fn$;

-- Drainage : mesure le temps de retour à zéro des événements de la boutique
-- de benchmark. Aucune activation implicite : si le worker est désactivé,
-- la fonction renvoie NULL (le pilote classe alors NOT COVERED).
CREATE OR REPLACE FUNCTION p79_bench_drain(p_max_seconds int DEFAULT 60)
RETURNS numeric LANGUAGE plpgsql AS $fn$
DECLARE v_start timestamptz := clock_timestamp(); v_pending int; v_enabled boolean;
BEGIN
  SELECT enabled INTO v_enabled FROM public.dashboard_kpi_worker_config WHERE id = 1;
  IF v_enabled IS NOT TRUE THEN RETURN NULL; END IF;

  LOOP
    SELECT count(*) INTO v_pending
      FROM public.dashboard_kpi_invalidation
     WHERE store_id = '7f000000-0000-4000-8000-0000000000b1' AND processed_at IS NULL;
    EXIT WHEN v_pending = 0;
    EXIT WHEN extract(epoch FROM clock_timestamp() - v_start) > p_max_seconds;
    PERFORM public.dashboard_kpi_worker_run('bench', 10, 5000, 2);
  END LOOP;

  RETURN round(extract(epoch FROM clock_timestamp() - v_start)::numeric, 3);
END
$fn$;

-- Compteurs d'erreurs serveur avant/après campagne.
CREATE OR REPLACE FUNCTION p79_bench_deadlocks()
RETURNS bigint LANGUAGE sql AS $fn$
  SELECT coalesce(sum(deadlocks), 0)::bigint FROM pg_stat_database WHERE datname = current_database();
$fn$;

-- Démarrage d'une variante : état identique + producteurs conformes.
SELECT p79_bench_begin();
SELECT p79_bench_set_triggers(coalesce(current_setting('p79.bench_variant', true), 'C') <> 'A');
SELECT 'variant' AS metric, current_setting('p79.bench_variant', true) AS value
UNION ALL SELECT 'producers_enabled',
       (SELECT count(*)::text FROM p79_bench_producer_state() WHERE enabled)
UNION ALL SELECT 'producers_disabled',
       (SELECT count(*)::text FROM p79_bench_producer_state() WHERE NOT enabled)
UNION ALL SELECT 'deadlocks_before', p79_bench_deadlocks()::text;


-- ---------------------------------------------------------------------------
-- Mesures. Une instruction par itération => une transaction par itération.
-- Chaque bloc est encadré par un marqueur de section pour un comptage exact.
-- ---------------------------------------------------------------------------
\echo SECTION:create_unit
\timing on
SELECT format('select p79_bench_create(%s);', g) FROM generate_series(1, :iterations) g \gexec
\timing off

\echo SECTION:update_rounding
\timing on
SELECT format('select p79_bench_update(''rounding'', %s);', g) FROM generate_series(1, :iterations) g \gexec
\timing off

\echo SECTION:update_subtotal
\timing on
SELECT format('select p79_bench_update(''subtotal'', %s);', g) FROM generate_series(1, :iterations) g \gexec
\timing off

\echo SECTION:update_unrelated
\timing on
SELECT format('select p79_bench_update(''unrelated'', %s);', g) FROM generate_series(1, :iterations) g \gexec
\timing off

-- Import groupé : une seule instruction par lot de p_batch commandes + 2 lignes.
\echo SECTION:import_bulk
\timing on
SELECT format('select p79_bench_import_bulk(%s);', :import_batch)
  FROM generate_series(1, :import_rounds) g \gexec
\timing off

-- Import par boucle, pour comparaison explicite (même volume).
\echo SECTION:import_loop
\timing on
SELECT format('select p79_bench_import_loop(%s);', :import_batch)
  FROM generate_series(1, :import_rounds) g \gexec
\timing off

-- Drainage et compteurs de fin de variante.
\echo SECTION:summary
SELECT 'pending_events' AS metric, count(*)::text AS value
  FROM public.dashboard_kpi_invalidation
 WHERE store_id = '7f000000-0000-4000-8000-0000000000b1' AND processed_at IS NULL
UNION ALL
SELECT 'orders', count(*)::text FROM public.orders
 WHERE store_id = '7f000000-0000-4000-8000-0000000000b1'
UNION ALL
SELECT 'items', count(*)::text FROM public.order_items
 WHERE store_id = '7f000000-0000-4000-8000-0000000000b1'
UNION ALL
SELECT 'deadlocks_after', p79_bench_deadlocks()::text;

SELECT 'drain_seconds' AS metric, coalesce(p79_bench_drain(90)::text, 'NOT_COVERED') AS value;

-- Remise à l'état initial et restauration des producteurs : la variante
-- suivante repart d'un état strictement identique.
SELECT p79_bench_teardown();
SELECT p79_bench_set_triggers(true);

