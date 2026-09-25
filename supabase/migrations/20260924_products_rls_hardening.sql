-- ============================================================
-- Durcissement RLS : products / product_variants / product_images
-- Les politiques « Enable ... for authenticated users » autorisaient tout
-- utilisateur connecté à lire, modifier et supprimer les produits de TOUS les
-- stores. Elles sont supprimées et remplacées par un périmètre limité au store.
-- ============================================================

-- ---------- Helpers de périmètre ----------

create or replace function public.can_view_store_products(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.store_members sm
    where sm.store_id = p_store_id and sm.user_id = auth.uid()
  )
  or exists (
    select 1 from public.stores s
    where s.id = p_store_id and s.owner_user_id = auth.uid()
  );
$$;

create or replace function public.can_manage_store_products(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.store_members sm
    where sm.store_id = p_store_id
      and sm.user_id = auth.uid()
      and sm.role in ('owner', 'admin', 'stock_manager')
  )
  or exists (
    select 1 from public.stores s
    where s.id = p_store_id and s.owner_user_id = auth.uid()
  );
$$;

create or replace function public.can_manage_store_products_admin(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.store_members sm
    where sm.store_id = p_store_id
      and sm.user_id = auth.uid()
      and sm.role in ('owner', 'admin')
  )
  or exists (
    select 1 from public.stores s
    where s.id = p_store_id and s.owner_user_id = auth.uid()
  );
$$;

comment on function public.can_manage_store_products(uuid) is
  'Vrai si l''utilisateur peut créer/modifier les produits du store : owner, admin ou stock_manager actif.';

revoke all on function public.can_view_store_products(uuid) from public;
revoke all on function public.can_manage_store_products(uuid) from public;
revoke all on function public.can_manage_store_products_admin(uuid) from public;

grant execute on function public.can_view_store_products(uuid) to authenticated, service_role;
grant execute on function public.can_manage_store_products(uuid) to authenticated, service_role;
grant execute on function public.can_manage_store_products_admin(uuid) to authenticated, service_role;

-- ---------- products ----------

drop policy if exists "Enable read access for authenticated users" on public.products;
drop policy if exists "Enable insert access for authenticated users" on public.products;
drop policy if exists "Enable update access for authenticated users" on public.products;
drop policy if exists "Enable delete access for authenticated users" on public.products;

drop policy if exists "Store members can view products" on public.products;
drop policy if exists "Store members can insert products" on public.products;
drop policy if exists "Store members can update products" on public.products;
drop policy if exists "Owner or admin can delete products" on public.products;

drop policy if exists products_select_store_scope on public.products;
create policy products_select_store_scope on public.products for select
using (public.can_view_store_products(store_id));

drop policy if exists products_insert_store_scope on public.products;
create policy products_insert_store_scope on public.products for insert
with check (public.can_manage_store_products(store_id));

drop policy if exists products_update_store_scope on public.products;
create policy products_update_store_scope on public.products for update
using (public.can_manage_store_products(store_id))
with check (public.can_manage_store_products(store_id));

drop policy if exists products_delete_store_scope on public.products;
create policy products_delete_store_scope on public.products for delete
using (public.can_manage_store_products_admin(store_id));

-- ---------- product_variants ----------

drop policy if exists "Store members can view product_variants" on public.product_variants;
drop policy if exists "Store members can insert product_variants" on public.product_variants;
drop policy if exists "Store members can update product_variants" on public.product_variants;
drop policy if exists "Owner or admin can delete product_variants" on public.product_variants;

drop policy if exists product_variants_select_store_scope on public.product_variants;
create policy product_variants_select_store_scope on public.product_variants for select
using (public.can_view_store_products(store_id));

drop policy if exists product_variants_write_store_scope on public.product_variants;
create policy product_variants_write_store_scope on public.product_variants for all
using (public.can_manage_store_products(store_id))
with check (public.can_manage_store_products(store_id));

-- ---------- product_images ----------

drop policy if exists "Store members can view product_images" on public.product_images;
drop policy if exists "Store members can insert product_images" on public.product_images;
drop policy if exists "Store members can update product_images" on public.product_images;
drop policy if exists "Store members can delete product_images" on public.product_images;

drop policy if exists product_images_select_store_scope on public.product_images;
create policy product_images_select_store_scope on public.product_images for select
using (public.can_view_store_products(store_id));

drop policy if exists product_images_write_store_scope on public.product_images;
create policy product_images_write_store_scope on public.product_images for all
using (public.can_manage_store_products(store_id))
with check (public.can_manage_store_products(store_id));

