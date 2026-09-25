-- ============================================================
-- Module Confirmation — reprise de l'existant + durcissement RLS sur orders
-- (partie 3/4 de la migration 20260924_confirmation_*)
-- ============================================================

-- ---------- 4. Reprise de l'existant ----------

-- Les commandes déjà en rappel 1..5 connaissent leur nombre de tentatives.
update public.orders
set confirmation_attempt_count = case status
  when 'follow_up_1' then greatest(confirmation_attempt_count, 1)
  when 'follow_up_2' then greatest(confirmation_attempt_count, 2)
  when 'follow_up_3' then greatest(confirmation_attempt_count, 3)
  when 'follow_up_4' then greatest(confirmation_attempt_count, 4)
  when 'follow_up_5' then greatest(confirmation_attempt_count, 5)
  else confirmation_attempt_count
end
where status in ('follow_up_1', 'follow_up_2', 'follow_up_3', 'follow_up_4', 'follow_up_5');

-- ---------- 5. Durcissement des politiques RLS sur orders ----------
-- Les anciennes politiques « Enable ... for authenticated users » autorisaient
-- tout utilisateur connecté à lire, modifier et supprimer les commandes de TOUS
-- les stores. Elles sont supprimées et remplacées par un périmètre limité au store.

drop policy if exists "Enable read access for authenticated users" on public.orders;
drop policy if exists "Enable insert access for authenticated users" on public.orders;
drop policy if exists "Enable update access for authenticated users" on public.orders;
drop policy if exists "Enable delete access for authenticated users" on public.orders;

drop policy if exists "Store members can view orders" on public.orders;
drop policy if exists "Store members can insert orders" on public.orders;
drop policy if exists "Store members can update orders" on public.orders;
drop policy if exists "Owner or admin can delete orders" on public.orders;

drop policy if exists "orders_select_own_store" on public.orders;
drop policy if exists orders_select_store_scope on public.orders;
create policy orders_select_store_scope on public.orders for select
using (
  exists (
    select 1 from public.store_members sm
    where sm.store_id = orders.store_id and sm.user_id = auth.uid()
  )
  or exists (
    select 1 from public.stores s
    where s.id = orders.store_id and s.owner_user_id = auth.uid()
  )
);

drop policy if exists orders_insert_store_scope on public.orders;
create policy orders_insert_store_scope on public.orders for insert
with check (
  exists (
    select 1 from public.store_members sm
    where sm.store_id = orders.store_id and sm.user_id = auth.uid()
  )
  or exists (
    select 1 from public.stores s
    where s.id = orders.store_id and s.owner_user_id = auth.uid()
  )
);

drop policy if exists orders_update_store_scope on public.orders;
create policy orders_update_store_scope on public.orders for update
using (
  exists (
    select 1 from public.store_members sm
    where sm.store_id = orders.store_id and sm.user_id = auth.uid()
  )
  or exists (
    select 1 from public.stores s
    where s.id = orders.store_id and s.owner_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.store_members sm
    where sm.store_id = orders.store_id and sm.user_id = auth.uid()
  )
  or exists (
    select 1 from public.stores s
    where s.id = orders.store_id and s.owner_user_id = auth.uid()
  )
);

drop policy if exists orders_delete_store_scope on public.orders;
create policy orders_delete_store_scope on public.orders for delete
using (
  exists (
    select 1 from public.store_members sm
    where sm.store_id = orders.store_id
      and sm.user_id = auth.uid()
      and sm.role in ('owner', 'admin')
  )
  or exists (
    select 1 from public.stores s
    where s.id = orders.store_id and s.owner_user_id = auth.uid()
  )
);


