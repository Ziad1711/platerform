-- Statut de publication des produits : seul `active` est exposé au site client.
-- draft    = produit en préparation, non vendable en ligne
-- active   = produit publié sur le site
-- archived = produit retiré de la vente (conservé pour l'historique)

alter table public.products
  add column if not exists publication_status text not null default 'active';

alter table public.products
  drop constraint if exists products_publication_status_check;

alter table public.products
  add constraint products_publication_status_check
  check (publication_status in ('draft', 'active', 'archived'));

comment on column public.products.publication_status is
  'Statut de publication du produit pour l''API catalogue : draft, active ou archived. Seul active est exposé au site client.';

create index if not exists idx_products_store_publication_status
  on public.products (store_id, publication_status);
