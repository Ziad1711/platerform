-- Dashboard KPI V5 — coût de livraison journalier et définition commune de la
-- confirmation.
--
-- 1. `rpc_dashboard_kpi_reader_v2` : même contrat que le lecteur existant, avec
--    `delivery_fee_cost` ajouté aux points journaliers. La valeur provient de
--    l'axe `order` uniquement (jamais de l'axe `delivery`) : aucun double
--    comptage. Le champ est omis pour un accès `commercial`, et une journée dont
--    le coût n'est pas calculable reste sans champ (jamais un faux zéro).
--    Le lecteur d'origine n'est pas modifié : il reste la source des totaux,
--    de la couverture et des permissions, et l'appelant l'invoque tel quel.
-- 2. `order_counts_as_confirmed` : définition métier unique. Une commande garde
--    son caractère confirmé en avançant dans la logistique (ramassage,
--    expédition, livraison, refus, retour) ; une annulation métier la retire du
--    numérateur ; les statuts de préconfirmation ne comptent jamais.
-- 3. `rpc_dashboard_confirmation_counters` : compteurs du tunnel sur la période
--    exacte demandée, rattachés à `orders.order_date`.
-- 4. Ville et agent appliquent la même définition à `confirmed_orders`.
--
-- Aucune donnée, formule financière, commission, agrégat ni statut n'est
-- modifié ; aucune reconstruction historique n'est lancée.

