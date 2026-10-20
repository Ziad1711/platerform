-- B13 / mesure SERVEUR : duree d'execution mesuree dans PostgreSQL, hors reseau.
--
-- Principe : chaque operation est chronometree avec clock_timestamp() DANS la
-- session serveur. Seule la latence client est exclue ; les attentes de verrou,
-- les I/O et le cout des triggers restent inclus.
--
-- Limites (documentees) :
--   * ne remplace pas EXPLAIN (ANALYZE, BUFFERS) pour l'attribution par plan ;
--   * n'inclut pas le COMMIT (les scenarios restent en transaction, ROLLBACK) ;
--   * pg_stat_statements n'est pas utilise : agregation globale non isolable
--     par operation sans reset (interdit).
--
-- psql "$URL" -v ON_ERROR_STOP=1 \
--   -c "set p79.bench_env='isolated'" -c "set p79.bench_confirm='SCHEDULED-ISOLATED-RUN'" \
--   -c "set p79.bench_project='biqrgdopcvkrbgfxkzxm'" -c "set p79.bench_allow='biqrgdopcvkrbgfxkzxm'" \
--   -c "set p79.bench_owner='c45355f3-6ab5-4dda-8861-d52e283bf163'" \
--   -c "set p79.bench_variant='A'" \
--   -v kind=create_unit -v n=50 -f server_measure.sql

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

-- Mesure d'une operation : p_kind parmi les six scenarios officiels.
CREATE OR REPLACE FUNCTION p79_srv_measure(p_kind text, p_n int, p_variant text)
RETURNS TABLE(i int, ms numeric, order_id uuid) LANGUAGE plpgsql AS $fn$
DECLARE t0 timestamptz; t1 timestamptz; v_oid uuid;
BEGIN
  FOR i IN 1..p_n LOOP
    t0 := clock_timestamp();
    IF p_kind = 'create_unit' THEN
      v_oid := public.p79_bench_create(i);
    ELSIF p_kind IN ('update_rounding', 'update_subtotal', 'update_unrelated') THEN
      PERFORM public.p79_bench_update(
        CASE p_kind WHEN 'update_rounding' THEN 'rounding'
                    WHEN 'update_subtotal' THEN 'subtotal'
                    ELSE 'unrelated' END, i);
      v_oid := NULL;
    ELSIF p_kind = 'import_bulk' THEN
      PERFORM public.p79_bench_import_bulk(p_n);
      v_oid := NULL;
    ELSIF p_kind = 'import_loop' THEN
      PERFORM public.p79_bench_import_loop(p_n);
      v_oid := NULL;
    ELSE
      RAISE EXCEPTION 'P79_SRV_BAD_KIND';
    END IF;
    t1 := clock_timestamp();
    RETURN QUERY SELECT i, round(extract(epoch FROM (t1 - t0)) * 1000, 3)::numeric, v_oid;
  END LOOP;
END
$fn$;

-- Execution : une instruction par iteration si p_kind est unitaire.
SELECT p79_bench_begin();
SELECT p79_bench_set_triggers(coalesce(current_setting('p79.bench_variant', true), 'C') <> 'A');

SELECT :'kind' AS kind,
       current_setting('p79.bench_variant', true) AS variant,
       count(*) AS samples,
       round(avg(ms), 3) AS mean_ms,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY ms)::numeric, 3) AS median_ms,
       round(percentile_cont(0.95) WITHIN GROUP (ORDER BY ms)::numeric, 3) AS p95_ms,
       round(min(ms), 3) AS min_ms,
       round(max(ms), 3) AS max_ms
FROM p79_srv_measure(:'kind', :n, current_setting('p79.bench_variant', true))
GROUP BY 1, 2;

-- Invalidations produites par le scenario (mesure de l'utilité des producteurs).
SELECT count(*) AS invalidation_rows_created
  FROM public.dashboard_kpi_invalidation
 WHERE store_id = '7f000000-0000-4000-8000-0000000000b1';

SELECT p79_bench_teardown();
SELECT p79_bench_set_triggers(true);
