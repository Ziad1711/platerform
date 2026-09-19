begin;

-- Repartition des commandes par jour de semaine et par heure (fuseau du profil).
-- Utilise order_date (date metier de la commande) et le fuseau passe en parametre.
create or replace function public.rpc_dashboard_order_time_performance(
  p_store_ids uuid[],
  p_start_date timestamptz default null,
  p_end_date timestamptz default null,
  p_timezone text default 'Africa/Casablanca'
)
returns table (
  week_day int,
  hour_of_day int,
  orders_count bigint,
  confirmed_count bigint,
  delivered_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with scoped as (
    select
      extract(isodow from (o.order_date at time zone p_timezone))::int as slot_dow,
      extract(hour from (o.order_date at time zone p_timezone))::int as slot_hour,
      o.status as slot_status
    from public.orders o
    where o.store_id = any(p_store_ids)
      and exists (
        select 1
        from public.store_members sm
        where sm.store_id = o.store_id
          and sm.user_id = auth.uid()
          and sm.status = 'active'
      )
      and (p_start_date is null or o.order_date >= p_start_date)
      and (p_end_date is null or o.order_date < p_end_date)
  )
  select
    s.slot_dow as week_day,
    s.slot_hour as hour_of_day,
    count(*)::bigint as orders_count,
    count(*) filter (where s.slot_status in ('confirmed', 'picked_up', 'sent', 'delivered'))::bigint as confirmed_count,
    count(*) filter (where s.slot_status = 'delivered')::bigint as delivered_count
  from scoped s
  group by s.slot_dow, s.slot_hour
  order by s.slot_dow, s.slot_hour
$$;

grant execute on function public.rpc_dashboard_order_time_performance(uuid[], timestamptz, timestamptz, text) to authenticated;
revoke all on function public.rpc_dashboard_order_time_performance(uuid[], timestamptz, timestamptz, text) from anon;

commit;
