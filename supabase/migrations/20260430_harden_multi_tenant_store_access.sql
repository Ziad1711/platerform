alter table public.stores enable row level security;
alter table public.store_members enable row level security;

insert into public.store_members (store_id, user_id, role)
select s.id, s.owner_user_id, 'owner'
from public.stores s
where not exists (
  select 1
  from public.store_members sm
  where sm.store_id = s.id
    and sm.user_id = s.owner_user_id
);

drop policy if exists "stores_select_member_or_owner" on public.stores;
create policy "stores_select_member_or_owner"
on public.stores
for select
to authenticated
using (owner_user_id = auth.uid());

drop policy if exists "stores_insert_owner_only" on public.stores;
create policy "stores_insert_owner_only"
on public.stores
for insert
to authenticated
with check (owner_user_id = auth.uid());

drop policy if exists "stores_update_owner_only" on public.stores;
create policy "stores_update_owner_only"
on public.stores
for update
to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

drop policy if exists "Stores owner can delete stores" on public.stores;
create policy "Stores owner can delete stores"
on public.stores
for delete
to authenticated
using (owner_user_id = auth.uid());

drop policy if exists "store_members_select_self_or_store_admin" on public.store_members;
create policy "store_members_select_self_or_store_admin"
on public.store_members
for select
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.stores s
    where s.id = store_members.store_id
      and s.owner_user_id = auth.uid()
  )
);

drop policy if exists "store_members_insert_owner_admin" on public.store_members;
create policy "store_members_insert_owner_admin"
on public.store_members
for insert
to authenticated
with check (
  (
    user_id = auth.uid()
    and role = 'owner'
    and exists (
      select 1
      from public.stores s
      where s.id = store_members.store_id
        and s.owner_user_id = auth.uid()
    )
  )
  or exists (
    select 1
    from public.stores s
    where s.id = store_members.store_id
      and s.owner_user_id = auth.uid()
  )
);

drop policy if exists "store_members_update_owner_admin" on public.store_members;
create policy "store_members_update_owner_admin"
on public.store_members
for update
to authenticated
using (
  exists (
    select 1
    from public.stores s
    where s.id = store_members.store_id
      and s.owner_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.stores s
    where s.id = store_members.store_id
      and s.owner_user_id = auth.uid()
  )
);

drop policy if exists "store_members_delete_owner_admin" on public.store_members;
create policy "store_members_delete_owner_admin"
on public.store_members
for delete
to authenticated
using (
  exists (
    select 1
    from public.stores s
    where s.id = store_members.store_id
      and s.owner_user_id = auth.uid()
  )
);