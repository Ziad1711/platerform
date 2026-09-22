-- ============================================================================
-- Catalogue public P0 : galerie produit/variante, ancien prix, descriptions,
-- slug stable, catégories, variante par défaut et ordre d'affichage.
-- Aucun coût d'achat n'est exposé par l'API publique.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Catégories produits
-- ---------------------------------------------------------------------------
create table if not exists public.product_categories (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  slug text not null,
  description text,
  image_url text,
  sort_order integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint product_categories_name_check check (length(btrim(name)) > 0),
  constraint product_categories_slug_check check (length(btrim(slug)) > 0),
  constraint product_categories_sort_order_check check (sort_order >= 0)
);

create unique index if not exists product_categories_store_slug_unique
  on public.product_categories (store_id, slug);

create index if not exists idx_product_categories_store_sort
  on public.product_categories (store_id, sort_order, name);

drop trigger if exists set_product_categories_updated_at on public.product_categories;

create trigger set_product_categories_updated_at
  before update on public.product_categories
  for each row execute function public.handle_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Nouveaux champs produit
-- ---------------------------------------------------------------------------
alter table public.products
  add column if not exists slug text,
  add column if not exists short_description text,
  add column if not exists description text,
  add column if not exists old_price numeric,
  add column if not exists category_id uuid,
  add column if not exists sort_order integer not null default 0;

alter table public.products drop constraint if exists products_old_price_check;

alter table public.products add constraint products_old_price_check
  check (old_price is null or old_price >= 0);

alter table public.products drop constraint if exists products_sort_order_check;

alter table public.products add constraint products_sort_order_check
  check (sort_order >= 0);

alter table public.products drop constraint if exists products_category_id_fkey;

alter table public.products add constraint products_category_id_fkey
  foreign key (category_id) references public.product_categories(id) on delete set null;

create unique index if not exists products_store_slug_unique
  on public.products (store_id, slug) where slug is not null;

create index if not exists idx_products_store_category
  on public.products (store_id, category_id);

create index if not exists idx_products_store_sort
  on public.products (store_id, sort_order);

comment on column public.products.slug is
  'Slug public stable du produit, unique par store. Utilisé par le site client pour les URLs.';
comment on column public.products.old_price is
  'Ancien prix affiché (prix barré). Ne sert jamais au calcul des commandes.';
comment on column public.products.short_description is
  'Résumé court destiné aux cartes du catalogue.';
comment on column public.products.description is
  'Description complète destinée à la fiche produit.';

-- ---------------------------------------------------------------------------
-- 3. Nouveaux champs variante
-- ---------------------------------------------------------------------------
alter table public.product_variants
  add column if not exists old_price numeric,
  add column if not exists is_default boolean not null default false,
  add column if not exists sort_order integer not null default 0;

alter table public.product_variants drop constraint if exists product_variants_old_price_check;

alter table public.product_variants add constraint product_variants_old_price_check
  check (old_price is null or old_price >= 0);

alter table public.product_variants drop constraint if exists product_variants_sort_order_check;

alter table public.product_variants add constraint product_variants_sort_order_check
  check (sort_order >= 0);

create unique index if not exists product_variants_single_default_unique
  on public.product_variants (product_id) where is_default = true;

create index if not exists idx_product_variants_product_sort
  on public.product_variants (product_id, sort_order);

comment on column public.product_variants.old_price is
  'Ancien prix affiché de la variante (prix barré).';
comment on column public.product_variants.is_default is
  'Variante présélectionnée côté site client. Une seule variante par défaut par produit.';

-- ---------------------------------------------------------------------------
-- 4. Galerie produit et variante
-- product_variant_id null  -> image de la galerie produit
-- product_variant_id défini -> image propre à une variante
-- ---------------------------------------------------------------------------
create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  product_variant_id uuid references public.product_variants(id) on delete cascade,
  image_url text not null,
  alt_text text,
  sort_order integer not null default 0,
  is_primary boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint product_images_url_check check (length(btrim(image_url)) > 0),
  constraint product_images_sort_order_check check (sort_order >= 0)
);

