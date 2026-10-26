-- Rollback de 20261026120000_kpi_sent_orders_handover.
-- Restaure la définition précédente de `sent_orders` (liste de statuts
-- courants uniquement). Aucune donnée n'est modifiée ; exécution atomique.

create or replace function public.rpc_dashboard_confirmation_counters(
  p_store_ids uuid[],
  p_start_date timestamptz default null,
  p_end_date timestamptz default null
)
returns table (
  total_orders bigint,
  confirmed_orders bigint,
  sent_orders bigint,
  waiting_pickup_orders bigint,
  delivered_orders bigint,
  returned_orders bigint,
  cancelled_orders bigint,
  pending_orders bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  with scoped as (
    select o.id, o.status, o.confirmed_at
      from public.orders o
     where o.store_id = any (p_store_ids)
       and (public.can_view_all_store_orders(o.store_id)
            or public.is_order_assigned_to_actor(o.id))
       and (p_start_date is null or o.order_date >= p_start_date)
       and (p_end_date is null or o.order_date < p_end_date)
  )
  select
    count(*)::bigint,
    count(*) filter (
      where public.order_counts_as_confirmed(s.status, s.confirmed_at)
    )::bigint,
    count(*) filter (
      where s.status in ('sent', 'delivered', 'returned_stocked', 'returned_not_stocked')
    )::bigint,
    count(*) filter (where s.status = 'dl_pickup_pending')::bigint,
    count(*) filter (where s.status = 'delivered')::bigint,
    count(*) filter (where s.status in ('returned_stocked', 'returned_not_stocked'))::bigint,
    count(*) filter (where s.status = 'cancelled')::bigint,
    count(*) filter (
      where s.status in (
        'new', 'follow_up_1', 'follow_up_2', 'follow_up_3', 'follow_up_4', 'follow_up_5',
        'no_answer', 'wrong_number', 'voicemail', 'confirmation_rejected'
      )
    )::bigint
  from scoped s;
$function$;

revoke all on function public.rpc_dashboard_confirmation_counters(uuid[], timestamptz, timestamptz)
  from public, anon;
grant execute on function public.rpc_dashboard_confirmation_counters(uuid[], timestamptz, timestamptz)
  to authenticated, service_role;
