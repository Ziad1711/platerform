-- ============================================================
-- Actions groupées sur les commandes (page Ventes)
-- 1) rpc_delete_orders    : suppression multiple + restitution du stock FIFO
-- 2) rpc_duplicate_orders : duplication multiple en « Nouvelle »
-- Réservées au propriétaire et aux administrateurs du store.
-- ============================================================

-- ---------- Suppression groupée ----------

create or replace function public.rpc_delete_orders(p_order_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
  v_order public.orders%rowtype;
  v_deleted integer := 0;
  v_restored integer := 0;
  v_skipped jsonb := '[]'::jsonb;
begin
  if v_actor is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if p_order_ids is null or array_length(p_order_ids, 1) is null then
    raise exception 'MISSING_ORDER_IDS';
  end if;

  foreach v_id in array p_order_ids loop
    select * into v_order from public.orders where id = v_id for update;

    if not found then
      v_skipped := v_skipped || to_jsonb(v_id::text);
      continue;
    end if;

    if not exists (
      select 1 from public.store_members sm
      where sm.store_id = v_order.store_id
        and sm.user_id = v_actor
        and sm.status = 'active'
        and sm.role in ('owner', 'admin')
    ) and not exists (
      select 1 from public.stores s
      where s.id = v_order.store_id and s.owner_user_id = v_actor
    ) then
      raise exception 'FORBIDDEN';
    end if;

    -- Une sortie de stock liée à la commande ? (détecté avant le nettoyage)
    if exists (
      select 1 from public.inventory_movements im
      where im.source_type = 'order'
        and im.source_id = v_id
        and im.movement_type = 'out'
    ) then
      v_restored := v_restored + 1;
    end if;

    -- `restore_fifo_for_order` restaure le stock consommé puis supprime les
    -- mouvements de sortie de la commande. Sans consommation, il ne fait rien.
    perform public.restore_fifo_for_order(v_id, true);

    -- order_items, order_confirmation_events et inventory_consumptions sont
    -- supprimés par cascade.
    delete from public.orders where id = v_id;
    v_deleted := v_deleted + 1;
  end loop;

  return jsonb_build_object(
    'deleted', v_deleted,
    'restored', v_restored,
    'skipped', v_skipped
  );
end;
$$;

comment on function public.rpc_delete_orders(uuid[]) is
  'Suppression multiple de commandes du store. Restitue le stock FIFO des commandes déjà sorties. Owner/admin uniquement.';

revoke all on function public.rpc_delete_orders(uuid[]) from public;
grant execute on function public.rpc_delete_orders(uuid[]) to authenticated, service_role;

-- ---------- Duplication groupée ----------

create or replace function public.rpc_duplicate_orders(p_order_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
  v_order public.orders%rowtype;
  v_new_id uuid;
  v_created integer := 0;
  v_new_ids jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
begin
  if v_actor is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if p_order_ids is null or array_length(p_order_ids, 1) is null then
    raise exception 'MISSING_ORDER_IDS';
  end if;

  foreach v_id in array p_order_ids loop
    select * into v_order from public.orders where id = v_id;

    if not found then
      v_skipped := v_skipped || to_jsonb(v_id::text);
      continue;
    end if;

    if not exists (
      select 1 from public.store_members sm
      where sm.store_id = v_order.store_id
        and sm.user_id = v_actor
        and sm.status = 'active'
        and sm.role in ('owner', 'admin')
    ) and not exists (
      select 1 from public.stores s
      where s.id = v_order.store_id and s.owner_user_id = v_actor
    ) then
      raise exception 'FORBIDDEN';
    end if;

    -- La copie repart d'une commande neuve : aucun suivi, aucun colis,
    -- aucun coût publicitaire ou de confirmation déjà affecté.
    insert into public.orders (
      store_id,
      order_date,
      customer_name,
      phone,
      address,
      city,
      delivery_city_external_id,
      source,
      status,
      discount_type,
      discount_amount,
      delivery_charge_to_customer,
      delivery_company_id,
      delivery_note
    ) values (
      v_order.store_id,
      now(),
      v_order.customer_name,
      v_order.phone,
      v_order.address,
      v_order.city,
      v_order.delivery_city_external_id,
      coalesce(v_order.source, 'organic'),
      'new',
      v_order.discount_type,
      coalesce(v_order.discount_amount, 0),
      coalesce(v_order.delivery_charge_to_customer, 0),
      v_order.delivery_company_id,
      v_order.delivery_note
    )
    returning id into v_new_id;

    insert into public.order_items (
      store_id,
      order_id,
      product_id,
      product_variant_id,
      quantity,
      unit_selling_price,
      unit_purchase_cost_snapshot,
      product_name_override,
      item_type
    )
    select
      v_order.store_id,
      v_new_id,
      oi.product_id,
      oi.product_variant_id,
      oi.quantity,
      oi.unit_selling_price,
      oi.unit_purchase_cost_snapshot,
      oi.product_name_override,
      coalesce(oi.item_type, 'product')
    from public.order_items oi
    where oi.order_id = v_id;

    v_created := v_created + 1;
    v_new_ids := v_new_ids || to_jsonb(v_new_id::text);
  end loop;

  return jsonb_build_object(
    'created', v_created,
    'orderIds', v_new_ids,
    'skipped', v_skipped
  );
end;
$$;

comment on function public.rpc_duplicate_orders(uuid[]) is
  'Duplication multiple de commandes du store en statut « Nouvelle ». Owner/admin uniquement.';

revoke all on function public.rpc_duplicate_orders(uuid[]) from public;
grant execute on function public.rpc_duplicate_orders(uuid[]) to authenticated, service_role;

