-- JISRA — P7.10 : tests fonctionnels des producteurs optimisés.
-- CIBLE UNIQUEMENT : B13 isolé (biqrgdopcvkrbgfxkzxm). Aucune autre cible.
-- Écritures synthétiques, nettoyées en fin de script.
--   psql -X -w -v ON_ERROR_STOP=1 "service=b13-isolated" -f tests/producers_optimization_tests.sql
\set ON_ERROR_STOP on
\pset pager off
set client_min_messages = notice;
set statement_timeout = '120s';

do $guard$
begin
  if current_database() <> 'postgres' or current_user <> 'postgres' then
    raise exception 'P710_TESTS_IDENTITY';
  end if;
  if to_regprocedure('public.dashboard_kpi_producer_arm(boolean)') is null then
    raise exception 'P710_TESTS_PATCH_MISSING';
  end if;
  if (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
       where c.relnamespace = 'public'::regnamespace and not t.tgisinternal
         and t.tgname like 'trg_kpi_%' and t.tgenabled = 'O') <> 6 then
    raise exception 'P710_TESTS_PRODUCERS_NOT_ACTIVE';
  end if;
end
$guard$;

-- ---------------------------------------------------------------------------
-- Fixtures (script idempotent : nettoyage préalable des mêmes identifiants)
-- ---------------------------------------------------------------------------
do $t$
begin
  delete from public.order_items where store_id::text like '7e000000-%';
  delete from public.orders where store_id::text like '7e000000-%';
  delete from public.ad_spend_daily where store_id::text like '7e000000-%';
  delete from public.dashboard_kpi_invalidation where store_id::text like '7e000000-%';
  delete from public.dashboard_daily_metrics where store_id::text like '7e000000-%';
  delete from public.dashboard_kpi_store_state where store_id::text like '7e000000-%';
  delete from public.dashboard_kpi_producer_stores where store_id::text like '7e000000-%';
  delete from public.products where id::text like '7e000000-%';
  delete from public.stores where id::text like '7e000000-%';
end
$t$;

create temp table _r(label text primary key, ok boolean not null, detail text);
create or replace function pg_temp.chk(p_label text, p_actual text, p_expected text)
returns void language plpgsql as $fn$
begin
  insert into _r values (p_label, p_actual is not distinct from p_expected,
                         'attendu=' || coalesce(p_expected,'<null>') || ' obtenu=' || coalesce(p_actual,'<null>'));
end
$fn$;

create or replace function pg_temp.ev(p_store uuid)
returns bigint language sql as
$fn$ select count(*) from public.dashboard_kpi_invalidation where store_id = p_store $fn$;

create or replace function pg_temp.evdays(p_store uuid)
returns text language sql as
$fn$ select coalesce(string_agg(business_date::text, ',' order by business_date), '')
      from public.dashboard_kpi_invalidation where store_id = p_store $fn$;

create or replace function pg_temp.clear_ev()
returns void language sql as
$fn$ delete from public.dashboard_kpi_invalidation
      where store_id in ('7e000000-0000-4000-8000-0000000000a1'::uuid,
                         '7e000000-0000-4000-8000-0000000000a2'::uuid) $fn$;

insert into public.stores (id, owner_user_id, name, currency, country)
select '7e000000-0000-4000-8000-0000000000a1'::uuid, p.id, 'P7.10 A', 'MAD', 'MA'
  from public.profiles p order by p.id limit 1
on conflict (id) do nothing;
insert into public.stores (id, owner_user_id, name, currency, country)
select '7e000000-0000-4000-8000-0000000000a2'::uuid, p.id, 'P7.10 B', 'MAD', 'MA'
  from public.profiles p order by p.id limit 1
on conflict (id) do nothing;

