-- P7.9 / P0-3 — transitions d'état de dashboard_kpi_finalize_store_state.
--
-- Audit P7.8 (constats) :
--   A. `backfill_state` était forcé à `done` dès que la couverture était
--      complète, y compris si un opérateur avait volontairement posé `paused`
--      ou `error`. Une finalisation (appelée à chaque publication) effaçait donc
--      une intention opérationnelle. `paused` est utilisé par
--      dashboard_kpi_claim : l'effacement relançait des backfills suspendus.
--   B. `done` ne tenait pas compte des invalidations en attente HORS de la plage
--      déclarée : une journée nouvellement sale au-delà de `coverage_to`
--      laissait la boutique déclarée `done` alors que du travail était en file.
--   C. `no_partitions` renvoyait `updated=false` sans corriger `computed_days` :
--      après suppression totale des partitions, l'état continuait d'annoncer
--      N jours calculés et un `done` devenu faux.
--
-- Correctifs minimaux :
--   * `paused` et `error` sont conservés tels quels (jamais promus ni écrasés) ;
--   * `done` exige `pending_partitions = 0`, y compris hors plage ; nouvelle
--     raison `pending_outside_range` ;
--   * `no_partitions` remet `computed_days`/`dirty_days` à 0 et rétrograde
--     `done` vers `idle` ; `paused`/`error` restent intacts ; la plage déclarée
--     n'est jamais modifiée par cette branche ;
--   * `no_state` reste inchangé : aucune ligne d'état n'est créée ici (une
--     création automatique déclarerait une couverture non décidée).
--
-- Inchangé : publish_counter, last_event_seq, last_rebuild_at, l'extension
-- monotone de la plage, le verrou de boutique et l'ordre des verrous.

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
  v_pending_outside int;
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

  -- Invalidations en attente sur TOUTE la boutique (plage incluse ou non).
  select count(distinct i.business_date)
    into v_pending
    from public.dashboard_kpi_invalidation i
   where i.store_id = p_store_id and i.processed_at is null;

  v_version := coalesce(v_row.active_definition_version, 1);
  v_tz := coalesce(v_row.tz, 'Africa/Casablanca');
  select s.currency into v_currency from public.stores s where s.id = p_store_id;

  select min(m.business_date), max(m.business_date)
    into v_min, v_max
    from public.dashboard_daily_metrics m
   where m.store_id = p_store_id
     and m.definition_version = v_version;

  if v_min is null then
    -- Aucune partition dans la version active : la couverture déclarée ne peut
    -- pas être honorée. On corrige les compteurs sans toucher à la plage ni à
    -- une intention opérationnelle.
    update public.dashboard_kpi_store_state st
       set computed_days = 0,
           dirty_days = 0,
           pending_partitions = v_pending,
           backfill_state = case
             when st.backfill_state in ('paused', 'error') then st.backfill_state
             when st.backfill_state = 'done' then 'idle'
             else st.backfill_state
           end,
           updated_at = clock_timestamp()
     where st.store_id = p_store_id;

    return jsonb_build_object(
      'updated', true,
      'coverage_from', v_row.coverage_from,
      'coverage_to', v_row.coverage_to,
      'expected_days', 0,
      'computed_days', 0,
      'dirty_days', 0,
      'missing_delivery_days', 0,
      'incompatible_days', 0,
      'pending_partitions', v_pending,
      'complete', false,
      'reason', 'no_partitions'
    );
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

  v_pending_outside := greatest(0, v_pending - v_dirty);

  if v_computed = v_expected and v_dirty = 0
     and v_missing_delivery = 0 and v_incompatible = 0
     and v_pending = 0 then
    v_reason := null;
  elsif v_computed < v_expected then
    v_reason := 'missing_days';
  elsif v_dirty > 0 then
    v_reason := 'dirty_days';
  elsif v_missing_delivery > 0 then
    v_reason := 'missing_delivery_axis';
  elsif v_incompatible > 0 then
    v_reason := 'incompatible_partitions';
  else
    v_reason := 'pending_outside_range';
  end if;

  update public.dashboard_kpi_store_state st
     set coverage_from = v_from,
         coverage_to = v_to,
         computed_days = v_computed,
         dirty_days = v_dirty,
         pending_partitions = v_pending,
         backfill_state = case
           -- Intention opérationnelle : jamais écrasée par une finalisation.
           when st.backfill_state in ('paused', 'error') then st.backfill_state
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
    'pending_outside_range', v_pending_outside,
    'complete', v_reason is null,
    'reason', v_reason
  );
end;
$function$;

revoke all on function public.dashboard_kpi_finalize_store_state(uuid)
  from public, anon, authenticated;
grant execute on function public.dashboard_kpi_finalize_store_state(uuid)
  to service_role;
