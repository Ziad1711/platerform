-- ============================================================================
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
-- drop function if exists public.dashboard_kpi_access_level(p_store_id uuid);
-- drop function if exists public.dashboard_kpi_aggregate_delivery(p_store_id uuid, p_date date, p_version integer, p_start timestamp with time zone, p_end timestamp with time zone, p_tz text, p_currency text, p_last_seq bigint);
-- drop function if exists public.dashboard_kpi_aggregate_order(p_store_id uuid, p_date date, p_version integer, p_start timestamp with time zone, p_end timestamp with time zone, p_tz text, p_currency text, p_last_seq bigint);
-- drop function if exists public.dashboard_kpi_backfill_enqueue(p_store_id uuid, p_from date, p_to date);
-- drop function if exists public.dashboard_kpi_business_date(p_ts timestamp with time zone, p_tz text);
-- drop function if exists public.dashboard_kpi_claim(p_limit integer, p_worker text);
-- drop function if exists public.dashboard_kpi_coverage(p_store_id uuid, p_from date, p_to date);
-- drop function if exists public.dashboard_kpi_direct_day(p_store_id uuid, p_date date, p_tz text);
-- drop function if exists public.dashboard_kpi_invalidate_insert_stmt();
-- drop function if exists public.dashboard_kpi_invalidate_trg();
-- drop function if exists public.dashboard_kpi_mark_order_insert();
-- drop function if exists public.dashboard_kpi_note(p_store_id uuid, p_date date, p_reason text);
-- drop function if exists public.dashboard_kpi_purge_orphans(p_limit integer);
-- drop function if exists public.dashboard_kpi_purge_processed(p_before timestamp with time zone, p_limit integer);
-- drop function if exists public.dashboard_kpi_rebuild_day(p_store_id uuid, p_date date, p_token uuid, p_seqs bigint[]);
-- drop function if exists public.dashboard_kpi_resume(p_max_partitions integer, p_worker text);
-- drop function if exists public.dashboard_kpi_resume(p_max_partitions integer, p_worker text, p_force boolean);
-- drop function if exists public.dashboard_kpi_store_tz(p_store_id uuid);
-- drop function if exists public.dashboard_kpi_store_tz_cached(p_store_id uuid);
-- drop function if exists public.dashboard_kpi_wakeup_trg();
-- drop function if exists public.dashboard_kpi_worker_purge_runs(p_before timestamp with time zone, p_limit integer);
-- drop function if exists public.dashboard_kpi_worker_run(p_worker text, p_max_partitions integer, p_max_events bigint, p_max_seconds numeric);
-- drop function if exists public.rpc_dashboard_kpi_reader(p_store_ids uuid[], p_from date, p_to date, p_include_direct boolean);
--
-- drop table if exists public.dashboard_kpi_worker_run;
-- drop table if exists public.dashboard_kpi_wakeup_config;
-- drop table if exists public.dashboard_kpi_worker_config;
-- drop table if exists public.dashboard_kpi_store_state;
-- drop table if exists public.dashboard_kpi_invalidation;
-- drop table if exists public.dashboard_daily_metrics;