insert into public.products (id, store_id, name) values
  ('7e000000-0000-4000-8000-0000000000b1', '7e000000-0000-4000-8000-0000000000a1', 'P7.10 produit A'),
  ('7e000000-0000-4000-8000-0000000000b2', '7e000000-0000-4000-8000-0000000000a2', 'P7.10 produit B')
on conflict (id) do nothing;

insert into public.dashboard_kpi_store_state
  (store_id, tz, active_definition_version, coverage_from, coverage_to, backfill_state)
values
  ('7e000000-0000-4000-8000-0000000000a1', 'Africa/Casablanca', 1, '2035-01-01', '2035-01-05', 'idle'),
  ('7e000000-0000-4000-8000-0000000000a2', 'Africa/Casablanca', 1, '2035-01-01', '2035-01-05', 'idle')
on conflict (store_id) do update
  set tz = excluded.tz, active_definition_version = excluded.active_definition_version;

select public.dashboard_kpi_producer_arm(true);
select public.dashboard_kpi_producer_enable_store('7e000000-0000-4000-8000-0000000000a1'::uuid, null, 'p710 test');
select public.dashboard_kpi_producer_enable_store('7e000000-0000-4000-8000-0000000000a2'::uuid, null, 'p710 test');

-- ---------------------------------------------------------------------------
-- T1 — insertion d'une commande : une seule clé boutique/jour
-- ---------------------------------------------------------------------------
do $t$
declare v_id uuid := gen_random_uuid();
begin
  perform pg_temp.clear_ev();
  insert into public.orders (id, store_id, status, order_date, subtotal_amount, discount_amount,
    delivery_charge_to_customer, rounding_adjustment, total_selling_price, delivery_fee,
    discount_type, discount_value, city, customer_name, source)
  values (v_id, '7e000000-0000-4000-8000-0000000000a1', 'new',
          timestamptz '2035-01-01 10:00:00+00', 0,0,0,0,0,0,'fixed',0,'Rabat','T1','organic');
  perform pg_temp.chk('T1_events', pg_temp.ev('7e000000-0000-4000-8000-0000000000a1')::text, '1');
  perform pg_temp.chk('T1_day', pg_temp.evdays('7e000000-0000-4000-8000-0000000000a1'), '2035-01-01');
end
$t$;

-- ---------------------------------------------------------------------------
-- T2 — commande + articles dans la MÊME transaction : aucune invalidation doublée
-- ---------------------------------------------------------------------------
do $t$
declare v_id uuid := gen_random_uuid();
begin
  perform pg_temp.clear_ev();
  insert into public.orders (id, store_id, status, order_date, subtotal_amount, discount_amount,
    delivery_charge_to_customer, rounding_adjustment, total_selling_price, delivery_fee,
    discount_type, discount_value, city, customer_name, source)
  values (v_id, '7e000000-0000-4000-8000-0000000000a1', 'new',
          timestamptz '2035-01-01 11:00:00+00', 0,0,0,0,0,0,'fixed',0,'Rabat','T2','organic');
  insert into public.order_items (store_id, order_id, product_id, quantity,
    unit_selling_price, unit_purchase_cost_snapshot, item_type)
  values ('7e000000-0000-4000-8000-0000000000a1', v_id, '7e000000-0000-4000-8000-0000000000b1',
          1, 100.00, 40.00, 'main');
  perform pg_temp.chk('T2_events_same_tx', pg_temp.ev('7e000000-0000-4000-8000-0000000000a1')::text, '1');
end
$t$;

-- ---------------------------------------------------------------------------
-- T3 — commande puis articles dans des transactions SÉPARÉES
-- ---------------------------------------------------------------------------
do $t$
begin
  perform pg_temp.clear_ev();
  insert into public.orders (id, store_id, status, order_date, subtotal_amount, discount_amount,
    delivery_charge_to_customer, rounding_adjustment, total_selling_price, delivery_fee,
    discount_type, discount_value, city, customer_name, source)
  values ('7e000000-0000-4000-8000-0000000000d3', '7e000000-0000-4000-8000-0000000000a1', 'new',
          timestamptz '2035-01-01 12:00:00+00', 0,0,0,0,0,0,'fixed',0,'Rabat','T3','organic');
  perform pg_temp.chk('T3a_order_tx_events', pg_temp.ev('7e000000-0000-4000-8000-0000000000a1')::text, '1');
