-- Nettoyage complet des artefacts de mesure P7.10 sur B13.
\set ON_ERROR_STOP on
update public.dashboard_kpi_worker_config set enabled = false where id = 1;
select public.dashboard_kpi_producer_arm(false);
delete from public.dashboard_kpi_producer_stores where store_id in (
  '7f100000-0000-4000-8000-0000000000e1'::uuid,
  '7e000000-0000-4000-8000-0000000000a1'::uuid,
  '7e000000-0000-4000-8000-0000000000a2'::uuid);
delete from public.dashboard_kpi_invalidation where store_id in (
  '7f100000-0000-4000-8000-0000000000e1'::uuid,
  '7e000000-0000-4000-8000-0000000000a1'::uuid,
  '7e000000-0000-4000-8000-0000000000a2'::uuid);
delete from public.dashboard_daily_metrics where store_id in (
  '7f100000-0000-4000-8000-0000000000e1'::uuid,
  '7e000000-0000-4000-8000-0000000000a1'::uuid,
  '7e000000-0000-4000-8000-0000000000a2'::uuid);
delete from public.ad_spend_daily where store_id in (
  '7f100000-0000-4000-8000-0000000000e1'::uuid,
  '7e000000-0000-4000-8000-0000000000a1'::uuid,
  '7e000000-0000-4000-8000-0000000000a2'::uuid);
delete from public.order_items where store_id in (
  '7f100000-0000-4000-8000-0000000000e1'::uuid,
  '7e000000-0000-4000-8000-0000000000a1'::uuid,
  '7e000000-0000-4000-8000-0000000000a2'::uuid);
delete from public.orders where store_id in (
  '7f100000-0000-4000-8000-0000000000e1'::uuid,
  '7e000000-0000-4000-8000-0000000000a1'::uuid,
  '7e000000-0000-4000-8000-0000000000a2'::uuid);
delete from public.dashboard_kpi_store_state where store_id in (
  '7f100000-0000-4000-8000-0000000000e1'::uuid,
  '7e000000-0000-4000-8000-0000000000a1'::uuid,
  '7e000000-0000-4000-8000-0000000000a2'::uuid);
delete from public.products where id in (
  '7f100000-0000-4000-8000-0000000000e2'::uuid,
  '7e000000-0000-4000-8000-0000000000b1'::uuid,
  '7e000000-0000-4000-8000-0000000000b2'::uuid);
delete from public.stores where id in (
  '7f100000-0000-4000-8000-0000000000e1'::uuid,
  '7e000000-0000-4000-8000-0000000000a1'::uuid,
  '7e000000-0000-4000-8000-0000000000a2'::uuid);
delete from public.dashboard_kpi_worker_run where worker = 'p710-tests';
drop function if exists p710_update_item(int);
drop function if exists p710_import_orders(int, int);
drop function if exists p710_setup();
drop function if exists p710_reset();
drop function if exists p710_product();
drop function if exists p710_store();
drop function if exists public.p710_count_attempt();
drop table if exists public.p710_attempts;
drop function if exists public.p710_c0_invalidate_trg();
drop function if exists public.p710_c0_invalidate_insert_stmt();
drop function if exists public.p710_c0_quality_trg();
drop function if exists public.p710_c0_mark_order_insert();
