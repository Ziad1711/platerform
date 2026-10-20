-- JISRA — P7.9 / rollback du producteur (niveau 1, sans perte de preuve).
--
-- psql "$URL" -v ON_ERROR_STOP=1 \
--   -c "set p79.rollback_authorized='yes'" \
--   --single-transaction -f 91_rollback_p79.sql
--
-- Ce que ce rollback FAIT :
--   * retire le producteur ajouté par P7.9 (trigger puis fonction) ;
--   * conserve le journal d'invalidation, les acquittements et les révisions.
--
-- Ce que ce rollback NE FAIT PAS, volontairement :
--   * ne réinstalle pas la version P7.7 de rpc_dashboard_kpi_quality_status
--     (sans contrôle d'accès) : la version P7.9 est conservée ;
--   * ne rouvre pas rpc_dashboard_revenue_chart(uuid[]) aux clients ;
--   * ne revient pas sur dashboard_kpi_finalize_store_state : la version P7.9
--     empêche l'écrasement de paused/error et la déclaration prématurée de done.
--
-- Revenir sur ces trois points exigerait une décision explicite distincte,
-- documentée comme réintroduction d'un risque.

do $guard$
begin
  if current_setting('p79.rollback_authorized', true) is distinct from 'yes' then
    raise exception 'P79_ROLLBACK_NOT_AUTHORIZED';
  end if;
end
$guard$;

-- 1. Producteur : trigger d'abord, fonction ensuite.
drop trigger if exists trg_kpi_invalidate_orders_quality on public.orders;
drop function if exists public.dashboard_kpi_invalidate_orders_quality_trg();

-- 2. Aucune donnée métier, aucun journal, aucune révision touchés.
do $noop$
begin
  if exists (select 1 from pg_trigger where tgname = 'trg_kpi_invalidate_orders_quality') then
    raise exception 'P79_ROLLBACK_TRIGGER_REMAINS';
  end if;
  if to_regprocedure('public.dashboard_kpi_invalidate_orders_quality_trg()') is not null then
    raise exception 'P79_ROLLBACK_FUNCTION_REMAINS';
  end if;
end
$noop$;

-- 3. Contrôle de sortie : les protections P7.9 restent en place.
select c.check_id, c.expected, c.observed,
       case when c.expected = c.observed then 'PASS' else 'FAIL' end as status
from (
  select 'quality_trigger_removed' as check_id, '0' as expected,
         (select count(*)::text from pg_trigger
           where tgname = 'trg_kpi_invalidate_orders_quality') as observed
  union all
  select 'quality_trigger_fn_removed', '0',
         (select count(*)::text from pg_proc
           where proname = 'dashboard_kpi_invalidate_orders_quality_trg')
  union all
  select 'quality_rpc_still_hardened', 't',
         (select (position('dashboard_kpi_access_level' in pg_get_functiondef(
                    'public.rpc_dashboard_kpi_quality_status(uuid[],date,date)'::regprocedure)) > 0)::text)
  union all
  select 'surcharge_still_closed', 'f',
         (select has_function_privilege('authenticated',
                   'public.rpc_dashboard_revenue_chart(uuid[],timestamptz,timestamptz,text,timestamptz,timestamptz)',
                   'execute')::text)
  union all
  select 'finalize_still_preserves_paused', 't',
         (select (position('''paused'', ''error''' in pg_get_functiondef(
                    'public.dashboard_kpi_finalize_store_state(uuid)'::regprocedure)) > 0)::text)
  union all
  select 'invalidation_journal_preserved', 't',
         (select (count(*) > 0)::text from public.dashboard_kpi_invalidation)
) c
order by c.check_id;