end
$t$;

do $t$
begin
  insert into public.order_items (store_id, order_id, product_id, quantity,
    unit_selling_price, unit_purchase_cost_snapshot, item_type)
  values ('7e000000-0000-4000-8000-0000000000a1', '7e000000-0000-4000-8000-0000000000d3',
          '7e000000-0000-4000-8000-0000000000b1', 1, 100.00, 40.00, 'main'),
         ('7e000000-0000-4000-8000-0000000000a1', '7e000000-0000-4000-8000-0000000000d3',
          '7e000000-0000-4000-8000-0000000000b1', 2, 200.00, 50.00, 'main');
  perform pg_temp.chk('T3b_item_tx_events', pg_temp.ev('7e000000-0000-4000-8000-0000000000a1')::text, '2');
end
$t$;

-- ---------------------------------------------------------------------------
-- T4 — import ensembliste de 600 commandes : UNE clé, pas 1 200 candidats
-- ---------------------------------------------------------------------------
do $t$
begin
  perform pg_temp.clear_ev();
  insert into public.orders (id, store_id, status, order_date, subtotal_amount, discount_amount,
    delivery_charge_to_customer, rounding_adjustment, total_selling_price, delivery_fee,
    discount_type, discount_value, city, customer_name, source)
  select gen_random_uuid(), '7e000000-0000-4000-8000-0000000000a1', 'new',
         timestamptz '2035-01-02 10:00:00+00' + (g % 60) * interval '1 minute',
         0,0,0,0,0,0,'fixed',0,'Rabat','T4 ' || g, 'organic'
    from generate_series(1, 600) g;
  perform pg_temp.chk('T4_import600_events', pg_temp.ev('7e000000-0000-4000-8000-0000000000a1')::text, '1');
  perform pg_temp.chk('T4_import600_day', pg_temp.evdays('7e000000-0000-4000-8000-0000000000a1'), '2035-01-02');
end
$t$;

-- ---------------------------------------------------------------------------
-- T5 — article : prix (pertinent) vs colonne non consommée (non pertinent)
-- Chaque sous-test est une transaction distincte : le marqueur de journée est
-- volontairement limité à la transaction.
-- ---------------------------------------------------------------------------
DO $t$
declare v_item uuid;
begin
  select oi.id into v_item from public.order_items oi
   where oi.order_id = '7e000000-0000-4000-8000-0000000000d3' order by oi.id limit 1;
  perform pg_temp.clear_ev();
  update public.order_items set unit_selling_price = 111.00 where id = v_item;
  perform pg_temp.chk('T5a_item_price_events', pg_temp.ev('7e000000-0000-4000-8000-0000000000a1')::text, '1');
end
$t$;

DO $t$
declare v_item uuid;
begin
  select oi.id into v_item from public.order_items oi
   where oi.order_id = '7e000000-0000-4000-8000-0000000000d3' order by oi.id limit 1;
  perform pg_temp.clear_ev();
  update public.order_items set item_type = 'upsell' where id = v_item;
  perform pg_temp.chk('T5b_item_irrelevant_events', pg_temp.ev('7e000000-0000-4000-8000-0000000000a1')::text, '0');
end
$t$;

DO $t$
declare v_item uuid;
begin
  select oi.id into v_item from public.order_items oi
   where oi.order_id = '7e000000-0000-4000-8000-0000000000d3' order by oi.id limit 1;
  perform pg_temp.clear_ev();
  update public.order_items set unit_purchase_cost_snapshot = 44.00 where id = v_item;
  perform pg_temp.chk('T5c_item_cost_events', pg_temp.ev('7e000000-0000-4000-8000-0000000000a1')::text, '1');
