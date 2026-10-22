-- JISRA — P7.10 : mesure ciblée B13 (update_item_price, import_orders_600).
-- CIBLE UNIQUE : B13 isolé. Gardes : base postgres + aucune boutique sentinelle.
--   psql -X -w -v ON_ERROR_STOP=1 "service=b13-isolated" \
--        -v iters=100 -v rounds=20 -f bench.sql
\set ON_ERROR_STOP on
\pset pager off
set client_min_messages = warning;
set statement_timeout = '300s';

do $guard$
declare v_stores int; v_sent int;
begin
  if current_database() <> 'postgres' or current_user <> 'postgres' then
    raise exception 'P710_BENCH_IDENTITY';
  end if;
  select count(*) into v_sent from public.stores
   where id in ('d6bfa510-3411-e642-3bd4-1fdff95cbc25',
                '1a1bdb7f-999e-5321-e2d9-4c1409841338',
                '57d00a07-d6e8-218b-a45f-3b0d7d4d7a45',
                '6872472a-9f7c-ee2c-712a-9613ff65abf9',
                '8d8c39d2-c4a7-4810-e2da-2d25cfc595c3');
  if v_sent > 0 then raise exception 'P710_BENCH_SHARED_ENVIRONMENT'; end if;
  select count(*) into v_stores from public.stores;
  if v_stores > 20 then raise exception 'P710_BENCH_SHARED_ENVIRONMENT %', v_stores; end if;
  if to_regprocedure('public.dashboard_kpi_producer_arm(boolean)') is null then
    raise exception 'P710_BENCH_PATCH_MISSING';
  end if;
end
$guard$;

create or replace function p710_store() returns uuid language sql immutable
as $fn$ select '7f100000-0000-4000-8000-0000000000e1'::uuid $fn$;
create or replace function p710_product() returns uuid language sql immutable
as $fn$ select '7f100000-0000-4000-8000-0000000000e2'::uuid $fn$;

create or replace function p710_reset() returns void language plpgsql as $fn$
begin
  -- Ordre volontaire : les lignes métier d'abord (leurs triggers produisent des
  -- événements), le journal ensuite, pour ne laisser aucun résidu.
  delete from public.order_items where store_id = p710_store();
  delete from public.orders where store_id = p710_store();
  delete from public.dashboard_kpi_invalidation where store_id = p710_store();
  delete from public.dashboard_daily_metrics where store_id = p710_store();
  delete from public.dashboard_kpi_store_state where store_id = p710_store();
end
$fn$;

create or replace function p710_setup() returns void language plpgsql as $fn$
declare v_owner uuid;
begin
  select id into v_owner from public.profiles order by id limit 1;
  if v_owner is null then raise exception 'P710_BENCH_NO_PROFILE'; end if;
  insert into public.stores (id, owner_user_id, name, currency, country)
  values (p710_store(), v_owner, 'P7.10 bench', 'MAD', 'MA')
  on conflict (id) do nothing;
  insert into public.products (id, store_id, name)
  values (p710_product(), p710_store(), 'P7.10 bench produit')
  on conflict (id) do nothing;
  insert into public.dashboard_kpi_store_state
    (store_id, tz, active_definition_version, coverage_from, coverage_to, backfill_state)
  values (p710_store(), 'Africa/Casablanca', 1, '2035-01-01', '2035-02-05', 'idle')
  on conflict (store_id) do update set tz = excluded.tz;

  -- Base de travail : 100 commandes, 200 articles (une seule cible d'article).
  insert into public.orders (id, store_id, status, order_date, subtotal_amount, discount_amount,
    delivery_charge_to_customer, rounding_adjustment, total_selling_price, delivery_fee,
    discount_type, discount_value, city, customer_name, source)
  select gen_random_uuid(), p710_store(), 'new',
         timestamptz '2035-01-01 10:00:00+00' + (g % 20) * interval '1 minute',
         0,0,0,0,0,0,'fixed',0,'Rabat','bench ' || g, 'organic'
    from generate_series(1, 100) g;

  insert into public.order_items (store_id, order_id, product_id, quantity,
    unit_selling_price, unit_purchase_cost_snapshot, item_type)
  select p710_store(), t.id, p710_product(), 1, 100.00, 40.00, 'main'
    from (select id from public.orders where store_id = p710_store() order by id, order_date) t
   cross join (values (1),(2)) l(n);
end
$fn$;

-- Cible stable de la mise à jour d'article (comme le scénario historique).
create or replace function p710_update_item(p_i int) returns void language plpgsql as $fn$
declare v_id uuid;
begin
  select oi.id into v_id from public.order_items oi
   where oi.store_id = p710_store() order by oi.order_id, oi.id limit 1;
  if v_id is null then raise exception 'P710_BENCH_NO_ITEM'; end if;
  update public.order_items
     set unit_selling_price = case when p_i % 2 = 0 then 101.00 else 100.00 end
   where id = v_id;
end
$fn$;

create or replace function p710_import_orders(p_n int, p_day int) returns int language plpgsql as $fn$
begin
  insert into public.orders (id, store_id, status, order_date, subtotal_amount, discount_amount,
    delivery_charge_to_customer, rounding_adjustment, total_selling_price, delivery_fee,
    discount_type, discount_value, city, customer_name, source)
  select gen_random_uuid(), p710_store(), 'new',
         (date '2035-01-01' + p_day)::timestamptz + time '10:00' + (g % 60) * interval '1 minute',
         0,0,0,0,0,0,'fixed',0,'Rabat','bench import ' || p_n, 'organic'
    from generate_series(1, p_n) g;
  return p_n;
end
$fn$;

select p710_reset();
select p710_setup();
select public.dashboard_kpi_producer_arm(true);
select public.dashboard_kpi_producer_enable_store(p710_store(), null, 'bench');

\echo SECTION:update_item_price
\timing on
select format('select p710_update_item(%s);', g) from generate_series(1, :iters) g \gexec
\timing off

\echo SECTION:import_orders_600
\timing on
select format('select p710_import_orders(%s, 2);', :large) from generate_series(1, :rounds) g \gexec
\timing off

\echo SECTION:summary
select 'events' as metric, count(*)::text as value
  from public.dashboard_kpi_invalidation where store_id = p710_store()
union all
select 'orders', count(*)::text from public.orders where store_id = p710_store()
union all
select 'items', count(*)::text from public.order_items where store_id = p710_store();

select p710_reset();
