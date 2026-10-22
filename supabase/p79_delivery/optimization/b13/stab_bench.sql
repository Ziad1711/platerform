-- P7.10 : banc de stabilite (client + serveur), fixtures autonomes.
\set ON_ERROR_STOP on
\pset pager off
set client_min_messages = warning;
set statement_timeout = '240s';

delete from public.order_items where store_id = '7e000000-0000-4000-8000-0000000000a1';
delete from public.orders where store_id = '7e000000-0000-4000-8000-0000000000a1';
delete from public.dashboard_kpi_invalidation where store_id = '7e000000-0000-4000-8000-0000000000a1';
delete from public.dashboard_daily_metrics where store_id = '7e000000-0000-4000-8000-0000000000a1';

insert into public.orders (id, store_id, status, order_date, subtotal_amount, discount_amount,
  delivery_charge_to_customer, rounding_adjustment, total_selling_price, delivery_fee,
  discount_type, discount_value, city, customer_name, source)
values ('7e000000-0000-4000-8000-0000000000d1', '7e000000-0000-4000-8000-0000000000a1', 'new',
        timestamptz '2035-05-01 10:00:00+00', 0,0,0,0,0,0,'fixed',0,'Rabat','stab','organic');
insert into public.order_items (id, store_id, order_id, product_id, quantity,
  unit_selling_price, unit_purchase_cost_snapshot, item_type)
values ('7e000000-0000-4000-8000-0000000000c1', '7e000000-0000-4000-8000-0000000000a1',
        '7e000000-0000-4000-8000-0000000000d1', '7e000000-0000-4000-8000-0000000000b1', 1,
        100.00, 40.00, 'main');

select public.dashboard_kpi_producer_arm(true);
select public.dashboard_kpi_producer_enable_store('7e000000-0000-4000-8000-0000000000a1'::uuid, null, 'stab');

\echo SECTION:client_item_update
\timing on
select format('update public.order_items set unit_selling_price = case when %s %% 2 = 0 then 101.00 else 100.00 end where id = ''7e000000-0000-4000-8000-0000000000c1'';', g)
  from generate_series(1, :iters) g \gexec
\timing off

\echo SECTION:server_series
select p710_server_series('7e000000-0000-4000-8000-0000000000a1'::uuid, :iters) as series;

delete from public.order_items where store_id = '7e000000-0000-4000-8000-0000000000a1';
delete from public.orders where store_id = '7e000000-0000-4000-8000-0000000000a1';
delete from public.dashboard_kpi_invalidation where store_id = '7e000000-0000-4000-8000-0000000000a1';
delete from public.dashboard_daily_metrics where store_id = '7e000000-0000-4000-8000-0000000000a1';
