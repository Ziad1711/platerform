-- P7.7 / C3-A (2/4) : réconciliation corrigée — axe `order`.
--
-- Ancien contrôle : revenu des lignes comparé au total encaissé
-- (total_selling_price), qui inclut livraison client, remise et arrondi.
-- Nouveau contrôle, en deux parties :
--   1. lignes vs sous-total : abs(rev - subtotal_amount) > 0.01
--   2. total vs formule      : abs(total_selling_price - greatest(0,
--        subtotal_amount - discount_amount + delivery_charge_to_customer
--        + rounding_adjustment)) > 0.01
--
-- data_issues_count compte les commandes distinctes affectées par au moins un
-- problème : une seule ligne par commande, donc aucune addition de catégories.
-- Aucun montant financier n'est modifié. Seuls les indicateurs de qualité et la
-- version de qualité (2) changent.

create or replace function public.dashboard_kpi_aggregate_order(
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
     and m.axis = 'order' and m.definition_version = p_version;

  with scoped as (
    select o.id, o.status, o.delivery_fee, o.confirmation_cost_allocated, o.ads_cost_allocated,
           o.buy_price, o.buy_price_source, o.discount_amount, o.delivery_charge_to_customer,
           o.total_selling_price, o.subtotal_amount, o.rounding_adjustment
    from public.orders o
    where o.store_id = p_store_id and o.order_date >= p_start and o.order_date < p_end
  ), items as (
    select oi.order_id,
           sum(coalesce(oi.quantity,0) * coalesce(oi.unit_selling_price,0)) as rev,
           sum(coalesce(oi.quantity,0) * coalesce(oi.unit_purchase_cost_snapshot,0)) as pc,
           count(*) as n_lines
    from public.order_items oi join scoped s on s.id = oi.order_id
    group by oi.order_id
  ), joined as (
    select s.*, i.rev, i.pc, i.n_lines,
           public.order_purchase_cost(s.buy_price_source, s.buy_price, coalesce(i.pc, s.buy_price, 0)) as purchase
    from scoped s left join items i on i.order_id = s.id
  ), ads as (
    select coalesce(sum(coalesce(a.spend_converted, a.spend, 0)), 0) as tracked,
           count(*)::int as n_rows
    from public.ad_spend_daily a
    where a.store_id = p_store_id and a.spend_date >= p_start and a.spend_date < p_end
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
  select p_store_id, p_date, 'order', p_version, p_tz, p_currency,
    count(j.id)::int,
    count(j.id) filter (where j.status = 'delivered')::int,
    count(j.id) filter (where j.status = 'cancelled')::int,
    count(j.id) filter (where j.status in ('returned_stocked','returned_not_stocked'))::int,
    count(j.id) filter (where j.status = 'refused')::int,
    count(j.id) filter (where j.status in ('new','follow_up_1','follow_up_2','follow_up_3','follow_up_4','follow_up_5','no_answer','wrong_number','voicemail','confirmation_rejected'))::int,
    -- funnels alignés sur le lecteur existant (recouvrement assumé, NON additif)
    count(j.id) filter (where j.status in ('confirmed','picked_up','sent','delivered','returned_not_stocked','returned_stocked'))::int,
    count(j.id) filter (where j.status in ('sent','delivered','returned_not_stocked','returned_stocked'))::int,
    -- non classifiées = hors des 4 familles publiées + pending : inclut `refused` et `dl_*` (BL-6 option A)
    count(j.id) filter (where coalesce(j.status,'') not in ('delivered','cancelled','returned_stocked','returned_not_stocked','new','follow_up_1','follow_up_2','follow_up_3','follow_up_4','follow_up_5','no_answer','wrong_number','voicemail','confirmation_rejected','confirmed','picked_up','sent'))::int,
    coalesce(sum(coalesce(j.rev,0)) filter (where j.status = 'delivered'), 0),
    coalesce(sum(coalesce(j.total_selling_price,0)) filter (where j.status = 'delivered' and j.n_lines is null), 0),
    coalesce(sum(coalesce(j.discount_amount,0)) filter (where j.status = 'delivered'), 0),
    coalesce(sum(coalesce(j.delivery_charge_to_customer,0)) filter (where j.status = 'delivered'), 0),
    coalesce(sum(j.purchase) filter (where j.status = 'delivered'), 0),
    coalesce(sum(coalesce(j.delivery_fee,0)) filter (where j.status = 'delivered'), 0),
    coalesce(sum(coalesce(j.confirmation_cost_allocated,0)) filter (where j.status = 'delivered'), 0),
    (select tracked from ads),
    coalesce(sum(coalesce(j.ads_cost_allocated,0)) filter (where j.status = 'delivered'), 0),
    case when (select n_rows from ads) > 0 then 0
         else coalesce(sum(coalesce(j.ads_cost_allocated,0)) filter (where j.status = 'delivered'), 0) end,
    (select n_rows from ads),
    count(j.id) filter (where j.n_lines is null)::int,
    count(j.id) filter (where j.status = 'delivered' and j.n_lines is null)::int,
    -- C3 : réconciliation corrigée (sous-total puis total reconstitué)
    count(j.id) filter (where j.status = 'delivered' and (
         abs(coalesce(j.rev,0) - coalesce(j.subtotal_amount,0)) > 0.01
      or abs(coalesce(j.total_selling_price,0) - greatest(0,
           coalesce(j.subtotal_amount,0) - coalesce(j.discount_amount,0)
           + coalesce(j.delivery_charge_to_customer,0)
           + coalesce(j.rounding_adjustment,0))) > 0.01
    ))::int,
    count(j.id) filter (where j.status = 'delivered' and coalesce(j.rev,0) > 0 and coalesce(j.purchase,0) = 0)::int,
    count(j.id) filter (where j.n_lines is null
      or (j.status = 'delivered' and (
           abs(coalesce(j.rev,0) - coalesce(j.subtotal_amount,0)) > 0.01
        or abs(coalesce(j.total_selling_price,0) - greatest(0,
             coalesce(j.subtotal_amount,0) - coalesce(j.discount_amount,0)
             + coalesce(j.delivery_charge_to_customer,0)
             + coalesce(j.rounding_adjustment,0))) > 0.01
      ))
      or (j.status = 'delivered' and coalesce(j.rev,0) > 0 and coalesce(j.purchase,0) = 0))::int,
    p_last_seq, clock_timestamp(), 2
  from joined j;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'KPI_AGGREGATE_ORDER_NO_ROW'; end if;
end;
$function$;

revoke all on function public.dashboard_kpi_aggregate_order(uuid, date, integer, timestamptz, timestamptz, text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.dashboard_kpi_aggregate_order(uuid, date, integer, timestamptz, timestamptz, text, text, bigint)
  to service_role;

