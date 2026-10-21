-- P8.4 - Rollback verbatim des deux RPC Confirmation
-- Source : capture de l etat installe (capture-p84-rpc.json)
-- Aucune donnee touchee.

CREATE OR REPLACE FUNCTION public.rpc_order_confirmation_action(p_order_id uuid, p_action text, p_callback_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_reason_code text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_expected_status text DEFAULT NULL::text, p_expected_attempt_count integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pending_statuses text[] := array[
    'new', 'confirmation_rejected',
    'follow_up_1', 'follow_up_2', 'follow_up_3', 'follow_up_4', 'follow_up_5',
    'no_answer', 'wrong_number', 'voicemail'
  ];
  v_order public.orders%rowtype;
  v_action text;
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_agent_id uuid;
  v_max_attempts integer;
  v_auto_cancel boolean;
  v_require_reason boolean;
  v_attempt integer;
  v_attempt_number integer;
  v_from_status text;
  v_new_status text;
  v_auto_cancelled boolean := false;
  v_limit_reached boolean := false;
  v_now timestamptz := now();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_reason text := nullif(btrim(coalesce(p_reason_code, '')), '');
begin
  if v_actor is null then
    raise exception 'UNAUTHORIZED';
  end if;

  v_action := upper(btrim(coalesce(p_action, '')));
  if v_action not in ('NO_ANSWER', 'POSTPONE', 'CANCEL', 'CONFIRM') then
    raise exception 'INVALID_ACTION';
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

  select ca.id into v_agent_id
  from public.confirmation_agents ca
  join public.store_members sm on sm.id = ca.member_id
  where ca.store_id = v_order.store_id
    and sm.user_id = v_actor
  limit 1;

  if v_actor_role = 'confirmation' then
    if v_order.confirmation_agent_id is not null
       and v_order.confirmation_agent_id <> v_agent_id then
      raise exception 'FORBIDDEN';
    end if;

    if v_order.confirmation_agent_id is null and v_agent_id is not null then
      update public.orders
      set confirmation_agent_id = v_agent_id, updated_at = v_now
      where id = p_order_id;
      v_order.confirmation_agent_id := v_agent_id;
    end if;
  end if;

  -- Une commande déjà confirmée reste annulable (rétractation du client) ;
  -- les autres actions restent réservées aux commandes en attente.
  if v_action = 'CANCEL' then
    if not (v_order.status = any (v_pending_statuses) or v_order.status = 'confirmed') then
      raise exception 'ORDER_NOT_CONFIRMABLE';
    end if;
  elsif not (v_order.status = any (v_pending_statuses)) then
    raise exception 'ORDER_NOT_CONFIRMABLE';
  end if;

  if p_expected_status is not null and p_expected_status <> v_order.status then
    raise exception 'ORDER_ALREADY_UPDATED';
  end if;

  if p_expected_attempt_count is not null
     and p_expected_attempt_count <> coalesce(v_order.confirmation_attempt_count, 0) then
    raise exception 'ORDER_ALREADY_UPDATED';
  end if;

  select
    coalesce(cs.max_attempts, 6),
    coalesce(cs.auto_cancel_on_max_attempts, true),
    coalesce(cs.require_cancellation_reason, true)
  into v_max_attempts, v_auto_cancel, v_require_reason
  from (select 1) seed
  left join public.confirmation_settings cs on cs.store_id = v_order.store_id;

  if v_max_attempts < 1 then
    v_max_attempts := 1;
  end if;

  v_agent_id := coalesce(v_order.confirmation_agent_id, v_agent_id);

  v_attempt := coalesce(v_order.confirmation_attempt_count, 0);
  v_from_status := v_order.status;
  v_new_status := v_order.status;

  if v_action = 'NO_ANSWER' then
    v_attempt := v_attempt + 1;
    v_attempt_number := v_attempt;

    if v_attempt >= v_max_attempts then
      v_limit_reached := true;
      if v_auto_cancel then
        v_new_status := 'cancelled';
        v_auto_cancelled := true;
      else
        v_new_status := 'no_answer';
      end if;
    else
      v_new_status := case
        when v_attempt = 1 then 'follow_up_1'
        when v_attempt = 2 then 'follow_up_2'
        when v_attempt = 3 then 'follow_up_3'
        when v_attempt = 4 then 'follow_up_4'
        when v_attempt = 5 then 'follow_up_5'
        else 'no_answer'
      end;
    end if;

    update public.orders
    set confirmation_attempt_count = v_attempt,
        status = v_new_status,
        next_callback_at = null,
        cancellation_reason_code = case
          when v_auto_cancelled then 'max_attempts_reached'
          else cancellation_reason_code
        end,
        cancellation_note = case
          when v_auto_cancelled then coalesce(v_note, 'Nombre maximal de tentatives atteint')
          else cancellation_note
        end,
        confirmation_last_action_at = v_now,
        confirmation_last_actor_user_id = v_actor,
        last_status_update_at = v_now,
        delivery_status_source = 'manual',
        updated_at = v_now
    where id = p_order_id;

    insert into public.order_confirmation_events (
      store_id, order_id, actor_user_id, agent_id, event_type,
      from_status, to_status, attempt_number, reason_code, note, metadata
    ) values (
      v_order.store_id, p_order_id, v_actor, v_agent_id, 'no_answer',
      v_from_status, v_new_status, v_attempt_number, null, v_note,
      jsonb_build_object('maxAttempts', v_max_attempts, 'limitReached', v_limit_reached)
    );

    if v_auto_cancelled then
      insert into public.order_confirmation_events (
        store_id, order_id, actor_user_id, agent_id, event_type,
        from_status, to_status, attempt_number, reason_code, note, metadata
      ) values (
        v_order.store_id, p_order_id, v_actor, v_agent_id, 'cancelled_max_attempts',
        v_from_status, 'cancelled', v_attempt_number, 'max_attempts_reached',
        coalesce(v_note, 'Nombre maximal de tentatives atteint'),
        jsonb_build_object('maxAttempts', v_max_attempts)
      );
    end if;

  elsif v_action = 'POSTPONE' then
    if p_callback_at is null then
      raise exception 'MISSING_CALLBACK_DATETIME';
    end if;
    if p_callback_at <= v_now then
      raise exception 'INVALID_CALLBACK_DATETIME';
    end if;

    update public.orders
    set next_callback_at = p_callback_at,
        confirmation_last_action_at = v_now,
        confirmation_last_actor_user_id = v_actor,
        updated_at = v_now
    where id = p_order_id;

    insert into public.order_confirmation_events (
      store_id, order_id, actor_user_id, agent_id, event_type,
      from_status, to_status, attempt_number, callback_at, reason_code, note, metadata
    ) values (
      v_order.store_id, p_order_id, v_actor, v_agent_id, 'postponed',
      v_from_status, v_new_status, null, p_callback_at, null, v_note,
      jsonb_build_object('attemptCount', v_attempt)
    );

  elsif v_action = 'CANCEL' then
    if v_require_reason and v_reason is null then
      raise exception 'MISSING_CANCELLATION_REASON';
    end if;
    if v_reason = 'other' and v_note is null then
      raise exception 'MISSING_CANCELLATION_NOTE';
    end if;

    v_new_status := 'cancelled';

    update public.orders
    set status = v_new_status,
        next_callback_at = null,
        cancellation_reason_code = coalesce(v_reason, 'other'),
        cancellation_note = v_note,
        confirmation_last_action_at = v_now,
        confirmation_last_actor_user_id = v_actor,
        last_status_update_at = v_now,
        delivery_status_source = 'manual',
        updated_at = v_now
    where id = p_order_id;

    insert into public.order_confirmation_events (
      store_id, order_id, actor_user_id, agent_id, event_type,
      from_status, to_status, attempt_number, reason_code, note, metadata
    ) values (
      v_order.store_id, p_order_id, v_actor, v_agent_id, 'cancelled_manual',
      v_from_status, v_new_status, null, coalesce(v_reason, 'other'), v_note,
      jsonb_build_object('attemptCount', v_attempt)
    );

  else
    v_new_status := 'confirmed';

    update public.orders
    set status = v_new_status,
        next_callback_at = null,
        cancellation_reason_code = null,
        cancellation_note = null,
        confirmation_last_action_at = v_now,
        confirmation_last_actor_user_id = v_actor,
        last_status_update_at = v_now,
        delivery_status_source = 'manual',
        updated_at = v_now
    where id = p_order_id;

    insert into public.order_confirmation_events (
      store_id, order_id, actor_user_id, agent_id, event_type,
      from_status, to_status, attempt_number, reason_code, note, metadata
    ) values (
      v_order.store_id, p_order_id, v_actor, v_agent_id, 'confirmed',
      v_from_status, v_new_status, null, null, v_note,
      jsonb_build_object('attemptCount', v_attempt)
    );
  end if;

  return jsonb_build_object(
    'orderId', p_order_id,
    'action', v_action,
    'fromStatus', v_from_status,
    'status', v_new_status,
    'attemptCount', v_attempt,
    'attemptNumber', v_attempt_number,
    'maxAttempts', v_max_attempts,
    'autoCancelled', v_auto_cancelled,
    'limitReached', v_limit_reached
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_update_confirmation_order_details(p_order_id uuid, p_customer_name text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_city_key numeric DEFAULT NULL::numeric, p_delivery_note text DEFAULT NULL::text, p_delivery_company_id uuid DEFAULT NULL::uuid, p_delivery_mode text DEFAULT NULL::text, p_items jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

revoke all on function public.rpc_order_confirmation_action(p_order_id uuid, p_action text, p_callback_at timestamp with time zone, p_reason_code text, p_note text, p_expected_status text, p_expected_attempt_count integer) from public;
revoke all on function public.rpc_order_confirmation_action(p_order_id uuid, p_action text, p_callback_at timestamp with time zone, p_reason_code text, p_note text, p_expected_status text, p_expected_attempt_count integer) from anon;
grant execute on function public.rpc_order_confirmation_action(p_order_id uuid, p_action text, p_callback_at timestamp with time zone, p_reason_code text, p_note text, p_expected_status text, p_expected_attempt_count integer) to authenticated, service_role;

revoke all on function public.rpc_update_confirmation_order_details(p_order_id uuid, p_customer_name text, p_phone text, p_address text, p_city text, p_city_key numeric, p_delivery_note text, p_delivery_company_id uuid, p_delivery_mode text, p_items jsonb) from public;
revoke all on function public.rpc_update_confirmation_order_details(p_order_id uuid, p_customer_name text, p_phone text, p_address text, p_city text, p_city_key numeric, p_delivery_note text, p_delivery_company_id uuid, p_delivery_mode text, p_items jsonb) from anon;
grant execute on function public.rpc_update_confirmation_order_details(p_order_id uuid, p_customer_name text, p_phone text, p_address text, p_city text, p_city_key numeric, p_delivery_note text, p_delivery_company_id uuid, p_delivery_mode text, p_items jsonb) to authenticated, service_role;
