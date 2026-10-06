-- ---------- L'arrondi du total survit à la synchronisation des articles ----------
-- Problème constaté (boutique « cheziks », 06/10/2026) : une commande importée avec un écart
-- d'arrondi (`orders.rounding_adjustment = 1`, total 199 -> 200) retombait à 199 dès l'insertion
-- de ses articles. Cause : `sync_order_total_from_items()` recalcule `total_selling_price` depuis
-- les lignes (`sous-total - remise + livraison`) sans reprendre l'écart d'arrondi déjà stocké.
-- L'ordre réel est : insert de la commande (avec l'arrondi) -> insert des articles -> trigger ->
-- total écrasé.
-- Règle retenue : l'écart d'arrondi est une donnée explicite de la commande, le recalcul des
-- lignes doit donc le conserver tel quel. Il n'est repris que si la commande possède au moins une
-- ligne (une commande vidée de ses articles retombe à 0 comme avant).
-- Idempotent.

create or replace function public.sync_order_total_from_items()
returns trigger
language plpgsql
as $function$
declare
  v_order_id uuid;
begin
  v_order_id := coalesce(new.order_id, old.order_id);

  update public.orders o
  set
    subtotal_amount = coalesce(items.subtotal, 0),
    total_selling_price = greatest(
      0,
      coalesce(items.subtotal, 0)
      - coalesce(o.discount_amount, 0)
      + coalesce(o.delivery_charge_to_customer, 0)
      -- Écart d'arrondi appliqué à la création de la commande : repris tel quel, jamais recalculé.
      + case
          when coalesce(items.line_count, 0) > 0 then coalesce(o.rounding_adjustment, 0)
          else 0
        end
    ),
    updated_at = now()
  from (
    select
      coalesce(sum(oi.quantity * oi.unit_selling_price), 0) as subtotal,
      count(*) as line_count
    from public.order_items oi
    where oi.order_id = v_order_id
  ) items
  where o.id = v_order_id;

  return coalesce(new, old);
end;
$function$;

comment on function public.sync_order_total_from_items() is
  'Recalcule sous-total et total de la commande depuis ses articles, en conservant l''écart d''arrondi stocké (orders.rounding_adjustment) tant que la commande a au moins une ligne.';
