-- ============================================================================
-- JISRA — P7.1 / 40 — ACTIVATION DU WORKER SQL BORNÉ (LOT SÉPARÉ)
-- ============================================================================
-- Prérequis : 10 installé, 20 appliqué (pg_cron), 30 appliqué (5 triggers).
-- Le worker traite le journal en SQL local ; aucun appel HTTP n'est requis.
--
-- Autorisation : SET LOCAL p7.activate_worker = 'yes';
-- Les bornes sont celles de la ligne 1 (10 partitions, 5000 événements, 4 s).
-- ============================================================================

do $guard$
declare
  v_n integer;
  v_enabled boolean;
begin
  if current_setting('p7.activate_worker', true) is distinct from 'yes' then
    raise exception 'P71_WORKER_NOT_AUTHORIZED';
  end if;

  if to_regclass('cron.job') is null then
    raise exception 'P71_PG_CRON_REQUIRED';
  end if;

  select count(*) into v_n
    from pg_trigger
   where not tgisinternal and tgname like 'trg_kpi_%';
  if v_n < 5 then
    raise exception 'P71_INVALIDATIONS_NOT_ACTIVE (found % triggers)', v_n;
  end if;

  select c.enabled into v_enabled
    from public.dashboard_kpi_worker_config c where c.id = 1;
  if v_enabled is null then
    raise exception 'P71_WORKER_CONFIG_MISSING';
  end if;

  if to_regprocedure('public.dashboard_kpi_worker_run(text,integer,bigint,numeric)') is null then
    raise exception 'P71_WORKER_FUNCTION_MISSING';
  end if;
end
$guard$;

update public.dashboard_kpi_worker_config
   set enabled = true,
       updated_at = clock_timestamp()
 where id = 1;

select cron.schedule(
  'jisra_kpi_worker',
  '2 seconds',
  $$select public.dashboard_kpi_worker_run('cron', 10, 5000, 4)$$
);

-- Entretien quotidien : purge des événements traités et des orphelins.
-- La rétention de 7 jours reste conservatrice pendant la qualification.
select cron.schedule(
  'jisra_kpi_purge',
  '10 3 * * *',
  $$select public.dashboard_kpi_purge_processed(now() - interval '7 days', 5000);
    select public.dashboard_kpi_purge_orphans(2000);$$
);

-- Contrôle :
--   select jobid, jobname, schedule, active from cron.job where jobname like 'jisra_kpi%';
--   select * from public.dashboard_kpi_health;
--   select status, return_message, start_time, end_time from cron.job_run_details
--    where jobid in (select jobid from cron.job where jobname like 'jisra_kpi%')
--    order by start_time desc limit 20;
--
-- COUPE-CIRCUIT (sans redéploiement) :
--   select cron.unschedule('jisra_kpi_worker');
--   select cron.unschedule('jisra_kpi_purge');
--   update public.dashboard_kpi_worker_config set enabled = false, updated_at = clock_timestamp() where id = 1;
--
-- Le journal, les agrégats et les traces de runs sont conservés.
