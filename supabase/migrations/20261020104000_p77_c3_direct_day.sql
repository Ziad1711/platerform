-- P7.7 / C3-A (4/4) : réconciliation corrigée — oracle direct du jour.
--
-- `dashboard_kpi_direct_day` sert d'oracle indépendant (shadow, lecteur en repli).
-- Il doit appliquer exactement les mêmes règles de qualité que les agrégats,
-- sinon la comparaison signalerait une divergence qui n'existe pas.
-- Signature et colonnes de retour inchangées.

create or replace function public.dashboard_kpi_direct_day(
  p_store_id uuid,
  p_date date,
  p_tz text
)
returns table (
  orders_count integer, delivered_count integer, cancelled_count integer, returned_count integer,
  refused_count integer, pending_count integer, unclassified_count integer,
  revenue_items_gross numeric, revenue_estimated numeric, discount_amount numeric,
  delivery_charge_customer numeric, purchase_cost numeric, delivery_fee_cost numeric,
  confirmation_cost numeric, ads_tracked numeric, ads_allocated_raw numeric,
  ads_fallback_effective numeric, ads_daily_rows integer, orders_without_lines integer,
  delivered_without_lines integer, line_vs_total_mismatch integer,
  zero_purchase_with_revenue integer, data_issues_count integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  with bounds as (
    select (p_date::timestamp at time zone p_tz) as b_start,
           ((p_date + 1)::timestamp at time zone p_tz) as b_end
  ), scoped as (
    select o.id, o.status, o.delivery_fee, o.confirmation_cost_allocated,
           o.ads_cost_allocated, o.buy_price, o.buy_price_source,
           o.discount_amount, o.delivery_charge_to_customer, o.total_selling_price,
           o.subtotal_amount, o.rounding_adjustment
      from public.orders o, bounds b
     where o.store_id = p_store_id
       and o.order_date >= b.b_start and o.order_date < b.b_end
  ), items as (
    select oi.order_id,
           sum(coalesce(oi.quantity,0) * coalesce(oi.unit_selling_price,0)) as rev,
           sum(coalesce(oi.quantity,0) * coalesce(oi.unit_purchase_cost_snapshot,0)) as pc,
           count(*) as n_lines
      from public.order_items oi join scoped s on s.id = oi.order_id
     group by oi.order_id
  ), joined as (
    select s.*, i.rev, i.pc, i.n_lines,
           public.order_purchase_cost(s.buy_price_source, s.buy_price,
                                      coalesce(i.pc, s.buy_price, 0)) as purchase
      from scoped s left join items i on i.order_id = s.id
  ), ads as (
    select coalesce(sum(coalesce(a.spend_converted, a.spend, 0)), 0) as tracked,
           count(*)::int as n_rows
      from public.ad_spend_daily a, bounds b
     where a.store_id = p_store_id
       and a.spend_date >= b.b_start and a.spend_date < b.b_end
  )
  select
    count(j.id)::int,
    count(j.id) filter (where j.status = 'delivered')::int,
    count(j.id) filter (where j.status = 'cancelled')::int,
    count(j.id) filter (where j.status in ('returned_stocked','returned_not_stocked'))::int,
    count(j.id) filter (where j.status = 'refused')::int,
    count(j.id) filter (where j.status in ('new','follow_up_1','follow_up_2','follow_up_3','follow_up_4','follow_up_5','no_answer','wrong_number','voicemail','confirmation_rejected'))::int,
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
    -- C3 : réconciliation corrigée
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
      or (j.status = 'delivered' and coalesce(j.rev,0) > 0 and coalesce(j.purchase,0) = 0))::int
  from joined j;
$function$;

revoke all on function public.dashboard_kpi_direct_day(uuid, date, text)
  from public, anon, authenticated;
grant execute on function public.dashboard_kpi_direct_day(uuid, date, text)
  to service_role;
