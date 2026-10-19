-- B13 — coalescence des INSERT par instruction.
-- Les triggers ligne existants sont conservés pour UPDATE/DELETE. Les INSERT
-- passent par une table de transition et une seule insertion groupée par
-- couple (store_id, business_date). Les deux axes et la déduplication
-- transactionnelle restent identiques.

create or replace function public.dashboard_kpi_invalidate_insert_stmt()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_tx bigint := txid_current();
begin
  if tg_table_name = 'orders' then
    insert into public.dashboard_kpi_invalidation (store_id, business_date, reason, note_tx)
    select distinct o.store_id, d.day, 'orders:INSERT:stmt', v_tx
    from new_rows o
    left join public.dashboard_kpi_store_state st on st.store_id = o.store_id
    cross join lateral (
      select (o.order_date at time zone coalesce(st.tz, 'Africa/Casablanca'))::date as day
      union all
      select (coalesce(o.delivered_at, o.order_date) at time zone coalesce(st.tz, 'Africa/Casablanca'))::date
    ) d
    where o.store_id is not null and d.day is not null
    on conflict do nothing;

  elsif tg_table_name = 'order_items' then
    insert into public.dashboard_kpi_invalidation (store_id, business_date, reason, note_tx)
    select distinct o.store_id, d.day, 'order_items:INSERT:stmt', v_tx
    from new_rows ni
    join public.orders o on o.id = ni.order_id
    left join public.dashboard_kpi_store_state st on st.store_id = o.store_id
    cross join lateral (
      select (o.order_date at time zone coalesce(st.tz, 'Africa/Casablanca'))::date as day
      union all
      select (coalesce(o.delivered_at, o.order_date) at time zone coalesce(st.tz, 'Africa/Casablanca'))::date
    ) d
    where o.store_id is not null and d.day is not null
    on conflict do nothing;

  elsif tg_table_name = 'ad_spend_daily' then
    insert into public.dashboard_kpi_invalidation (store_id, business_date, reason, note_tx)
    select distinct a.store_id,
           (a.spend_date at time zone coalesce(st.tz, 'Africa/Casablanca'))::date,
           'ad_spend_daily:INSERT:stmt', v_tx
    from new_rows a
    left join public.dashboard_kpi_store_state st on st.store_id = a.store_id
    where a.store_id is not null
    on conflict do nothing;
  end if;

  return null;
end;
$function$;

drop trigger if exists trg_kpi_invalidate_orders on public.orders;
create trigger trg_kpi_invalidate_orders
  after update or delete on public.orders
  for each row execute function public.dashboard_kpi_invalidate_trg();
create trigger trg_kpi_invalidate_orders_insert
  after insert on public.orders
  referencing new table as new_rows
  for each statement execute function public.dashboard_kpi_invalidate_insert_stmt();

drop trigger if exists trg_kpi_invalidate_order_items on public.order_items;
create trigger trg_kpi_invalidate_order_items
  after update or delete on public.order_items
  for each row execute function public.dashboard_kpi_invalidate_trg();
create trigger trg_kpi_invalidate_order_items_insert
  after insert on public.order_items
  referencing new table as new_rows
  for each statement execute function public.dashboard_kpi_invalidate_insert_stmt();

drop trigger if exists trg_kpi_invalidate_ad_spend on public.ad_spend_daily;
create trigger trg_kpi_invalidate_ad_spend
  after update or delete on public.ad_spend_daily
  for each row execute function public.dashboard_kpi_invalidate_trg();
create trigger trg_kpi_invalidate_ad_spend_insert
  after insert on public.ad_spend_daily
  referencing new table as new_rows
  for each statement execute function public.dashboard_kpi_invalidate_insert_stmt();
