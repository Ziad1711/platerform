-- Toute modification d'une variante doit signaler le produit parent comme modifié,
-- sinon la synchronisation incrémentale du site (updated_since sur products.updated_at)
-- ne verrait pas les changements de prix, SKU, options ou multiplicateur de pack.

create or replace function public.touch_product_from_variant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
$$;

comment on function public.touch_product_from_variant() is
  'Met à jour products.updated_at lorsqu''une variante est créée, modifiée ou supprimée.';

drop trigger if exists trg_touch_product_from_variant on public.product_variants;

create trigger trg_touch_product_from_variant
after insert or update or delete on public.product_variants
for each row execute function public.touch_product_from_variant();
