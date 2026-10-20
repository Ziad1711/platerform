-- B13 / mesure SERVEUR v2 : echantillons BRUTS + verification de volumes.
--
-- Corrections par rapport a v1 :
--   * imports : VRAIS lots de :size commandes, :batches fois (au lieu de
--     p_n boucles de p_n commandes) ;
--   * echantillons bruts exportes en CSV : les percentiles sont calcules sur
--     les observations, plus jamais une mediane de p95 ;
--   * volumes verifies par compteurs independants, echec explicite sinon ;
--   * drapeau transactionnel de la commande de reference efface ;
--   * execution conservee dans UNE transaction : le cout du COMMIT n'est pas
--     mesure et le cache de fuseau / la deduplication sont "chauds" — limite
--     documentee, non contournee.
--
-- psql "$URL" -v ON_ERROR_STOP=1 \
--   -c "set p79.bench_env='isolated'" -c "set p79.bench_confirm='SCHEDULED-ISOLATED-RUN'" \
--   -c "set p79.bench_project='biqrgdopcvkrbgfxkzxm'" -c "set p79.bench_allow='biqrgdopcvkrbgfxkzxm'" \
--   -c "set p79.bench_owner='c45355f3-6ab5-4dda-8861-d52e283bf163'" \
--   -c "set p79.bench_variant='A'" \
--   -v kind=import_bulk -v n=100 -v batches=10 -v size=200 \
--   -v samples_file='C:/.../samples.csv' -f server_measure_v2.sql

\set ON_ERROR_STOP on
\pset pager off

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

-- Mesure : p_n operations unitaires, ou p_batches lots de p_size commandes.
CREATE OR REPLACE FUNCTION p79_srv_measure(p_kind text, p_n int, p_batches int, p_size int)
RETURNS TABLE(i int, ms numeric) LANGUAGE plpgsql AS $fn$
DECLARE t0 timestamptz; t1 timestamptz;
BEGIN
  FOR i IN 1..(
    CASE WHEN p_kind IN ('import_bulk','import_loop') THEN p_batches ELSE p_n END
  ) LOOP
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
SELECT count(*) AS events_before FROM public.dashboard_kpi_invalidation
 WHERE store_id = '7f000000-0000-4000-8000-0000000000b1' \gset

\copy (SELECT i, ms FROM p79_srv_measure(:'kind', :n, :batches, :size) ORDER BY i) TO :'samples_file' WITH (FORMAT csv, HEADER true)

SELECT count(*) AS orders_after FROM public.orders
 WHERE store_id = '7f000000-0000-4000-8000-0000000000b1' \gset
SELECT count(*) AS items_after FROM public.order_items
 WHERE store_id = '7f000000-0000-4000-8000-0000000000b1' \gset
SELECT count(*) AS events_after FROM public.dashboard_kpi_invalidation
 WHERE store_id = '7f000000-0000-4000-8000-0000000000b1' \gset

DO $check$
DECLARE
  v_kind text := :'kind';
  v_orders int := :orders_after - :orders_before;
  v_items int := :items_after - :items_before;
  v_events int := :events_after - :events_before;
  v_expected_orders int := 0;
  v_expected_items int := 0;
BEGIN
  IF v_kind IN ('import_bulk','import_loop') THEN
    v_expected_orders := :batches * :size;
    v_expected_items  := :batches * :size * 2;
  ELSIF v_kind = 'create_unit' THEN
    v_expected_orders := :n;
    v_expected_items  := :n * 2;
  END IF;

  IF v_orders <> v_expected_orders OR v_items <> v_expected_items THEN
    RAISE EXCEPTION 'P79_SRV_VOLUME_MISMATCH kind=% orders=%/% items=%/%',
      v_kind, v_orders, v_expected_orders, v_items, v_expected_items;
  END IF;
  IF v_events < 0 THEN
    RAISE EXCEPTION 'P79_SRV_EVENTS_NEGATIVE';
  END IF;

  RAISE NOTICE 'P79_SRV_VOLUMES_OK kind=% orders=% items=% events=%',
    v_kind, v_orders, v_items, v_events;
END
$check$;

SELECT :'kind' AS kind,
       current_setting('p79.bench_variant', true) AS variant,
       :orders_after - :orders_before AS orders_created,
       :items_after - :items_before AS items_created,
       :events_after - :events_before AS invalidations_created;

SELECT p79_bench_teardown();
SELECT p79_bench_set_triggers(true);