create index if not exists idx_product_images_product_sort
  on public.product_images (product_id, product_variant_id, sort_order);

create index if not exists idx_product_images_variant
  on public.product_images (product_variant_id);

-- Une seule image principale par produit (galerie produit).
create unique index if not exists product_images_primary_product_unique
  on public.product_images (product_id)
  where product_variant_id is null and is_primary = true;

-- Une seule image principale par variante.
create unique index if not exists product_images_primary_variant_unique
  on public.product_images (product_variant_id)
  where product_variant_id is not null and is_primary = true;

drop trigger if exists set_product_images_updated_at on public.product_images;

create trigger set_product_images_updated_at
  before update on public.product_images
  for each row execute function public.handle_updated_at();

-- Cohérence : l'image doit appartenir au bon produit, à la bonne variante et au bon store.
create or replace function public.validate_product_image_scope()
returns trigger
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare
  v_product_store uuid;
  v_variant_product uuid;
  v_variant_store uuid;
begin
  select store_id into v_product_store
  from public.products
  where id = new.product_id;

  if v_product_store is null then
    raise exception 'PRODUCT_IMAGE_PRODUCT_NOT_FOUND';
  end if;

  if new.store_id is distinct from v_product_store then
    raise exception 'PRODUCT_IMAGE_STORE_MISMATCH';
  end if;

  if new.product_variant_id is not null then
    select product_id, store_id into v_variant_product, v_variant_store
    from public.product_variants
    where id = new.product_variant_id;

    if v_variant_product is null then
      raise exception 'PRODUCT_IMAGE_VARIANT_NOT_FOUND';
    end if;

    if v_variant_product is distinct from new.product_id then
      raise exception 'PRODUCT_IMAGE_VARIANT_MISMATCH';
    end if;

    if v_variant_store is distinct from v_product_store then
      raise exception 'PRODUCT_IMAGE_VARIANT_STORE_MISMATCH';
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists validate_product_image_scope_trigger on public.product_images;

create trigger validate_product_image_scope_trigger
  before insert or update on public.product_images
  for each row execute function public.validate_product_image_scope();

-- Toute modification d'image doit propager `products.updated_at` (synchronisation incrémentale).
create or replace function public.touch_product_from_image()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_product_id uuid;
begin
  v_product_id := coalesce(new.product_id, old.product_id);

  if v_product_id is not null then
    update public.products
    set updated_at = now()
    where id = v_product_id;
  end if;

  return coalesce(new, old);
end;
$function$;

drop trigger if exists trg_touch_product_from_image on public.product_images;

create trigger trg_touch_product_from_image
  after insert or update or delete on public.product_images
  for each row execute function public.touch_product_from_image();

-- ---------------------------------------------------------------------------
-- 5. Slugification et backfill des slugs produits
-- ---------------------------------------------------------------------------
create or replace function public.slugify_text(p_value text)
returns text
language sql
immutable
set search_path to ''
as $function$
  select nullif(
    trim(
      both '-' from regexp_replace(
        regexp_replace(
          lower(
            translate(
              coalesce(p_value, ''),
              'àáâãäåçèéêëìíîïñòóôõöùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ',
              'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUY'
            )
          ),
          '[^a-z0-9]+', '-', 'g'
        ),
        '-{2,}', '-', 'g'
      )
    ),
    ''
  );
$function$;

with ranked as (
  select
    p.id,
    coalesce(public.slugify_text(p.name), 'produit') as base_slug,
    row_number() over (
      partition by p.store_id, coalesce(public.slugify_text(p.name), 'produit')
      order by p.created_at, p.id
    ) as rn
  from public.products p
  where p.slug is null
)
update public.products p
set slug = case when r.rn = 1 then r.base_slug else r.base_slug || '-' || r.rn end
from ranked r
where p.id = r.id;