end
$t$;


-- ---------------------------------------------------------------------------
-- T6 — article : suppression et déplacement de parent (jours distincts)
-- ---------------------------------------------------------------------------
DO $t$
declare v_item uuid; v_other uuid;
begin
  select oi.id into v_item from public.order_items oi
   where oi.order_id = '7e000000-0000-4000-8000-0000000000d3' order by oi.id limit 1;

  insert into public.orders (id, store_id, status, order_date, subtotal_amount, discount_amount,
    delivery_charge_to_customer, rounding_adjustment, total_selling_price, delivery_fee,
    discount_type, discount_value, city, customer_name, source)
  values ('7e000000-0000-4000-8000-0000000000d6', '7e000000-0000-4000-8000-0000000000a1', 'new',
          timestamptz '2035-01-03 10:00:00+00', 0,0,0,0,0,0,'fixed',0,'Rabat','T6 cible','organic');
  v_other := '7e000000-0000-4000-8000-0000000000d6';

  perform pg_temp.clear_ev();
  update public.order_items set order_id = v_other where id = v_item;
  perform pg_temp.chk('T6a_parent_move_events', pg_temp.ev('7e000000-0000-4000-8000-0000000000a1')::text, '2');
end
$t$;

DO $t$
declare v_item uuid;
begin
  select oi.id into v_item from public.order_items oi
   where oi.order_id = '7e000000-0000-4000-8000-0000000000d6' order by oi.id limit 1;
  perform pg_temp.clear_ev();
  delete from public.order_items where id = v_item;
  perform pg_temp.chk('T6b_item_delete_events', pg_temp.ev('7e000000-0000-4000-8000-0000000000a1')::text, '1');
end
$t$;

-- ---------------------------------------------------------------------------
-- T7 — commande : statut (pertinent) vs nom client (non pertinent)
-- ---------------------------------------------------------------------------
DO $t$
begin
  perform pg_temp.clear_ev();
  update public.orders set status = 'confirmed'
   where id = '7e000000-0000-4000-8000-0000000000d6';
  perform pg_temp.chk('T7a_status_events', pg_temp.ev('7e000000-0000-4000-8000-0000000000a1')::text, '1');

  perform pg_temp.clear_ev();
  update public.orders set customer_name = 'T7 renomme'
   where id = '7e000000-0000-4000-8000-0000000000d6';
  perform pg_temp.chk('T7b_irrelevant_events', pg_temp.ev('7e000000-0000-4000-8000-0000000000a1')::text, '0');
end
$t$;

-- ---------------------------------------------------------------------------
-- T8 — commande : déplacement de date => ancienne ET nouvelle journée
-- ---------------------------------------------------------------------------
DO $t$
begin
  perform pg_temp.clear_ev();
  update public.orders set order_date = timestamptz '2035-01-04 10:00:00+00'
   where id = '7e000000-0000-4000-8000-0000000000d6';
  perform pg_temp.chk('T8_date_move_events', pg_temp.ev('7e000000-0000-4000-8000-0000000000a1')::text, '2');
  perform pg_temp.chk('T8_date_move_days', pg_temp.evdays('7e000000-0000-4000-8000-0000000000a1'), '2035-01-03,2035-01-04');
end
$t$;

-- ---------------------------------------------------------------------------
-- T9 — commande : changement de boutique => une clé par boutique
-- ---------------------------------------------------------------------------
DO $t$
begin
  perform pg_temp.clear_ev();
  update public.orders set store_id = '7e000000-0000-4000-8000-0000000000a2'
   where id = '7e000000-0000-4000-8000-0000000000d6';
  perform pg_temp.chk('T9_store_move_a1', pg_temp.ev('7e000000-0000-4000-8000-0000000000a1')::text, '1');
  perform pg_temp.chk('T9_store_move_a2', pg_temp.ev('7e000000-0000-4000-8000-0000000000a2')::text, '1');
