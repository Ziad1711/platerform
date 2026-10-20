-- JISRA — P7.9 / vérification (lecture seule, aucune écriture).
-- psql "$URL" -v ON_ERROR_STOP=1 -f 90_verify_p79.sql
-- Attendu : 12 lignes, toutes PASS.
\pset pager off

with checks(check_id, expected, observed) as (
  values
    ('trg_quality_present', '1',
      (select count(*)::text from pg_trigger where tgname = 'trg_kpi_invalidate_orders_quality')),

    ('trg_quality_columns', 'subtotal_amount,rounding_adjustment',
      (select string_agg(a.attname, ',' order by a.attname)
         from pg_trigger t
         join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = any (t.tgattr)
        where t.tgname = 'trg_kpi_invalidate_orders_quality')),

    ('trg_quality_fn_acl_closed', '0',
      (select count(*)::text from pg_proc p
        where p.oid = to_regprocedure('public.dashboard_kpi_invalidate_orders_quality_trg()')
          and (has_function_privilege('public', p.oid, 'execute')
               or has_function_privilege('anon', p.oid, 'execute')
               or has_function_privilege('authenticated', p.oid, 'execute')))),

    ('quality_rpc_access_level', 't',
      (select (position('dashboard_kpi_access_level' in pg_get_functiondef(
                 'public.rpc_dashboard_kpi_quality_status(uuid[],date,date)'::regprocedure)) > 0)::text)),

    ('quality_rpc_no_anon', 'f',
      (select has_function_privilege('anon',
                'public.rpc_dashboard_kpi_quality_status(uuid[],date,date)', 'execute')::text)),

    ('quality_rpc_auth_granted', 't',
      (select has_function_privilege('authenticated',
                'public.rpc_dashboard_kpi_quality_status(uuid[],date,date)', 'execute')::text)),

    ('finalize_preserves_paused', 't',
      (select (position('''paused'', ''error''' in pg_get_functiondef(
                 'public.dashboard_kpi_finalize_store_state(uuid)'::regprocedure)) > 0)::text)),

    ('finalize_pending_gate', 't',
      (select (position('pending_outside_range' in pg_get_functiondef(
                 'public.dashboard_kpi_finalize_store_state(uuid)'::regprocedure)) > 0)::text)),

    ('surcharge_auth_closed', 'f',
      (select has_function_privilege('authenticated',
                'public.rpc_dashboard_revenue_chart(uuid[],timestamptz,timestamptz,text,timestamptz,timestamptz)',
                'execute')::text)),

    ('surcharge_anon_closed', 'f',
      (select has_function_privilege('anon',
                'public.rpc_dashboard_revenue_chart(uuid[],timestamptz,timestamptz,text,timestamptz,timestamptz)',
                'execute')::text)),

    ('chart_single_store_intact', 't',
      (select has_function_privilege('authenticated',
                'public.rpc_dashboard_revenue_chart(uuid,timestamptz,timestamptz,text,timestamptz,timestamptz)',
                'execute')::text)),

    ('rollout_off', 'legacy',
      (select case when kill_switch and requested_mode = 'legacy' then 'legacy'
                   else requested_mode end
         from public.dashboard_kpi_rollout_config where id = 1))
)
select check_id, expected, observed,
       case when expected = observed then 'PASS' else 'FAIL' end as status
from checks
order by check_id;

-- Rappel : 0 ligne dans les contrôles d'écriture ; cette vérification ne modifie
-- aucune donnée et n'écrit aucune ligne.
