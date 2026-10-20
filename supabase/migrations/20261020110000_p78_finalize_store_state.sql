-- P7.8 — finalisation des métadonnées de dashboard_kpi_store_state.
--
-- Problème corrigé : les agrégateurs recalculent les partitions mais ne
-- publient pas leur état. Une reconstruction par appels directs laissait donc
-- coverage_to, computed_days, dirty_days et backfill_state désynchronisés, ce
-- qui faussait dashboard_kpi_coverage et empêchait la détection de révision.
--
-- Principe :
--   * la fonction DÉRIVE les champs à partir des partitions et invalidations
--     réellement présentes ;
--   * elle ne touche JAMAIS publish_counter, last_event_seq ni last_rebuild_at
--     (ces champs restent gouvernés par la publication de rebuild_day) ;
--   * la plage déclarée ne rétrécit jamais : elle s'étend à la couverture
--     réellement calculée ;
--   * backfill_state = 'done' uniquement si la couverture est complète, propre,
--     avec les deux axes, la même version, le même fuseau et la même devise.
--
-- Aucune donnée métier n'est modifiée ; aucune partition n'est réécrite.

create or replace function public.dashboard_kpi_finalize_store_state(p_store_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_row public.dashboard_kpi_store_state%rowtype;
  v_version int;
  v_tz text;
  v_currency text;
  v_from date;
  v_to date;
  v_min date;
  v_max date;
  v_expected int;
  v_computed int;
  v_dirty int;
  v_missing_delivery int;
  v_incompatible int;
  v_pending int;
  v_reason text;
begin
  if p_store_id is null then
    raise exception 'KPI_BAD_STORE';
  end if;

  -- Sérialise deux finalisations concurrentes de la même boutique.
  -- Clé distincte des verrous de partition pris par dashboard_kpi_claim.
  perform pg_advisory_xact_lock(hashtextextended(p_store_id::text || '|finalize', 0));

  select * into v_row
    from public.dashboard_kpi_store_state
   where store_id = p_store_id;
  if not found then
    return jsonb_build_object('updated', false, 'reason', 'no_state');
  end if;

  v_version := coalesce(v_row.active_definition_version, 1);
  v_tz := coalesce(v_row.tz, 'Africa/Casablanca');
  select s.currency into v_currency from public.stores s where s.id = p_store_id;

  select min(m.business_date), max(m.business_date)
    into v_min, v_max
    from public.dashboard_daily_metrics m
   where m.store_id = p_store_id
     and m.definition_version = v_version;

  if v_min is null then
    return jsonb_build_object('updated', false, 'reason', 'no_partitions');
  end if;

  -- La plage déclarée ne rétrécit jamais ; elle couvre au moins le calculé.
  v_from := least(coalesce(v_row.coverage_from, v_min), v_min);
  v_to := greatest(coalesce(v_row.coverage_to, v_max), v_max);
  v_expected := (v_to - v_from) + 1;

  with days as (
    select d::date as day
      from generate_series(v_from::timestamp, v_to::timestamp, interval '1 day') d
  ), flags as (
    select dy.day,
      exists (
        select 1 from public.dashboard_daily_metrics m
         where m.store_id = p_store_id and m.business_date = dy.day
           and m.axis = 'order' and m.definition_version = v_version
           and m.tz_used = v_tz
           and m.currency_code is not distinct from v_currency
      ) as has_order,
      exists (
        select 1 from public.dashboard_daily_metrics m
         where m.store_id = p_store_id and m.business_date = dy.day
           and m.axis = 'delivery' and m.definition_version = v_version
           and m.tz_used = v_tz
           and m.currency_code is not distinct from v_currency
      ) as has_delivery,
      exists (
        select 1 from public.dashboard_kpi_invalidation i
         where i.store_id = p_store_id and i.business_date = dy.day
           and i.processed_at is null
      ) as is_dirty,
      exists (
        select 1 from public.dashboard_daily_metrics m
         where m.store_id = p_store_id and m.business_date = dy.day
           and m.definition_version <> v_version
      ) as other_version,
      exists (
        select 1 from public.dashboard_daily_metrics m
         where m.store_id = p_store_id and m.business_date = dy.day
           and m.definition_version = v_version
           and (m.tz_used is distinct from v_tz
                or m.currency_code is distinct from v_currency)
      ) as bad_config
    from days dy
  )
  select count(*) filter (where has_order),
         count(*) filter (where is_dirty),
         count(*) filter (where has_order and not has_delivery),
         count(*) filter (where bad_config or other_version)
    into v_computed, v_dirty, v_missing_delivery, v_incompatible
    from flags;

  select count(distinct i.business_date)
    into v_pending
    from public.dashboard_kpi_invalidation i
   where i.store_id = p_store_id and i.processed_at is null;

  if v_computed = v_expected and v_dirty = 0
     and v_missing_delivery = 0 and v_incompatible = 0 then
    v_reason := null;
  elsif v_computed < v_expected then
    v_reason := 'missing_days';
  elsif v_dirty > 0 then
    v_reason := 'dirty_days';
  elsif v_missing_delivery > 0 then
    v_reason := 'missing_delivery_axis';
  else
    v_reason := 'incompatible_partitions';
  end if;

  update public.dashboard_kpi_store_state st
     set coverage_from = v_from,
         coverage_to = v_to,
         computed_days = v_computed,
         dirty_days = v_dirty,
         pending_partitions = v_pending,
         backfill_state = case
           when v_reason is null then 'done'
           when st.backfill_state in ('done', 'idle') then 'running'
           else st.backfill_state
         end,
         updated_at = clock_timestamp()
   where st.store_id = p_store_id;

  return jsonb_build_object(
    'updated', true,
    'coverage_from', v_from,
    'coverage_to', v_to,
    'expected_days', v_expected,
    'computed_days', v_computed,
    'dirty_days', v_dirty,
    'missing_delivery_days', v_missing_delivery,
    'incompatible_days', v_incompatible,
    'pending_partitions', v_pending,
    'complete', v_reason is null,
    'reason', v_reason
  );
end;
$function$;

revoke all on function public.dashboard_kpi_finalize_store_state(uuid)
  from public, anon, authenticated;
grant execute on function public.dashboard_kpi_finalize_store_state(uuid)
  to service_role;

