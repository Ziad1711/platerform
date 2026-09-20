-- Agrégation du stock côté base pour l'API catalogue publique.
-- Évite de rapatrier tous les mouvements d'inventaire côté serveur Node.
-- Réservée au service_role : seul le backend Jisra l'appelle.

create or replace function public.rpc_public_catalog_stock_snapshot(
  p_store_id uuid,
  p_product_ids uuid[]
)
returns table (
  product_id uuid,
  product_variant_id uuid,
  quantity bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    im.product_id,
    im.product_variant_id,
    sum(
      case
        when im.movement_type = 'in' then im.quantity
        when im.movement_type = 'out' then -im.quantity
        when im.movement_type = 'adjustment' and im.adjustment_direction = 'out' then -im.quantity
        when im.movement_type = 'adjustment' then im.quantity
        else 0
      end
    )::bigint as quantity
  from public.inventory_movements im
  where im.store_id = p_store_id
    and im.product_id = any(p_product_ids)
  group by im.product_id, im.product_variant_id;
$$;

comment on function public.rpc_public_catalog_stock_snapshot(uuid, uuid[]) is
  'Stock agrégé (produit + variante) pour le catalogue public. product_variant_id NULL = stock produit non affecté à une variante.';

revoke all on function public.rpc_public_catalog_stock_snapshot(uuid, uuid[]) from public;
grant execute on function public.rpc_public_catalog_stock_snapshot(uuid, uuid[]) to service_role;