-- ---------------------------------------------------------------------------
-- 6. Backfill de la galerie depuis l'ancienne colonne products.image_url
-- (déclencheur de mise à jour désactivé pour ne pas réécrire updated_at)
-- ---------------------------------------------------------------------------
alter table public.product_images disable trigger trg_touch_product_from_image;

insert into public.product_images (store_id, product_id, image_url, alt_text, sort_order, is_primary)
select p.store_id, p.id, btrim(p.image_url), p.name, 0, true
from public.products p
where p.image_url is not null
  and btrim(p.image_url) <> ''
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.product_variant_id is null
  );

alter table public.product_images enable trigger trg_touch_product_from_image;

-- ---------------------------------------------------------------------------
-- 7. RLS et privilèges
-- ---------------------------------------------------------------------------
alter table public.product_categories enable row level security;
alter table public.product_images enable row level security;

grant select, insert, update, delete on public.product_categories to authenticated;
grant select, insert, update, delete on public.product_images to authenticated;
grant all on public.product_categories to service_role;
grant all on public.product_images to service_role;

drop policy if exists "Store members can view product_categories" on public.product_categories;
create policy "Store members can view product_categories"
  on public.product_categories for select
  using (
    exists (
      select 1 from public.store_members sm
      where sm.store_id = product_categories.store_id
        and sm.user_id = auth.uid()
    )
  );

drop policy if exists "Store members can insert product_categories" on public.product_categories;
create policy "Store members can insert product_categories"
  on public.product_categories for insert
  with check (
    exists (
      select 1 from public.store_members sm
      where sm.store_id = product_categories.store_id
        and sm.user_id = auth.uid()
        and sm.role = any (array['owner', 'admin', 'staff'])
    )
  );

drop policy if exists "Store members can update product_categories" on public.product_categories;
create policy "Store members can update product_categories"
  on public.product_categories for update
  using (
    exists (
      select 1 from public.store_members sm
      where sm.store_id = product_categories.store_id
        and sm.user_id = auth.uid()
        and sm.role = any (array['owner', 'admin', 'staff'])
    )
  );

drop policy if exists "Owner or admin can delete product_categories" on public.product_categories;
create policy "Owner or admin can delete product_categories"
  on public.product_categories for delete
  using (
    exists (
      select 1 from public.store_members sm
      where sm.store_id = product_categories.store_id
        and sm.user_id = auth.uid()
        and sm.role = any (array['owner', 'admin'])
    )
  );

drop policy if exists "Store members can view product_images" on public.product_images;
create policy "Store members can view product_images"
  on public.product_images for select
  using (
    exists (
      select 1 from public.store_members sm
      where sm.store_id = product_images.store_id
        and sm.user_id = auth.uid()
    )
  );

drop policy if exists "Store members can insert product_images" on public.product_images;
create policy "Store members can insert product_images"
  on public.product_images for insert
  with check (
    exists (
      select 1 from public.store_members sm
      where sm.store_id = product_images.store_id
        and sm.user_id = auth.uid()
        and sm.role = any (array['owner', 'admin', 'staff'])
    )
  );

drop policy if exists "Store members can update product_images" on public.product_images;
create policy "Store members can update product_images"
  on public.product_images for update
  using (
    exists (
      select 1 from public.store_members sm
      where sm.store_id = product_images.store_id
        and sm.user_id = auth.uid()
        and sm.role = any (array['owner', 'admin', 'staff'])
    )
  );

drop policy if exists "Owner or admin can delete product_images" on public.product_images;
create policy "Owner or admin can delete product_images"
  on public.product_images for delete
  using (
    exists (
      select 1 from public.store_members sm
      where sm.store_id = product_images.store_id
        and sm.user_id = auth.uid()
        and sm.role = any (array['owner', 'admin'])
    )
  );

-- ---------------------------------------------------------------------------
-- 8. Durcissement : pas d'appel RPC direct sur les fonctions déclencheurs
-- ---------------------------------------------------------------------------
revoke all on function public.validate_product_image_scope() from public, anon, authenticated;
revoke all on function public.touch_product_from_image() from public, anon, authenticated;




