-- ============================================================
-- 20261107130000 — Édition d'un mouvement de stock : cohérence FIFO
-- ------------------------------------------------------------
-- Défaut reproduit (store « ziilart », produit « Pack d'amour éternel ») :
-- 1. une entrée de 74 unités est créée valorisée 40 dhs ;
-- 2. 49 unités sont consommées par des commandes → sorties à 40 dhs ;
-- 3. l'entrée est corrigée à 75 dhs dans la page Stock : `remaining_qty`
--    est réécrit à la quantité d'origine (74 au lieu de 25) et les 49
--    sorties + les `order_items.unit_purchase_cost_snapshot` restent à 40.
--
-- Correctif :
-- - `rpc_update_stock_movement` : édition générique d'un mouvement saisi
--   manuellement (remplace l'écriture REST directe de la page Stock) ;
-- - `rpc_update_stock_purchase` : même règle pour les achats fournisseurs ;
-- - `remaining_qty = quantity - consommé` (jamais la quantité d'origine) et
--   refus si la quantité devient inférieure au déjà consommé ;
-- - le coût d'un lot est propagé à ses consommations, aux sorties liées et
--   aux snapshots d'achat des lignes de commande (moyenne pondérée ×
--   stock_multiplier), ce qui déclenche `recalc_order_financials`.
-- ============================================================

-- ---------- Propagation du coût d'un lot déjà consommé ----------
create or replace function public.apply_lot_cost_propagation(
  p_movement_id uuid,
  p_unit_cost numeric
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product_id uuid;
  v_item record;
  v_weighted numeric;
  v_multiplier integer;
begin
  -- 1. Les consommations de ce lot adoptent son coût de référence.
  update public.inventory_consumptions ic
  set unit_cost = p_unit_cost
  where ic.inventory_in_id = p_movement_id
    and ic.unit_cost is distinct from p_unit_cost;

  -- 2. Les sorties nées de ces consommations suivent le même coût.
  update public.inventory_movements im
  set unit_cost = p_unit_cost,
      total_cost = im.quantity * p_unit_cost
  from public.inventory_consumptions ic
  where ic.inventory_in_id = p_movement_id
    and ic.inventory_out_id = im.id
    and (
      im.unit_cost is distinct from p_unit_cost
      or im.total_cost is distinct from im.quantity * p_unit_cost
    );

  -- 3. Snapshots d'achat des lignes de commande impactées : recalculés comme
  --    le fait le FIFO (moyenne pondérée par ligne, × stock_multiplier).
  for v_item in
    select distinct ic.order_item_id
    from public.inventory_consumptions ic
    where ic.inventory_in_id = p_movement_id
      and ic.order_item_id is not null
  loop
    select greatest(coalesce(pv.stock_multiplier, 1), 1)
    into v_multiplier
    from public.order_items oi
    left join public.product_variants pv on pv.id = oi.product_variant_id
    where oi.id = v_item.order_item_id;

    v_multiplier := coalesce(v_multiplier, 1);

    select case
             when sum(ic.quantity) > 0
               then sum(ic.quantity * ic.unit_cost) / sum(ic.quantity)
             else null
           end
    into v_weighted
    from public.inventory_consumptions ic
    where ic.order_item_id = v_item.order_item_id;

    if v_weighted is not null then
      update public.order_items
      set unit_purchase_cost_snapshot = round(v_weighted * v_multiplier, 2),
          updated_at = now()
      where id = v_item.order_item_id;
    end if;
  end loop;

  -- 4. Coût d'achat par défaut du produit aligné sur son plus ancien lot.
  select product_id into v_product_id
  from public.inventory_movements
  where id = p_movement_id;

  if v_product_id is not null then
    perform public.refresh_product_default_purchase_cost(v_product_id);
  end if;
end;
$$;

comment on function public.apply_lot_cost_propagation(uuid, numeric) is
  'Propage le coût d''un lot déjà consommé aux consommations, aux sorties liées et aux snapshots d''achat des commandes, puis rafraîchit le coût par défaut du produit.';

-- ---------- Édition générique d'un mouvement saisi manuellement ----------
create or replace function public.rpc_update_stock_movement(
  p_movement_id uuid,
  p_product_id uuid,
  p_movement_type text,
  p_quantity int,
  p_unit_cost numeric,
  p_product_variant_id uuid default null,
  p_adjustment_direction text default null,
  p_supplier_id uuid default null,
  p_invoice_reference text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_movement public.inventory_movements%rowtype;
  v_consumed int;
  v_invoice text;
begin
  select * into v_movement
  from public.inventory_movements
  where id = p_movement_id
  for update;

  if not found then
    raise exception 'MOVEMENT_NOT_FOUND';
  end if;

  if not public.can_manage_store_stock(v_movement.store_id) then
    raise exception 'FORBIDDEN';
  end if;

  -- Un mouvement généré par une commande est piloté par le FIFO : jamais édité.
  if coalesce(v_movement.source_type, '') in ('order', 'order_return') then
    raise exception 'MOVEMENT_NOT_EDITABLE';
  end if;

  if p_movement_type not in ('in', 'out', 'adjustment') then
    raise exception 'INVALID_MOVEMENT_TYPE';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'INVALID_QUANTITY';
  end if;

  if p_unit_cost is null or p_unit_cost < 0 then
    raise exception 'INVALID_UNIT_COST';
  end if;

  if not exists (
    select 1 from public.products
    where id = p_product_id and store_id = v_movement.store_id
  ) then
    raise exception 'PRODUCT_NOT_FOUND';
  end if;

  if p_product_variant_id is not null and not exists (
    select 1 from public.product_variants
    where id = p_product_variant_id and product_id = p_product_id
  ) then
    raise exception 'VARIANT_NOT_FOUND';
  end if;

  if p_supplier_id is not null and not exists (
    select 1 from public.suppliers
    where id = p_supplier_id and store_id = v_movement.store_id
  ) then
    raise exception 'SUPPLIER_NOT_FOUND';
  end if;

  -- Quantité déjà sortie depuis ce lot : elle n'est jamais réécrite en silence.
  select coalesce(sum(ic.quantity), 0)::int
  into v_consumed
  from public.inventory_consumptions ic
  where ic.inventory_in_id = p_movement_id;

  if p_movement_type = 'in' then
    if p_quantity < v_consumed then
      raise exception 'QUANTITY_BELOW_CONSUMED';
    end if;
  elsif v_consumed > 0 then
    raise exception 'MOVEMENT_HAS_CONSUMPTIONS';
  end if;

  v_invoice := nullif(btrim(p_invoice_reference), '');

  update public.inventory_movements
  set product_id = p_product_id,
      product_variant_id = p_product_variant_id,
      movement_type = p_movement_type,
      adjustment_direction = case
                               when p_movement_type = 'adjustment'
                                 then coalesce(p_adjustment_direction, 'out')
                               else null
                             end,
      supplier_id = p_supplier_id,
      quantity = p_quantity,
      remaining_qty = case
                        when p_movement_type = 'in' then p_quantity - v_consumed
                        else null
                      end,
      unit_cost = p_unit_cost,
      total_cost = p_quantity * p_unit_cost,
      invoice_number = v_invoice
  where id = p_movement_id;

  -- Le produit d'origine peut changer : son coût par défaut est rafraîchi aussi.
  if v_movement.product_id <> p_product_id then
    perform public.refresh_product_default_purchase_cost(v_movement.product_id);
  end if;

  if p_movement_type = 'in' then
    perform public.apply_lot_cost_propagation(p_movement_id, p_unit_cost);
  end if;
end;
$$;

comment on function public.rpc_update_stock_movement(uuid, uuid, text, int, numeric, uuid, text, uuid, text) is
  'Édition atomique d''un mouvement de stock manuel : conserve le restant réel (quantity - consommé) et propage le coût du lot aux sorties déjà enregistrées.';

-- ---------- Achat fournisseur : même règle de restant + propagation ----------
create or replace function public.rpc_update_stock_purchase(
  p_movement_id uuid,
  p_product_id uuid,
  p_quantity int,
  p_unit_cost numeric,
  p_product_variant_id uuid default null,
  p_supplier_id uuid default null,
  p_invoice_reference text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_movement public.inventory_movements%rowtype;
  v_purchase_id uuid;
  v_consumed int;
  v_total numeric;
  v_invoice text;
begin
  select * into v_movement
  from public.inventory_movements
  where id = p_movement_id
  for update;

  if not found then
    raise exception 'MOVEMENT_NOT_FOUND';
  end if;

  if not public.can_manage_store_stock(v_movement.store_id) then
    raise exception 'FORBIDDEN';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'INVALID_QUANTITY';
  end if;
  if p_unit_cost is null or p_unit_cost < 0 then
    raise exception 'INVALID_UNIT_COST';
  end if;
  if not exists (select 1 from public.products where id = p_product_id and store_id = v_movement.store_id) then
    raise exception 'PRODUCT_NOT_FOUND';
  end if;
  if p_product_variant_id is not null and not exists (
    select 1 from public.product_variants where id = p_product_variant_id and product_id = p_product_id
  ) then
    raise exception 'VARIANT_NOT_FOUND';
  end if;
  if p_supplier_id is not null and not exists (
    select 1 from public.suppliers where id = p_supplier_id and store_id = v_movement.store_id
  ) then
    raise exception 'SUPPLIER_NOT_FOUND';
  end if;

  -- Quantité déjà sortie depuis ce lot : elle n'est jamais réécrite en silence.
  select coalesce(sum(ic.quantity), 0)::int
  into v_consumed
  from public.inventory_consumptions ic
  where ic.inventory_in_id = p_movement_id;

  if p_quantity < v_consumed then
    raise exception 'QUANTITY_BELOW_CONSUMED';
  end if;

  select id into v_purchase_id
  from public.supplier_purchases
  where movement_id = p_movement_id;

  -- Une dette déjà (partiellement) réglée ne doit pas être modifiée en silence.
  if v_purchase_id is not null then
    if p_supplier_id is null then
      raise exception 'SUPPLIER_REQUIRED';
    end if;
    if exists (
      select 1 from public.supplier_payment_allocations a
      where a.purchase_id = v_purchase_id
    ) then
      raise exception 'PURCHASE_ALREADY_PAID';
    end if;
  end if;

  v_invoice := nullif(btrim(p_invoice_reference), '');
  v_total := p_quantity * p_unit_cost;

  update public.inventory_movements
  set product_id = p_product_id,
      product_variant_id = p_product_variant_id,
      supplier_id = p_supplier_id,
      quantity = p_quantity,
      remaining_qty = p_quantity - v_consumed,
      unit_cost = p_unit_cost,
      total_cost = v_total,
      invoice_number = v_invoice
  where id = p_movement_id;

  if v_purchase_id is not null then
    update public.supplier_purchases
    set supplier_id = p_supplier_id,
        amount_due = v_total,
        invoice_reference = v_invoice
    where id = v_purchase_id;
  end if;

  if v_movement.product_id <> p_product_id then
    perform public.refresh_product_default_purchase_cost(v_movement.product_id);
  end if;

  perform public.apply_lot_cost_propagation(p_movement_id, p_unit_cost);
end;
$$;

-- ---------- Grants ----------
revoke all on function public.apply_lot_cost_propagation(uuid, numeric) from public;
revoke all on function public.rpc_update_stock_movement(uuid, uuid, text, int, numeric, uuid, text, uuid, text) from public;
revoke all on function public.rpc_update_stock_purchase(uuid, uuid, int, numeric, uuid, uuid, text) from public;

grant execute on function public.rpc_update_stock_movement(uuid, uuid, text, int, numeric, uuid, text, uuid, text) to authenticated;
grant execute on function public.rpc_update_stock_purchase(uuid, uuid, int, numeric, uuid, uuid, text) to authenticated;