-- ============================================================
-- 1. Lecteur V5 : coût de livraison par point journalier
-- ============================================================
create or replace function public.rpc_dashboard_kpi_reader_v2(
  p_store_ids uuid[],
  p_from date,
  p_to date,
  p_include_direct boolean default true
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_base jsonb;
  v_stores jsonb;
begin
  -- Contrat existant inchangé : permissions, couverture, totaux et points.
  v_base := public.rpc_dashboard_kpi_reader(p_store_ids, p_from, p_to, p_include_direct);

  select coalesce(jsonb_agg(enriched.store order by enriched.ord), '[]'::jsonb)
    into v_stores
    from (
      select st.ord,
             case
               when st.store->>'access' <> 'full' then st.store
               else jsonb_set(
                 st.store,
                 '{points}',
                 coalesce((
                   select jsonb_agg(
                            case
                              when d.cost is null then pt.value
                              else pt.value || jsonb_build_object('delivery_fee_cost', d.cost::text)
                            end
                            order by pt.ord
                          )
                     from jsonb_array_elements(st.store->'points')
                          with ordinality as pt(value, ord)
                     left join lateral (
                       select case pt.value->>'state'
                                when 'aggregate' then (
                                  select m.delivery_fee_cost
                                    from public.dashboard_daily_metrics m
                                   where m.store_id = (st.store->>'store_id')::uuid
                                     and m.business_date = (pt.value->>'date')::date
                                     and m.axis = 'order'
                                     and m.definition_version = (st.store->>'definition_version')::int
                                     and m.tz_used = st.store->>'tz'
                                     and m.currency_code is not distinct from (st.store->>'currency')
                                )
                                when 'direct' then (
                                  select dd.delivery_fee_cost
                                    from public.dashboard_kpi_direct_day(
                                           (st.store->>'store_id')::uuid,
                                           (pt.value->>'date')::date,
                                           st.store->>'tz'
                                         ) dd
                                )
                              end as cost
                     ) d on true
                 ), '[]'::jsonb),
                 true
               )
             end as store
        from jsonb_array_elements(v_base->'stores') with ordinality as st(store, ord)
    ) enriched;

  return jsonb_set(v_base, '{stores}', v_stores, true);
end;
$function$;

comment on function public.rpc_dashboard_kpi_reader_v2(uuid[], date, date, boolean) is
  'Lecteur KPI V5 du graphique : contrat identique au lecteur principal, plus delivery_fee_cost par point (axe order, accès full uniquement).';

revoke all on function public.rpc_dashboard_kpi_reader_v2(uuid[], date, date, boolean)
  from public, anon;
grant execute on function public.rpc_dashboard_kpi_reader_v2(uuid[], date, date, boolean)
  to authenticated, service_role;

-- ============================================================
-- 2. Définition métier unique de la confirmation
-- ============================================================
-- Progression logistique conservée, annulation exclue, préconfirmation exclue.
-- `refused` n'est retenu que si la confirmation est prouvée (`confirmed_at`) :
-- un refus ne prouve pas, à lui seul, qu'un appel de confirmation a eu lieu.
create or replace function public.order_counts_as_confirmed(
  p_status text,
  p_confirmed_at timestamptz
)
returns boolean
language sql
immutable
as $function$
  select case
    when p_status is null then false
    when p_status = 'cancelled' then false
    when p_status = 'confirmed' then true
    when p_status in (
      'picked_up', 'sent', 'delivered',
      'returned_stocked', 'returned_not_stocked',
      'dl_pickup_pending', 'dl_no_answer', 'dl_unreachable', 'dl_out_of_zone',
      'dl_client_interested', 'dl_postponed', 'dl_address_change', 'dl_refund',
      'dl_follow_up_request', 'dl_billing_error', 'dl_out_for_delivery'
    ) then true
    when p_status = 'refused' then p_confirmed_at is not null
    else false
  end
$function$;

comment on function public.order_counts_as_confirmed(text, timestamptz) is
  'Définition métier du taux de confirmation : progression logistique conservée, annulation exclue, préconfirmation exclue.';

-- Compteurs du tunnel sur les commandes créées dans [p_start_date, p_end_date).
-- Visibilité identique à la politique RLS de `orders` (tout le store ou
-- commande assignée à l'acteur) : aucun élargissement d'accès.
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
    select o.id, o.status, o.confirmed_at
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
      where s.status in ('sent', 'delivered', 'returned_stocked', 'returned_not_stocked')
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

revoke all on function public.order_counts_as_confirmed(text, timestamptz)
  from public, anon;
grant execute on function public.order_counts_as_confirmed(text, timestamptz)
  to authenticated, service_role;

revoke all on function public.rpc_dashboard_confirmation_counters(uuid[], timestamptz, timestamptz)
  from public, anon;
grant execute on function public.rpc_dashboard_confirmation_counters(uuid[], timestamptz, timestamptz)
  to authenticated, service_role;


-- ============================================================
-- 3. Ville : même définition de confirmation
-- ============================================================
-- Dénominateur, autres compteurs, CA et permissions inchangés.
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
    select o.id, o.city, o.status, o.confirmed_at
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
         count(*) filter (
           where public.order_counts_as_confirmed(s.status, s.confirmed_at)
         )::bigint,
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

-- ============================================================
-- 4. Agent : même définition de confirmation
-- ============================================================
-- Commissions, rejets et filtre de période restent identiques.
create or replace function public.rpc_dashboard_confirmation_performance(
  p_store_ids uuid[],
  p_start_date timestamptz default null,
  p_end_date timestamptz default null
)
returns table (
  agent_id uuid,
  agent_name text,
  total_orders bigint,
  confirmed_orders bigint,
  delivered_orders bigint,
  rejected_orders bigint,
  potential_commission numeric,
  earned_commission numeric,
  paid_commission numeric,
  confirmation_rate numeric
)
language sql
stable
as $function$
  select
    ca.id as agent_id,
    ca.name as agent_name,
    count(*)::bigint as total_orders,
    count(*) filter (
      where public.order_counts_as_confirmed(o.status, o.confirmed_at)
    )::bigint as confirmed_orders,
    count(*) filter (where o.status = 'delivered')::bigint as delivered_orders,
    count(*) filter (where o.status in ('confirmation_rejected','wrong_number','no_answer','voicemail','cancelled','refused'))::bigint as rejected_orders,
    coalesce(sum(coalesce(o.confirmation_commission_amount, 0)) filter (where o.confirmation_commission_status = 'pending'), 0)::numeric as potential_commission,
    coalesce(sum(coalesce(o.confirmation_commission_amount, 0)) filter (where o.confirmation_commission_status in ('earned','paid')), 0)::numeric as earned_commission,
    coalesce(sum(coalesce(o.confirmation_commission_amount, 0)) filter (where o.confirmation_commission_status = 'paid'), 0)::numeric as paid_commission,
    case
      when count(*) > 0
      then (count(*) filter (
              where public.order_counts_as_confirmed(o.status, o.confirmed_at)
            )::numeric / count(*)::numeric) * 100
      else 0
    end as confirmation_rate
  from public.confirmation_agents ca
  inner join public.orders o on o.confirmation_agent_id = ca.id
  where ca.store_id = any(p_store_ids)
    and exists (
      select 1
      from public.store_members sm
      where sm.store_id = ca.store_id
        and sm.user_id = auth.uid()
    )
    and (p_start_date is null or o.order_date >= p_start_date)
    and (p_end_date is null or o.order_date <= p_end_date)
  group by ca.id, ca.name
  order by count(*) desc
$function$;

revoke all on function public.rpc_dashboard_confirmation_performance(uuid[], timestamptz, timestamptz)
  from public, anon;
grant execute on function public.rpc_dashboard_confirmation_performance(uuid[], timestamptz, timestamptz)
  to authenticated, service_role;

