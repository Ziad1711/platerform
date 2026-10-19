import fs from 'node:fs'

const snapshot = fs.readFileSync(new URL('../.work/snapshot.sql', import.meta.url), 'utf8')
const re = /^-- @@FUNCTION ([0-9a-f]{32}) (.+)$/gm
const rows = []
let match
while ((match = re.exec(snapshot)) !== null) {
  const md5 = match[1]
  const signature = match[2].replace(/\r$/, '').replace(/'/g, "''")
  rows.push(`  ('${signature}', '${md5}')`)
}
if (rows.length !== 23) throw new Error(`expected 23, got ${rows.length}`)

const sql = `-- ============================================================================
-- JISRA — P7.1 / 90 — VÉRIFICATION (LECTURE + TABLE TEMPORAIRE DE SESSION)
-- ============================================================================
-- Usage psql :
--   psql "$URL" -v ON_ERROR_STOP=1 -c "set p7.stage='install'" -f 90_verify.sql
-- Stages : install | invalidations | worker | wakeup | all
-- Sur jisra-test, utiliser stage=all : une anomalie ACL connue (EXECUTE PUBLIC
-- sur dashboard_kpi_invalidate_insert_stmt) doit apparaître en FAIL.
-- ============================================================================

select set_config(
  'p7.stage',
  coalesce(nullif(current_setting('p7.stage', true), ''), 'install'),
  false
);

drop table if exists pg_temp.p7_checks;
create temp table p7_checks (
  check_id text,
  expected text,
  observed text,
  status text not null
);

with expected(signature, expected_md5) as (
  values
${rows.join(',\n')}
),
actual as (
  select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as signature,
         md5(pg_get_functiondef(p.oid)) as actual_md5,
         p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and (p.proname like 'dashboard_kpi%' or p.proname = 'rpc_dashboard_kpi_reader')
),
table_counts(table_name, n) as (
  values
    ('dashboard_daily_metrics', 33),
    ('dashboard_kpi_invalidation', 13),
    ('dashboard_kpi_store_state', 17),
    ('dashboard_kpi_worker_config', 7),
    ('dashboard_kpi_worker_run', 10),
    ('dashboard_kpi_wakeup_config', 7)
)
insert into p7_checks
select 'function_count', '23', count(*)::text,
       case when count(*) = 23 then 'PASS' else 'FAIL' end
  from actual
union all
select 'function_fingerprints', '23', count(*)::text,
       case when count(*) = 23 then 'PASS' else 'FAIL' end
  from expected e join actual a using (signature)
 where a.actual_md5 = e.expected_md5
union all
select 'tables', '6', count(*)::text,
       case when count(*) = 6 then 'PASS' else 'FAIL' end
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
   and c.relname in (select table_name from table_counts)
union all
select 'columns_' || tc.table_name, tc.n::text, coalesce(o.n, 0)::text,
       case when coalesce(o.n, 0) = tc.n then 'PASS' else 'FAIL' end
  from table_counts tc
  left join (
    select table_name, count(*)::int as n
      from information_schema.columns
     where table_schema = 'public'
       and table_name in (select table_name from table_counts)
     group by table_name
  ) o on o.table_name = tc.table_name
union all
select 'constraints', '27', count(*)::text,
       case when count(*) = 27 then 'PASS' else 'FAIL' end
  from pg_constraint
 where connamespace = 'public'::regnamespace
   and contype <> 't'
   and conrelid::regclass::text in (select table_name from table_counts)
union all
select 'indexes', '9', count(*)::text,
       case when count(*) = 9 then 'PASS' else 'FAIL' end
  from pg_indexes
 where schemaname = 'public'
   and tablename in (select table_name from table_counts)
union all
select 'tx_unique_index', '1', count(*)::text,
       case when count(*) = 1 then 'PASS' else 'FAIL' end
  from pg_indexes
 where schemaname = 'public'
   and indexname = 'dashboard_kpi_invalidation_tx_uniq'
union all
select 'tx_unique_index_definition', '1', count(*)::text,
       case when count(*) = 1 then 'PASS' else 'FAIL' end
  from pg_indexes
 where schemaname = 'public'
   and indexname = 'dashboard_kpi_invalidation_tx_uniq'
   and indexdef ilike '%(store_id, business_date, note_tx)%'
   and indexdef ilike '%note_tx IS NOT NULL%'
union all
select 'note_tx_column', '1', count(*)::text,
       case when count(*) = 1 then 'PASS' else 'FAIL' end
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'dashboard_kpi_invalidation'
   and column_name = 'note_tx'
   and data_type = 'bigint'
union all
select 'reader_security_definer', 'true',
       coalesce((select p.prosecdef::text from pg_proc p
                  where p.oid = to_regprocedure('public.rpc_dashboard_kpi_reader(uuid[],date,date,boolean)')), 'missing'),
       case when coalesce((select p.prosecdef from pg_proc p
                  where p.oid = to_regprocedure('public.rpc_dashboard_kpi_reader(uuid[],date,date,boolean)')), false)
            then 'PASS' else 'FAIL' end
union all
select 'view_health_columns', '12', count(*)::text,
       case when count(*) = 12 then 'PASS' else 'FAIL' end
  from information_schema.columns
 where table_schema = 'public' and table_name = 'dashboard_kpi_health'
union all
select 'rls_enabled', '6', count(*)::text,
       case when count(*) = 6 then 'PASS' else 'FAIL' end
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relrowsecurity
   and c.relname in (select table_name from table_counts)
union all
select 'rls_policies', '0', count(*)::text,
       case when count(*) = 0 then 'PASS' else 'FAIL' end
  from pg_policies
 where schemaname = 'public'
   and tablename in (select table_name from table_counts)
union all
select 'kpi_triggers',
       (case current_setting('p7.stage')
          when 'install' then '0'
          when 'invalidations' then '5'
          when 'worker' then '5'
          when 'wakeup' then '6'
          when 'all' then '5'
          else '-1' end),
       count(*)::text,
       case
         when current_setting('p7.stage') = 'install' and count(*) = 0 then 'PASS'
         when current_setting('p7.stage') = 'invalidations' and count(*) = 5 then 'PASS'
         when current_setting('p7.stage') = 'worker' and count(*) = 5 then 'PASS'
         when current_setting('p7.stage') = 'wakeup' and count(*) = 6 then 'PASS'
         when current_setting('p7.stage') = 'all' and count(*) = 5 then 'PASS'
         else 'FAIL'
       end
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
 where not t.tgisinternal and t.tgname like 'trg_kpi_%'
   and c.relname in ('orders','order_items','ad_spend_daily','dashboard_kpi_invalidation')
union all
select 'worker_enabled',
       (case when current_setting('p7.stage') in ('worker','wakeup','all') then 'true' else 'false' end),
       coalesce((select c.enabled::text from public.dashboard_kpi_worker_config c where c.id = 1), 'missing'),
       case
         when current_setting('p7.stage') in ('worker','wakeup','all')
              and coalesce((select c.enabled from public.dashboard_kpi_worker_config c where c.id = 1), false) then 'PASS'
         when current_setting('p7.stage') in ('install','invalidations')
              and not coalesce((select c.enabled from public.dashboard_kpi_worker_config c where c.id = 1), true) then 'PASS'
         else 'FAIL'
       end
union all
select 'wakeup_enabled',
       (case when current_setting('p7.stage') = 'wakeup' then 'true' else 'false' end),
       coalesce((select c.enabled::text from public.dashboard_kpi_wakeup_config c where c.id = 1), 'missing'),
       case
         when current_setting('p7.stage') = 'wakeup'
              and coalesce((select c.enabled from public.dashboard_kpi_wakeup_config c where c.id = 1), false) then 'PASS'
         when current_setting('p7.stage') <> 'wakeup'
              and not coalesce((select c.enabled from public.dashboard_kpi_wakeup_config c where c.id = 1), true) then 'PASS'
         else 'FAIL'
       end
union all
select 'acl_reader_authenticated', 'true',
       coalesce(has_function_privilege(
         'authenticated',
         to_regprocedure('public.rpc_dashboard_kpi_reader(uuid[],date,date,boolean)'),
         'EXECUTE')::text, 'false'),
       case when coalesce(has_function_privilege(
         'authenticated',
         to_regprocedure('public.rpc_dashboard_kpi_reader(uuid[],date,date,boolean)'),
         'EXECUTE'), false) then 'PASS' else 'FAIL' end
union all
select 'acl_reader_anon', 'false',
       coalesce(has_function_privilege(
         'anon',
         to_regprocedure('public.rpc_dashboard_kpi_reader(uuid[],date,date,boolean)'),
         'EXECUTE')::text, 'false'),
       case when not coalesce(has_function_privilege(
         'anon',
         to_regprocedure('public.rpc_dashboard_kpi_reader(uuid[],date,date,boolean)'),
         'EXECUTE'), false) then 'PASS' else 'FAIL' end
union all
select 'acl_no_client_on_internal', '0', count(*)::text,
       case when count(*) = 0 then 'PASS' else 'FAIL' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname like 'dashboard_kpi%'
   and (has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
union all
select 'acl_service_role_all', '23', count(*)::text,
       case when count(*) = 23 then 'PASS' else 'FAIL' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and (p.proname like 'dashboard_kpi%' or p.proname = 'rpc_dashboard_kpi_reader')
   and has_function_privilege('service_role', p.oid, 'EXECUTE')
union all
select 'acl_tables_no_client', '0', count(*)::text,
       case when count(*) = 0 then 'PASS' else 'FAIL' end
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in (select table_name from table_counts)
   and (has_table_privilege('anon', c.oid, 'SELECT')
        or has_table_privilege('authenticated', c.oid, 'SELECT'))
union all
select 'state_empty_at_install',
       (case when current_setting('p7.stage') = 'install' then '0' else 'n/a' end),
       ((select count(*) from public.dashboard_daily_metrics)
        + (select count(*) from public.dashboard_kpi_invalidation)
        + (select count(*) from public.dashboard_kpi_worker_run))::text,
       case
         when current_setting('p7.stage') = 'install'
              and (select count(*) from public.dashboard_daily_metrics) = 0
              and (select count(*) from public.dashboard_kpi_invalidation) = 0
              and (select count(*) from public.dashboard_kpi_worker_run) = 0 then 'PASS'
         when current_setting('p7.stage') <> 'install' then 'PASS'
         else 'FAIL'
       end
union all
select 'wakeup_url_absent_at_install',
       (case when current_setting('p7.stage') = 'install' then 'true' else 'n/a' end),
       coalesce((select (c.url is null and c.host is null)::text
                   from public.dashboard_kpi_wakeup_config c where c.id = 1), 'missing'),
       case
         when current_setting('p7.stage') = 'install'
              and coalesce((select (c.url is null and c.host is null)
                              from public.dashboard_kpi_wakeup_config c where c.id = 1), false) then 'PASS'
         when current_setting('p7.stage') <> 'install' then 'PASS'
         else 'FAIL'
       end;

do $jobs$
declare
  v_expected integer;
  v_actual integer := 0;
begin
  v_expected := case current_setting('p7.stage')
    when 'install' then 0
    when 'invalidations' then 0
    when 'worker' then 2
    when 'wakeup' then 2
    when 'all' then 2
    else -1 end;

  if to_regclass('cron.job') is not null then
    execute 'select count(*) from cron.job where jobname like ''jisra_kpi%''' into v_actual;
  end if;

  insert into p7_checks(check_id, expected, observed, status)
  values (
    'kpi_jobs',
    v_expected::text,
    v_actual::text,
    case when v_expected = v_actual then 'PASS' else 'FAIL' end
  );
end
$jobs$;

select check_id, expected, observed, status
  from p7_checks
 order by case status when 'FAIL' then 0 else 1 end, check_id;

do $summary$
declare
  v_fail integer;
  v_total integer;
begin
  select count(*), count(*) filter (where status = 'FAIL')
    into v_total, v_fail
    from p7_checks;

  raise notice 'P71_VERIFY total=% fail=%', v_total, v_fail;

  if v_fail > 0 then
    raise exception 'P71_VERIFY_FAILED (% of % checks)', v_fail, v_total;
  end if;
end
$summary$;
`

fs.writeFileSync(new URL('../90_verify.sql', import.meta.url), sql)