end
$t$;

-- ---------------------------------------------------------------------------
-- T10 — déplacement vers une boutique NON capturée : seule l'ancienne est notifiée
-- ---------------------------------------------------------------------------
DO $t$
begin
  -- Remise en état : d6 revient dans a1 tant que a2 est encore capturée.
  update public.orders set store_id = '7e000000-0000-4000-8000-0000000000a1'
   where id = '7e000000-0000-4000-8000-0000000000d6';
  perform public.dashboard_kpi_producer_disable_store('7e000000-0000-4000-8000-0000000000a2'::uuid, 'T10');
  -- La nouvelle session doit relire la configuration : le cache est transactionnel.
  perform pg_temp.clear_ev();
end
$t$;

DO $t$
begin
  update public.orders set store_id = '7e000000-0000-4000-8000-0000000000a2'
   where id = '7e000000-0000-4000-8000-0000000000d6';
  perform pg_temp.chk('T10_move_to_disabled_a1', pg_temp.ev('7e000000-0000-4000-8000-0000000000a1')::text, '1');
  perform pg_temp.chk('T10_move_to_disabled_a2', pg_temp.ev('7e000000-0000-4000-8000-0000000000a2')::text, '0');
end
$t$;

-- ---------------------------------------------------------------------------
-- T11 — publicité : montant (pertinent) vs impressions (non consommées)
-- ---------------------------------------------------------------------------
DO $t$
begin
  perform pg_temp.clear_ev();
  insert into public.ad_spend_daily (id, store_id, spend_date, platform, spend, spend_converted)
  values (gen_random_uuid(), '7e000000-0000-4000-8000-0000000000a1',
          timestamptz '2035-01-02 12:00:00+00', 'facebook', 50.00, 50.00);
  perform pg_temp.chk('T11a_ad_insert_events', pg_temp.ev('7e000000-0000-4000-8000-0000000000a1')::text, '1');
end
$t$;

DO $t$
begin
  perform pg_temp.clear_ev();
  update public.ad_spend_daily set spend = 60.00
   where store_id = '7e000000-0000-4000-8000-0000000000a1';
  perform pg_temp.chk('T11b_ad_amount_events', pg_temp.ev('7e000000-0000-4000-8000-0000000000a1')::text, '1');
end
$t$;

DO $t$
begin
  perform pg_temp.clear_ev();
  update public.ad_spend_daily set impressions = 1234
   where store_id = '7e000000-0000-4000-8000-0000000000a1';
  perform pg_temp.chk('T11c_ad_irrelevant_events', pg_temp.ev('7e000000-0000-4000-8000-0000000000a1')::text, '0');
end
$t$;

-- ---------------------------------------------------------------------------
-- T12 — suppression de commande
-- ---------------------------------------------------------------------------
DO $t$
begin
  perform pg_temp.clear_ev();
  delete from public.orders where id = '7e000000-0000-4000-8000-0000000000d3';
  perform pg_temp.chk('T12_order_delete_events', pg_temp.ev('7e000000-0000-4000-8000-0000000000a1')::text, '1');
end
$t$;

-- ---------------------------------------------------------------------------
-- T13 — capture DÉSARMÉE : aucun travail, aucune invalidation
-- ---------------------------------------------------------------------------
DO $t$
begin
  perform public.dashboard_kpi_producer_arm(false);
end
$t$;

