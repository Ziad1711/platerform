-- P7.10 : fixtures de qualification (2 boutiques, capture armee).
\set ON_ERROR_STOP on
set client_min_messages = warning;

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

insert into public.stores (id, owner_user_id, name, currency, country)
select '7e000000-0000-4000-8000-0000000000a1'::uuid, p.id, 'P710 A', 'MAD', 'MA'
  from public.profiles p order by p.id limit 1
on conflict (id) do nothing;
insert into public.stores (id, owner_user_id, name, currency, country)
select '7e000000-0000-4000-8000-0000000000a2'::uuid, p.id, 'P710 B', 'MAD', 'MA'
  from public.profiles p order by p.id limit 1
on conflict (id) do nothing;
insert into public.products (id, store_id, name) values
  ('7e000000-0000-4000-8000-0000000000b1', '7e000000-0000-4000-8000-0000000000a1', 'P710 produit A'),
  ('7e000000-0000-4000-8000-0000000000b2', '7e000000-0000-4000-8000-0000000000a2', 'P710 produit B')
on conflict (id) do nothing;
insert into public.dashboard_kpi_store_state
  (store_id, tz, active_definition_version, coverage_from, coverage_to, backfill_state)
values
  ('7e000000-0000-4000-8000-0000000000a1', 'Africa/Casablanca', 1, '2035-01-01', '2035-01-10', 'idle'),
  ('7e000000-0000-4000-8000-0000000000a2', 'Africa/Casablanca', 1, '2035-01-01', '2035-01-10', 'idle')
on conflict (store_id) do update set tz = excluded.tz;

select public.dashboard_kpi_producer_arm(true);
select public.dashboard_kpi_producer_enable_store('7e000000-0000-4000-8000-0000000000a1'::uuid, null, 'qualif');
select public.dashboard_kpi_producer_enable_store('7e000000-0000-4000-8000-0000000000a2'::uuid, null, 'qualif');
update public.dashboard_kpi_worker_config set enabled = false where id = 1;
