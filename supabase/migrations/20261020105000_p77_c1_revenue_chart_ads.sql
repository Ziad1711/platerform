-- P7.7 / C1-A : graphique CA/profit/publicité aligné sur le contrat des cartes.
--
-- Ancien comportement :
--   * série `ads`  = publicité allouée à TOUTES les commandes ;
--   * profit       = commandes livrées moins la publicité allouée aux seules livrées.
--   Le graphique ne satisfaisait donc pas profit = CA - achats - livraison - confirmation - ads,
--   et pouvait différer des cartes.
--
-- Nouveau comportement, identique au contrat des cartes legacy :
--   * publicité de période suivie > 0  -> publicité suivie, répartie par jour ;
--   * sinon                            -> publicité allouée à toutes les commandes, par jour ;
--   * profit du jour = CA - achats - livraison - confirmation - publicité retenue ;
--   * les jours sans commande mais avec publicité restent présents dans les séries.
--
-- Aucune allocation stockée n'est modifiée ; aucune donnée n'est écrite.
-- Seule l'implémentation interne (boutique unique) est remplacée.

create or replace function public._rbl4_impl_dashboard_revenue_chart(
  p_store_id uuid,
  p_start_date timestamptz default null,
  p_end_date timestamptz default null,
  p_granularity text default 'day',
  p_conversion_start timestamptz default null,
  p_conversion_end timestamptz default null
)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  with gran as (
    select case when p_granularity in ('day', 'week', 'month') then p_granularity else 'day' end as g
  ), scoped_orders as (
    select o.*
    from public.orders o
    where (p_store_id is null or o.store_id = p_store_id)
      and exists (
        select 1
        from public.store_members sm
        where sm.store_id = o.store_id
          and sm.user_id = auth.uid()
          and sm.status = 'active'
      )
      and (p_start_date is null or o.order_date >= p_start_date)
      and (p_end_date is null or o.order_date < p_end_date)
  ), order_item_totals as (
    select
      oi.order_id,
      sum(coalesce(oi.quantity, 0) * coalesce(oi.unit_selling_price, 0))::numeric as item_revenue,
      sum(coalesce(oi.quantity, 0) * coalesce(oi.unit_purchase_cost_snapshot, 0))::numeric as item_purchase_cost
    from public.order_items oi
    join scoped_orders so on so.id = oi.order_id
    group by oi.order_id
  ), ads_scope as (
    select a.spend_date,
           coalesce(a.spend_converted, a.spend, 0)::numeric as spend
    from public.ad_spend_daily a
    where (p_store_id is null or a.store_id = p_store_id)
      and (p_start_date is null or a.spend_date >= p_start_date)
      and (p_end_date is null or a.spend_date < p_end_date)
  ), period as (
    select coalesce(sum(spend), 0)::numeric as tracked_total
    from ads_scope
  ), span as (
    select coalesce(p_start_date,
                    (select min(o.order_date) from scoped_orders o),
                    (select min(a.spend_date) from ads_scope a)) as s,
           coalesce(p_end_date,
                    (select max(o.order_date) + interval '1 day' from scoped_orders o),
                    (select max(a.spend_date) + interval '1 day' from ads_scope a)) as e
  ), buckets as (
    select generate_series(
             date_trunc((select g from gran), (select s from span)),
             (select e from span) - interval '1 second',
             case (select g from gran)
               when 'month' then interval '1 month'
               when 'week'  then interval '1 week'
               else interval '1 day'
             end
           ) as bucket_start
  ), orders_bucket as (
    select
      date_trunc((select g from gran), so.order_date) as bucket_start,
      coalesce(sum(coalesce(oit.item_revenue, 0)) filter (where so.status = 'delivered'), 0)::numeric as revenue,
      coalesce(sum(public.order_purchase_cost(so.buy_price_source, so.buy_price, coalesce(oit.item_purchase_cost, so.buy_price, 0)))
               filter (where so.status = 'delivered'), 0)::numeric as purchase,
      coalesce(sum(coalesce(so.delivery_fee, 0)) filter (where so.status = 'delivered'), 0)::numeric as delivery,
      coalesce(sum(coalesce(so.confirmation_cost_allocated, 0)) filter (where so.status = 'delivered'), 0)::numeric as confirmation,
      coalesce(sum(coalesce(so.ads_cost_allocated, 0)), 0)::numeric as ads_allocated
    from scoped_orders so
    left join order_item_totals oit on oit.order_id = so.id
    group by 1
  ), ads_bucket as (
    select date_trunc((select g from gran), a.spend_date) as bucket_start,
           coalesce(sum(a.spend), 0)::numeric as tracked
    from ads_scope a
    group by 1
  ), merged as (
    select
      b.bucket_start,
      coalesce(ob.revenue, 0)::numeric as revenue,
      coalesce(ob.purchase, 0)::numeric as purchase,
      coalesce(ob.delivery, 0)::numeric as delivery,
      coalesce(ob.confirmation, 0)::numeric as confirmation,
      case when (select tracked_total from period) > 0
           then coalesce(ab.tracked, 0)::numeric
           else coalesce(ob.ads_allocated, 0)::numeric
      end as ads
    from buckets b
    left join orders_bucket ob on ob.bucket_start = b.bucket_start
    left join ads_bucket ab on ab.bucket_start = b.bucket_start
  ), final as (
    select bucket_start, revenue, purchase, delivery, confirmation, ads,
           (revenue - purchase - delivery - confirmation - ads)::numeric as profit
    from merged
  ), visible as (
    -- Les jours vides restent hors graphique ; un jour avec publicité seule est conservé.
    select * from final
    where ads <> 0 or revenue <> 0 or purchase <> 0 or delivery <> 0 or confirmation <> 0
  ), conv_orders as (
    select o.*
    from public.orders o
    where (p_store_id is null or o.store_id = p_store_id)
      and exists (
        select 1
        from public.store_members sm
        where sm.store_id = o.store_id
          and sm.user_id = auth.uid()
          and sm.status = 'active'
      )
      and (coalesce(p_conversion_start, p_start_date) is null or o.order_date >= coalesce(p_conversion_start, p_start_date))
      and (coalesce(p_conversion_end, p_end_date) is null or o.order_date < coalesce(p_conversion_end, p_end_date))
  ), conversion as (
    select
      count(*)::bigint as total_orders,
      count(*) filter (where status in ('confirmed', 'picked_up', 'sent', 'delivered', 'returned_not_stocked', 'returned_stocked'))::bigint as confirmed_orders,
      count(*) filter (where status = 'cancelled')::bigint as cancelled_orders,
      count(*) filter (where status in ('new', 'follow_up_1', 'follow_up_2', 'follow_up_3', 'follow_up_4', 'follow_up_5', 'no_answer', 'wrong_number', 'voicemail', 'confirmation_rejected'))::bigint as pending_orders,
      count(*) filter (where status in ('sent', 'delivered', 'returned_not_stocked', 'returned_stocked'))::bigint as sent_orders,
      count(*) filter (where status = 'delivered')::bigint as delivered_orders,
      count(*) filter (where status in ('returned_not_stocked', 'returned_stocked'))::bigint as returned_orders
    from conv_orders
  )
  select jsonb_build_object(
    'points', coalesce((
      select jsonb_agg(jsonb_build_object('date', bucket_start::date::text, 'revenue', revenue, 'profit', profit, 'ads', ads, 'purchase', purchase, 'delivery', delivery) order by bucket_start)
      from visible
    ), '[]'::jsonb),
    'totalRevenue', coalesce((select sum(revenue) from visible), 0),
    'totalProfit', coalesce((select sum(profit) from visible), 0),
    'totalAds', coalesce((select sum(ads) from visible), 0),
    'totalPurchase', coalesce((select sum(purchase) from visible), 0),
    'conversion', (select to_jsonb(conversion) from conversion)
  );
$function$;

-- Fonction interne : accès serveur uniquement (le wrapper public applique R-BL4).
revoke all on function public._rbl4_impl_dashboard_revenue_chart(uuid, timestamptz, timestamptz, text, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public._rbl4_impl_dashboard_revenue_chart(uuid, timestamptz, timestamptz, text, timestamptz, timestamptz)
  to service_role;

