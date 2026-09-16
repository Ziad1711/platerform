-- ============================================================
-- Nom personnalisé par ligne de commande.
-- Permet de renommer le produit affiché dans une commande sans
-- toucher au product_id (stock, coûts et variantes restent liés
-- au produit d'origine).
-- ============================================================

alter table public.order_items
  add column if not exists product_name_override text;

comment on column public.order_items.product_name_override is
  'Nom personnalisé affiché dans la commande. Le product_id reste inchangé (stock, coûts et variantes restent liés au produit d''origine).';
