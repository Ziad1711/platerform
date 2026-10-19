-- P7.4 — fonctions de configuration hors du préfixe dashboard_kpi_.
-- Évite de fausser le décompte du vérificateur P7.1 (23 fonctions KPI).

do $rename$
begin
  if to_regprocedure('public.dashboard_kpi_rollout_config_touch()') is not null then
    alter function public.dashboard_kpi_rollout_config_touch()
      rename to rollout_config_touch;
  end if;

  if to_regprocedure('public.dashboard_kpi_rollout_cohort_touch()') is not null then
    alter function public.dashboard_kpi_rollout_cohort_touch()
      rename to rollout_cohort_touch;
  end if;
end
$rename$;
