-- P7.9 / P0-2 — permissions de rpc_dashboard_kpi_quality_status.
--
-- Constat : la RPC (P7.7) ne vérifiait qu'une appartenance active. Elle
-- retournait `data_issues_orders`, dont une composante
-- (`zero_purchase_with_revenue`) dépend du coût d'achat : un viewer ou un
-- marketer pouvait déduire indirectement une information financière, et un
-- utilisateur étranger recevait des zéros silencieux au lieu d'un refus.
--
-- Contrat appliqué, aligné sur R-BL4 (dashboard_legacy_access) :
--   * niveau d'accès repris de `dashboard_kpi_access_level` (owner/admin/
--     accountant -> full ; marketer/viewer -> commercial ; sinon none) ;
--   * sélection contenant une boutique sans droit ou vide -> DASHBOARD_NO_ACCESS
--     (aucune agrégation partielle silencieuse) ;
--   * diagnostics financiers masqués (null) pour `commercial` :
--       - mismatch_orders      : réconciliation de montants encaissés ;
--       - data_issues_orders   : inclut le coût d'achat nul ;
--     diagnostics opérationnels conservés : volumes de jours, versions de
--     qualité, commandes sans ligne.
--   * `financial_diagnostics_visible` et `access_level` exposent le masquage.
--
-- Aucune définition financière n'est modifiée : seules la visibilité et la
-- validation d'entrée changent. Les clés existantes sont conservées.

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
