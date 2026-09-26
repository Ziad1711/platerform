-- ============================================================
-- Finance — Lot B (suite) : fuseau d'affaires explicite + journées coupées
-- ------------------------------------------------------------
-- Constat (26/09/2026, audit en lecture seule) : l'arbitrage publicitaire
-- quotidien comparait des clés de journée calculées en UTC
-- (`date_trunc('day', ...)`) alors que l'interface envoie des bornes de
-- période calculées dans le fuseau du navigateur. Une commande passée entre
-- 00:00 et 01:00 heure marocaine (UTC+1) était donc rangée dans la journée
-- UTC précédente ; quand cette journée UTC n'était pas suivie par
-- `ad_spend_daily`, le coût publicitaire de la commande était recompté en
-- repli **en plus** de la journée réellement suivie.
-- Mesure en base (store principal, 26/09/2026) : 7 commandes / 564,78 MAD
-- recomptés à tort.
--
-- 1. Fuseau d'affaires explicite et unique :
--    `public.finance_business_timezone()` = 'Africa/Casablanca'. Les clés de
--    journée de la publicité suivie ET des commandes passent par ce fuseau.
--    Aucune donnée existante ne change de journée : les lignes
--    `ad_spend_daily` sont écrites à 00:00 UTC, soit la même date locale.
-- 2. Règle des journées coupées : `ad_spend_daily` est une donnée de journée
--    entière. La fenêtre publicitaire (suivi **et** repli) est donc élargie
--    aux journées locales complètes touchées par la période : plus d'asymétrie
--    en bord de période. `ads_partial_days` compte les journées suivies
--    seulement partiellement couvertes par la période — l'interface le
--    signale, aucun montant n'est proratisé ni ajusté en silence.
-- 3. Le reste du contrat (migration 20260926200000) est inchangé.
-- ============================================================

-- Fuseau d'affaires unique du module Finances (clés de journée, fenêtres).
create or replace function public.finance_business_timezone()
returns text
language sql
immutable
as $fn$
  select 'Africa/Casablanca'::text;
$fn$;

comment on function public.finance_business_timezone() is
  'Fuseau d''affaires unique du module Finances (clés de journée et fenêtres de période). Toute clé de journée du module doit passer par ici.';

-- Fonction interne : aucun rôle applicatif n'a besoin de l'appeler directement.
revoke all on function public.finance_business_timezone() from public;
revoke all on function public.finance_business_timezone() from anon, authenticated;

drop function if exists public.rpc_finance_overview(uuid, timestamptz, timestamptz);

