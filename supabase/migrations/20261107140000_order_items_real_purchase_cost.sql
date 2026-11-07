-- ============================================================
-- 20261107140000 — Coût d'achat réel des lignes de commande
-- ------------------------------------------------------------
-- Défaut reproduit (store « ziilart ») : les commandes importées
-- (YouCan, Lightfunnels, API) insèrent `unit_purchase_cost_snapshot = 0`
-- et les ventes créées avant correction du produit gardaient l'ancien
-- coût (40) au lieu du coût réel (75). Le profit affiché était faux
-- jusqu'à la création du colis, et définitivement faux si la commande
-- n'atteignait jamais le statut livré.
--
-- Correctif : le trigger `order_items_before_write` remplace un coût
-- absent **ou nul** par le coût réel du catalogue :
--   1. `product_variants.purchase_cost` quand il est renseigné (> 0) ;
--   2. sinon `products.default_purchase_cost` × `stock_multiplier` du pack.
-- Le coût explicite d'une ligne (déjà > 0) n'est jamais modifié.
-- ============================================================

create or replace function public.order_items_before_write()
returns trigger
language plpgsql
as $$
declare
  v_store_id uuid;
  v_default_selling numeric;
  v_default_purchase numeric;
  v_variant_cost numeric;
  v_multiplier integer;
begin
  select o.store_id into v_store_id
  from public.orders o
  where o.id = new.order_id;

  if v_store_id is null then
    raise exception 'order_id % not found', new.order_id;
  end if;

  new.store_id := v_store_id;

  if new.product_id is not null then
    select p.default_selling_price, p.default_purchase_cost
    into v_default_selling, v_default_purchase
    from public.products p
    where p.id = new.product_id;

    if new.unit_selling_price is null then
      new.unit_selling_price := coalesce(v_default_selling, 0);
    end if;

    -- Coût d'achat réel : jamais 0/null quand le catalogue le connaît.
    if new.unit_purchase_cost_snapshot is null or new.unit_purchase_cost_snapshot = 0 then
      select pv.purchase_cost, greatest(coalesce(pv.stock_multiplier, 1), 1)
      into v_variant_cost, v_multiplier
      from public.product_variants pv
      where pv.id = new.product_variant_id;

      if v_variant_cost is not null and v_variant_cost > 0 then
        new.unit_purchase_cost_snapshot := v_variant_cost;
      else
        new.unit_purchase_cost_snapshot :=
          round(coalesce(v_default_purchase, 0) * coalesce(v_multiplier, 1), 2);
      end if;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

comment on function public.order_items_before_write() is
  'Normalise une ligne de commande : store_id, prix de vente par défaut et coût d''achat réel (variante, sinon coût produit × multiplicateur du pack) au lieu de 0.';
