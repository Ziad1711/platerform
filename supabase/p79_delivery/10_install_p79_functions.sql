-- JISRA - P7.9 / installation INACTIVE des fonctions (aucun producteur).
-- Genere depuis les quatre migrations approuvees ; corps copies a l identique
-- (verifies par inclusion stricte dans les fichiers sources).
-- Aucun trigger n est cree ici : voir 20_activate_p79_quality_trigger.sql.

\set ON_ERROR_STOP on
create or replace function public.dashboard_kpi_invalidate_orders_quality_trg()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_tz text;
  v_tx bigint;
begin
  -- Aucune invalidation si les valeurs ne changent pas réellement.
  if new.subtotal_amount is not distinct from old.subtotal_amount
     and new.rounding_adjustment is not distinct from old.rounding_adjustment then
    return null;
  end if;

  if new.store_id is null or new.order_date is null then
    return null;
  end if;

  v_tz := public.dashboard_kpi_store_tz_cached(new.store_id);
  v_tx := txid_current();

  insert into public.dashboard_kpi_invalidation (store_id, business_date, reason, note_tx)
  select v.s, v.d, v.r, v_tx
  from (values
    (new.store_id,
     (new.order_date at time zone v_tz)::date,
     'orders:UPDATE:quality:order'),
    (new.store_id,
     (coalesce(new.delivered_at, new.order_date) at time zone v_tz)::date,
     'orders:UPDATE:quality:delivery')
  ) v(s, d, r)
  where v.s is not null and v.d is not null
  on conflict do nothing;

  return null;
end;
$function$;

revoke all on function public.dashboard_kpi_invalidate_orders_quality_trg()
  from public, anon, authenticated;

comment on function public.dashboard_kpi_invalidate_orders_quality_trg() is
  'P7.9 : invalidation KPI ciblée quand seules les composantes qualité C3 (sous-total, arrondi) changent. Dédupliquée par dashboard_kpi_invalidation_tx_uniq.';

