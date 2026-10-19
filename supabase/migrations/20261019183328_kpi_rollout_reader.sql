-- P7.4 — RPC de rollout KPI V5 (Test uniquement).
-- Lecture de configuration, comparaison shadow et télémétrie bornée.
-- Aucune écriture sur les objets KPI, triggers métier, workers ou jobs.

create or replace function public.rpc_dashboard_kpi_rollout(p_store_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_uid uuid := auth.uid();
  v_cfg record;
  v_stores jsonb;
  v_selection text;
begin
  if v_uid is null then
    raise exception 'KPI_UNAUTHENTICATED';
  end if;
  if p_store_ids is null or cardinality(p_store_ids) = 0 then
    raise exception 'KPI_ROLLOUT_BAD_STORES';
  end if;

  if exists (
    select 1
      from (select distinct unnest(p_store_ids) as store_id) requested
     where not exists (
       select 1 from public.stores s
        where s.id = requested.store_id
          and public.dashboard_kpi_access_level(s.id) <> 'none'
     )
  ) then
    raise exception 'KPI_ROLLOUT_NO_ACCESS';
  end if;

  select * into v_cfg
    from public.dashboard_kpi_rollout_config
   where id = 1;

  if not found then
    return jsonb_build_object(
      'config_version', '0',
      'kill_switch', true,
      'requested_mode', 'legacy',
      'selection_mode', 'legacy',
      'shadow_sample_pct', 0,
      'readiness', jsonb_build_object('rbl4', false, 'tzdata', false, 'backend', false),
      'generated_at', now(),
      'expires_at', now(),
      'stores', '[]'::jsonb
    );
  end if;

  with requested as (
    select distinct unnest(p_store_ids) as store_id
  ),
  resolved as (
    select r.store_id,
           c.mode as cohort_mode,
           case
             when v_cfg.kill_switch then 'legacy'
             when not (v_cfg.readiness_rbl4 and v_cfg.readiness_tzdata and v_cfg.readiness_backend)
               then 'legacy'
             when v_cfg.requested_mode = 'legacy' then 'legacy'
             when c.store_id is null or not c.enabled then 'legacy'
             when v_cfg.requested_mode = 'shadow' then 'shadow'
             when v_cfg.requested_mode = 'v5' and c.mode = 'v5' then 'v5'
             when v_cfg.requested_mode = 'v5' and c.mode = 'shadow' then 'shadow'
             else 'legacy'
           end as effective_mode
      from requested r
      left join public.dashboard_kpi_rollout_cohorts c
        on c.store_id = r.store_id
  )
  select jsonb_agg(
           jsonb_build_object(
             'store_id', store_id,
             'effective_mode', effective_mode,
             'cohort_mode', cohort_mode
           ) order by store_id
         ),
         case
           when bool_and(effective_mode = 'v5') then 'v5'
           when bool_and(effective_mode in ('shadow', 'v5'))
                and bool_or(effective_mode = 'shadow') then 'shadow'
           else 'legacy'
         end
    into v_stores, v_selection
    from resolved;

  return jsonb_build_object(
    'config_version', v_cfg.config_version::text,
    'kill_switch', v_cfg.kill_switch,
    'requested_mode', v_cfg.requested_mode,
    'selection_mode', v_selection,
    'shadow_sample_pct', v_cfg.shadow_sample_pct,
    'readiness', jsonb_build_object(
      'rbl4', v_cfg.readiness_rbl4,
      'tzdata', v_cfg.readiness_tzdata,
      'backend', v_cfg.readiness_backend
    ),
    'generated_at', now(),
    'expires_at', now() + interval '15 seconds',
    'stores', coalesce(v_stores, '[]'::jsonb)
  );
end
$function$;

revoke all on function public.rpc_dashboard_kpi_rollout(uuid[]) from public, anon;
grant execute on function public.rpc_dashboard_kpi_rollout(uuid[]) to authenticated, service_role;

