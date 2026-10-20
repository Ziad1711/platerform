-- JISRA — P7.9 / activation du producteur qualité (lot séparé).
-- À n'exécuter qu'après l'installation des 4 migrations P7.9, et après
-- autorisation explicite. Le trigger est le SEUL producteur ajouté par P7.9 :
-- sans lui, la fonction reste inerte et aucune invalidation supplémentaire
-- n'est émise.
--
-- psql "$URL" -v ON_ERROR_STOP=1 \
--   -c "set p79.activate_quality='yes'" \
--   --single-transaction -f 20_activate_p79_quality_trigger.sql

do $guard$
begin
  if current_setting('p79.activate_quality', true) is distinct from 'yes' then
    raise exception 'P79_ACTIVATION_NOT_AUTHORIZED';
  end if;

  if to_regprocedure('public.dashboard_kpi_invalidate_orders_quality_trg()') is null then
    raise exception 'P79_FUNCTION_MISSING (appliquer les migrations P7.9 avant)';
  end if;

  if exists (select 1 from pg_trigger where tgname = 'trg_kpi_invalidate_orders_quality') then
    raise exception 'P79_TRIGGER_ALREADY_PRESENT';
  end if;
end
$guard$;

create trigger trg_kpi_invalidate_orders_quality
  after update of subtotal_amount, rounding_adjustment on public.orders
  for each row execute function public.dashboard_kpi_invalidate_orders_quality_trg();

-- Contrôle immédiat (une ligne par attente).
select c.check_id, c.expected, c.observed,
       case when c.expected = c.observed then 'PASS' else 'FAIL' end as status
from (
  select 'quality_trigger' as check_id, '1' as expected,
         (select count(*)::text from pg_trigger
           where tgname = 'trg_kpi_invalidate_orders_quality') as observed
  union all
  select 'quality_trigger_enabled', 'O',
         (select tgenabled::text from pg_trigger where tgname = 'trg_kpi_invalidate_orders_quality')
  union all
  select 'kpi_triggers_total', '7',
         (select count(*)::text from pg_trigger t
            join pg_class c on c.oid = t.tgrelid
            join pg_namespace n on n.oid = c.relnamespace
           where not t.tgisinternal and n.nspname = 'public' and t.tgname like 'trg_kpi_%')
) c
order by c.check_id;
