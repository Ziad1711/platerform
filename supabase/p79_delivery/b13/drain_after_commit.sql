-- JISRA — B13 / mesure du drainage RÉEL après COMMIT (phase séparée).
--
-- À exécuter APRÈS la campagne appariée, sur la cible isolée uniquement,
-- worker actif. Aucun appel manuel au worker : on attend le cron.
--
-- psql "$URL" -v ON_ERROR_STOP=1 \
--   -c "set p79.bench_env='isolated'" \
--   -c "set p79.bench_confirm='SCHEDULED-ISOLATED-RUN'" \
--   -c "set p79.bench_project='<ref>'" -c "set p79.bench_allow='<ref>'" \
--   -v events=200 -f drain_after_commit.sql

\set ON_ERROR_STOP on
\pset pager off

DO $guard$
DECLARE v_ok boolean; v_project text := coalesce(current_setting('p79.bench_project', true), '');
BEGIN
  IF current_setting('p79.bench_env', true) IS DISTINCT FROM 'isolated'
     OR current_setting('p79.bench_confirm', true) IS DISTINCT FROM 'SCHEDULED-ISOLATED-RUN' THEN
    RAISE EXCEPTION 'P79_DRAIN_NOT_AUTHORIZED';
  END IF;
  IF v_project <> 'biqrgdopcvkrbgfxkzxm' THEN
    RAISE EXCEPTION 'P79_DRAIN_PROJECT_NOT_ALLOWED (%)', coalesce(nullif(v_project, ''), '<vide>');
  END IF;
  IF coalesce(current_setting('p79.bench_allow', true), '') <> v_project THEN
    RAISE EXCEPTION 'P79_DRAIN_DOUBLE_ENTRY_MISMATCH';
  END IF;
  SELECT enabled INTO v_ok FROM public.dashboard_kpi_worker_config WHERE id = 1;
  IF v_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'P79_DRAIN_WORKER_DISABLED (activer le worker de la cible isolee avant de mesurer)';
  END IF;
  IF to_regprocedure('public.p79_bench_begin()') IS NULL THEN
    RAISE EXCEPTION 'P79_DRAIN_HARNESS_MISSING';
  END IF;
END
$guard$;

SELECT p79_bench_begin();

-- Phase 1 : injection COMMITTÉE (autocommit), une commande par instruction.
\timing off
SELECT format('select p79_bench_create(%s);', g) FROM generate_series(1, :events) g \gexec

SELECT count(*) AS pending_after_commit
  FROM public.dashboard_kpi_invalidation
 WHERE store_id = '7f000000-0000-4000-8000-0000000000b1' AND processed_at IS NULL;

SELECT clock_timestamp() AS drain_started_at \gset

-- Phase 2 : attente passive du cron (aucun appel manuel au worker).
DO $wait$
DECLARE v_pending int; v_start timestamptz := clock_timestamp();
BEGIN
  LOOP
    SELECT count(*) INTO v_pending
      FROM public.dashboard_kpi_invalidation
     WHERE store_id = '7f000000-0000-4000-8000-0000000000b1' AND processed_at IS NULL;
    EXIT WHEN v_pending = 0;
    EXIT WHEN extract(epoch FROM clock_timestamp() - v_start) > 120;
    PERFORM pg_sleep(0.5);
  END LOOP;
  RAISE NOTICE 'P79_DRAIN_RESULT pending=% elapsed_s=%',
    v_pending, round(extract(epoch FROM clock_timestamp() - v_start)::numeric, 3);
END
$wait$;

SELECT 'pending_final' AS metric, count(*)::text AS value
  FROM public.dashboard_kpi_invalidation
 WHERE store_id = '7f000000-0000-4000-8000-0000000000b1' AND processed_at IS NULL
UNION ALL
SELECT 'acked_events', count(*)::text
  FROM public.dashboard_kpi_invalidation
 WHERE store_id = '7f000000-0000-4000-8000-0000000000b1' AND processed_at IS NOT NULL
UNION ALL
SELECT 'claimed_by_cron', count(*)::text
  FROM public.dashboard_kpi_invalidation
 WHERE store_id = '7f000000-0000-4000-8000-0000000000b1' AND claimed_by = 'cron';

SELECT p79_bench_teardown();
