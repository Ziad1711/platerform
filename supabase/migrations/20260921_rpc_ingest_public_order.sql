-- Ingestion atomique d'une commande API publique.
-- 1) Réserve la clé d'idempotence (verrou logique via contrainte unique)
-- 2) Crée la commande + ses articles dans la même transaction
-- 3) Rattache l'idempotence à la commande
-- En cas d'erreur, tout est annulé : aucune commande orpheline.

create or replace function public.rpc_ingest_public_order(
  p_store_id uuid,
  p_api_key_id uuid,
  p_idempotency_key text,
  p_payload_hash text,
  p_order jsonb,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reservation_id uuid;
  v_existing_hash text;
  v_existing_order_id uuid;
  v_order_id uuid;
  v_item jsonb;
  v_items_total numeric := 0;
  v_quantity integer;
  v_unit_price numeric;
begin
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    return jsonb_build_object('status', 'rejected', 'error', 'MISSING_IDEMPOTENCY_KEY');
  end if;

  -- 1) Réservation atomique de la clé d'idempotence
  insert into public.public_order_idempotency (
    store_id, api_key_id, idempotency_key, payload_hash
  )
  values (
    p_store_id, p_api_key_id, trim(p_idempotency_key), p_payload_hash
  )
  on conflict (store_id, idempotency_key) do nothing
  returning id into v_reservation_id;

  if v_reservation_id is null then
    select payload_hash, order_id
    into v_existing_hash, v_existing_order_id
    from public.public_order_idempotency
    where store_id = p_store_id
      and idempotency_key = trim(p_idempotency_key);

    if v_existing_hash is distinct from p_payload_hash then
      return jsonb_build_object('status', 'conflict');
    end if;

    return jsonb_build_object('status', 'duplicate', 'order_id', v_existing_order_id);
  end if;

  -- 2) Commande
  insert into public.orders (
    store_id,
    external_order_id,
    customer_name,
    phone,
    city,
    address,
    total_selling_price,
    delivery_charge_to_customer,
    delivery_fee,
    delivery_note,
    discount_type,
    discount_value,
    discount_amount,
    subtotal_amount,
    source,
    order_date,
    status
  )
  values (
    p_store_id,
    nullif(p_order->>'external_order_id', ''),
    p_order->>'customer_name',
    nullif(p_order->>'phone', ''),
    nullif(p_order->>'city', ''),
    nullif(p_order->>'address', ''),
    coalesce((p_order->>'total_selling_price')::numeric, 0),
    coalesce((p_order->>'delivery_charge_to_customer')::numeric, 0),
    0,
    nullif(p_order->>'delivery_note', ''),
    nullif(p_order->>'discount_type', ''),
    coalesce((p_order->>'discount_value')::numeric, 0),
    coalesce((p_order->>'discount_amount')::numeric, 0),
    coalesce((p_order->>'subtotal_amount')::numeric, 0),
    coalesce(nullif(p_order->>'source', ''), 'organic'),
    coalesce((p_order->>'order_date')::timestamptz, now()),
    'new'
  )
  returning id into v_order_id;

  -- 3) Articles
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_quantity := greatest(coalesce((v_item->>'quantity')::integer, 1), 1);
    v_unit_price := coalesce((v_item->>'unit_selling_price')::numeric, 0);

    insert into public.order_items (
      store_id,
      order_id,
      product_id,
      product_variant_id,
      quantity,
      unit_selling_price,
      unit_purchase_cost_snapshot,
      item_type
    )
    values (
      p_store_id,
      v_order_id,
      (v_item->>'product_id')::uuid,
      nullif(v_item->>'product_variant_id', '')::uuid,
      v_quantity,
      v_unit_price,
      0,
      'product'
    );

    v_items_total := v_items_total + (v_quantity * v_unit_price);
  end loop;

  -- 4) Rattachement de l'idempotence
  update public.public_order_idempotency
  set order_id = v_order_id
  where id = v_reservation_id;

  return jsonb_build_object(
    'status', 'accepted',
    'order_id', v_order_id,
    'items_total', v_items_total
  );
end;
$$;

comment on function public.rpc_ingest_public_order(uuid, uuid, text, text, jsonb, jsonb) is
  'Crée une commande API publique de façon atomique avec réservation d''idempotence. Retourne accepted, duplicate ou conflict.';

revoke all on function public.rpc_ingest_public_order(uuid, uuid, text, text, jsonb, jsonb) from public;
grant execute on function public.rpc_ingest_public_order(uuid, uuid, text, text, jsonb, jsonb) to service_role;
