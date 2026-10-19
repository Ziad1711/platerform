-- P7.4 — comparaison shadow et télémétrie KPI V5 (Test uniquement).
-- Aucune écriture sur les objets KPI, triggers métier, workers ou jobs.
create or replace function public.rpc_dashboard_kpi_shadow_check(
  p_store_id uuid,
  p_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_tz text;
  v_ver integer;
  v_agg record;
  v_direct record;
  v_agg_json jsonb;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'KPI_UNAUTHENTICATED';
  end if;
  if p_store_id is null or p_date is null then
    raise exception 'KPI_ROLLOUT_BAD_ARGUMENTS';
  end if;
  if public.dashboard_kpi_access_level(p_store_id) = 'none' then
    raise exception 'KPI_NO_ACCESS';
  end if;

  select st.tz, st.active_definition_version
    into v_tz, v_ver
    from public.dashboard_kpi_store_state st
   where st.store_id = p_store_id;
  if not found then
    v_tz := 'Africa/Casablanca';
    v_ver := 1;
  end if;

  select * into v_agg
    from public.dashboard_daily_metrics m
   where m.store_id = p_store_id
     and m.business_date = p_date
     and m.axis = 'order'
     and m.definition_version = v_ver;
  if not found then
    return jsonb_build_object(
      'comparable', false,
      'reason', 'aggregate_missing',
      'match', false,
      'diff_count', null,
      'diff_fields', '[]'::jsonb
    );
  end if;

  select * into v_direct
    from public.dashboard_kpi_direct_day(p_store_id, p_date, v_tz);

  v_agg_json := jsonb_build_object(
    'orders_count', v_agg.orders_count,
    'delivered_count', v_agg.delivered_count,
    'cancelled_count', v_agg.cancelled_count,
    'returned_count', v_agg.returned_count,
    'refused_count', v_agg.refused_count,
    'pending_count', v_agg.pending_count,
    'unclassified_count', v_agg.unclassified_count,
    'revenue_items_gross', v_agg.revenue_items_gross,
    'revenue_estimated', v_agg.revenue_estimated,
    'discount_amount', v_agg.discount_amount,
    'delivery_charge_customer', v_agg.delivery_charge_customer,
    'purchase_cost', v_agg.purchase_cost,
    'delivery_fee_cost', v_agg.delivery_fee_cost,
    'confirmation_cost', v_agg.confirmation_cost,
    'ads_tracked', v_agg.ads_tracked,
    'ads_allocated_raw', v_agg.ads_allocated_raw,
    'ads_fallback_effective', v_agg.ads_fallback_effective,
    'ads_daily_rows', v_agg.ads_daily_rows,
    'orders_without_lines', v_agg.orders_without_lines,
    'delivered_without_lines', v_agg.delivered_without_lines,
    'line_vs_total_mismatch', v_agg.line_vs_total_mismatch,
    'zero_purchase_with_revenue', v_agg.zero_purchase_with_revenue,
    'data_issues_count', v_agg.data_issues_count
  );

  with a as (select v_agg_json as j),
       d as (select to_jsonb(v_direct) as j),
       diffs as (
         select x.key
           from a, d,
                jsonb_each(a.j) x
                join jsonb_each(d.j) y using (key)
          where x.value is distinct from y.value
       )
  select jsonb_build_object(
           'comparable', true,
           'match', (select a.j = d.j from a, d),
           'diff_count', (select count(*) from diffs),
           'diff_fields', (
             select coalesce(jsonb_agg(key order by key), '[]'::jsonb)
               from diffs
           )
         )
    into v_result
    from a, d;

  return v_result;
end
$function$;

revoke all on function public.rpc_dashboard_kpi_shadow_check(uuid, date) from public, anon;
grant execute on function public.rpc_dashboard_kpi_shadow_check(uuid, date) to authenticated, service_role;