DO $t$
declare v_item uuid;
begin
  perform pg_temp.clear_ev();
  insert into public.orders (id, store_id, status, order_date, subtotal_amount, discount_amount,
    delivery_charge_to_customer, rounding_adjustment, total_selling_price, delivery_fee,
    discount_type, discount_value, city, customer_name, source)
  values (gen_random_uuid(), '7e000000-0000-4000-8000-0000000000a1', 'new',
          timestamptz '2035-01-05 10:00:00+00', 0,0,0,0,0,0,'fixed',0,'Rabat','T13','organic');
  select oi.id into v_item from public.order_items oi
   where oi.order_id = '7e000000-0000-4000-8000-0000000000d3' order by oi.id limit 1;
  update public.order_items set unit_selling_price = 222.00 where id = v_item;
  perform pg_temp.chk('T13_disarmed_events', pg_temp.ev('7e000000-0000-4000-8000-0000000000a1')::text, '0');
  perform public.dashboard_kpi_producer_arm(true);
end
$t$;

-- ---------------------------------------------------------------------------
-- T14 — boutique désactivée : aucune invalidation pour elle, les autres continuent
-- ---------------------------------------------------------------------------
DO $t$
begin
  perform pg_temp.clear_ev();
end
$t$;

DO $t$
begin
  insert into public.orders (id, store_id, status, order_date, subtotal_amount, discount_amount,
    delivery_charge_to_customer, rounding_adjustment, total_selling_price, delivery_fee,
    discount_type, discount_value, city, customer_name, source)
  values (gen_random_uuid(), '7e000000-0000-4000-8000-0000000000a2', 'new',
          timestamptz '2035-01-05 11:00:00+00', 0,0,0,0,0,0,'fixed',0,'Rabat','T14 b','organic');
  insert into public.orders (id, store_id, status, order_date, subtotal_amount, discount_amount,
    delivery_charge_to_customer, rounding_adjustment, total_selling_price, delivery_fee,
    discount_type, discount_value, city, customer_name, source)
  values (gen_random_uuid(), '7e000000-0000-4000-8000-0000000000a1', 'new',
          timestamptz '2035-01-05 11:30:00+00', 0,0,0,0,0,0,'fixed',0,'Rabat','T14 a','organic');
  perform pg_temp.chk('T14_disabled_store_events', pg_temp.ev('7e000000-0000-4000-8000-0000000000a2')::text, '0');
  perform pg_temp.chk('T14_enabled_store_events', pg_temp.ev('7e000000-0000-4000-8000-0000000000a1')::text, '1');
end
$t$;

-- ---------------------------------------------------------------------------
-- T15 — reprise après interruption de collecte : rattrapage obligatoire
-- ---------------------------------------------------------------------------
DO $t$
declare v jsonb;
begin
  perform pg_temp.clear_ev();
  v := public.dashboard_kpi_producer_enable_store('7e000000-0000-4000-8000-0000000000a2'::uuid, null, 'T15 reprise');
  perform pg_temp.chk('T15_resume_enabled', (v->>'enabled'), 'true');
  perform pg_temp.chk('T15_resume_gap_present', ((v->>'gap_from') is not null)::text, 'true');
  perform pg_temp.chk('T15_resume_events_positive',
    (pg_temp.ev('7e000000-0000-4000-8000-0000000000a2') > 0)::text, 'true');
  perform pg_temp.chk('T15_resume_reason',
    (select count(*) from public.dashboard_kpi_invalidation
      where store_id = '7e000000-0000-4000-8000-0000000000a2'
        and reason like 'capture:resume:%')::text, '1');
end
$t$;

