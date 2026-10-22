select 'kpi_triggers' as check, count(*)::text as value from pg_trigger t join pg_class c on c.oid=t.tgrelid
 where c.relnamespace='public'::regnamespace and not t.tgisinternal and t.tgname like 'trg_kpi_%'
union all select 'producer_config_table', coalesce(to_regclass('public.dashboard_kpi_producer_config')::text,'ABSENT')
union all select 'producer_stores_table', coalesce(to_regclass('public.dashboard_kpi_producer_stores')::text,'ABSENT')
union all select 'producer_status_view', coalesce(to_regclass('public.dashboard_kpi_producer_status')::text,'ABSENT')
union all select 'producer_functions', count(*)::text from pg_proc where proname like 'dashboard_kpi_producer%' or proname='dashboard_kpi_day_claimed'
union all select 'tz_helper_local_ts', coalesce(to_regprocedure('public.dashboard_kpi_local_ts(timestamp with time zone,text)')::text,'ABSENT')
union all select 'test_objects_p710', count(*)::text from pg_proc where proname like 'p710%'
union all select 'stores', count(*)::text from public.stores
union all select 'orders', count(*)::text from public.orders
union all select 'order_items', count(*)::text from public.order_items
union all select 'ad_spend_daily', count(*)::text from public.ad_spend_daily
union all select 'kpi_invalidation', count(*)::text from public.dashboard_kpi_invalidation
union all select 'daily_metrics', count(*)::text from public.dashboard_daily_metrics
union all select 'store_state', count(*)::text from public.dashboard_kpi_store_state
union all select 'worker_runs', count(*)::text from public.dashboard_kpi_worker_run
union all select 'worker_enabled', enabled::text from public.dashboard_kpi_worker_config where id=1
union all select 'rollout', kill_switch::text||'/'||requested_mode from public.dashboard_kpi_rollout_config where id=1
union all select 'reader_cohorts', count(*)::text from public.dashboard_kpi_rollout_cohorts
union all select 'prod_fingerprint_stmt', md5(pg_get_functiondef('public.dashboard_kpi_invalidate_insert_stmt()'::regprocedure))
order by 1;
