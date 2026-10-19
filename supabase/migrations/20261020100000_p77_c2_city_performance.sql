-- P7.7 / C2-A : CA par ville fondé sur les lignes des commandes livrées.
--
-- Corrections par rapport à la version précédente :
--   1. bornes demi-ouvertes [p_start_date, p_end_date) ;
--   2. appartenance active exigée (status = 'active') ;
--   3. CA = revenus des lignes des commandes livrées (et non total_selling_price
--      de toutes les commandes), afin que la somme des villes égale le CA des cartes.
--
-- Les dénominateurs (commandes, confirmées, livrées, retours, annulées) gardent
-- leur définition existante : ce lot ne modifie pas les taux affichés.
-- Aucune donnée n'est réécrite ; seule la fonction de lecture est remplacée.

create or replace function public.rpc_dashboard_city_performance(
  p_store_ids uuid[],
  p_start_date timestamptz default null,
  p_end_date timestamptz default null
)
returns table (
  city text,
  total_orders bigint,
  confirmed_orders bigint,
  delivered_orders bigint,
  returned_orders bigint,
  cancelled_orders bigint,
  total_revenue numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  with scoped as (
    select o.id, o.city, o.status
      from public.orders o
     where o.store_id = any (p_store_ids)
       and exists (
         select 1
           from public.store_members sm
          where sm.store_id = o.store_id
            and sm.user_id = auth.uid()
            and sm.status = 'active'
       )
       and (p_start_date is null or o.order_date >= p_start_date)
       and (p_end_date is null or o.order_date < p_end_date)
  ),
  -- Agrégation par commande avant jointure : évite de multiplier les compteurs.
  line_totals as (
    select i.order_id,
           sum(coalesce(i.quantity, 0) * coalesce(i.unit_selling_price, 0)) as revenue
      from public.order_items i
      join scoped s on s.id = i.order_id
     group by i.order_id
  )
  select s.city,
         count(*)::bigint,
         count(*) filter (where s.status in ('confirmed', 'picked_up', 'sent', 'delivered'))::bigint,
         count(*) filter (where s.status = 'delivered')::bigint,
         count(*) filter (where s.status in ('returned_not_stocked', 'returned_stocked'))::bigint,
         count(*) filter (where s.status = 'cancelled')::bigint,
         coalesce(sum(coalesce(lt.revenue, 0)) filter (where s.status = 'delivered'), 0)::numeric
    from scoped s
    left join line_totals lt on lt.order_id = s.id
   group by s.city
   order by count(*) desc;
$function$;

revoke all on function public.rpc_dashboard_city_performance(uuid[], timestamptz, timestamptz)
  from public, anon;
grant execute on function public.rpc_dashboard_city_performance(uuid[], timestamptz, timestamptz)
  to authenticated, service_role;
