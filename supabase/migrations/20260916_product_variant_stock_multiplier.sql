-- Multiplicateur de stock par variante (packs quantité: 1 unité, 2 unités, 3 unités...).
-- Le stock physique reste géré au niveau du produit; la variante indique combien
-- d'unités physiques une unité vendue consomme.

alter table public.product_variants
  add column if not exists stock_multiplier integer not null default 1;

alter table public.product_variants
  drop constraint if exists product_variants_stock_multiplier_check;

alter table public.product_variants
  add constraint product_variants_stock_multiplier_check
  check (stock_multiplier >= 1 and stock_multiplier <= 999);

comment on column public.product_variants.stock_multiplier is
  'Nombre d''unités physiques consommées par unité vendue de cette variante (packs: 1, 2, 3...). Le stock reste géré au niveau du produit.';

create or replace function public.apply_fifo_for_order(p_order_id uuid)
 returns void
 language plpgsql
as $function$
declare
  v_order public.orders%rowtype;
  v_item public.order_items%rowtype;
  v_needed integer;
  v_take integer;
  v_out_id uuid;
  v_slot record;
  v_weighted_cost numeric;
  v_multiplier integer;
begin
  select * into v_order
  from public.orders
  where id = p_order_id;

  if not found then
    raise exception 'Order % introuvable', p_order_id;
  end if;

  if v_order.status not in ('picked_up', 'sent', 'delivered') then
    return;
  end if;

  if exists (
    select 1
    from public.inventory_movements im
    where im.source_type = 'order'
      and im.source_id = p_order_id
      and im.movement_type = 'out'
  ) then
    return;
  end if;

  for v_item in
    select *
    from public.order_items oi
    where oi.order_id = p_order_id
    order by oi.id
  loop
    -- Les variantes de type pack consomment plusieurs unités physiques par unité vendue.
    select greatest(coalesce(pv.stock_multiplier, 1), 1)
    into v_multiplier
    from public.product_variants pv
    where pv.id = v_item.product_variant_id;

    v_multiplier := coalesce(v_multiplier, 1);
    v_needed := greatest(coalesce(v_item.quantity, 1), 1) * v_multiplier;

    while v_needed > 0 loop
      select im.id, im.remaining_qty, coalesce(im.unit_cost, 0) as unit_cost
      into v_slot
      from public.inventory_movements im
      where im.store_id = v_order.store_id
        and im.product_id = v_item.product_id
        and im.movement_type = 'in'
        and coalesce(im.remaining_qty, 0) > 0
      order by
        case when im.source_type = 'order_return' then 0 else 1 end,
        case when im.source_type = 'order_return' then im.created_at end desc nulls last,
        case when im.source_type = 'order_return' then null else im.created_at end asc nulls last,
        im.id
      for update skip locked
      limit 1;

      if not found then
        raise exception 'Stock insuffisant pour product_id % (order_id %)', v_item.product_id, p_order_id;
      end if;

      v_take := least(v_needed, v_slot.remaining_qty);

      insert into public.inventory_movements (
        store_id,
        product_id,
        quantity,
        movement_type,
        unit_cost,
        total_cost,
        source_type,
        source_id,
        remaining_qty
      )
      values (
        v_order.store_id,
        v_item.product_id,
        v_take,
        'out',
        v_slot.unit_cost,
        v_take * v_slot.unit_cost,
        'order',
        p_order_id,
        null
      )
      returning id into v_out_id;

      update public.inventory_movements
      set remaining_qty = remaining_qty - v_take
      where id = v_slot.id;

      insert into public.inventory_consumptions (
        store_id,
        product_id,
        order_id,
        order_item_id,
        inventory_in_id,
        inventory_out_id,
        quantity,
        unit_cost
      )
      values (
        v_order.store_id,
        v_item.product_id,
        p_order_id,
        v_item.id,
        v_slot.id,
        v_out_id,
        v_take,
        v_slot.unit_cost
      );

      v_needed := v_needed - v_take;
    end loop;

    select
      case
        when sum(ic.quantity) > 0
          then sum(ic.quantity * ic.unit_cost) / sum(ic.quantity)
        else null
      end
    into v_weighted_cost
    from public.inventory_consumptions ic
    where ic.order_item_id = v_item.id;

    if v_weighted_cost is not null then
      update public.order_items
      set unit_purchase_cost_snapshot = v_weighted_cost,
          updated_at = now()
      where id = v_item.id;
    end if;

    perform public.refresh_product_default_purchase_cost(v_item.product_id);
  end loop;
end;
$function$;
