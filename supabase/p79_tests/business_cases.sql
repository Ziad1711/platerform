-- P7.9 — jeu métier minimal des fonctions installées (agrégats order/delivery).
--
-- STATUT : préparé, NON exécuté. Aucune écriture sur jisra-test sans
-- autorisation distincte. Aucune intégration externe, aucun envoi de message.
--
-- Exécution prévue (jisra-test, base de test uniquement) :
--   psql "$TEST_DATABASE_URL" -v store_id=<uuid boutique MAD de test> \
--        -v ON_ERROR_STOP=1 -f supabase/p79_tests/business_cases.sql
--
-- Garanties :
--   * tout se passe dans une transaction terminée par ROLLBACK ;
--   * journées synthétiques (2000-01-03 / 01-08..01-11 / 01-20 / 01-25) ;
--   * version de définition 900 : aucun recoupement avec les partitions réelles ;
--   * la boutique ciblée n'est jamais une boutique déjà publiée.
--
-- Chaque requête de contrôle renvoie une colonne par grandeur : PASS ou FAIL.
-- Une colonne FAIL est un échec, jamais une déduction.

\set ON_ERROR_STOP on

-- ===========================================================================
-- BLOC A — P0-1 : invalidation ciblée des composantes qualité.
-- Transaction séparée, sur des commandes réelles de la boutique de test,
-- entièrement annulée (ROLLBACK).
-- ===========================================================================
begin;

select set_config('p79.store_id', :'store_id', true);

create temporary table p79_inv (case_id text primary key, observed text not null, expected text not null) on commit drop;

do $p01$
declare
  v_store uuid := current_setting('p79.store_id')::uuid;
  v_a uuid; v_da date;
  v_b uuid; v_db date;
  v_before int; v_after int; v_ctrl int;
begin
  select o.id,
         (o.order_date at time zone coalesce(st.tz, 'Africa/Casablanca'))::date
    into v_a, v_da
    from public.orders o
    left join public.dashboard_kpi_store_state st on st.store_id = o.store_id
   where o.store_id = v_store
   order by o.order_date desc
   limit 1;

  if v_a is null then
    insert into p79_inv values ('P0-1_rounding_only', 'NOT COVERED', 'PASS');
    insert into p79_inv values ('P0-1_unrelated_update', 'NOT COVERED', 'PASS');
    return;
  end if;

  select count(*) into v_before
    from public.dashboard_kpi_invalidation i
   where i.store_id = v_store and i.business_date = v_da
     and i.note_tx = txid_current()
     and i.reason like 'orders:UPDATE:quality:%';

  update public.orders
     set rounding_adjustment = case when coalesce(rounding_adjustment, 0) = 0 then 0.5 else 0 end
   where id = v_a;

  select count(*) into v_after
    from public.dashboard_kpi_invalidation i
   where i.store_id = v_store and i.business_date = v_da
     and i.note_tx = txid_current()
     and i.reason like 'orders:UPDATE:quality:%';

  insert into p79_inv values ('P0-1_rounding_only',
    case when v_after = v_before + 1 then 'PASS' else 'FAIL' end, 'PASS');

  -- Contrôle : une écriture hors composantes qualité ne doit rien enfiler.
  select o.id,
         (o.order_date at time zone coalesce(st.tz, 'Africa/Casablanca'))::date
    into v_b, v_db
    from public.orders o
    left join public.dashboard_kpi_store_state st on st.store_id = o.store_id
   where o.store_id = v_store
     and o.id <> v_a
     and (o.order_date at time zone coalesce(st.tz, 'Africa/Casablanca'))::date <> v_da
   order by o.order_date desc
   limit 1;

  if v_b is null then
    insert into p79_inv values ('P0-1_unrelated_update', 'NOT COVERED', 'PASS');
    return;
  end if;

  update public.orders
     set customer_name = coalesce(customer_name, '') || ' (p79)'
   where id = v_b;

  select count(*) into v_ctrl
    from public.dashboard_kpi_invalidation i
   where i.store_id = v_store and i.business_date = v_db
     and i.note_tx = txid_current()
     and i.reason like 'orders:UPDATE:quality:%';

  insert into p79_inv values ('P0-1_unrelated_update',
    case when v_ctrl = 0 then 'PASS' else 'FAIL' end, 'PASS');
