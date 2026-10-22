-- Contrôle final de la livraison INACTIVE — LECTURE SEULE.
-- Aucune écriture, aucun DDL. Toute ligne FAIL interdit activation et poursuite.
\set ON_ERROR_STOP on
\pset pager off

with checks(check_id, expected, observed, kind) as (
  select 'kpi_producers_active', '0',
         (select count(*)::text from pg_trigger t join pg_class c on c.oid = t.tgrelid
           join pg_namespace n on n.oid = c.relnamespace
          where not t.tgisinternal and n.nspname = 'public'
            and t.tgname like 'trg\_kpi\_%' and t.tgenabled = 'O'),
         'bloquant'
  union all
  select 'kpi_cron_jobs', '0',
         (case when to_regclass('cron.job') is null then '0'
               else (select count(*)::text from cron.job where jobname like 'jisra\_kpi%') end),
         'bloquant'
  union all
  select 'worker_disabled', 'false',
         coalesce((select enabled::text from public.dashboard_kpi_worker_config where id = 1), 'ABSENT'),
         'bloquant'
  union all
  select 'wakeup_disabled', 'false',
         coalesce((select enabled::text from public.dashboard_kpi_wakeup_config where id = 1), 'ABSENT'),
         'bloquant'
  union all
  select 'reader_kill_switch', 'true',
         coalesce((select kill_switch::text from public.dashboard_kpi_rollout_config where id = 1), 'ABSENT'),
         'bloquant'
  union all
  select 'reader_requested_mode', 'legacy',
         coalesce((select requested_mode from public.dashboard_kpi_rollout_config where id = 1), 'ABSENT'),
         'bloquant'
  union all
  select 'rollout_cohorts', '0',
         (select count(*)::text from public.dashboard_kpi_rollout_cohorts),
         'bloquant'
  union all
  select 'rollout_events', '0',
         (select count(*)::text from public.dashboard_kpi_rollout_events),
         'informatif'
  union all
  select 'legacy_access_function', 'true',
         (to_regprocedure('public.dashboard_legacy_access(uuid)') is not null)::text,
         'bloquant'
  union all
  select 'rbl4_impl_present', 'true',
         (to_regprocedure('public._rbl4_impl_dashboard_revenue_chart(uuid[],timestamptz,timestamptz,text,timestamptz,timestamptz)') is not null)::text,
         'bloquant'
  union all
  select 'quality_trigger_absent', '0',
         (select count(*)::text from pg_trigger
           where not tgisinternal and tgname = 'trg_kpi_invalidate_orders_quality'),
         'bloquant'
  union all
  select 'p8_delivery_trigger', '1',
         (select count(*)::text from pg_trigger
           where not tgisinternal and tgname = 'a_p84_delivery_order_columns'),
         'bloquant'
  union all
  select 'p8_invitation_function', 'true',
         (to_regprocedure('public.can_invite_to_store(uuid,uuid)') is not null)::text,
         'bloquant'
  union all
  select 'p8_expenses_function', 'true',
         (to_regprocedure('public.can_manage_store_expenses(uuid)') is not null)::text,
         'bloquant'
  union all
  select 'reader_rpc_present', 'true',
         (to_regprocedure('public.rpc_dashboard_kpi_reader(uuid[],date,date,boolean)') is not null)::text,
         'informatif'
)
select check_id, expected, observed, kind,
       case when expected = observed then 'PASS' else 'FAIL' end as status
  from checks
 order by kind desc, check_id;

-- Résultat global : échoue si une seule vérification bloquante est FAIL.
do $verdict$
declare v_failed text;
begin
  select string_agg(check_id || ' (' || observed || ' au lieu de ' || expected || ')', '; ')
    into v_failed
    from (
      select 'kpi_producers_active' as check_id, '0' as expected,
             (select count(*)::text from pg_trigger t join pg_class c on c.oid = t.tgrelid
               join pg_namespace n on n.oid = c.relnamespace
              where not t.tgisinternal and n.nspname = 'public'
                and t.tgname like 'trg\_kpi\_%' and t.tgenabled = 'O') as observed
      union all
      select 'kpi_cron_jobs', '0',
             (case when to_regclass('cron.job') is null then '0'
                   else (select count(*)::text from cron.job where jobname like 'jisra\_kpi%') end)
      union all
      select 'worker_disabled', 'false',
             coalesce((select enabled::text from public.dashboard_kpi_worker_config where id = 1), 'ABSENT')
      union all
      select 'wakeup_disabled', 'false',
             coalesce((select enabled::text from public.dashboard_kpi_wakeup_config where id = 1), 'ABSENT')
      union all
      select 'reader_kill_switch', 'true',
             coalesce((select kill_switch::text from public.dashboard_kpi_rollout_config where id = 1), 'ABSENT')
      union all
      select 'reader_requested_mode', 'legacy',
             coalesce((select requested_mode from public.dashboard_kpi_rollout_config where id = 1), 'ABSENT')
      union all
      select 'rollout_cohorts', '0',
             (select count(*)::text from public.dashboard_kpi_rollout_cohorts)
      union all
      select 'quality_trigger_absent', '0',
             (select count(*)::text from pg_trigger
               where not tgisinternal and tgname = 'trg_kpi_invalidate_orders_quality')
    ) f
   where f.expected is distinct from f.observed;

  if v_failed is not null then
    raise exception 'INACTIVE_DELIVERY_FAILED: %', v_failed;
  end if;

  raise notice 'INACTIVE_DELIVERY_PASS';
end
$verdict$;
