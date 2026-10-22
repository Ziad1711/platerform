-- P7.10 : helpers de qualification concurrente (B13 uniquement).
\set ON_ERROR_STOP on
create or replace function p710_reset_ev() returns void language plpgsql as $fn$
begin
  delete from public.dashboard_kpi_invalidation where store_id::text like '7e000000-%';
end $fn$;

create or replace function p710_mk_order(p_store uuid, p_day date, p_name text) returns uuid
language plpgsql as $fn$
declare v_id uuid := gen_random_uuid();
begin
  insert into public.orders (id, store_id, status, order_date, subtotal_amount, discount_amount,
    delivery_charge_to_customer, rounding_adjustment, total_selling_price, delivery_fee,
    discount_type, discount_value, city, customer_name, source)
  values (v_id, p_store, 'new', (p_day::timestamp + time '12:00') at time zone 'UTC',
          0,0,0,0,0,0,'fixed',0,'Rabat',p_name,'organic');
  return v_id;
end $fn$;

create or replace function p710_pending(p_store uuid, p_day date) returns bigint language sql as
$fn$ select count(*) from public.dashboard_kpi_invalidation
      where store_id = p_store and business_date = p_day and processed_at is null $fn$;

create or replace function p710_pending_total() returns bigint language sql as
$fn$ select count(*) from public.dashboard_kpi_invalidation
      where store_id::text like '7e000000-%' and processed_at is null $fn$;

create or replace function p710_agg(p_store uuid, p_day date) returns text language sql as
$fn$ select coalesce((select m.orders_count::text from public.dashboard_daily_metrics m
      where m.store_id = p_store and m.business_date = p_day and m.axis = 'order'), 'ABSENT') $fn$;

create or replace function p710_deadlocks() returns bigint language sql as
$fn$ select coalesce(sum(deadlocks),0)::bigint from pg_stat_database where datname = current_database() $fn$;

-- Cycle complet volontairement lent : laisse une fenetre aux ecritures concurrentes
-- entre le claim et l'acquittement.
create or replace function p710_cycle_slow(p_delay numeric default 3) returns jsonb
language plpgsql as $fn$
declare c record;
begin
  select * into c from public.dashboard_kpi_claim(5, 'qualif') limit 1;
  if c.r_token is null then
    return jsonb_build_object('claimed', false);
  end if;
  perform pg_sleep(greatest(p_delay, 0));
  perform public.dashboard_kpi_rebuild_day(c.r_store_id, c.r_business_date, c.r_token, c.r_seqs);
  return jsonb_build_object('claimed', true, 'store', c.r_store_id,
    'day', c.r_business_date, 'events', coalesce(array_length(c.r_seqs,1),0));
end $fn$;

create or replace function p710_write_one(p_store uuid, p_day date, p_i int) returns void
language plpgsql as $fn$
declare v_id uuid;
begin
  select o.id into v_id from public.orders o
   where o.store_id = p_store and o.order_date >= (p_day::timestamp at time zone 'UTC')
     and o.order_date < ((p_day + 1)::timestamp at time zone 'UTC')
   order by o.id limit 1;
  if v_id is null then raise exception 'P710_NO_ORDER'; end if;
  update public.orders set status = case when p_i % 2 = 0 then 'confirmed' else 'new' end
   where id = v_id;
end $fn$;

create or replace function p710_bulk(p_store uuid, p_day date, p_n int, p_tag text) returns int
language plpgsql as $fn$
begin
  insert into public.orders (id, store_id, status, order_date, subtotal_amount, discount_amount,
    delivery_charge_to_customer, rounding_adjustment, total_selling_price, delivery_fee,
    discount_type, discount_value, city, customer_name, source)
  select gen_random_uuid(), p_store, 'new', (p_day::timestamp + time '13:00') at time zone 'UTC',
         0,0,0,0,0,0,'fixed',0,'Rabat',p_tag || ' ' || g, 'organic'
    from generate_series(1, p_n) g;
  return p_n;
end $fn$;

create or replace function p710_drain(p_max int default 40) returns int
language plpgsql as $fn$
declare c record; n int := 0;
begin
  loop
    select * into c from public.dashboard_kpi_claim(5, 'drain') limit 1;
    exit when c.r_token is null or n >= p_max;
    perform public.dashboard_kpi_rebuild_day(c.r_store_id, c.r_business_date, c.r_token, c.r_seqs);
    n := n + 1;
  end loop;
  return n;
end $fn$;

-- Temps SERVEUR d'une mutation d'article, triggers compris, hors reseau/commit.
create or replace function p710_server_series(p_store uuid, p_n int) returns text
language plpgsql as $fn$
declare v_out text := ''; v_ms numeric; r record; i int; v_item uuid;
begin
  select oi.id into v_item from public.order_items oi
   where oi.store_id = p_store order by oi.order_id, oi.id limit 1;
  if v_item is null then raise exception 'P710_NO_ITEM'; end if;
  for i in 1..p_n loop
    for r in execute format(
      'explain (analyze, format json) update public.order_items set unit_selling_price = %s where id = %L',
      (case when i % 2 = 0 then 101.00 else 100.00 end), v_item)
    loop
      v_ms := ((r."QUERY PLAN")::json -> 0 ->> 'Execution Time')::numeric;
    end loop;
    v_out := v_out || case when v_out = '' then '' else ',' end || v_ms::text;
  end loop;
  return v_out;
end $fn$;
