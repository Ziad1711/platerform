-- Dashboard KPI V5 — KPI « Expédiées » du tunnel de conversion.
--
-- Une commande est expédiée dès qu'elle a réellement été prise en charge par
-- le transporteur ; elle le reste lors des étapes ultérieures (sortie pour
-- livraison, livraison, refus, retour) et lorsqu'une annulation intervient
-- après la remise.
--
-- Seule l'expression de `sent_orders` change. Les autres compteurs, les
-- bornes `[p_start_date, p_end_date)`, le rattachement `orders.order_date`,
-- le filtre par boutique et les permissions restent identiques.
--
-- Preuves admises :
--  - statut courant explicite : picked_up, sent, dl_out_for_delivery,
--    delivered, returned_stocked, returned_not_stocked ;
--  - refused : issue transporteur établie (delivery_status d'issue avec
--    source `delivery_company`) ou horodatage de progression ;
--  - cancelled : remise prouvée avant l'annulation ;
--  - autre statut `dl_*` : progression transporteur prouvée ;
--  - statut antérieur (confirmed, new, relances) : preuve historique fiable
--    (cycle transporteur avec source, sortie pour livraison, ou ramassage ET
--    expédition) — un horodatage isolé ne suffit pas.
--  - une confirmation, un bon de ramassage ou un simple `pending` ne suffisent
--    jamais.

create or replace function public.rpc_dashboard_confirmation_counters(
  p_store_ids uuid[],
  p_start_date timestamptz default null,
  p_end_date timestamptz default null
)
returns table (
  total_orders bigint,
  confirmed_orders bigint,
  sent_orders bigint,
  waiting_pickup_orders bigint,
  delivered_orders bigint,
  returned_orders bigint,
  cancelled_orders bigint,
  pending_orders bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  with scoped as (
    select o.id, o.status, o.confirmed_at,
           o.delivery_status, o.delivery_status_source,
           o.picked_up_at, o.sent_at, o.dl_out_for_delivery_at
      from public.orders o
     where o.store_id = any (p_store_ids)
       and (public.can_view_all_store_orders(o.store_id)
            or public.is_order_assigned_to_actor(o.id))
       and (p_start_date is null or o.order_date >= p_start_date)
       and (p_end_date is null or o.order_date < p_end_date)
  )
  select
    count(*)::bigint,
    count(*) filter (
      where public.order_counts_as_confirmed(s.status, s.confirmed_at)
    )::bigint,
    count(*) filter (
      where case
        when s.status in (
          'picked_up', 'sent', 'dl_out_for_delivery', 'delivered',
          'returned_stocked', 'returned_not_stocked'
        ) then true
        when s.status = 'refused' then (
          (s.delivery_status in ('refused', 'returned', 'delivered')
            and s.delivery_status_source = 'delivery_company')
          or s.picked_up_at is not null
          or s.sent_at is not null
          or s.dl_out_for_delivery_at is not null
        )
        when s.status = 'cancelled' then (
          s.picked_up_at is not null
          or s.sent_at is not null
          or s.dl_out_for_delivery_at is not null
          or s.delivery_status in (
            'picked_up', 'deposited', 'in_transit', 'delivered', 'refused', 'returned'
          )
        )
        when left(s.status, 3) = 'dl_' then (
          s.picked_up_at is not null
          or s.sent_at is not null
          or s.dl_out_for_delivery_at is not null
          or s.delivery_status in (
            'picked_up', 'deposited', 'in_transit', 'delivered', 'refused', 'returned'
          )
        )
        else coalesce((
          (s.delivery_status in (
             'picked_up', 'deposited', 'in_transit', 'delivered', 'refused', 'returned'
           ) and s.delivery_status_source = 'delivery_company')
          or s.dl_out_for_delivery_at is not null
          or (s.picked_up_at is not null and s.sent_at is not null)
        ), false)
      end
    )::bigint,
    count(*) filter (where s.status = 'dl_pickup_pending')::bigint,
    count(*) filter (where s.status = 'delivered')::bigint,
    count(*) filter (where s.status in ('returned_stocked', 'returned_not_stocked'))::bigint,
    count(*) filter (where s.status = 'cancelled')::bigint,
    count(*) filter (
      where s.status in (
        'new', 'follow_up_1', 'follow_up_2', 'follow_up_3', 'follow_up_4', 'follow_up_5',
        'no_answer', 'wrong_number', 'voicemail', 'confirmation_rejected'
      )
    )::bigint
  from scoped s;
$function$;

comment on function public.rpc_dashboard_confirmation_counters(uuid[], timestamptz, timestamptz) is
  'Compteurs du tunnel par période exacte : « Expédiées » = prise en charge transporteur établie (conservée après sortie, livraison, refus, retour ou annulation postérieure).';

revoke all on function public.rpc_dashboard_confirmation_counters(uuid[], timestamptz, timestamptz)
  from public, anon;
grant execute on function public.rpc_dashboard_confirmation_counters(uuid[], timestamptz, timestamptz)
  to authenticated, service_role;
