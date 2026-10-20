-- JISRA — P7.9 / vérification (lecture seule, aucune écriture).
--
-- Deux modes, choisis par la variable p79.stage :
--   inactive (défaut après 10_install_p79_functions.sql) : 0 trigger qualité
--   active   (après 20_activate_p79_quality_trigger.sql) : 1 trigger qualité
--
-- psql "$URL" -v ON_ERROR_STOP=1 -c "set p79.stage='inactive'" -f 90_verify_p79.sql
-- Attendu : 13 lignes, toutes PASS.
\pset pager off

select set_config('p79.stage',
                  coalesce(nullif(current_setting('p79.stage', true), ''), 'active'),
                  false) as stage_applied;

with checks(check_id, expected, observed) as (
  select 'mode',
         case when current_setting('p79.stage') = 'inactive' then 'inactive' else 'active' end,
         case when current_setting('p79.stage') = 'inactive' then 'inactive' else 'active' end

  union all
  select 'trg_quality_present',
         case when current_setting('p79.stage') = 'inactive' then '0' else '1' end,
         (select count(*)::text from pg_trigger where tgname = 'trg_kpi_invalidate_orders_quality')

  union all
  select 'trg_quality_fn_installed', '1',
         (select count(*)::text from pg_proc
           where proname = 'dashboard_kpi_invalidate_orders_quality_trg')

  union all
  select 'trg_quality_columns',
         case when current_setting('p79.stage') = 'inactive' then 'n/a'
              else 'rounding_adjustment,subtotal_amount' end,
         coalesce((select string_agg(a.attname, ',' order by a.attname)
                     from pg_trigger t
                     join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = any (t.tgattr)
                    where t.tgname = 'trg_kpi_invalidate_orders_quality'), 'n/a')

  union all
  select 'trg_quality_fn_acl_closed', '0',
         (select count(*)::text from pg_proc p
           where p.oid = to_regprocedure('public.dashboard_kpi_invalidate_orders_quality_trg()')
             and (has_function_privilege('public', p.oid, 'execute')
                  or has_function_privilege('anon', p.oid, 'execute')
                  or has_function_privilege('authenticated', p.oid, 'execute')))

  union all
  select 'quality_rpc_access_level', 't',
         (select (position('dashboard_kpi_access_level' in pg_get_functiondef(
                    'public.rpc_dashboard_kpi_quality_status(uuid[],date,date)'::regprocedure)) > 0)::text)

  union all
  select 'quality_rpc_no_anon', 'f',
         (select has_function_privilege('anon',
                    'public.rpc_dashboard_kpi_quality_status(uuid[],date,date)', 'execute')::text)

  union all
  select 'quality_rpc_auth_granted', 't',
         (select has_function_privilege('authenticated',
                    'public.rpc_dashboard_kpi_quality_status(uuid[],date,date)', 'execute')::text)

  union all
  select 'finalize_preserves_paused', 't',
         (select (position('''paused'', ''error''' in pg_get_functiondef(
                    'public.dashboard_kpi_finalize_store_state(uuid)'::regprocedure)) > 0)::text)

  union all
  select 'finalize_pending_gate', 't',
         (select (position('pending_outside_range' in pg_get_functiondef(
                    'public.dashboard_kpi_finalize_store_state(uuid)'::regprocedure)) > 0)::text)

  union all
  select 'surcharge_auth_closed', 'f',
         (select has_function_privilege('authenticated',
                    'public.rpc_dashboard_revenue_chart(uuid[],timestamptz,timestamptz,text,timestamptz,timestamptz)',
                    'execute')::text)

  union all
  select 'surcharge_anon_closed', 'f',
         (select has_function_privilege('anon',
                    'public.rpc_dashboard_revenue_chart(uuid[],timestamptz,timestamptz,text,timestamptz,timestamptz)',
                    'execute')::text)

  union all
  select 'chart_single_store_intact', 't',
         (select has_function_privilege('authenticated',
                    'public.rpc_dashboard_revenue_chart(uuid,timestamptz,timestamptz,text,timestamptz,timestamptz)',
                    'execute')::text)
)
select check_id, expected, observed,
       case when expected = observed then 'PASS' else 'FAIL' end as status
from checks
order by check_id;