create or replace function public.rpc_finance_overview(
  p_store_id uuid,
  p_start_date timestamptz default null,
  p_end_date timestamptz default null
)
returns table (
  store_id uuid,
  currency text,
  revenue numeric,
  revenue_reliable numeric,
  revenue_estimated numeric,
  cost_of_goods numeric,
  delivery_cost numeric,
  ad_spend numeric,
  ad_spend_daily numeric,
  ads_from_orders numeric,
  ads_daily_days bigint,
  ads_fallback_days bigint,
  ads_fallback_orders bigint,
  ads_partial_days bigint,
  commission numeric,
  other_expenses numeric,
  ads_expense_overlap numeric,
  ads_expense_overlap_count bigint,
  operating_result numeric,
  delivered_orders bigint,
  estimated_orders bigint,
  data_issues bigint,
  result_is_reliable boolean
)
language sql
stable
security definer
set search_path = public
as $fn$
  with ads_window as (
    -- Bornes de la fenêtre publicitaire : journées locales complètes touchées
    -- par la période demandée (borne de fin exclue, journées entières).
    select
      case
        when p_start_date is null then null::timestamptz
        else (date_trunc('day', p_start_date at time zone public.finance_business_timezone())
              at time zone public.finance_business_timezone())
      end as first_day_start,
      case
        when p_end_date is null then null::timestamptz
        else ((date_trunc('day', (p_end_date - interval '1 microsecond') at time zone public.finance_business_timezone())
               at time zone public.finance_business_timezone()) + interval '1 day')
      end as last_day_end
  ),
  delivered_orders as (
    select o.*
    from public.orders o
    where o.store_id = p_store_id
      and o.status = 'delivered'
      and (p_start_date is null or coalesce(o.delivered_at, o.order_date) >= p_start_date)
      and (p_end_date is null or coalesce(o.delivered_at, o.order_date) < p_end_date)
  ),
  order_item_totals as (
    select
      oi.order_id,
      sum(coalesce(oi.quantity, 0) * coalesce(oi.unit_selling_price, 0))::numeric as item_revenue,
      sum(coalesce(oi.quantity, 0) * coalesce(oi.unit_purchase_cost_snapshot, 0))::numeric as item_purchase_cost
    from public.order_items oi
    join delivered_orders d on d.id = oi.order_id
    group by oi.order_id
  ),
  revenue_base as (
    select
      -- CA fiable : somme des lignes produits.
      coalesce(sum(case when oit.order_id is not null then coalesce(oit.item_revenue, 0) else 0 end), 0)::numeric as revenue_reliable,
      -- CA estimé : total de la commande quand les lignes manquent (jamais perdu, jamais présenté comme fiable).
      coalesce(sum(case when oit.order_id is null then coalesce(d.total_selling_price, 0) else 0 end), 0)::numeric as revenue_estimated,
      -- Coût produit : lignes si présentes, sinon `buy_price` (valeur à vérifier).
      coalesce(sum(coalesce(oit.item_purchase_cost, d.buy_price, 0)), 0)::numeric as cogs,
      coalesce(sum(coalesce(d.delivery_fee, 0)), 0)::numeric as delivery,
      coalesce(sum(coalesce(d.confirmation_cost_allocated, 0)), 0)::numeric as commission,
      count(d.id)::bigint as delivered,
      count(d.id) filter (where oit.order_id is null)::bigint as estimated_orders,
      count(d.id) filter (
        where oit.order_id is null
           or abs(coalesce(oit.item_revenue, 0) - coalesce(d.total_selling_price, 0)) > 0.01
           or (coalesce(oit.item_purchase_cost, d.buy_price, 0) = 0 and coalesce(oit.item_revenue, 0) > 0)
      )::bigint as data_issues
    from delivered_orders d
    left join order_item_totals oit on oit.order_id = d.id
  ),
  -- Journées suivies par le suivi publicitaire quotidien. La clé de journée est
  -- désormais calculée dans le fuseau d'affaires (et non en UTC) : c'est la
  -- journée que l'utilisateur voit, donc celle qui arbitre suivi vs repli.
  ads_days_tracked as (
    select
      (a.spend_date at time zone public.finance_business_timezone())::date as day,
      sum(coalesce(a.spend_converted, a.spend, 0))::numeric as day_total
    from public.ad_spend_daily a
    cross join ads_window w
    where a.store_id = p_store_id
      and (w.first_day_start is null or a.spend_date >= w.first_day_start)
      and (w.last_day_end is null or a.spend_date < w.last_day_end)
    group by 1
  ),
  ads_daily_totals as (
    select
      coalesce(sum(day_total), 0)::numeric as total,
      count(*)::bigint as days
    from ads_days_tracked
  ),
  ads_orders as (
    select
      coalesce(o.ads_cost_allocated, 0)::numeric as ads_cost,
      (o.order_date at time zone public.finance_business_timezone())::date as day,
      exists (
        select 1 from ads_days_tracked ad
        where ad.day = (o.order_date at time zone public.finance_business_timezone())::date
      ) as day_tracked
    from public.orders o
    cross join ads_window w
    where o.store_id = p_store_id
      and (w.first_day_start is null or o.order_date >= w.first_day_start)
      and (w.last_day_end is null or o.order_date < w.last_day_end)
  ),
  ads_fallback_totals as (
    select
      coalesce(sum(case when not day_tracked then ads_cost else 0 end), 0)::numeric as total,
      count(*) filter (where not day_tracked and ads_cost <> 0)::bigint as orders,
      count(distinct day) filter (where not day_tracked)::bigint as days
    from ads_orders
  ),
  -- Journées suivies seulement partiellement couvertes par la période demandée :
  -- leur montant est compté en journée entière, l'interface le signale.
  ads_partial as (
    select count(*)::bigint as days
    from ads_days_tracked ad
    where (p_start_date is not null
             and p_start_date > ((ad.day::timestamp) at time zone public.finance_business_timezone()))
       or (p_end_date is not null
             and p_end_date < (((ad.day::timestamp) at time zone public.finance_business_timezone()) + interval '1 day'))
  ),
  other_exp as (
    select coalesce(sum(coalesce(e.amount, 0)), 0)::numeric as total
    from public.expenses e
    where e.store_id = p_store_id
      and e.status = 'active'
      and (p_start_date is null or e.expense_date >= p_start_date)
      and (p_end_date is null or e.expense_date < p_end_date)
  ),
  -- Charges déjà rangées en « Publicité » côté Dépenses : elles restent comptées
  -- dans « autres charges », mais sont signalées pour éviter un double comptage.
  ads_expense_overlap as (
    select
      coalesce(sum(coalesce(e.amount, 0)), 0)::numeric as total,
      count(*)::bigint as cnt
    from public.expenses e
    left join public.expense_categories c on c.id = e.category_id
    where e.store_id = p_store_id
      and e.status = 'active'
      and coalesce(c.type, '') = 'ads'
      and (p_start_date is null or e.expense_date >= p_start_date)
      and (p_end_date is null or e.expense_date < p_end_date)
  )
  select
    p_store_id,
    (select s.currency from public.stores s where s.id = p_store_id),
    (r.revenue_reliable + r.revenue_estimated)::numeric as revenue,
    r.revenue_reliable,
    r.revenue_estimated,
    r.cogs,
    r.delivery,
    (dt.total + fb.total)::numeric as ad_spend,
    dt.total as ad_spend_daily,
    fb.total as ads_from_orders,
    dt.days as ads_daily_days,
    fb.days as ads_fallback_days,
    fb.orders as ads_fallback_orders,
    ap.days as ads_partial_days,
    r.commission,
    oe.total as other_expenses,
    ao.total as ads_expense_overlap,
    ao.cnt as ads_expense_overlap_count,
    ((r.revenue_reliable + r.revenue_estimated) - r.cogs - r.delivery - (dt.total + fb.total) - r.commission - oe.total)::numeric as operating_result,
    r.delivered,
    r.estimated_orders,
    r.data_issues,
    (r.estimated_orders = 0 and r.data_issues = 0) as result_is_reliable
  from revenue_base r
  cross join ads_daily_totals dt
  cross join ads_fallback_totals fb
  cross join ads_partial ap
  cross join other_exp oe
  cross join ads_expense_overlap ao
  where public.can_view_store_finances(p_store_id);
$fn$;

-- `anon` n'a aucun usage de ces fonctions : le privilège est retiré nommément
-- (les privilèges par défaut du schéma `public` l'accordent à chaque création).
revoke all on function public.rpc_finance_overview(uuid, timestamptz, timestamptz) from public;
revoke all on function public.rpc_finance_overview(uuid, timestamptz, timestamptz) from anon;
grant execute on function public.rpc_finance_overview(uuid, timestamptz, timestamptz) to authenticated, service_role;

