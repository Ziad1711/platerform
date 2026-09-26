-- ============================================================
-- Durcissement RLS order_items : périmètre agent
-- L'agent confirmation ne voit/modifie que les articles de ses
-- commandes assignées. Écritures directes réservées aux rôles
-- opérationnels (owner/admin/delivery/accountant/stock_manager).
-- ============================================================

drop policy if exists "Store members can view order_items" on public.order_items;
drop policy if exists order_items_select_store_scope on public.order_items;
create policy order_items_select_store_scope on public.order_items for select
using (
  public.can_view_all_store_orders(order_items.store_id)
  or public.is_order_assigned_to_actor(order_items.order_id)
);

drop policy if exists "Store members can insert order_items" on public.order_items;
drop policy if exists order_items_insert_store_scope on public.order_items;
create policy order_items_insert_store_scope on public.order_items for insert
with check (public.can_manage_store_orders(order_items.store_id));

drop policy if exists "Store members can update order_items" on public.order_items;
drop policy if exists order_items_update_store_scope on public.order_items;
create policy order_items_update_store_scope on public.order_items for update
using (public.can_manage_store_orders(order_items.store_id))
with check (public.can_manage_store_orders(order_items.store_id));

drop policy if exists "Owner or admin can delete order_items" on public.order_items;
drop policy if exists order_items_delete_store_scope on public.order_items;
create policy order_items_delete_store_scope on public.order_items for delete
using (public.is_order_store_admin(order_items.store_id));
