-- JISRA KPI V5 - borne historique verifiee (PREPARATION, NON APPLIQUEE).
--
-- Probleme corrige : le lecteur comptait comme "manquantes" les journees
-- anterieures a l'existence de la boutique (197 jours pour woodea).
-- Aucune journee n'est inventee : ces journees sortent de la grille, elles ne
-- sont ni manquantes ni comptees dans les totaux.
--
-- Aucun calcul financier, aucune ACL, aucun producteur n'est modifie.
-- Aucune donnee metier n'est touchee.
--
-- Execution : psql -X -w -1 -v ON_ERROR_STOP=1
--              -c "set kpi.history_authorized='yes'" -f ce_fichier

\set ON_ERROR_STOP on

set local lock_timeout = '5s';

do $guard$
begin
  if current_setting('kpi.history_authorized', true) is distinct from 'yes' then
    raise exception 'HISTORY_WINDOW_NOT_AUTHORIZED';
  end if;
  if current_database() <> 'postgres' or current_user <> 'postgres' then
    raise exception 'HISTORY_WINDOW_IDENTITY';
  end if;
end
$guard$;

alter table public.dashboard_kpi_store_state
  add column if not exists history_from date;

comment on column public.dashboard_kpi_store_state.history_from is
  'Premiere journee metier ou la boutique peut produire des donnees KPI (creation ou premiere donnee). NULL = pas de borne : la grille couvre toute la periode demandee.';

-- Borne verifiee : minimum des sources reellement consommees par les agregats.
create or replace function public.dashboard_kpi_history_from(p_store_id uuid)
returns date
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
  with tz as (
    select coalesce(st.tz, 'Africa/Casablanca') as tz
      from (select 1) one
      left join public.dashboard_kpi_store_state st on st.store_id = p_store_id
  ),
  sources as (
    select s.created_at as ts from public.stores s where s.id = p_store_id
    union all
    select o.order_date from public.orders o where o.store_id = p_store_id
    union all
    select o.delivered_at from public.orders o
     where o.store_id = p_store_id and o.delivered_at is not null
    union all
    select a.spend_date from public.ad_spend_daily a where a.store_id = p_store_id
  )
  select min(public.dashboard_kpi_local_ts(ts, (select tz from tz))::date) from sources where ts is not null
$fn$;

revoke all on function public.dashboard_kpi_history_from(uuid) from public, anon, authenticated;
grant execute on function public.dashboard_kpi_history_from(uuid) to service_role;