-- ---------------------------------------------------------------------------
-- T16 — frontières Casablanca : avant/après le correctif IANA 2026c
-- ---------------------------------------------------------------------------
DO $t$
begin
  perform pg_temp.clear_ev();
  insert into public.orders (id, store_id, status, order_date, subtotal_amount, discount_amount,
    delivery_charge_to_customer, rounding_adjustment, total_selling_price, delivery_fee,
    discount_type, discount_value, city, customer_name, source)
  values (gen_random_uuid(), '7e000000-0000-4000-8000-0000000000a1', 'new',
          timestamptz '2026-10-22 22:59:00+00', 0,0,0,0,0,0,'fixed',0,'Rabat','T16 a','organic');
  perform pg_temp.chk('T16a_2359_local', pg_temp.evdays('7e000000-0000-4000-8000-0000000000a1'), '2026-10-22');

  perform pg_temp.clear_ev();
  insert into public.orders (id, store_id, status, order_date, subtotal_amount, discount_amount,
    delivery_charge_to_customer, rounding_adjustment, total_selling_price, delivery_fee,
    discount_type, discount_value, city, customer_name, source)
  values (gen_random_uuid(), '7e000000-0000-4000-8000-0000000000a1', 'new',
          timestamptz '2026-10-23 00:00:01+00', 0,0,0,0,0,0,'fixed',0,'Rabat','T16 b','organic');
  perform pg_temp.chk('T16b_0001_local', pg_temp.evdays('7e000000-0000-4000-8000-0000000000a1'), '2026-10-23');

  perform pg_temp.clear_ev();
  insert into public.orders (id, store_id, status, order_date, subtotal_amount, discount_amount,
    delivery_charge_to_customer, rounding_adjustment, total_selling_price, delivery_fee,
    discount_type, discount_value, city, customer_name, source)
  values (gen_random_uuid(), '7e000000-0000-4000-8000-0000000000a1', 'new',
          timestamptz '2026-09-19 23:30:00+00', 0,0,0,0,0,0,'fixed',0,'Rabat','T16 c','organic');
  perform pg_temp.chk('T16c_pre_patch_offset', pg_temp.evdays('7e000000-0000-4000-8000-0000000000a1'), '2026-09-20');
end
$t$;

-- ---------------------------------------------------------------------------
-- T17 — bout en bout : journal -> worker -> agrégat identique au calcul direct
-- ---------------------------------------------------------------------------
DO $t$
declare
  v_id uuid := gen_random_uuid();
  v_agg record; v_dir record;
begin
  perform pg_temp.clear_ev();
  insert into public.orders (id, store_id, status, order_date, delivered_at, subtotal_amount,
    discount_amount, delivery_charge_to_customer, rounding_adjustment, total_selling_price,
    delivery_fee, discount_type, discount_value, city, customer_name, source)
  values (v_id, '7e000000-0000-4000-8000-0000000000a1', 'delivered',
          timestamptz '2035-01-06 12:00:00+00', timestamptz '2035-01-06 18:00:00+00',
          0,0,0,0,0,15.00,'fixed',0,'Rabat','T17','organic');
  insert into public.order_items (store_id, order_id, product_id, quantity,
    unit_selling_price, unit_purchase_cost_snapshot, item_type)
  values ('7e000000-0000-4000-8000-0000000000a1', v_id, '7e000000-0000-4000-8000-0000000000b1', 1, 100.00, 40.00, 'main'),
         ('7e000000-0000-4000-8000-0000000000a1', v_id, '7e000000-0000-4000-8000-0000000000b1', 2, 200.00, 50.00, 'main');

  update public.dashboard_kpi_worker_config set enabled = true where id = 1;
  perform public.dashboard_kpi_worker_run('p710-tests', 50, 10000, 30.0);
  update public.dashboard_kpi_worker_config set enabled = false where id = 1;

  select m.revenue_items_gross, m.orders_count, m.delivered_count, m.purchase_cost
    into v_agg
    from public.dashboard_daily_metrics m
   where m.store_id = '7e000000-0000-4000-8000-0000000000a1'
     and m.business_date = '2035-01-06' and m.axis = 'order';
  select d.revenue_items_gross, d.orders_count, d.delivered_count, d.purchase_cost
    into v_dir
    from public.dashboard_kpi_direct_day('7e000000-0000-4000-8000-0000000000a1',
           '2035-01-06', 'Africa/Casablanca') d;

  perform pg_temp.chk('T17a_revenue', coalesce(v_agg.revenue_items_gross::text,'<null>'), coalesce(v_dir.revenue_items_gross::text,'<null>'));
  perform pg_temp.chk('T17b_orders', coalesce(v_agg.orders_count::text,'<null>'), coalesce(v_dir.orders_count::text,'<null>'));
  perform pg_temp.chk('T17c_delivered', coalesce(v_agg.delivered_count::text,'<null>'), coalesce(v_dir.delivered_count::text,'<null>'));
  perform pg_temp.chk('T17d_purchase', coalesce(v_agg.purchase_cost::text,'<null>'), coalesce(v_dir.purchase_cost::text,'<null>'));
  perform pg_temp.chk('T17e_revenue_value', coalesce(v_agg.revenue_items_gross::text,'<null>'), '500.00');
