-- P7.10 : compatibilite du paquet avec le socle Production (LECTURE SEULE).
-- Aucune ecriture : uniquement pg_catalog / vues de configuration.
\set ON_ERROR_STOP on
\pset pager off
set default_transaction_read_only = on;

select 'server_version' as check, current_setting('server_version') as value
union all select 'timezone_data_version', current_setting('TimeZone') || ' / system tzdata'
union all select 'kpi_functions', count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and (p.proname like 'dashboard\_kpi%' or p.proname = 'rpc_dashboard_kpi_reader')
union all select 'kpi_triggers', count(*)::text from pg_trigger t join pg_class c on c.oid = t.tgrelid
  where c.relnamespace = 'public'::regnamespace and not t.tgisinternal and t.tgname like 'trg_kpi_%'
union all select 'local_ts_present', coalesce(to_regprocedure('public.dashboard_kpi_local_ts(timestamp with time zone,text)')::text, 'ABSENT')
union all select 'producer_config_table', coalesce(to_regclass('public.dashboard_kpi_producer_config')::text, 'ABSENT')
union all select 'worker_resilience_helper', coalesce(to_regprocedure('public.dashboard_kpi_worker_note_failure(uuid,date,uuid,text)')::text, 'ABSENT')
union all select 'rollout', kill_switch::text || '/' || requested_mode from public.dashboard_kpi_rollout_config where id = 1
union all select 'worker_enabled', enabled::text from public.dashboard_kpi_worker_config where id = 1
union all select 'reader_cohorts', count(*)::text from public.dashboard_kpi_rollout_cohorts
order by 1;

-- Empreintes du socle (doivent correspondre aux attentes du paquet P7.10).
select p.proname as fonction, md5(pg_get_functiondef(p.oid)) as md5
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('dashboard_kpi_invalidate_trg','dashboard_kpi_invalidate_insert_stmt',
                     'dashboard_kpi_mark_order_insert','dashboard_kpi_invalidate_orders_quality_trg',
                     'dashboard_kpi_worker_run','dashboard_kpi_local_ts','dashboard_kpi_local_instant')
 order by 1;
