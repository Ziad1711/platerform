import fs from 'node:fs'

const snapshot = fs.readFileSync(new URL('../.work/snapshot.sql', import.meta.url), 'utf8')
const re = /^-- @@FUNCTION [0-9a-f]{32} (.+)$/gm
const signatures = []
let match
while ((match = re.exec(snapshot)) !== null) {
  signatures.push(match[1].replace(/\r$/, ''))
}
if (signatures.length !== 23) throw new Error(`expected 23, got ${signatures.length}`)

const drops = signatures
  .map((sig) => `-- drop function if exists public.${sig};`)
  .join('\n')

const sql = `-- ============================================================================
-- JISRA — P7.1 / 91 — ROLLBACK SÛR (SANS SUPPRESSION D'ÉVÉNEMENTS)
-- ============================================================================
-- Niveau 1 (actif) : arrête les traitements et les producteurs, CONSERVE le
-- journal, les agrégats, les runs et les sources métier.
-- LIMITE : les écritures postérieures à l'arrêt des producteurs ne sont plus
-- capturées ; les événements déjà présents ne sont jamais supprimés.
-- Niveau 2 (commenté) : suppression des objets KPI, uniquement après export,
-- rapprochement et décision explicite.
--
-- Autorisation niveau 1 : SET LOCAL p7.rollback_authorized = 'yes';
-- Ne touche jamais orders / order_items / ad_spend_daily / stores.
-- ============================================================================

do $guard$
begin
  if current_setting('p7.rollback_authorized', true) is distinct from 'yes' then
    raise exception 'P71_ROLLBACK_NOT_AUTHORIZED';
  end if;
end
$guard$;

-- 1. Coupe-circuit worker.
do $stop$
declare
  v_state text;
  v_msg text;
  v_left text;
begin
  if to_regclass('cron.job') is not null then
    begin
      perform cron.unschedule('jisra_kpi_worker');
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      if v_state not in ('42704','42883','P0002')
         and v_msg not ilike '%not found%'
         and v_msg not ilike '%could not find valid entry for job%' then
        raise;
      end if;
    end;

    begin
      perform cron.unschedule('jisra_kpi_purge');
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      if v_state not in ('42704','42883','P0002')
         and v_msg not ilike '%not found%'
         and v_msg not ilike '%could not find valid entry for job%' then
        raise;
      end if;
    end;

    select string_agg(jobname, ',') into v_left
      from cron.job where jobname like 'jisra_kpi%';
    if v_left is not null then
      raise exception 'P71_ROLLBACK_JOBS_REMAIN: %', v_left;
    end if;
  end if;

  if to_regclass('public.dashboard_kpi_worker_config') is not null then
    update public.dashboard_kpi_worker_config
       set enabled = false, updated_at = clock_timestamp()
     where id = 1;
  end if;

  if to_regclass('public.dashboard_kpi_wakeup_config') is not null then
    update public.dashboard_kpi_wakeup_config
       set enabled = false, updated_at = clock_timestamp()
     where id = 1;
  end if;
end
$stop$;

-- 2. Arrêt des producteurs KPI (aucune donnée métier modifiée).
do $trg$
begin
  if to_regclass('public.dashboard_kpi_invalidation') is not null then
    execute 'drop trigger if exists trg_kpi_wakeup on public.dashboard_kpi_invalidation';
  end if;
end
$trg$;
drop trigger if exists trg_kpi_invalidate_ad_spend on public.ad_spend_daily;
drop trigger if exists trg_kpi_invalidate_order_items on public.order_items;
drop trigger if exists trg_kpi_invalidate_orders_insert on public.orders;
drop trigger if exists trg_kpi_invalidate_orders on public.orders;
drop trigger if exists trg_kpi_mark_order_insert on public.orders;

-- 3. Conserver le journal. Noter la plage à reconstruire avant toute purge :
--   select store_id, min(business_date), max(business_date), count(*)
--     from public.dashboard_kpi_invalidation
--    where processed_at is null
--    group by store_id;
--   select * from public.dashboard_kpi_health;

-- ============================================================================
-- NIVEAU 2 — SUPPRESSION DES OBJETS (DÉCOMMENTER APRÈS AUTORISATION)
-- ============================================================================
-- Prérequis : export du journal, des agrégats et des runs ; rapprochement fait ;
-- décision humaine explicite ; aucun autre objet ne dépend des fonctions.
--
-- drop view if exists public.dashboard_kpi_health;
${drops}
--
-- drop table if exists public.dashboard_kpi_worker_run;
-- drop table if exists public.dashboard_kpi_wakeup_config;
-- drop table if exists public.dashboard_kpi_worker_config;
-- drop table if exists public.dashboard_kpi_store_state;
-- drop table if exists public.dashboard_kpi_invalidation;
-- drop table if exists public.dashboard_daily_metrics;
`

fs.writeFileSync(new URL('../91_rollback.sql', import.meta.url), sql)
