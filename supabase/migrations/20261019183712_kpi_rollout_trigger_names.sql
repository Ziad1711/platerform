-- P7.4 — noms des triggers de configuration hors du préfixe trg_kpi_.
-- Évite toute confusion avec les triggers d'invalidation KPI existants.

do $rename$
begin
  if exists (
    select 1 from pg_trigger
     where tgname = 'trg_kpi_rollout_config_touch'
       and tgrelid = 'public.dashboard_kpi_rollout_config'::regclass
  ) then
    alter trigger trg_kpi_rollout_config_touch
      on public.dashboard_kpi_rollout_config
      rename to trg_rollout_config_touch;
  end if;

  if exists (
    select 1 from pg_trigger
     where tgname = 'trg_kpi_rollout_cohort_touch'
       and tgrelid = 'public.dashboard_kpi_rollout_cohorts'::regclass
  ) then
    alter trigger trg_kpi_rollout_cohort_touch
      on public.dashboard_kpi_rollout_cohorts
      rename to trg_rollout_cohort_touch;
  end if;
end
$rename$;