end
$p01$;

select case_id, observed, expected,
       case when observed = 'NOT COVERED' then 'NOT COVERED'
            when observed = expected then 'PASS' else 'FAIL' end as status
  from p79_inv order by case_id;

drop table p79_inv;

rollback;

-- ===========================================================================
-- BLOC B — jeu métier minimal (agrégats installés).
-- ===========================================================================
begin;

select set_config('p79.store_id', :'store_id', true);


do $guard$
declare
  v_store uuid := current_setting('p79.store_id')::uuid;
begin
  if v_store is null then
    raise exception 'P79_STORE_ID_REQUIRED';
  end if;
  if not exists (select 1 from public.stores s where s.id = v_store) then
    raise exception 'P79_STORE_NOT_FOUND';
  end if;
  if exists (
    select 1 from public.dashboard_kpi_store_state st
     where st.store_id = v_store and st.backfill_state = 'done'
       and st.coverage_from is not null and st.coverage_to is not null
  ) then
    raise exception 'P79_STORE_LOOKS_PUBLISHED (choisir une boutique de test hors cohorte)';
  end if;
end
$guard$;

create temporary table p79_map (key text primary key, order_id uuid not null) on commit drop;

insert into p79_map (key, order_id)
values
  ('multi',      gen_random_uuid()),
  ('manual',     gen_random_uuid()),
  ('nolines',    gen_random_uuid()),
  ('cancelled',  gen_random_uuid()),
  ('returned',   gen_random_uuid()),
  ('discship',   gen_random_uuid()),
  ('anom',       gen_random_uuid()),
  ('multianom',  gen_random_uuid());

-- Publicité du jour suivi, insérée AVANT les commandes : le trigger
-- trg_allocate_ads_on_ad_spend ne doit pas réécrire les allocations du jeu
-- (il remet à 0 toute commande non `source = 'ads'` du même jour).
-- Devise de dépense = devise boutique => taux 1, `spend_converted` = `spend`.
insert into public.ad_spend_daily (
  store_id, spend_date, spend, spend_currency, currency_convert, platform
)
select current_setting('p79.store_id')::uuid, v.ts, v.spend,
       s.currency, s.currency, 'facebook'
  from public.stores s
  join (values
    (timestamptz '2000-01-03 12:00:00+00', 40.00::numeric),
    (timestamptz '2000-01-03 12:05:00+00', 10.00::numeric),
    (timestamptz '2000-01-03 12:10:00+00',  0.00::numeric)
  ) v(ts, spend) on true
 where s.id = current_setting('p79.store_id')::uuid;

-- `spend_converted = NULL` : écriture directe, hors des colonnes surveillées
-- par le trigger de conversion.
update public.ad_spend_daily
   set spend_converted = null
 where store_id = current_setting('p79.store_id')::uuid
   and spend_date = timestamptz '2000-01-03 12:05:00+00'
   and platform = 'facebook';

