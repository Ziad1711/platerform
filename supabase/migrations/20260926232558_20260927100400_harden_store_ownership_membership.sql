-- ============================================================
-- Sécurité : verrouillage propriété & appartenance (suite audit multistore)
-- ------------------------------------------------------------
-- Vecteurs de prise de contrôle restants après la suppression des politiques
-- permissives :
--   1. is_store_member() ignorait status='active' -> un membre révoqué lisait
--      encore `stores` (sélecteur de store).
--   2. stores.owner_user_id modifiable par tout membre owner/admin (politique
--      "Owner or admin can update stores" sans WITH CHECK) -> prise de contrôle.
--   3. un admin pouvait changer le rôle du propriétaire, le désactiver ou
--      supprimer sa ligne de membre, le privant de ses droits.
-- ============================================================

-- (1) un membre n'est membre que s'il est actif.
create or replace function public.is_store_member(
  p_store_id uuid,
  p_roles text[] default null::text[]
)
returns boolean
language sql
stable
security definer
set search_path to public
as $$
  select exists (
    select 1
    from public.store_members sm
    where sm.store_id = p_store_id
      and sm.user_id = auth.uid()
      and sm.status = 'active'
      and (p_roles is null or sm.role = any(p_roles))
  );
$$;

-- (2) la propriété d'un store est immuable.
create or replace function public.block_store_owner_change()
returns trigger
language plpgsql
security definer
set search_path to public
as $$
begin
  if new.owner_user_id is distinct from old.owner_user_id then
    raise exception 'OWNER_USER_ID_IMMUTABLE';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_stores_block_owner_change on public.stores;
create trigger trg_stores_block_owner_change
  before update on public.stores
  for each row
  execute function public.block_store_owner_change();

-- (3) identité de membre immuable ; rôle/statut du propriétaire protégés ;
--     le rôle owner reste réservé au propriétaire du store.
create or replace function public.block_store_member_mutation()
returns trigger
language plpgsql
security definer
set search_path to public
as $$
declare
  v_owner_user_id uuid;
begin
  if new.store_id is distinct from old.store_id then
    raise exception 'STORE_MEMBER_STORE_IMMUTABLE';
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception 'STORE_MEMBER_USER_IMMUTABLE';
  end if;

  select s.owner_user_id into v_owner_user_id
  from public.stores s
  where s.id = old.store_id;

  if old.user_id = v_owner_user_id then
    if new.role is distinct from old.role then
      raise exception 'OWNER_ROLE_IMMUTABLE';
    end if;
    if new.status <> 'active' then
      raise exception 'OWNER_CANNOT_BE_REMOVED';
    end if;
  elsif new.role = 'owner' and new.role is distinct from old.role then
    raise exception 'OWNER_ROLE_UNIQUE';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_store_member_mutation on public.store_members;
create trigger trg_store_member_mutation
  before update on public.store_members
  for each row
  execute function public.block_store_member_mutation();

create or replace function public.block_store_member_insert()
returns trigger
language plpgsql
security definer
set search_path to public
as $$
begin
  if new.role = 'owner' and not exists (
    select 1 from public.stores s
    where s.id = new.store_id
      and s.owner_user_id = new.user_id
  ) then
    raise exception 'OWNER_ROLE_UNIQUE';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_store_member_insert on public.store_members;
create trigger trg_store_member_insert
  before insert on public.store_members
  for each row
  execute function public.block_store_member_insert();

-- (4) un admin ne peut pas supprimer la ligne du propriétaire via REST.
drop policy if exists store_members_admin_delete on public.store_members;
create policy store_members_admin_delete on public.store_members
  for delete
  to public
  using (
    is_store_admin_or_owner(store_id, auth.uid())
    and not exists (
      select 1 from public.stores s
      where s.id = store_members.store_id
        and s.owner_user_id = store_members.user_id
    )
  );
