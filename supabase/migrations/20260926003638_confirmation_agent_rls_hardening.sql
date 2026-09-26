-- ============================================================
-- Confirmation — durcissement RLS + révocation des droits publics
-- Un agent de confirmation ne lit/modifie que ses commandes assignées,
-- aussi bien via l'interface que via un accès direct Supabase.
-- ============================================================

create or replace function public.can_view_all_store_orders(p_store_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.stores s where s.id = p_store_id and s.owner_user_id = auth.uid()
  )
  or exists (
    select 1 from public.store_members sm
    where sm.store_id = p_store_id
      and sm.user_id = auth.uid()
      and sm.status = 'active'
      and sm.role <> 'confirmation'
  );
$$;

create or replace function public.can_manage_store_orders(p_store_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.stores s where s.id = p_store_id and s.owner_user_id = auth.uid()
  )
  or exists (
    select 1 from public.store_members sm
    where sm.store_id = p_store_id
      and sm.user_id = auth.uid()
      and sm.status = 'active'
      and sm.role in ('owner','admin','delivery','accountant','stock_manager')
  );
$$;

create or replace function public.is_order_assigned_to_actor(p_order_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.orders o
    join public.confirmation_agents ca on ca.id = o.confirmation_agent_id
    join public.store_members sm on sm.id = ca.member_id
    where o.id = p_order_id
      and sm.user_id = auth.uid()
      and sm.status = 'active'
      and sm.role = 'confirmation'
      and ca.is_active = true
  );
$$;

revoke all on function public.can_view_all_store_orders(uuid) from public;
revoke all on function public.can_manage_store_orders(uuid) from public;
revoke all on function public.is_order_assigned_to_actor(uuid) from public;
grant execute on function public.can_view_all_store_orders(uuid) to authenticated, service_role;
grant execute on function public.can_manage_store_orders(uuid) to authenticated, service_role;
grant execute on function public.is_order_assigned_to_actor(uuid) to authenticated, service_role;

drop policy if exists orders_select_store_scope on public.orders;
create policy orders_select_store_scope on public.orders for select
using (
  public.can_view_all_store_orders(orders.store_id)
  or public.is_order_assigned_to_actor(orders.id)
);

drop policy if exists orders_update_store_scope on public.orders;
create policy orders_update_store_scope on public.orders for update
using (
  public.can_manage_store_orders(orders.store_id)
  or public.is_order_assigned_to_actor(orders.id)
)
with check (
  public.can_manage_store_orders(orders.store_id)
  or public.is_order_assigned_to_actor(orders.id)
);

drop policy if exists order_confirmation_events_select_store_members on public.order_confirmation_events;
create policy order_confirmation_events_select_store_members on public.order_confirmation_events for select
using (
  public.can_view_all_store_orders(order_confirmation_events.store_id)
  or public.is_order_assigned_to_actor(order_confirmation_events.order_id)
);

revoke execute on function public.pick_confirmation_agent(uuid) from public, anon, authenticated;
revoke execute on function public.assign_confirmation_agent_on_insert() from public, anon, authenticated;
revoke execute on function public.sync_confirmation_agent_for_member() from public, anon, authenticated;
revoke execute on function public.rpc_order_confirmation_action(uuid, text, timestamptz, text, text, text, integer) from anon;
revoke execute on function public.rpc_update_confirmation_order_details(uuid, text, text, text, text, numeric, text, uuid, text, jsonb) from anon;

grant execute on function public.pick_confirmation_agent(uuid) to service_role;
grant execute on function public.assign_confirmation_agent_on_insert() to service_role;
grant execute on function public.sync_confirmation_agent_for_member() to service_role;
