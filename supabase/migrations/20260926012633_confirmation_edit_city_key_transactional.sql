-- ============================================================
-- Confirmation — effacement transactionnel de la clé ville
-- Si la ville change sans nouvelle clé, la clé transporteur est effacée
-- dans la même transaction que le reste de l'édition.
-- ============================================================

create or replace function public.rpc_update_confirmation_order_details(
  p_order_id uuid,
  p_customer_name text default null,
  p_phone text default null,
  p_address text default null,
  p_city text default null,
  p_city_key numeric default null,
  p_delivery_note text default null,
  p_delivery_company_id uuid default null,
  p_delivery_mode text default null,
  p_items jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pending_statuses text[] := array[
    'new', 'confirmation_rejected',
    'follow_up_1', 'follow_up_2', 'follow_up_3', 'follow_up_4', 'follow_up_5',
    'no_answer', 'wrong_number', 'voicemail'
  ];
  v_order public.orders%rowtype;
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_agent_id uuid;
  v_now timestamptz := now();
  v_customer_name text;
  v_phone text;
  v_address text;
  v_city text;
  v_delivery_note text;
  v_delivery_company_id uuid;
  v_delivery_mode text;
  v_delivery_city_external_id text;
  v_resolved jsonb := '[]'::jsonb;
  v_item jsonb;
  v_product_id uuid;
  v_variant_id uuid;
  v_quantity integer;
  v_price numeric;
  v_cost numeric;
  v_default_cost numeric;
  v_override text;
  v_item_type text;
  v_customer_changed boolean := false;
  v_delivery_changed boolean := false;
  v_items_changed boolean := false;
  v_before jsonb;
  v_after jsonb;
  v_item_count integer := 0;
begin
  if v_actor is null then
    raise exception 'UNAUTHORIZED';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if exists (
    select 1 from public.stores s
    where s.id = v_order.store_id and s.owner_user_id = v_actor
  ) then
    v_actor_role := 'owner';
  else
    select sm.role into v_actor_role
    from public.store_members sm
    where sm.store_id = v_order.store_id
      and sm.user_id = v_actor
      and sm.status = 'active'
    limit 1;
  end if;

  if v_actor_role not in ('owner', 'admin', 'confirmation') then
    raise exception 'FORBIDDEN';
  end if;

  if v_actor_role = 'confirmation' and not public.is_order_assigned_to_actor(p_order_id) then
    raise exception 'FORBIDDEN';
  end if;

  if not (v_order.status = any (v_pending_statuses)) then
    raise exception 'ORDER_NOT_EDITABLE';
  end if;

  if coalesce(btrim(v_order.tracking_number), '') <> '' then
    raise exception 'ORDER_ALREADY_SHIPPED';
  end if;

  select ca.id into v_agent_id
  from public.confirmation_agents ca
  join public.store_members sm on sm.id = ca.member_id
  where ca.store_id = v_order.store_id
    and sm.user_id = v_actor
  limit 1;

  v_agent_id := coalesce(v_order.confirmation_agent_id, v_agent_id);

  -- ---------- Informations client ----------

  if p_customer_name is not null then
    v_customer_name := btrim(p_customer_name);
    if v_customer_name = '' then
      raise exception 'MISSING_CUSTOMER_NAME';
    end if;
  else
    v_customer_name := v_order.customer_name;
  end if;

  if p_phone is not null then
    v_phone := btrim(p_phone);
    if v_phone = '' then
      raise exception 'MISSING_PHONE';
    end if;
  else
    v_phone := v_order.phone;
  end if;

  v_address := case when p_address is null then v_order.address else btrim(p_address) end;
  v_city := case when p_city is null then v_order.city else btrim(p_city) end;

  if v_city is not null and v_city = '' then
    raise exception 'MISSING_CITY';
  end if;

  v_customer_changed :=
    v_customer_name is distinct from v_order.customer_name
    or v_phone is distinct from v_order.phone
    or v_address is distinct from v_order.address
    or v_city is distinct from v_order.city
    or (p_city_key is not null
        and p_city_key::text is distinct from coalesce(v_order.delivery_city_external_id, ''));

  -- ---------- Livraison ----------

  v_delivery_note := case when p_delivery_note is null then v_order.delivery_note else btrim(p_delivery_note) end;
  v_delivery_mode := lower(btrim(coalesce(p_delivery_mode, '')));

  if v_delivery_mode = 'internal' then
    v_delivery_company_id := null;
  elsif v_delivery_mode = 'shipping' then
    if p_delivery_company_id is null then
      raise exception 'MISSING_DELIVERY_COMPANY';
    end if;
    if not exists (
      select 1 from public.delivery_companies dc
      where dc.id = p_delivery_company_id and dc.store_id = v_order.store_id
    ) then
      raise exception 'DELIVERY_COMPANY_NOT_IN_STORE';
    end if;
    v_delivery_company_id := p_delivery_company_id;
  else
    v_delivery_company_id := v_order.delivery_company_id;
  end if;

  v_delivery_changed :=
    v_delivery_note is distinct from v_order.delivery_note
    or v_delivery_company_id is distinct from v_order.delivery_company_id;

  -- ---------- Produits, variantes, quantités, prix ----------

  if p_items is not null then
    if jsonb_typeof(p_items) <> 'array' then
      raise exception 'INVALID_ITEMS';
    end if;

    if jsonb_array_length(p_items) = 0 then
      raise exception 'EMPTY_ITEMS';
    end if;

    v_before := (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'product_id', oi.product_id,
            'variant_id', oi.product_variant_id,
            'quantity', oi.quantity,
            'unit_selling_price', oi.unit_selling_price
          )
        ),
        '[]'::jsonb
      )
      from public.order_items oi
      where oi.order_id = p_order_id
    );

    for v_item in select * from jsonb_array_elements(p_items) loop
      v_product_id := nullif(btrim(coalesce(v_item->>'product_id', '')), '')::uuid;
      if v_product_id is null then
        raise exception 'INVALID_ITEM_PRODUCT';
      end if;

      v_quantity := coalesce((v_item->>'quantity')::integer, 0);
      if v_quantity <= 0 then
        raise exception 'INVALID_ITEM_QUANTITY';
      end if;

      v_price := coalesce((v_item->>'unit_selling_price')::numeric, 0);
      if v_price < 0 then
        raise exception 'INVALID_ITEM_PRICE';
      end if;

      select coalesce(p.default_purchase_cost, 0)
      into v_default_cost
      from public.products p
      where p.id = v_product_id
        and p.store_id = v_order.store_id;

      if not found then
        raise exception 'PRODUCT_NOT_IN_STORE';
      end if;

      v_cost := v_default_cost;
      v_variant_id := nullif(btrim(coalesce(v_item->>'product_variant_id', '')), '')::uuid;

      if v_variant_id is not null then
        select coalesce(pv.purchase_cost, v_default_cost)
        into v_cost
        from public.product_variants pv
        where pv.id = v_variant_id
          and pv.product_id = v_product_id
          and pv.store_id = v_order.store_id;

        if not found then
          raise exception 'VARIANT_NOT_IN_PRODUCT';
        end if;
      end if;

      v_override := nullif(btrim(coalesce(v_item->>'product_name_override', '')), '');
      v_item_type := coalesce(nullif(btrim(coalesce(v_item->>'item_type', '')), ''), 'product');

      v_resolved := v_resolved || jsonb_build_array(
        jsonb_build_object(
          'product_id', v_product_id,
          'product_variant_id', v_variant_id,
          'quantity', v_quantity,
          'unit_selling_price', v_price,
          'unit_purchase_cost_snapshot', v_cost,
          'product_name_override', v_override,
          'item_type', v_item_type
        )
      );
    end loop;

    delete from public.order_items where order_id = p_order_id;

    insert into public.order_items (
      store_id, order_id, product_id, product_variant_id, quantity,
      unit_selling_price, unit_purchase_cost_snapshot, product_name_override, item_type
    )
    select
      v_order.store_id,
      p_order_id,
      (item->>'product_id')::uuid,
      nullif(item->>'product_variant_id', '')::uuid,
      (item->>'quantity')::integer,
      (item->>'unit_selling_price')::numeric,
      coalesce((item->>'unit_purchase_cost_snapshot')::numeric, 0),
      nullif(item->>'product_name_override', ''),
      coalesce(nullif(item->>'item_type', ''), 'product')
    from jsonb_array_elements(v_resolved) as item;

    v_items_changed := true;
    v_item_count := jsonb_array_length(v_resolved);
  end if;

  -- ---------- Enregistrement de la commande ----------

  -- Clé transporteur : si une clé est fournie, on la prend ; sinon on la conserve,
  -- sauf si la ville a changé (dans ce cas on l'efface pour forcer la résolution).
  v_delivery_city_external_id := case
    when p_city_key is not null then p_city_key::text
    when v_city is distinct from v_order.city then null
    else v_order.delivery_city_external_id
  end;

  update public.orders
  set customer_name = v_customer_name,
      phone = v_phone,
      address = v_address,
      city = v_city,
      delivery_city_external_id = v_delivery_city_external_id,
      delivery_note = v_delivery_note,
      delivery_company_id = v_delivery_company_id,
      confirmation_last_action_at = v_now,
      confirmation_last_actor_user_id = v_actor,
      updated_at = v_now
  where id = p_order_id;

  -- ---------- Journal des modifications ----------

  if v_customer_changed then
    insert into public.order_confirmation_events (
      store_id, order_id, actor_user_id, agent_id, event_type,
      from_status, to_status, metadata
    ) values (
      v_order.store_id, p_order_id, v_actor, v_agent_id,
      'customer_information_updated', v_order.status, v_order.status,
      jsonb_build_object(
        'before', jsonb_build_object(
          'customer_name', v_order.customer_name,
          'phone', v_order.phone,
          'address', v_order.address,
          'city', v_order.city
        ),
        'after', jsonb_build_object(
          'customer_name', v_customer_name,
          'phone', v_phone,
          'address', v_address,
          'city', v_city
        )
      )
    );
  end if;

  if v_items_changed then
    insert into public.order_confirmation_events (
      store_id, order_id, actor_user_id, agent_id, event_type,
      from_status, to_status, metadata
    ) values (
      v_order.store_id, p_order_id, v_actor, v_agent_id,
      'order_items_updated', v_order.status, v_order.status,
      jsonb_build_object(
        'before', coalesce(v_before, '[]'::jsonb),
        'after', v_resolved,
        'itemCount', v_item_count
      )
    );
  end if;

  if v_delivery_changed then
    insert into public.order_confirmation_events (
      store_id, order_id, actor_user_id, agent_id, event_type,
      from_status, to_status, metadata
    ) values (
      v_order.store_id, p_order_id, v_actor, v_agent_id,
      'delivery_information_updated', v_order.status, v_order.status,
      jsonb_build_object(
        'before', jsonb_build_object(
          'delivery_note', v_order.delivery_note,
          'delivery_company_id', v_order.delivery_company_id
        ),
        'after', jsonb_build_object(
          'delivery_note', v_delivery_note,
          'delivery_company_id', v_delivery_company_id
        )
      )
    );
  end if;

  -- ---------- Retour ----------

  select jsonb_build_object(
    'orderId', o.id,
    'status', o.status,
    'attemptCount', coalesce(o.confirmation_attempt_count, 0),
    'customerName', o.customer_name,
    'phone', o.phone,
    'address', o.address,
    'city', o.city,
    'deliveryNote', o.delivery_note,
    'deliveryCompanyId', o.delivery_company_id,
    'subtotalAmount', coalesce(o.subtotal_amount, 0),
    'totalSellingPrice', coalesce(o.total_selling_price, 0),
    'itemCount', (
      select count(*) from public.order_items oi where oi.order_id = o.id
    ),
    'customerChanged', v_customer_changed,
    'itemsChanged', v_items_changed,
    'deliveryChanged', v_delivery_changed
  )
  into v_after
  from public.orders o
  where o.id = p_order_id;

  return v_after;
end;
$$;

revoke all on function public.rpc_update_confirmation_order_details(uuid, text, text, text, text, numeric, text, uuid, text, jsonb) from public;
grant execute on function public.rpc_update_confirmation_order_details(uuid, text, text, text, text, numeric, text, uuid, text, jsonb) to authenticated, service_role;
