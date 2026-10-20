\set ON_ERROR_STOP on
begin;
insert into public.stores (id, owner_user_id, name, currency, country) values
 ('7f000000-0000-4000-8000-0000000000f1','c45355f3-6ab5-4dda-8861-d52e283bf163','C0T1','MAD','MA'),
 ('7f000000-0000-4000-8000-0000000000f2','c45355f3-6ab5-4dda-8861-d52e283bf163','C0T2','MAD','MA');
insert into public.orders (id, store_id, status, order_date, delivered_at, subtotal_amount, discount_amount, delivery_charge_to_customer, rounding_adjustment, total_selling_price, discount_type, discount_value, customer_name, source) values
 ('7f000000-0000-4000-8000-0000000000c1','7f000000-0000-4000-8000-0000000000f1','new',(date '2000-01-10'::timestamp at time zone 'Africa/Casablanca'),null,0,0,0,0,0,'fixed',0,'C0','organic'),
 ('7f000000-0000-4000-8000-0000000000c2','7f000000-0000-4000-8000-0000000000f1','new',(date '2000-01-10'::timestamp at time zone 'Africa/Casablanca'),((date '2000-01-10'::timestamp at time zone 'Africa/Casablanca')+interval '15 hours'),0,0,0,0,0,'fixed',0,'C0','organic'),
 ('7f000000-0000-4000-8000-0000000000c3','7f000000-0000-4000-8000-0000000000f1','new',((date '2000-01-10'::timestamp at time zone 'Africa/Casablanca')+interval '23 hours 59 minutes 59 seconds'),(date '2000-01-11'::timestamp at time zone 'Africa/Casablanca'),0,0,0,0,0,'fixed',0,'C0','organic'),
 ('7f000000-0000-4000-8000-0000000000c4','7f000000-0000-4000-8000-0000000000f2','new',(date '2000-01-11'::timestamp at time zone 'Africa/Casablanca'),null,0,0,0,0,0,'fixed',0,'C0','organic'),
 ('7f000000-0000-4000-8000-0000000000c5','7f000000-0000-4000-8000-0000000000f2','new',((date '2000-01-11'::timestamp at time zone 'Africa/Casablanca')+interval '1 second'),((date '2000-01-11'::timestamp at time zone 'Africa/Casablanca')+interval '1 second'),0,0,0,0,0,'fixed',0,'C0','organic');
select store_id||'|'||business_date||'|'||reason from public.dashboard_kpi_invalidation where note_tx=txid_current() order by 1;
rollback;