end
$t$;

-- ---------------------------------------------------------------------------
-- Résultat
-- ---------------------------------------------------------------------------
select label, case when ok then 'PASS' else 'FAIL' end as status, detail
  from _r order by label;

do $t$
declare n int; total int;
begin
  select count(*), count(*) filter (where not ok) into total, n from _r;
  if n > 0 then
    raise exception 'P710_TESTS_FAILED : % echec(s) sur %', n, total;
  end if;
  raise notice 'P710_TESTS_PASS : % controles', total;
end
$t$;

-- ---------------------------------------------------------------------------
-- Nettoyage (aucun résidu de fixtures)
-- ---------------------------------------------------------------------------
do $t$
begin
  perform public.dashboard_kpi_producer_disable_store('7e000000-0000-4000-8000-0000000000a1'::uuid, 'cleanup');
  perform public.dashboard_kpi_producer_disable_store('7e000000-0000-4000-8000-0000000000a2'::uuid, 'cleanup');
  perform public.dashboard_kpi_producer_arm(false);
  update public.dashboard_kpi_worker_config set enabled = false where id = 1;
  delete from public.dashboard_kpi_invalidation
   where store_id in ('7e000000-0000-4000-8000-0000000000a1'::uuid,
                      '7e000000-0000-4000-8000-0000000000a2'::uuid);
  delete from public.dashboard_daily_metrics
   where store_id in ('7e000000-0000-4000-8000-0000000000a1'::uuid,
                      '7e000000-0000-4000-8000-0000000000a2'::uuid);
  delete from public.ad_spend_daily
   where store_id in ('7e000000-0000-4000-8000-0000000000a1'::uuid,
                      '7e000000-0000-4000-8000-0000000000a2'::uuid);
  delete from public.order_items
   where store_id in ('7e000000-0000-4000-8000-0000000000a1'::uuid,
                      '7e000000-0000-4000-8000-0000000000a2'::uuid);
  delete from public.orders
   where store_id in ('7e000000-0000-4000-8000-0000000000a1'::uuid,
                      '7e000000-0000-4000-8000-0000000000a2'::uuid);
  delete from public.dashboard_kpi_store_state
   where store_id in ('7e000000-0000-4000-8000-0000000000a1'::uuid,
                      '7e000000-0000-4000-8000-0000000000a2'::uuid);
  delete from public.dashboard_kpi_producer_stores
   where store_id in ('7e000000-0000-4000-8000-0000000000a1'::uuid,
                      '7e000000-0000-4000-8000-0000000000a2'::uuid);
  delete from public.products
   where id in ('7e000000-0000-4000-8000-0000000000b1'::uuid,
                '7e000000-0000-4000-8000-0000000000b2'::uuid);
  delete from public.stores
   where id in ('7e000000-0000-4000-8000-0000000000a1'::uuid,
                '7e000000-0000-4000-8000-0000000000a2'::uuid);
end
$t$;

select 'residual_stores' as check, count(*)::text as value
  from public.stores where id::text like '7e000000-%'
union all select 'residual_events', count(*)::text
  from public.dashboard_kpi_invalidation where store_id::text like '7e000000-%';