-- ---------------------------------------------------------------- D1 commandes
-- order_date = 2000-01-03 (fuseau boutique). Totaux volontairement neutres :
-- ils sont recalculés par sync_order_total_from_items à l'insertion des lignes.
insert into public.orders (
  id, store_id, status, order_date, delivered_at,
  subtotal_amount, discount_amount, delivery_charge_to_customer,
  rounding_adjustment, total_selling_price,
  delivery_fee, confirmation_cost_allocated, ads_cost_allocated,
  discount_type, discount_value, city, customer_name, source
)
select m.order_id, current_setting('p79.store_id')::uuid, v.status, v.od, v.dd,
       0, v.disc, v.ship, v.round, v.total,
       v.dfee, v.conf, v.ads,
       'fixed', 0, v.city, 'P7.9 ' || m.key, 'organic'
  from p79_map m
  join (values
    ('multi',     'delivered',        timestamptz '2000-01-03 10:00:00+00', timestamptz '2000-01-03 15:00:00+00', 0::numeric, 0::numeric, 0::numeric, 200::numeric, 20::numeric, 0::numeric, 15::numeric, 'Casablanca'),
    ('manual',    'delivered',        timestamptz '2000-01-03 10:30:00+00', timestamptz '2000-01-03 15:00:00+00', 0::numeric, 0::numeric, 0::numeric, 100::numeric,  0::numeric, 5::numeric,  0::numeric, 'Rabat'),
    ('nolines',   'delivered',        timestamptz '2000-01-03 11:00:00+00', timestamptz '2000-01-03 15:00:00+00', 0::numeric, 0::numeric, 0::numeric, 150::numeric,  0::numeric, 0::numeric,  0::numeric, 'Rabat'),
    ('cancelled', 'cancelled',        timestamptz '2000-01-03 12:00:00+00', null,                                 0::numeric, 0::numeric, 0::numeric, 300::numeric,  0::numeric, 0::numeric,  0::numeric, null),
    ('returned',  'returned_stocked', timestamptz '2000-01-03 12:30:00+00', null,                                 0::numeric, 0::numeric, 0::numeric, 250::numeric,  0::numeric, 0::numeric,  0::numeric, '  '),
    ('discship',  'delivered',        timestamptz '2000-01-03 13:00:00+00', timestamptz '2000-01-03 15:00:00+00',10::numeric,25::numeric, 1::numeric, 216::numeric,  0::numeric, 0::numeric, 15::numeric, 'Casablanca'),
    ('anom',      'delivered',        timestamptz '2000-01-03 14:00:00+00', timestamptz '2000-01-03 15:00:00+00', 0::numeric, 0::numeric, 0::numeric, 200::numeric,  0::numeric, 0::numeric,  0::numeric, 'Rabat'),
    ('multianom', 'delivered',        timestamptz '2000-01-03 14:30:00+00', timestamptz '2000-01-03 15:00:00+00', 0::numeric, 0::numeric, 0::numeric,  60::numeric,  0::numeric, 0::numeric,  0::numeric, 'Rabat')
  ) v(key, status, od, dd, disc, ship, round, total, dfee, conf, ads, city)
    on v.key = m.key;

