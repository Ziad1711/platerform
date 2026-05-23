-- Ajout de la colonne product_variant_id dans order_items
alter table public.order_items add column if not exists product_variant_id uuid references public.product_variants(id) on delete set null;

create index if not exists idx_order_items_product_variant_id on public.order_items (product_variant_id);