create or replace function public.rpc_dashboard_kpi_quality_status(
  p_store_ids uuid[],
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_uid uuid := auth.uid();
  v_requested int;
  v_accessible int;
  v_full boolean := false;
  v_days_total int := 0;
  v_days_v1 int := 0;
  v_days_v2 int := 0;
  v_mismatch int := 0;
  v_issues int := 0;
  v_without_lines int := 0;
begin
  if v_uid is null then
    raise exception 'KPI_UNAUTHENTICATED';
  end if;
  if p_store_ids is null or cardinality(p_store_ids) = 0 then
    raise exception 'KPI_QUALITY_BAD_STORES';
  end if;
  if p_from is null or p_to is null or p_from >= p_to then
    raise exception 'KPI_QUALITY_BAD_RANGE';
  end if;

  with requested as (
    select distinct unnest(p_store_ids) as store_id
  ), resolved as (
    select r.store_id, public.dashboard_kpi_access_level(r.store_id) as lvl
      from requested r
  )
  select count(*)::int,
         coalesce(bool_and(lvl = 'full'), false)
    into v_accessible, v_full
    from resolved
   where lvl <> 'none';

  select count(distinct store_id)::int into v_requested
    from (select distinct unnest(p_store_ids) as store_id) r;

  -- Refus explicite : sélection vide, partiellement inaccessible ou totalement
  -- inaccessible. Jamais de résultat partiel présenté comme complet.
  if v_requested = 0 or v_accessible <> v_requested then
    raise exception 'DASHBOARD_NO_ACCESS';
  end if;

  with scoped as (
    select m.store_id, m.business_date, m.axis, m.quality_version,
           m.line_vs_total_mismatch, m.data_issues_count, m.orders_without_lines
      from public.dashboard_daily_metrics m
      join (select distinct unnest(p_store_ids) as store_id) r
        on r.store_id = m.store_id
     where m.business_date >= p_from
       and m.business_date < p_to
  )
  select (count(distinct (store_id, business_date)))::int,
         (count(distinct (store_id, business_date))
            filter (where quality_version < 2))::int,
         (count(distinct (store_id, business_date))
            filter (where quality_version >= 2))::int,
         coalesce(sum(line_vs_total_mismatch) filter (where axis = 'order'), 0)::int,
         coalesce(sum(data_issues_count) filter (where axis = 'order'), 0)::int,
         coalesce(sum(orders_without_lines) filter (where axis = 'order'), 0)::int
    into v_days_total, v_days_v1, v_days_v2,
         v_mismatch, v_issues, v_without_lines
    from scoped;

  return jsonb_build_object(
    'access_level', case when v_full then 'full' else 'commercial' end,
    'financial_diagnostics_visible', v_full,
    'days_total',          v_days_total,
    'days_quality_v1',     v_days_v1,
    'days_quality_v2',     v_days_v2,
    'mismatch_orders',     case when v_full then v_mismatch else null end,
    'data_issues_orders',  case when v_full then v_issues else null end,
    'orders_without_lines', v_without_lines
  );
end;
$function$;

revoke all on function public.rpc_dashboard_kpi_quality_status(uuid[], date, date)
  from public, anon;
grant execute on function public.rpc_dashboard_kpi_quality_status(uuid[], date, date)
  to authenticated, service_role;

comment on function public.rpc_dashboard_kpi_quality_status(uuid[], date, date) is
  'P7.9 : état qualité KPI. Diagnostics financiers masqués pour marketer/viewer ; refus explicite hors périmètre.';

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

create or replace function public.rpc_dashboard_revenue_chart(
  p_store_ids uuid[],
  p_start_date timestamptz default null,
  p_end_date timestamptz default null,
  p_granularity text default 'day',
  p_conversion_start timestamptz default null,
  p_conversion_end timestamptz default null
)
returns table(
  date_key text, revenue numeric, profit numeric, ads_cost numeric,
  purchase_cost numeric, delivery_fee numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids uuid[];
  v_full boolean;
  v_role text := coalesce(auth.role(), '');
begin
  -- Fermeture d'accès : un appel porteur d'un JWT utilisateur est refusé même
  -- si un GRANT est réintroduit par erreur. Les appels internes sans JWT
  -- ('' ) et le service_role restent autorisés.
  if v_role in ('authenticated', 'anon') then
    raise exception 'KPI_MULTISTORE_SURCHARGE_DISABLED';
  end if;

  select array_agg(id order by id), bool_and(public.dashboard_legacy_access(id) = 'full')
    into v_ids, v_full
  from (select distinct unnest(p_store_ids) id) requested
  where public.dashboard_legacy_access(id) is not null;
  if coalesce(cardinality(v_ids), 0) <> coalesce((select count(distinct id) from unnest(p_store_ids) id), 0)
     or coalesce(cardinality(v_ids), 0) = 0 then
    raise exception 'DASHBOARD_NO_ACCESS';
  end if;
  return query
  select x.date_key, x.revenue,
         case when v_full then x.profit else null::numeric end,
         x.ads_cost,
         case when v_full then x.purchase_cost else null::numeric end,
         case when v_full then x.delivery_fee else null::numeric end
  from public._rbl4_impl_dashboard_revenue_chart(
    v_ids, p_start_date, p_end_date, p_granularity,
    p_conversion_start, p_conversion_end
  ) x;
end;
$$;

revoke all on function public.rpc_dashboard_revenue_chart(uuid[], timestamptz, timestamptz, text, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.rpc_dashboard_revenue_chart(uuid[], timestamptz, timestamptz, text, timestamptz, timestamptz)
  to service_role;

revoke all on function public._rbl4_impl_dashboard_revenue_chart(uuid[], timestamptz, timestamptz, text, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public._rbl4_impl_dashboard_revenue_chart(uuid[], timestamptz, timestamptz, text, timestamptz, timestamptz)
  to service_role;

comment on function public.rpc_dashboard_revenue_chart(uuid[], timestamptz, timestamptz, text, timestamptz, timestamptz) is
  'P7.9 : surcharge multiboutiques NON conforme au contrat C1-A. Accès client fermé (service_role uniquement) jusqu''à correction complète.';
