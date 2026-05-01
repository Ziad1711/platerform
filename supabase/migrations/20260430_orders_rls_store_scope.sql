-- ============================================================
-- RLS: orders — scope multi-tenant via store_members + owner
-- ============================================================

alter table public.orders enable row level security;

-- SELECT: l'utilisateur voit les orders de ses stores
create policy orders_select on public.orders
  for select
  using (
    exists (
      select 1 from public.store_members sm
      where sm.store_id = orders.store_id
        and sm.user_id = auth.uid()
    )
    or exists (
      select 1 from public.stores s
      where s.id = orders.store_id
        and s.owner_user_id = auth.uid()
    )
  );

-- INSERT: l'utilisateur ne peut insérer que dans ses stores
create policy orders_insert on public.orders
  for insert
  with check (
    exists (
      select 1 from public.store_members sm
      where sm.store_id = orders.store_id
        and sm.user_id = auth.uid()
    )
    or exists (
      select 1 from public.stores s
      where s.id = orders.store_id
        and s.owner_user_id = auth.uid()
    )
  );

-- UPDATE: l'utilisateur ne peut modifier que les orders de ses stores
create policy orders_update on public.orders
  for update
  using (
    exists (
      select 1 from public.store_members sm
      where sm.store_id = orders.store_id
        and sm.user_id = auth.uid()
    )
    or exists (
      select 1 from public.stores s
      where s.id = orders.store_id
        and s.owner_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.store_members sm
      where sm.store_id = orders.store_id
        and sm.user_id = auth.uid()
    )
    or exists (
      select 1 from public.stores s
      where s.id = orders.store_id
        and s.owner_user_id = auth.uid()
    )
  );

-- DELETE: l'utilisateur ne peut supprimer que les orders de ses stores
create policy orders_delete on public.orders
  for delete
  using (
    exists (
      select 1 from public.store_members sm
      where sm.store_id = orders.store_id
        and sm.user_id = auth.uid()
    )
    or exists (
      select 1 from public.stores s
      where s.id = orders.store_id
        and s.owner_user_id = auth.uid()
    )
  );
