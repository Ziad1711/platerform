create or replace function public.dashboard_kpi_invalidate_insert_stmt()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare v_tx bigint := txid_current();
begin
  if tg_table_name = 'orders' then
    insert into public.dashboard_kpi_invalidation (store_id, business_date, reason, note_tx)
    select o.store_id, dd.d, 'orders:INSERT:stmt', v_tx
    from (
      select o.store_id,
             (o.order_date at time zone coalesce(st.tz, 'Africa/Casablanca'))::date as d1,
             (coalesce(o.delivered_at, o.order_date) at time zone coalesce(st.tz, 'Africa/Casablanca'))::date as d2
        from new_rows o
        left join public.dashboard_kpi_store_state st on st.store_id = o.store_id
       where o.store_id is not null
    ) o
    cross join lateral (values (o.d1, 1), (o.d2, 2)) as dd(d, k)
    where dd.d is not null
      and (dd.k = 1 or o.d2 is distinct from o.d1)
    on conflict do nothing;
    elsif tg_table_name = 'order_items' then
    insert into public.dashboard_kpi_invalidation (store_id, business_date, reason, note_tx)
    select o.store_id,
           (o.order_date at time zone coalesce(st.tz, 'Africa/Casablanca'))::date,
           'order_items:INSERT:stmt', v_tx
    from new_rows ni
    join public.orders o on o.id = ni.order_id
    left join public.dashboard_kpi_store_state st on st.store_id = o.store_id
    where o.store_id is not null
    union all
    select o.store_id,
           (coalesce(o.delivered_at, o.order_date) at time zone coalesce(st.tz, 'Africa/Casablanca'))::date,
           'order_items:INSERT:stmt', v_tx
    from new_rows ni
    join public.orders o on o.id = ni.order_id
    left join public.dashboard_kpi_store_state st on st.store_id = o.store_id
    where o.store_id is not null
    on conflict do nothing;
  elsif tg_table_name = 'ad_spend_daily' then
    insert into public.dashboard_kpi_invalidation (store_id, business_date, reason, note_tx)
    select a.store_id,
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


revoke all on function public.dashboard_kpi_invalidate_insert_stmt() from public, anon, authenticated;
grant execute on function public.dashboard_kpi_invalidate_insert_stmt() to service_role;
