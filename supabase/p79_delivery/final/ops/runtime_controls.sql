-- JISRA — Contrôles d'exploitation KPI V5 (LECTURE SEULE, aucune écriture).
--
-- Vérifie l'état réel du lecteur, du worker, du drainage, des verrous applicatifs
-- et du chemin de retour legacy. Utilisable avant/pendant/après activation.
--   psql "$URL" -v ON_ERROR_STOP=1 -f runtime_controls.sql
\set ON_ERROR_STOP on
\pset pager off

-- 1. État du rollout (kill switch, mode demandé, fraîcheur de la configuration).
SELECT id,
       kill_switch,
       requested_mode,
       readiness_rbl4, readiness_tzdata, readiness_backend,
       shadow_sample_pct,
       config_version,
       updated_at,
       round(extract(epoch FROM (clock_timestamp() - updated_at))::numeric, 1) AS config_age_s,
       CASE WHEN kill_switch THEN 'legacy_forced' ELSE requested_mode END AS effective_mode,
       (SELECT count(*) FROM public.dashboard_kpi_rollout_cohorts) AS cohorts,
       (SELECT count(*) FROM public.dashboard_kpi_rollout_cohorts WHERE enabled) AS cohorts_enabled
  FROM public.dashboard_kpi_rollout_config
 ORDER BY id;

-- 2. Producteurs : combien sont actifs et lesquels (aucune activation implicite).
SELECT t.tgname, c.relname AS table_name, t.tgenabled,
       CASE t.tgenabled WHEN 'O' THEN 'ENABLED' WHEN 'D' THEN 'DISABLED' ELSE t.tgenabled::text END AS state
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
 WHERE NOT t.tgisinternal
   AND t.tgname LIKE 'trg_kpi_%'
 ORDER BY c.relname, t.tgname;

-- 3. Worker et réveil HTTP (le réveil doit rester désactivé pendant la montée).
SELECT w.id, w.enabled, w.max_partitions_per_run, w.max_events_per_run,
       w.max_seconds_per_run, w.statement_timeout_ms, w.updated_at,
       (SELECT enabled FROM public.dashboard_kpi_wakeup_config WHERE id = 1) AS wakeup_enabled,
       (to_regclass('cron.job') IS NOT NULL) AS cron_schema_present
  FROM public.dashboard_kpi_worker_config w
 ORDER BY w.id;

-- 4. Drainage et perte d'événements : backlog par âge, tentatives, bail expiré.
SELECT i.store_id,
       count(*) AS pending_total,
       count(*) FILTER (WHERE i.occurred_at < clock_timestamp() - interval '30 seconds') AS pending_over_30s,
       count(*) FILTER (WHERE i.occurred_at < clock_timestamp() - interval '5 minutes') AS pending_over_5min,
       count(*) FILTER (WHERE i.attempts > 0) AS with_attempts,
       max(i.attempts) AS max_attempts,
       max(i.last_error) AS last_error,
       count(*) FILTER (WHERE i.lease_expires_at IS NOT NULL
                          AND i.lease_expires_at < clock_timestamp()) AS expired_leases,
       round(max(extract(epoch FROM (clock_timestamp() - i.occurred_at)))::numeric, 1) AS oldest_age_s
  FROM public.dashboard_kpi_invalidation i
 WHERE i.processed_at IS NULL
 GROUP BY i.store_id
 ORDER BY oldest_age_s DESC NULLS LAST;

-- 5. Fraîcheur par boutique : âge du dernier rebuild et couverture publiée.
SELECT st.store_id,
       st.tz, st.active_definition_version, st.publish_counter, st.last_event_seq,
       st.coverage_from, st.coverage_to, st.backfill_state,
       st.computed_days, st.dirty_days, st.pending_partitions,
       st.last_rebuild_at,
       round(extract(epoch FROM (clock_timestamp() - st.last_rebuild_at))::numeric, 1) AS age_s,
       CASE WHEN st.last_rebuild_at IS NULL THEN 'NEVER_REBUILT'
            WHEN clock_timestamp() - st.last_rebuild_at > interval '5 minutes' THEN 'STALE'
            ELSE 'FRESH' END AS freshness
  FROM public.dashboard_kpi_store_state st
 ORDER BY st.store_id;

-- 6. Derniers passages du worker : succès, erreurs, durée, volumes.
SELECT r.run_id, r.worker, r.started_at, r.ended_at,
       r.duration_ms, r.partitions_rebuilt, r.partitions_failed,
       r.events_processed, r.stop_reason, r.last_error
  FROM public.dashboard_kpi_worker_run r
 ORDER BY r.run_id DESC
 LIMIT 20;

-- 7. Verrous : sessions bloquées et requêtes longues (attente mesurable).
SELECT a.pid, a.usename, a.state, a.wait_event_type, a.wait_event,
       round(extract(epoch FROM (clock_timestamp() - a.query_start))::numeric, 3) AS query_age_s,
       left(regexp_replace(a.query, '\s+', ' ', 'g'), 120) AS query_head
  FROM pg_stat_activity a
 WHERE a.datname = current_database()
   AND a.pid <> pg_backend_pid()
   AND (a.wait_event_type = 'Lock'
        OR (a.state = 'active' AND clock_timestamp() - a.query_start > interval '2 seconds'))
 ORDER BY query_age_s DESC;

-- 8. Conditions de retour legacy : objets nécessaires présents, aucune perte exigée.
SELECT
  (SELECT count(*) FROM public.dashboard_daily_metrics) AS aggregate_rows,
  (SELECT count(*) FROM public.dashboard_kpi_invalidation) AS journal_rows,
  (SELECT count(*) FROM public.orders) AS business_orders,
  (SELECT to_regprocedure('public.dashboard_kpi_worker_run(text,integer,integer,integer)') IS NOT NULL) AS worker_fn_present,
  (SELECT to_regprocedure('public.rpc_dashboard_kpi_reader(uuid[],date,date,boolean)') IS NOT NULL) AS reader_fn_present,
  (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename IN
     ('dashboard_daily_metrics','dashboard_kpi_invalidation','dashboard_kpi_store_state',
      'dashboard_kpi_worker_config','dashboard_kpi_rollout_config','dashboard_kpi_rollout_cohorts')) AS rls_policies;
