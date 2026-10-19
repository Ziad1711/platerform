-- P7.4 — télémétrie bornée du rollout KPI V5 (Test uniquement).
create or replace function public.rpc_dashboard_kpi_rollout_event(
  p_store_ids uuid[],
  p_mode text,
  p_event text,
  p_widget text default null,
  p_duration_ms integer default null,
  p_error_code text default null,
  p_config_version bigint default null,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_uid uuid := auth.uid();
  v_stores uuid[];
  v_count integer;
begin
  if v_uid is null then
    raise exception 'KPI_UNAUTHENTICATED';
  end if;
  if p_store_ids is null or cardinality(p_store_ids) = 0 then
    raise exception 'KPI_ROLLOUT_BAD_STORES';
  end if;
  if p_mode not in ('legacy', 'shadow', 'v5') then
    raise exception 'KPI_ROLLOUT_BAD_MODE';
  end if;
  if p_event is null or p_event !~ '^[a-z0-9_.:-]{1,64}$' then
    raise exception 'KPI_ROLLOUT_BAD_EVENT';
  end if;
  if p_widget is not null and p_widget !~ '^[a-z0-9_.:-]{1,64}$' then
    raise exception 'KPI_ROLLOUT_BAD_WIDGET';
  end if;
  if p_error_code is not null and length(p_error_code) > 80 then
    raise exception 'KPI_ROLLOUT_BAD_ERROR';
  end if;
  if p_duration_ms is not null and p_duration_ms < 0 then
    raise exception 'KPI_ROLLOUT_BAD_DURATION';
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

  select array_agg(distinct x) into v_stores
    from unnest(p_store_ids) x;

  -- Anti-spam : au-delà de 120 événements/minute, l'événement est ignoré.
  select count(*) into v_count
    from public.dashboard_kpi_rollout_events e
   where e.user_id = v_uid
     and e.occurred_at > now() - interval '1 minute';
  if v_count >= 120 then
    return;
  end if;

  if p_details is not null and octet_length(p_details::text) > 2048 then
    p_details := '{}'::jsonb;
  end if;

  insert into public.dashboard_kpi_rollout_events (
    user_id, store_ids, mode, event, widget, duration_ms,
    error_code, config_version, details
  ) values (
    v_uid,
    v_stores,
    p_mode,
    p_event,
    p_widget,
    p_duration_ms,
    p_error_code,
    coalesce(
      p_config_version,
      (select c.config_version from public.dashboard_kpi_rollout_config c where c.id = 1)
    ),
    coalesce(p_details, '{}'::jsonb)
  );
end
$function$;

revoke all on function public.rpc_dashboard_kpi_rollout_event(
  uuid[], text, text, text, integer, text, bigint, jsonb
) from public, anon;
grant execute on function public.rpc_dashboard_kpi_rollout_event(
  uuid[], text, text, text, integer, text, bigint, jsonb
) to authenticated, service_role;
