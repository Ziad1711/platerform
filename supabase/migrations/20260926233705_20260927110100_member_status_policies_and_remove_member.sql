-- ============================================================
-- Suite durcissement multistore
-- ------------------------------------------------------------
-- 1. Les politiques RLS de `expenses` et `ad_spend_daily` testaient
--    l'appartenance au store sans exiger `status='active'` : un membre
--    révoqué lisait/écrivait encore les données financières.
-- 2. `store_members_delete_owner_admin` laissait le propriétaire supprimer
--    sa propre ligne de membre (les politiques PERMISSIVE se cumulent en OR).
-- 3. `remove_member` écrivait `status='inactive'`, refusé par la contrainte
--    `store_members_status_check` (active/revoked) : la révocation échouait.
-- ============================================================

-- (1) Membre actif exigé sur les finances.
drop policy if exists "Store members can view expenses" on public.expenses;
create policy "Store members can view expenses" on public.expenses
  for select to public
  using (
    exists (
      select 1 from public.store_members sm
      where sm.store_id = expenses.store_id
        and sm.user_id = auth.uid()
        and sm.status = 'active'
    )
  );

drop policy if exists "Store members can insert expenses" on public.expenses;
create policy "Store members can insert expenses" on public.expenses
  for insert to public
  with check (
    exists (
      select 1 from public.store_members sm
      where sm.store_id = expenses.store_id
        and sm.user_id = auth.uid()
        and sm.status = 'active'
        and sm.role = any(array['owner','admin','staff'])
    )
  );

drop policy if exists "Store members can update expenses" on public.expenses;
create policy "Store members can update expenses" on public.expenses
  for update to public
  using (
    exists (
      select 1 from public.store_members sm
      where sm.store_id = expenses.store_id
        and sm.user_id = auth.uid()
        and sm.status = 'active'
        and sm.role = any(array['owner','admin','staff'])
    )
  );

drop policy if exists "Owner or admin can delete expenses" on public.expenses;
create policy "Owner or admin can delete expenses" on public.expenses
  for delete to public
  using (
    exists (
      select 1 from public.store_members sm
      where sm.store_id = expenses.store_id
        and sm.user_id = auth.uid()
        and sm.status = 'active'
        and sm.role = any(array['owner','admin'])
    )
  );

drop policy if exists "Store members can view ad spend" on public.ad_spend_daily;
create policy "Store members can view ad spend" on public.ad_spend_daily
  for select to public
  using (
    exists (
      select 1 from public.store_members sm
      where sm.store_id = ad_spend_daily.store_id
        and sm.user_id = auth.uid()
        and sm.status = 'active'
    )
  );

drop policy if exists "Store members can insert ad spend" on public.ad_spend_daily;
create policy "Store members can insert ad spend" on public.ad_spend_daily
  for insert to public
  with check (
    exists (
      select 1 from public.store_members sm
      where sm.store_id = ad_spend_daily.store_id
        and sm.user_id = auth.uid()
        and sm.status = 'active'
        and sm.role = any(array['owner','admin','staff'])
    )
  );

drop policy if exists "Store members can update ad spend" on public.ad_spend_daily;
create policy "Store members can update ad spend" on public.ad_spend_daily
  for update to public
  using (
    exists (
      select 1 from public.store_members sm
      where sm.store_id = ad_spend_daily.store_id
        and sm.user_id = auth.uid()
        and sm.status = 'active'
        and sm.role = any(array['owner','admin','staff'])
    )
  );

drop policy if exists "Owner or admin can delete ad spend" on public.ad_spend_daily;
create policy "Owner or admin can delete ad spend" on public.ad_spend_daily
  for delete to public
  using (
    exists (
      select 1 from public.store_members sm
      where sm.store_id = ad_spend_daily.store_id
        and sm.user_id = auth.uid()
        and sm.status = 'active'
        and sm.role = any(array['owner','admin'])
    )
  );

-- (2) Le propriétaire ne peut pas supprimer sa propre ligne de membre.
drop policy if exists store_members_delete_owner_admin on public.store_members;
create policy store_members_delete_owner_admin on public.store_members
  for delete to authenticated
  using (
    exists (
      select 1 from public.stores s
      where s.id = store_members.store_id
        and s.owner_user_id = auth.uid()
    )
    and not exists (
      select 1 from public.stores s2
      where s2.id = store_members.store_id
        and s2.owner_user_id = store_members.user_id
    )
  );

-- (3) remove_member : statut cohérent avec la contrainte (revoked).
create or replace function public.remove_member(p_store_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to public
as $$
begin
  if not is_store_admin_or_owner(p_store_id, auth.uid()) then
    raise exception 'UNAUTHORIZED';
  end if;
  update store_members
    set status = 'revoked', updated_at = now()
    where store_id = p_store_id
      and user_id = p_user_id
      and status = 'active';
end;
$$;
