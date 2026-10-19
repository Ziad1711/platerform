-- P7.7 / C3-A (3/4) : réconciliation corrigée — axe `delivery`.
--
-- Même correction que l'axe `order` : la comparaison porte désormais sur
-- (1) lignes vs subtotal_amount et (2) total_selling_price vs total reconstitué
-- (sous-total - remise + livraison client + arrondi).
-- La reconnaissance reste `delivered_at` avec repli documenté sur `order_date`.
-- Aucun montant financier n'est modifié ; quality_version = 2.

create or replace function public.dashboard_kpi_aggregate_delivery(
  p_store_id uuid,
  p_date date,
  p_version integer,
  p_start timestamptz,
  p_end timestamptz,
  p_tz text,
  p_currency text,
  p_last_seq bigint
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare v_rows int;
begin
  delete from public.dashboard_daily_metrics m
   where m.store_id = p_store_id and m.business_date = p_date
     and m.axis = 'delivery' and m.definition_version = p_version;

  with scoped_deliv as (
    select o.id, o.buy_price, o.buy_price_source, o.delivery_fee, o.confirmation_cost_allocated,
           o.total_selling_price, o.subtotal_amount, o.discount_amount,
           o.delivery_charge_to_customer, o.rounding_adjustment
    from public.orders o
    where o.store_id = p_store_id and o.status = 'delivered'
      and (
        (o.delivered_at >= p_start and o.delivered_at < p_end)
        -- repli documenté (contrat) : livrée sans date de livraison => cohorte order_date
        or (o.delivered_at is null and o.order_date >= p_start and o.order_date < p_end)
      )
  ), items as (
    select oi.order_id,
           sum(coalesce(oi.quantity,0) * coalesce(oi.unit_selling_price,0)) as rev,
           sum(coalesce(oi.quantity,0) * coalesce(oi.unit_purchase_cost_snapshot,0)) as pc,
           count(*) as n_lines
    from public.order_items oi join scoped_deliv d on d.id = oi.order_id
    group by oi.order_id
  ), joined as (
    select d.*, i.rev, i.pc, i.n_lines,
           public.order_purchase_cost(d.buy_price_source, d.buy_price, coalesce(i.pc, d.buy_price, 0)) as purchase
    from scoped_deliv d left join items i on i.order_id = d.id
  )
  insert into public.dashboard_daily_metrics (
    store_id, business_date, axis, definition_version, tz_used, currency_code,
    orders_count, delivered_count, cancelled_count, returned_count, refused_count,
    pending_count, confirmed_like_count, sent_like_count, unclassified_count,
    revenue_items_gross, revenue_estimated, discount_amount, delivery_charge_customer,
    purchase_cost, delivery_fee_cost, confirmation_cost,
    ads_tracked, ads_allocated_raw, ads_fallback_effective, ads_daily_rows,
    orders_without_lines, delivered_without_lines, line_vs_total_mismatch,
    zero_purchase_with_revenue, data_issues_count, last_event_seq, computed_at,
    quality_version)
  select p_store_id, p_date, 'delivery', p_version, p_tz, p_currency,
    count(j.id)::int, count(j.id)::int, 0, 0, 0, 0, 0, 0, 0,
    coalesce(sum(coalesce(j.rev,0)), 0),
    coalesce(sum(coalesce(j.total_selling_price,0)) filter (where j.n_lines is null), 0),
    0, 0,
    coalesce(sum(j.purchase), 0),
    coalesce(sum(coalesce(j.delivery_fee,0)), 0),
    coalesce(sum(coalesce(j.confirmation_cost_allocated,0)), 0),
    0, 0, 0, 0,
    count(j.id) filter (where j.n_lines is null)::int,
    count(j.id) filter (where j.n_lines is null)::int,
    -- C3 : réconciliation corrigée
    count(j.id) filter (where (
         abs(coalesce(j.rev,0) - coalesce(j.subtotal_amount,0)) > 0.01
      or abs(coalesce(j.total_selling_price,0) - greatest(0,
           coalesce(j.subtotal_amount,0) - coalesce(j.discount_amount,0)
           + coalesce(j.delivery_charge_to_customer,0)
           + coalesce(j.rounding_adjustment,0))) > 0.01
    ))::int,
    count(j.id) filter (where coalesce(j.rev,0) > 0 and coalesce(j.purchase,0) = 0)::int,
    count(j.id) filter (where j.n_lines is null
      or abs(coalesce(j.rev,0) - coalesce(j.subtotal_amount,0)) > 0.01
      or abs(coalesce(j.total_selling_price,0) - greatest(0,
           coalesce(j.subtotal_amount,0) - coalesce(j.discount_amount,0)
           + coalesce(j.delivery_charge_to_customer,0)
           + coalesce(j.rounding_adjustment,0))) > 0.01
      or (coalesce(j.rev,0) > 0 and coalesce(j.purchase,0) = 0))::int,
    p_last_seq, clock_timestamp(), 2
  from joined j;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'KPI_AGGREGATE_DELIVERY_NO_ROW'; end if;
end;
$function$;

revoke all on function public.dashboard_kpi_aggregate_delivery(uuid, date, integer, timestamptz, timestamptz, text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.dashboard_kpi_aggregate_delivery(uuid, date, integer, timestamptz, timestamptz, text, text, bigint)
  to service_role;

