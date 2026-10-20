-- B13 v2 / export CSV BRUT via stdout (psql n'interpole pas :samples_file dans \copy).
-- Seul le COPY ... TO STDOUT ecrit sur stdout : rediriger 1> samples.csv et
-- laisser les NOTICE/verifications sur stderr (2> log.err).
--
-- psql "$URL" -v ON_ERROR_STOP=1 \
--   -c "set p79.bench_env='isolated'" -c "set p79.bench_confirm='SCHEDULED-ISOLATED-RUN'" \
--   -c "set p79.bench_project='biqrgdopcvkrbgfxkzxm'" -c "set p79.bench_allow='biqrgdopcvkrbgfxkzxm'" \
--   -c "set p79.bench_owner='c45355f3-6ab5-4dda-8861-d52e283bf163'" \
--   -c "set p79.bench_variant='A'" \
--   -v kind=update_rounding -v n=100 -v batches=10 -v size=200 \
--   -f server_measure_v2_csv.sql 1> samples.csv 2> log.err

\set ON_ERROR_STOP on
\pset pager off
\pset tuples_only on
\set QUIET on

DO $guard$
BEGIN
  IF current_setting('p79.bench_env', true) IS DISTINCT FROM 'isolated' THEN
    RAISE EXCEPTION 'P79_SRV_NOT_AUTHORIZED';
  END IF;
  IF current_setting('p79.bench_confirm', true) IS DISTINCT FROM 'SCHEDULED-ISOLATED-RUN' THEN
    RAISE EXCEPTION 'P79_SRV_NOT_CONFIRMED';
  END IF;
  IF current_setting('p79.bench_project', true) IS DISTINCT FROM 'biqrgdopcvkrbgfxkzxm'
     OR current_setting('p79.bench_allow', true) IS DISTINCT FROM 'biqrgdopcvkrbgfxkzxm' THEN
    RAISE EXCEPTION 'P79_SRV_PROJECT_NOT_ALLOWED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.id = current_setting('p79.bench_owner', true)::uuid) THEN
    RAISE EXCEPTION 'P79_SRV_OWNER_UNKNOWN';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION p79_srv_measure(p_kind text, p_n int, p_batches int, p_size int)
RETURNS TABLE(i int, ms numeric) LANGUAGE plpgsql AS $fn$
DECLARE t0 timestamptz; t1 timestamptz;
BEGIN
  FOR i IN 1..(CASE WHEN p_kind IN ('import_bulk','import_loop') THEN p_batches ELSE p_n END) LOOP
    t0 := clock_timestamp();
    IF p_kind = 'create_unit' THEN
      PERFORM public.p79_bench_create(i);
    ELSIF p_kind IN ('update_rounding','update_subtotal','update_unrelated') THEN
      PERFORM public.p79_bench_update(
        CASE p_kind WHEN 'update_rounding' THEN 'rounding'
                    WHEN 'update_subtotal' THEN 'subtotal'
                    ELSE 'unrelated' END, i);
    ELSIF p_kind = 'import_bulk' THEN
      PERFORM public.p79_bench_import_bulk(p_size);
    ELSIF p_kind = 'import_loop' THEN
      PERFORM public.p79_bench_import_loop(p_size);
    ELSE
      RAISE EXCEPTION 'P79_SRV_BAD_KIND';
    END IF;
    t1 := clock_timestamp();
    RETURN QUERY SELECT i, round(extract(epoch FROM (t1 - t0)) * 1000, 3)::numeric;
  END LOOP;
END
$fn$;

-- Preparation hors fenetre (aucune sortie stdout).
SELECT p79_bench_begin();
SELECT public.p79_bench_create(1) AS reference_order_id \gset
SELECT set_config('app.kpi_inv_order_' || replace(:'reference_order_id', '-', '_'), '', true);
DELETE FROM public.dashboard_kpi_invalidation
 WHERE store_id = '7f000000-0000-4000-8000-0000000000b1';
SELECT p79_bench_set_triggers(coalesce(current_setting('p79.bench_variant', true), 'C') <> 'A');

SELECT count(*) AS orders_before FROM public.orders
 WHERE store_id = '7f000000-0000-4000-8000-0000000000b1' \gset
SELECT count(*) AS items_before FROM public.order_items
 WHERE store_id = '7f000000-0000-4000-8000-0000000000b1' \gset

-- SEULE sortie stdout : les observations brutes.
COPY (
  SELECT i, ms
    FROM p79_srv_measure(:'kind', :n, :batches, :size)
   ORDER BY i
) TO STDOUT WITH (FORMAT csv, HEADER true);

SELECT count(*) AS orders_after FROM public.orders
 WHERE store_id = '7f000000-0000-4000-8000-0000000000b1' \gset
SELECT count(*) AS items_after FROM public.order_items
 WHERE store_id = '7f000000-0000-4000-8000-0000000000b1' \gset

-- Verification de volume : fonction (les variables psql ne sont PAS interpolees
-- a l'interieur d'un corps dollar-quote $check$).
CREATE OR REPLACE FUNCTION p79_srv_check_volumes(
  p_kind text, p_orders int, p_items int, p_batches int, p_size int, p_n int
) RETURNS void LANGUAGE plpgsql AS $chk$
DECLARE v_exp_o int := 0; v_exp_i int := 0;
BEGIN
  IF p_kind IN ('import_bulk','import_loop') THEN
    v_exp_o := p_batches * p_size;
    v_exp_i := p_batches * p_size * 2;
  ELSIF p_kind = 'create_unit' THEN
    v_exp_o := p_n;
    v_exp_i := p_n * 2;
  END IF;
  IF p_orders <> v_exp_o OR p_items <> v_exp_i THEN
    RAISE EXCEPTION 'P79_SRV_VOLUME_MISMATCH kind=% orders=%/% items=%/%',
      p_kind, p_orders, v_exp_o, p_items, v_exp_i;
  END IF;
  RAISE NOTICE 'P79_SRV_OK kind=% orders=% items=%', p_kind, p_orders, p_items;
END
$chk$;

SELECT p79_srv_check_volumes(
  :'kind',
  :orders_after - :orders_before,
  :items_after - :items_before,
  :batches, :size, :n
);

SELECT p79_bench_teardown();
SELECT p79_bench_set_triggers(true);