-- Ecriture de la borne (idempotente). Ne cree aucune partition et ne lance aucun calcul.
create or replace function public.dashboard_kpi_set_history_from(p_store_id uuid, p_from date default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare v_from date; v_effective date;
begin
  if p_store_id is null then raise exception 'KPI_BAD_STORE'; end if;
  if not exists (select 1 from public.stores s where s.id = p_store_id) then
    raise exception 'KPI_UNKNOWN_STORE';
  end if;
  v_from := coalesce(p_from, public.dashboard_kpi_history_from(p_store_id));

  insert into public.dashboard_kpi_store_state as st (store_id, history_from)
  values (p_store_id, v_from)
  on conflict (store_id) do update
    set history_from = case
          -- Borne calculée : elle ne peut que reculer, jamais avancer, pour ne
          -- jamais retirer de la grille une journée réellement datée.
          when p_from is null then least(st.history_from, excluded.history_from)
          else excluded.history_from
        end,
        updated_at = clock_timestamp()
  returning st.history_from into v_effective;

  return jsonb_build_object('store_id', p_store_id, 'history_from', v_effective);
end
$fn$;

revoke all on function public.dashboard_kpi_set_history_from(uuid, date) from public, anon, authenticated;
grant execute on function public.dashboard_kpi_set_history_from(uuid, date) to service_role;

-- Lecteur : les journees anterieures a la borne sortent de la grille.

CREATE OR REPLACE FUNCTION public.rpc_dashboard_kpi_reader(p_store_ids uuid[] DEFAULT NULL::uuid[], p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_include_direct boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then raise exception 'KPI_UNAUTHENTICATED'; end if;
  if p_from is null or p_to is null then raise exception 'KPI_BAD_RANGE'; end if;
  if p_to <= p_from then raise exception 'KPI_BAD_RANGE'; end if;
  if (p_to - p_from) > 400 then raise exception 'KPI_RANGE_TOO_LARGE'; end if;

  with resolved as (
    select s.id, s.currency,
           coalesce(st.tz, 'Africa/Casablanca') as tz,
           coalesce(st.active_definition_version, 1) as ver,
           coalesce(st.publish_counter, 0) as rev,
           st.last_rebuild_at,
           st.history_from,
           public.dashboard_kpi_access_level(s.id) as lvl
      from public.stores s
      left join public.dashboard_kpi_store_state st on st.store_id = s.id
     where (p_store_ids is null or s.id = any(p_store_ids))
  ),
  authorized as (select * from resolved where lvl <> 'none'),
  days as (select d::date as bd from generate_series(p_from, p_to - 1, interval '1 day') d),
  grid as (
    select a.id, a.currency, a.tz, a.ver, a.rev, a.last_rebuild_at, a.lvl, d.bd
      from authorized a cross join days d
     where a.history_from is null or d.bd >= a.history_from
  ),
  flagged as (
    select g.*,
           (m.store_id is not null) as has_part,
           exists (select 1 from public.dashboard_kpi_invalidation i
                    where i.store_id = g.id and i.business_date = g.bd
                      and i.processed_at is null) as pending_note,
           exists (select 1 from public.dashboard_daily_metrics x
                    where x.store_id = g.id and x.business_date = g.bd and x.axis = 'order'
                      and (x.definition_version <> g.ver or x.tz_used <> g.tz)) as incompatible,
           m.orders_count as a_orders, m.delivered_count as a_dlv,
           m.cancelled_count as a_canc, m.returned_count as a_ret, m.refused_count as a_ref,
           m.pending_count as a_pend, m.unclassified_count as a_uncl,
           m.revenue_items_gross as a_rev, m.revenue_estimated as a_rev_est,
           m.discount_amount as a_disc, m.delivery_charge_customer as a_dcc,
           m.purchase_cost as a_pc, m.delivery_fee_cost as a_dfc, m.confirmation_cost as a_cc,
           m.ads_tracked as a_trk, m.ads_fallback_effective as a_fb, m.ads_daily_rows as a_adr,
           m.orders_without_lines as a_owl, m.delivered_without_lines as a_dwl,
           m.line_vs_total_mismatch as a_lvtm, m.zero_purchase_with_revenue as a_zpwr,
           m.data_issues_count as a_iss
      from grid g
      left join public.dashboard_daily_metrics m
        on m.store_id = g.id and m.business_date = g.bd and m.axis = 'order'
       and m.definition_version = g.ver and m.tz_used = g.tz
       and m.currency_code is not distinct from g.currency
  ),
  stated as (
    select f.*,
           case when f.has_part and f.pending_note then 'dirty'
                when f.has_part then 'aggregate'
                when f.incompatible then 'incompatible'
                else 'missing' end as state
      from flagged f
  ),
  candidates as (
    select id, bd, row_number() over (order by id, bd) as rn
      from stated where state in ('missing','dirty')
  ),
  decided as (
    select s.*,
           case when p_include_direct and c.rn is not null and c.rn <= 7 then 'direct' else s.state end as final_state,
           x.*
      from stated s
      left join candidates c on c.id = s.id and c.bd = s.bd
      left join lateral (
        select * from public.dashboard_kpi_direct_day(s.id, s.bd, s.tz)
         where p_include_direct and c.rn is not null and c.rn <= 7
      ) x on true
  ),
  norm as (
    select d.id as store_id, d.currency, d.tz, d.ver, d.rev, d.last_rebuild_at, d.lvl, d.bd,
           d.final_state as state,
           (d.bd = public.dashboard_kpi_local_ts(now(), d.tz)::date) as partial,
           case when d.final_state = 'aggregate' then d.a_orders      else d.orders_count end as orders_count,
           case when d.final_state = 'aggregate' then d.a_dlv         else d.delivered_count end as delivered_count,
           case when d.final_state = 'aggregate' then d.a_canc        else d.cancelled_count end as cancelled_count,
           case when d.final_state = 'aggregate' then d.a_ret         else d.returned_count end as returned_count,
           case when d.final_state = 'aggregate' then d.a_ref         else d.refused_count end as refused_count,
           case when d.final_state = 'aggregate' then d.a_pend        else d.pending_count end as pending_count,
           case when d.final_state = 'aggregate' then d.a_uncl        else d.unclassified_count end as unclassified_count,
           case when d.final_state = 'aggregate' then d.a_rev         else d.revenue_items_gross end as revenue_items_gross,
           case when d.final_state = 'aggregate' then d.a_rev_est     else d.revenue_estimated end as revenue_estimated,
           case when d.final_state = 'aggregate' then d.a_disc        else d.discount_amount end as discount_amount,
           case when d.final_state = 'aggregate' then d.a_dcc         else d.delivery_charge_customer end as delivery_charge_customer,
           case when d.final_state = 'aggregate' then d.a_pc          else d.purchase_cost end as purchase_cost,
           case when d.final_state = 'aggregate' then d.a_dfc         else d.delivery_fee_cost end as delivery_fee_cost,
           case when d.final_state = 'aggregate' then d.a_cc          else d.confirmation_cost end as confirmation_cost,
           case when d.final_state = 'aggregate' then d.a_trk         else d.ads_tracked end as ads_tracked,
           case when d.final_state = 'aggregate' then d.a_fb          else d.ads_fallback_effective end as ads_fallback,
           case when d.final_state = 'aggregate' then d.a_adr         else d.ads_daily_rows end as ads_daily_rows,
           case when d.final_state = 'aggregate' then d.a_owl         else d.orders_without_lines end as orders_without_lines,
           case when d.final_state = 'aggregate' then d.a_dwl         else d.delivered_without_lines end as delivered_without_lines,
           case when d.final_state = 'aggregate' then d.a_lvtm        else d.line_vs_total_mismatch end as line_vs_total_mismatch,
           case when d.final_state = 'aggregate' then d.a_zpwr        else d.zero_purchase_with_revenue end as zero_purchase_with_revenue,
           case when d.final_state = 'aggregate' then d.a_iss         else d.data_issues_count end as data_issues_count
      from decided d
  ),
  store_totals as (
    select store_id, currency, tz, ver, rev, last_rebuild_at, lvl,
           count(*) as days_total,
           count(*) filter (where state = 'aggregate') as days_aggregate,
           count(*) filter (where state = 'direct') as days_direct,
           count(*) filter (where state = 'dirty') as days_dirty,
           count(*) filter (where state = 'missing') as days_missing,
           count(*) filter (where state = 'incompatible') as days_incompatible,
           count(*) filter (where partial and state in ('aggregate','direct')) as days_partial,
           coalesce(sum(orders_count) filter (where state in ('aggregate','direct')), 0) as orders_count,
           coalesce(sum(delivered_count) filter (where state in ('aggregate','direct')), 0) as delivered_count,
           coalesce(sum(cancelled_count) filter (where state in ('aggregate','direct')), 0) as cancelled_count,
           coalesce(sum(returned_count) filter (where state in ('aggregate','direct')), 0) as returned_count,
           coalesce(sum(refused_count) filter (where state in ('aggregate','direct')), 0) as refused_count,
           coalesce(sum(pending_count) filter (where state in ('aggregate','direct')), 0) as pending_count,
           coalesce(sum(unclassified_count) filter (where state in ('aggregate','direct')), 0) as unclassified_count,
           coalesce(sum(revenue_items_gross) filter (where state in ('aggregate','direct')), 0) as revenue_items_gross,
           coalesce(sum(revenue_estimated) filter (where state in ('aggregate','direct')), 0) as revenue_estimated,
           coalesce(sum(discount_amount) filter (where state in ('aggregate','direct')), 0) as discount_amount,
           coalesce(sum(delivery_charge_customer) filter (where state in ('aggregate','direct')), 0) as delivery_charge_customer,
           coalesce(sum(purchase_cost) filter (where state in ('aggregate','direct')), 0) as purchase_cost,
           coalesce(sum(delivery_fee_cost) filter (where state in ('aggregate','direct')), 0) as delivery_fee_cost,
           coalesce(sum(confirmation_cost) filter (where state in ('aggregate','direct')), 0) as confirmation_cost,
           coalesce(sum(ads_tracked) filter (where state in ('aggregate','direct')), 0) as ads_tracked,
           coalesce(sum(ads_fallback) filter (where state in ('aggregate','direct')), 0) as ads_fallback,
           coalesce(sum(ads_daily_rows) filter (where state in ('aggregate','direct')), 0) as ads_daily_rows,
           coalesce(sum(orders_without_lines) filter (where state in ('aggregate','direct')), 0) as orders_without_lines,
           coalesce(sum(delivered_without_lines) filter (where state in ('aggregate','direct')), 0) as delivered_without_lines,
           coalesce(sum(line_vs_total_mismatch) filter (where state in ('aggregate','direct')), 0) as line_vs_total_mismatch,
           coalesce(sum(zero_purchase_with_revenue) filter (where state in ('aggregate','direct')), 0) as zero_purchase_with_revenue,
           coalesce(sum(data_issues_count) filter (where state in ('aggregate','direct')), 0) as data_issues_count
      from norm
     group by store_id, currency, tz, ver, rev, last_rebuild_at, lvl
  ),
  store_totals_all as (
    -- Une boutique autorisée dont toute la fenêtre demandée est antérieure à sa
    -- borne historique n'a aucune ligne dans `norm`. Elle doit tout de même
    -- être renvoyée : couverture de 0 jour et totaux nuls, sans inventer de
    -- journée ni fabriquer de montant.
    select t.* from store_totals t
    union all
    select a.id, a.currency, a.tz, a.ver, a.rev, a.last_rebuild_at, a.lvl,
           0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint,
           0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint,
           0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric,
           0::numeric, 0::numeric, 0::numeric,
           0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint
      from authorized a
     where not exists (select 1 from store_totals t where t.store_id = a.id)
  ),
  points as (
    select n.store_id, n.bd,
           jsonb_build_object(
             'date', n.bd,
             'state', n.state,
             'partial', n.partial,
             'orders_count', n.orders_count,
             'delivered_count', n.delivered_count,
             'cancelled_count', n.cancelled_count,
             'returned_count', n.returned_count,
             'pending_count', n.pending_count,
             'unclassified_count', n.unclassified_count,
             'revenue', n.revenue_items_gross::text,
             'ads', (coalesce(n.ads_tracked,0) + coalesce(n.ads_fallback,0))::text,
             'purchase_cost', n.purchase_cost::text,
             'contribution_margin',
               (coalesce(n.revenue_items_gross,0) - coalesce(n.purchase_cost,0)
                - coalesce(n.delivery_fee_cost,0) - coalesce(n.confirmation_cost,0)
                - coalesce(n.ads_tracked,0) - coalesce(n.ads_fallback,0))::text
           ) as pt
      from norm n
     where n.state in ('aggregate','direct')
  ),
  points_gated as (
    select p.store_id, p.bd,
           case when t.lvl = 'full' then p.pt else p.pt - 'purchase_cost' - 'contribution_margin' end as pt
      from points p join store_totals t on t.store_id = p.store_id
  ),
  store_json as (
    select t.store_id,
           jsonb_build_object(
             'store_id', t.store_id,
             'access', t.lvl,
             'currency', t.currency,
             'tz', t.tz,
             'definition_version', t.ver,
             'revision', t.rev::text,
             'last_rebuild_at', t.last_rebuild_at,
             'coverage', jsonb_build_object(
               'days_total', t.days_total,
               'days_aggregate', t.days_aggregate,
               'days_direct', t.days_direct,
               'days_dirty', t.days_dirty,
               'days_missing', t.days_missing,
               'days_incompatible', t.days_incompatible,
               'days_partial', t.days_partial
             ),
             'incomplete', (t.days_dirty + t.days_missing + t.days_incompatible) > 0,
             'totals', (
               case when t.lvl = 'full' then jsonb_build_object(
                 'orders_count', t.orders_count,
                 'delivered_count', t.delivered_count,
                 'cancelled_count', t.cancelled_count,
                 'returned_count', t.returned_count,
                 'refused_count', t.refused_count,
                 'pending_count', t.pending_count,
                 'unclassified_count', t.unclassified_count,
                 'revenue', t.revenue_items_gross::text,
                 'revenue_estimated', t.revenue_estimated::text,
                 'discount_amount', t.discount_amount::text,
                 'delivery_charge_customer', t.delivery_charge_customer::text,
                 'purchase_cost', t.purchase_cost::text,
                 'delivery_fee_cost', t.delivery_fee_cost::text,
                 'confirmation_cost', t.confirmation_cost::text,
                 'ads_tracked', t.ads_tracked::text,
                 'ads_fallback', t.ads_fallback::text,
                 'ad_spend_contract', (t.ads_tracked + t.ads_fallback)::text,
                 'ads_daily_days', t.ads_daily_rows,
                 'contribution_margin', (t.revenue_items_gross - t.purchase_cost - t.delivery_fee_cost
                                         - t.confirmation_cost - t.ads_tracked - t.ads_fallback)::text,
                 'aov', (case when t.delivered_count > 0 then t.revenue_items_gross / t.delivered_count else 0 end)::text,
                 'delivery_rate', (case when t.orders_count > 0 then 100.0 * t.delivered_count / t.orders_count else 0 end)::text,
                 'margin_rate', (case when t.revenue_items_gross <> 0
                                      then 100.0 * (t.revenue_items_gross - t.purchase_cost - t.delivery_fee_cost
                                                    - t.confirmation_cost - t.ads_tracked - t.ads_fallback)
                                           / t.revenue_items_gross else 0 end)::text,
                 'cpl', (case when t.orders_count > 0 then (t.ads_tracked + t.ads_fallback) / t.orders_count else 0 end)::text,
                 'cpa', (case when t.delivered_count > 0 then (t.ads_tracked + t.ads_fallback) / t.delivered_count else 0 end)::text,
                 'roas', (case when (t.ads_tracked + t.ads_fallback) > 0
                               then t.revenue_items_gross / (t.ads_tracked + t.ads_fallback) else 0 end)::text,
                 'quality', jsonb_build_object(
                   'orders_without_lines', t.orders_without_lines,
                   'delivered_without_lines', t.delivered_without_lines,
                   'line_vs_total_mismatch', t.line_vs_total_mismatch,
                   'zero_purchase_with_revenue', t.zero_purchase_with_revenue,
                   'data_issues_count', t.data_issues_count
                 )
               ) else jsonb_build_object(
                 'orders_count', t.orders_count,
                 'delivered_count', t.delivered_count,
                 'cancelled_count', t.cancelled_count,
                 'returned_count', t.returned_count,
                 'refused_count', t.refused_count,
                 'pending_count', t.pending_count,
                 'unclassified_count', t.unclassified_count,
                 'revenue', t.revenue_items_gross::text,
                 'revenue_estimated', t.revenue_estimated::text,
                 'discount_amount', t.discount_amount::text,
                 'delivery_charge_customer', t.delivery_charge_customer::text,
                 'ads_tracked', t.ads_tracked::text,
                 'ads_fallback', t.ads_fallback::text,
                 'ad_spend_contract', (t.ads_tracked + t.ads_fallback)::text,
                 'ads_daily_days', t.ads_daily_rows,
                 'aov', (case when t.delivered_count > 0 then t.revenue_items_gross / t.delivered_count else 0 end)::text,
                 'delivery_rate', (case when t.orders_count > 0 then 100.0 * t.delivered_count / t.orders_count else 0 end)::text,
                 'cpl', (case when t.orders_count > 0 then (t.ads_tracked + t.ads_fallback) / t.orders_count else 0 end)::text,
                 'cpa', (case when t.delivered_count > 0 then (t.ads_tracked + t.ads_fallback) / t.delivered_count else 0 end)::text,
                 'roas', (case when (t.ads_tracked + t.ads_fallback) > 0
                               then t.revenue_items_gross / (t.ads_tracked + t.ads_fallback) else 0 end)::text,
                 'quality', jsonb_build_object(
                   'orders_without_lines', t.orders_without_lines,
                   'delivered_without_lines', t.delivered_without_lines,
                   'line_vs_total_mismatch', t.line_vs_total_mismatch
                 )
               ) end
             ),
             'points', coalesce((select jsonb_agg(pg.pt order by pg.bd) from points_gated pg where pg.store_id = t.store_id), '[]'::jsonb)
           ) as js
      from store_totals_all t
  ),
  currency_totals as (
    select n.currency,
           sum(n.orders_count) filter (where n.state in ('aggregate','direct')) as orders_count,
           sum(n.delivered_count) filter (where n.state in ('aggregate','direct')) as delivered_count,
           sum(n.revenue_items_gross) filter (where n.state in ('aggregate','direct')) as revenue,
           sum(n.purchase_cost) filter (where n.state in ('aggregate','direct')) as purchase_cost,
           sum(n.ads_tracked) filter (where n.state in ('aggregate','direct')) as ads_tracked,
           sum(n.ads_fallback) filter (where n.state in ('aggregate','direct')) as ads_fallback
      from norm n group by n.currency
  )
  select jsonb_build_object(
    'definition_version', (select max(ver) from store_totals_all),
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'generated_at', now(),
    'direct_budget', jsonb_build_object('limit', 7,
      'used', (select count(*) from norm where state = 'direct')),
    'incomplete', (select coalesce(bool_or((days_dirty + days_missing + days_incompatible) > 0), false)
                     from store_totals_all),
    'stores', coalesce((select jsonb_agg(sj.js order by sj.store_id) from store_json sj), '[]'::jsonb),
    'currencies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', c.currency,
        'totals', jsonb_build_object(
          'orders_count', c.orders_count,
          'delivered_count', c.delivered_count,
          'revenue', c.revenue::text,
          'ads', (coalesce(c.ads_tracked,0) + coalesce(c.ads_fallback,0))::text
        )
      ) order by c.currency)
      from currency_totals c), '[]'::jsonb)
  ) into v_result;

  if (select count(*) from jsonb_array_elements(v_result->'stores')) = 0 then
    raise exception 'KPI_NO_ACCESS';
  end if;

  return v_result;
end;
$function$
;