-- Lignes : (quantité, prix unitaire, coût d'achat snapshot)
insert into public.order_items (
  store_id, order_id, quantity, unit_selling_price, unit_purchase_cost_snapshot, item_type
)
select current_setting('p79.store_id')::uuid, m.order_id, v.qty, v.price, v.cost, 'main'
  from p79_map m
  join (values
    ('multi',     2,  50.00, 20.00),
    ('multi',     1, 100.00, 40.00),
    ('manual',    1, 100.00, 40.00),
    ('cancelled', 1, 300.00, 100.00),
    ('returned',  1, 250.00,  90.00),
    ('discship',  1, 200.00,  50.00),
    ('anom',      1, 199.00, 100.00),
    ('multianom', 1, 100.00,   0.00)
  ) v(key, qty, price, cost)
    on v.key = m.key;

-- Coût d'achat manuel : écriture par UPDATE pour que la source soit dérivée par
-- trg_orders_sync_buy_price_source (aucun état forcé manuellement).
update public.orders o
   set buy_price = 70.00
  from p79_map m
 where m.key = 'manual' and o.id = m.order_id;

-- Anomalies volontaires, posées APRÈS les lignes (sinon le sync les écrase).
update public.orders o set subtotal_amount = 200.00
  from p79_map m where m.key = 'anom' and o.id = m.order_id;
update public.orders o set subtotal_amount = 95.00, total_selling_price = 60.00
  from p79_map m where m.key = 'multianom' and o.id = m.order_id;
-- Commande livrée sans ligne : total encaissé conservé.
update public.orders o set subtotal_amount = 0.00, total_selling_price = 150.00
  from p79_map m where m.key = 'nolines' and o.id = m.order_id;

-- Publicité : voir le bloc inséré avant les commandes (devise boutique).

-- ------------------------------------------------------- D1 agrégat axe order
select public.dashboard_kpi_aggregate_order(
  current_setting('p79.store_id')::uuid,
  date '2000-01-03',
  900,
  (date '2000-01-03'::timestamp at time zone 'Africa/Casablanca'),
  ((date '2000-01-03' + 1)::timestamp at time zone 'Africa/Casablanca'),
  'Africa/Casablanca',
  (select s.currency from public.stores s where s.id = current_setting('p79.store_id')::uuid),
  1
);

select 'D1_order' as case_id,
  case when orders_count = 8 then 'PASS' else 'FAIL' end as orders_count,
  case when delivered_count = 6 then 'PASS' else 'FAIL' end as delivered_count,
  case when cancelled_count = 1 then 'PASS' else 'FAIL' end as cancelled_count,
  case when returned_count = 1 then 'PASS' else 'FAIL' end as returned_count,
  case when refused_count = 0 then 'PASS' else 'FAIL' end as refused_count,
  case when pending_count = 0 then 'PASS' else 'FAIL' end as pending_count,
  case when confirmed_like_count = 7 then 'PASS' else 'FAIL' end as confirmed_like_count,
  case when sent_like_count = 7 then 'PASS' else 'FAIL' end as sent_like_count,
  case when unclassified_count = 0 then 'PASS' else 'FAIL' end as unclassified_count,
  case when revenue_items_gross = 799 then 'PASS' else 'FAIL' end as revenue_items_gross,
  case when revenue_estimated = 150 then 'PASS' else 'FAIL' end as revenue_estimated,
  case when discount_amount = 10 then 'PASS' else 'FAIL' end as discount_amount,
  case when delivery_charge_customer = 25 then 'PASS' else 'FAIL' end as delivery_charge_customer,
  case when purchase_cost = 300 then 'PASS' else 'FAIL' end as purchase_cost_manual_and_auto,
  case when delivery_fee_cost = 20 then 'PASS' else 'FAIL' end as delivery_fee_cost,
  case when confirmation_cost = 5 then 'PASS' else 'FAIL' end as confirmation_cost,
  case when ads_tracked = 50 then 'PASS' else 'FAIL' end as ads_tracked,
  case when ads_allocated_raw = 30 then 'PASS' else 'FAIL' end as ads_allocated_raw,
  case when ads_fallback_effective = 0 then 'PASS' else 'FAIL' end as ads_fallback_effective,
  case when ads_daily_rows = 3 then 'PASS' else 'FAIL' end as ads_daily_rows,
  case when orders_without_lines = 1 then 'PASS' else 'FAIL' end as orders_without_lines,
  case when delivered_without_lines = 1 then 'PASS' else 'FAIL' end as delivered_without_lines,
  case when line_vs_total_mismatch = 2 then 'PASS' else 'FAIL' end as line_vs_total_mismatch,
  case when zero_purchase_with_revenue = 1 then 'PASS' else 'FAIL' end as zero_purchase_with_revenue,
  case when data_issues_count = 3 then 'PASS' else 'FAIL' end as data_issues_count_single_count,
  case when quality_version = 2 then 'PASS' else 'FAIL' end as quality_version
from public.dashboard_daily_metrics
where store_id = current_setting('p79.store_id')::uuid
  and business_date = date '2000-01-03'
  and axis = 'order'
  and definition_version = 900;

-- ---------------------------------------------------- D1 agrégat axe delivery
select public.dashboard_kpi_aggregate_delivery(
  current_setting('p79.store_id')::uuid,
  date '2000-01-03',
  900,
  (date '2000-01-03'::timestamp at time zone 'Africa/Casablanca'),
  ((date '2000-01-03' + 1)::timestamp at time zone 'Africa/Casablanca'),
  'Africa/Casablanca',
  (select s.currency from public.stores s where s.id = current_setting('p79.store_id')::uuid),
  1
);

select 'D1_delivery' as case_id,
  case when orders_count = 6 then 'PASS' else 'FAIL' end as orders_count,
  case when delivered_count = 6 then 'PASS' else 'FAIL' end as delivered_count,
  case when revenue_items_gross = 799 then 'PASS' else 'FAIL' end as revenue_items_gross,
  case when revenue_estimated = 150 then 'PASS' else 'FAIL' end as revenue_estimated,
  case when purchase_cost = 300 then 'PASS' else 'FAIL' end as purchase_cost,
  case when delivery_fee_cost = 20 then 'PASS' else 'FAIL' end as delivery_fee_cost,
  case when confirmation_cost = 5 then 'PASS' else 'FAIL' end as confirmation_cost,
  case when orders_without_lines = 1 then 'PASS' else 'FAIL' end as orders_without_lines,
  case when delivered_without_lines = 1 then 'PASS' else 'FAIL' end as delivered_without_lines,
  case when line_vs_total_mismatch = 2 then 'PASS' else 'FAIL' end as line_vs_total_mismatch,
  case when zero_purchase_with_revenue = 1 then 'PASS' else 'FAIL' end as zero_purchase_with_revenue,
  case when data_issues_count = 3 then 'PASS' else 'FAIL' end as data_issues_count_single_count,
  case when ads_tracked = 0 then 'PASS' else 'FAIL' end as ads_tracked_zero_on_delivery_axis,
  case when quality_version = 2 then 'PASS' else 'FAIL' end as quality_version
from public.dashboard_daily_metrics
where store_id = current_setting('p79.store_id')::uuid
  and business_date = date '2000-01-03'
  and axis = 'delivery'
  and definition_version = 900;

-- ===========================================================================
-- D2 — temporalité : commande J1/livraison J3, livraison sans date,
-- borne de fin exacte, frontière Casablanca.
-- ===========================================================================
create temporary table p79_map2 (key text primary key, order_id uuid not null) on commit drop;

insert into p79_map2 (key, order_id) values
  ('earlier',     gen_random_uuid()),
  ('nodelivdate', gen_random_uuid()),
  ('endbound',    gen_random_uuid()),
  ('boundary',    gen_random_uuid()),
  ('prevsec',     gen_random_uuid());

insert into public.orders (
  id, store_id, status, order_date, delivered_at,
  subtotal_amount, discount_amount, delivery_charge_to_customer,
  rounding_adjustment, total_selling_price,
  discount_type, discount_value, customer_name, source
)
select m.order_id, current_setting('p79.store_id')::uuid, v.status, v.od, v.dd,
       0, 0, 0, 0, 0, 'fixed', 0, 'P7.9 ' || m.key, 'organic'
  from p79_map2 m
  join (values
    ('earlier',     'delivered',
     ((date '2000-01-08')::timestamp at time zone 'Africa/Casablanca') + interval '23 hours 30 minutes',
     ((date '2000-01-10')::timestamp at time zone 'Africa/Casablanca') + interval '10 hours'),
    ('nodelivdate', 'delivered',
     ((date '2000-01-10')::timestamp at time zone 'Africa/Casablanca') + interval '9 hours',
     null::timestamptz),
    ('endbound',    'new',
     ((date '2000-01-11')::timestamp at time zone 'Africa/Casablanca'),
     null::timestamptz),
    ('boundary',    'delivered',
     ((date '2000-01-10')::timestamp at time zone 'Africa/Casablanca'),
     ((date '2000-01-10')::timestamp at time zone 'Africa/Casablanca') + interval '12 hours'),
    ('prevsec',     'new',
     ((date '2000-01-10')::timestamp at time zone 'Africa/Casablanca') - interval '1 second',
     null::timestamptz)
  ) v(key, status, od, dd)
    on v.key = m.key;

insert into public.order_items (
  store_id, order_id, quantity, unit_selling_price, unit_purchase_cost_snapshot, item_type
)
select current_setting('p79.store_id')::uuid, m.order_id, 1, 100.00, 50.00, 'main'
  from p79_map2 m
 where m.key in ('earlier', 'nodelivdate', 'boundary');

select public.dashboard_kpi_aggregate_order(
  current_setting('p79.store_id')::uuid, date '2000-01-10', 900,
  (date '2000-01-10'::timestamp at time zone 'Africa/Casablanca'),
  ((date '2000-01-10' + 1)::timestamp at time zone 'Africa/Casablanca'),
  'Africa/Casablanca',
  (select s.currency from public.stores s where s.id = current_setting('p79.store_id')::uuid), 1);

select public.dashboard_kpi_aggregate_delivery(
  current_setting('p79.store_id')::uuid, date '2000-01-10', 900,
  (date '2000-01-10'::timestamp at time zone 'Africa/Casablanca'),
  ((date '2000-01-10' + 1)::timestamp at time zone 'Africa/Casablanca'),
  'Africa/Casablanca',
  (select s.currency from public.stores s where s.id = current_setting('p79.store_id')::uuid), 1);

select public.dashboard_kpi_aggregate_order(
  current_setting('p79.store_id')::uuid, date '2000-01-09', 900,
  (date '2000-01-09'::timestamp at time zone 'Africa/Casablanca'),
  ((date '2000-01-09' + 1)::timestamp at time zone 'Africa/Casablanca'),
  'Africa/Casablanca',
  (select s.currency from public.stores s where s.id = current_setting('p79.store_id')::uuid), 1);

select public.dashboard_kpi_aggregate_order(
  current_setting('p79.store_id')::uuid, date '2000-01-11', 900,
  (date '2000-01-11'::timestamp at time zone 'Africa/Casablanca'),
  ((date '2000-01-11' + 1)::timestamp at time zone 'Africa/Casablanca'),
  'Africa/Casablanca',
  (select s.currency from public.stores s where s.id = current_setting('p79.store_id')::uuid), 1);

select 'D2_temporality' as case_id,
  case when (select orders_count from public.dashboard_daily_metrics
              where store_id = current_setting('p79.store_id')::uuid
                and business_date = date '2000-01-10' and axis = 'order'
                and definition_version = 900) = 2
       then 'PASS' else 'FAIL' end as order_axis_boundary_and_fallback_in,
  case when (select delivered_count from public.dashboard_daily_metrics
              where store_id = current_setting('p79.store_id')::uuid
                and business_date = date '2000-01-10' and axis = 'delivery'
                and definition_version = 900) = 3
       then 'PASS' else 'FAIL' end as delivery_axis_j1_j3_and_no_date,
  case when (select orders_count from public.dashboard_daily_metrics
              where store_id = current_setting('p79.store_id')::uuid
                and business_date = date '2000-01-09' and axis = 'order'
                and definition_version = 900) = 1
       then 'PASS' else 'FAIL' end as one_second_before_midnight_previous_day,
  case when (select orders_count from public.dashboard_daily_metrics
              where store_id = current_setting('p79.store_id')::uuid
                and business_date = date '2000-01-11' and axis = 'order'
                and definition_version = 900) = 1
       then 'PASS' else 'FAIL' end as exact_end_bound_excluded;

-- ===========================================================================
-- D3 — publicité sans aucune commande.
-- ===========================================================================
insert into public.ad_spend_daily (
  store_id, spend_date, spend, spend_currency, currency_convert, platform
)
select current_setting('p79.store_id')::uuid,
       ((date '2000-01-20')::timestamp at time zone 'Africa/Casablanca') + interval '12 hours',
       30.00, s.currency, s.currency, 'facebook'
  from public.stores s
 where s.id = current_setting('p79.store_id')::uuid;

select public.dashboard_kpi_aggregate_order(
  current_setting('p79.store_id')::uuid, date '2000-01-20', 900,
  (date '2000-01-20'::timestamp at time zone 'Africa/Casablanca'),
  ((date '2000-01-20' + 1)::timestamp at time zone 'Africa/Casablanca'),
  'Africa/Casablanca',
  (select s.currency from public.stores s where s.id = current_setting('p79.store_id')::uuid), 1);

select 'D3_ads_without_orders' as case_id,
  case when orders_count = 0 then 'PASS' else 'FAIL' end as orders_count_zero,
  case when ads_tracked = 30 then 'PASS' else 'FAIL' end as ads_tracked_kept,
  case when ads_daily_rows = 1 then 'PASS' else 'FAIL' end as ads_daily_rows,
  case when ads_allocated_raw = 0 then 'PASS' else 'FAIL' end as ads_allocated_zero,
  case when ads_fallback_effective = 0 then 'PASS' else 'FAIL' end as ads_fallback_zero
from public.dashboard_daily_metrics
where store_id = current_setting('p79.store_id')::uuid
  and business_date = date '2000-01-20'
  and axis = 'order'
  and definition_version = 900;

-- ===========================================================================
-- D4 — jour non suivi : allocations présentes sur livrée et non livrée.
-- ===========================================================================
create temporary table p79_map3 (key text primary key, order_id uuid not null) on commit drop;

insert into p79_map3 (key, order_id) values
  ('alloc_delivered', gen_random_uuid()),
  ('alloc_cancelled', gen_random_uuid());

insert into public.orders (
  id, store_id, status, order_date, delivered_at,
  subtotal_amount, discount_amount, delivery_charge_to_customer,
  rounding_adjustment, total_selling_price, ads_cost_allocated,
  discount_type, discount_value, customer_name, source
)
select m.order_id, current_setting('p79.store_id')::uuid, v.status, v.od, v.dd,
       0, 0, 0, 0, 0, v.ads, 'fixed', 0, 'P7.9 ' || m.key, 'organic'
  from p79_map3 m
  join (values
    ('alloc_delivered', 'delivered',
     ((date '2000-01-25')::timestamp at time zone 'Africa/Casablanca') + interval '10 hours',
     ((date '2000-01-25')::timestamp at time zone 'Africa/Casablanca') + interval '16 hours',
     12.00::numeric),
    ('alloc_cancelled', 'cancelled',
     ((date '2000-01-25')::timestamp at time zone 'Africa/Casablanca') + interval '11 hours',
     null::timestamptz,
     8.00::numeric)
  ) v(key, status, od, dd, ads)
    on v.key = m.key;

insert into public.order_items (
  store_id, order_id, quantity, unit_selling_price, unit_purchase_cost_snapshot, item_type
)
select current_setting('p79.store_id')::uuid, m.order_id, 1, 100.00, 40.00, 'main'
  from p79_map3 m;

select public.dashboard_kpi_aggregate_order(
  current_setting('p79.store_id')::uuid, date '2000-01-25', 900,
  (date '2000-01-25'::timestamp at time zone 'Africa/Casablanca'),
  ((date '2000-01-25' + 1)::timestamp at time zone 'Africa/Casablanca'),
  'Africa/Casablanca',
  (select s.currency from public.stores s where s.id = current_setting('p79.store_id')::uuid), 1);

select 'D4_untracked_day_allocation' as case_id,
  case when orders_count = 2 then 'PASS' else 'FAIL' end as orders_count,
  case when delivered_count = 1 then 'PASS' else 'FAIL' end as delivered_count,
  case when ads_tracked = 0 then 'PASS' else 'FAIL' end as ads_tracked_zero,
  case when ads_daily_rows = 0 then 'PASS' else 'FAIL' end as ads_daily_rows_zero,
  case when ads_allocated_raw = 12 then 'PASS' else 'FAIL' end as allocated_delivered_only,
  case when ads_fallback_effective = 12 then 'PASS' else 'FAIL' end as fallback_equals_delivered_allocation
from public.dashboard_daily_metrics
where store_id = current_setting('p79.store_id')::uuid
  and business_date = date '2000-01-25'
  and axis = 'order'
  and definition_version = 900;

-- Aucune donnée conservée : les deux blocs ont été annulés (ROLLBACK).
rollback;




