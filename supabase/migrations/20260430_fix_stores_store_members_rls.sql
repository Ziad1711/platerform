drop policy if exists "Enable read access for authenticated users" on public.stores;
drop policy if exists "Enable insert access for authenticated users" on public.stores;
drop policy if exists "Enable update access for authenticated users" on public.stores;
drop policy if exists "Enable delete access for authenticated users" on public.stores;

drop policy if exists "Enable read access for authenticated users" on public.store_members;
drop policy if exists "Enable insert access for authenticated users" on public.store_members;
drop policy if exists "Enable update access for authenticated users" on public.store_members;
drop policy if exists "Enable delete access for authenticated users" on public.store_members;

drop policy if exists "Stores owner can delete stores" on public.stores;
create policy "Stores owner can delete stores"
on public.stores
for delete
to authenticated
using (owner_user_id = auth.uid());

drop policy if exists "store_members_delete_owner_admin" on public.store_members;
create policy "store_members_delete_owner_admin"
on public.store_members
for delete
to authenticated
using (is_store_member(store_id, array['owner'::text, 'admin'::text]));