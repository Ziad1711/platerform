-- ============================================================
-- Lightfunnels : durcissement de l'import d'une commande
--
-- Deux verrous ajoutés à `rpc_import_lightfunnels_order` :
--   1. la **liaison** doit exister (integration + store Jisra + boutique distante) : la
--      fonction ne peut plus servir à créer une commande « Lightfunnels » sans boutique liée ;
--   2. pour un appel avec session utilisateur, seuls les rôles qui détiennent à la fois
--      `integrations.manage` et `sales.write` sont acceptés (owner/admin) — sans cela, un rôle
--      autorisé à écrire des commandes (livraison, comptabilité, stock) contournait la route.
--
-- La fonction reste SECURITY INVOKER : la RLS Jisra s'applique toujours aux écritures.
-- ============================================================

drop function if exists public.rpc_import_lightfunnels_order(uuid, uuid, uuid, text, jsonb, jsonb, jsonb, jsonb);

create or replace function public.rpc_import_lightfunnels_order(
  p_integration_id uuid,
  p_user_id uuid,
  p_store_id uuid,
  p_lightfunnels_store_id text,
  p_external_order_id text,
  p_order jsonb,
  p_items jsonb,
  p_payload jsonb,
  p_external jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_caller uuid := auth.uid();
  v_owner uuid;
  v_existing uuid;
  v_order_id uuid;
  v_item jsonb;
  v_quantity integer;
  v_unit numeric;
  v_items_total numeric := 0;
  v_delivery numeric;
  v_rounding numeric;
  v_target numeric;
  v_discount numeric;
  v_reconciled boolean := true;
  v_inserted integer := 0;
begin
  -- Identité : session utilisateur, ou service_role (webhook) qui doit fournir p_user_id.
  v_owner := coalesce(v_caller, case when current_user = 'service_role' then p_user_id end);

  if v_owner is null then
    return jsonb_build_object('status', 'rejected', 'error', 'UNAUTHORIZED');
  end if;

  if coalesce(btrim(p_external_order_id), '') = '' then
    return jsonb_build_object('status', 'rejected', 'error', 'MISSING_EXTERNAL_ORDER_ID');
  end if;

  if not exists (
    select 1 from public.integrations i
    where i.id = p_integration_id
      and i.user_id = v_owner
      and i.provider = 'lightfunnels'
  ) then
    return jsonb_build_object('status', 'rejected', 'error', 'FORBIDDEN_INTEGRATION');
  end if;

  if not exists (
    select 1 from public.store_members sm
    where sm.store_id = p_store_id and sm.user_id = v_owner and sm.status = 'active'
  ) and not exists (
    select 1 from public.stores s
    where s.id = p_store_id and s.owner_user_id = v_owner
  ) then
    return jsonb_build_object('status', 'rejected', 'error', 'FORBIDDEN_STORE');
  end if;

  -- Liaison obligatoire : aucune commande ne peut être importée dans un store sans
  -- rattachement explicite à cette boutique distante.
  if not exists (
    select 1 from public.lightfunnels_store_bindings b
    where b.integration_id = p_integration_id
      and b.store_id = p_store_id
      and b.lightfunnels_store_id = btrim(coalesce(p_lightfunnels_store_id, ''))
  ) then
    return jsonb_build_object('status', 'rejected', 'error', 'FORBIDDEN_BINDING');
  end if;

  -- Rôles habilités : un appel avec session ne peut pas élargir les droits de la route.
  if v_caller is not null
     and not exists (
       select 1 from public.store_members sm
       where sm.store_id = p_store_id
         and sm.user_id = v_caller
         and sm.status = 'active'
         and sm.role in ('owner', 'admin')
     )
     and not exists (
       select 1 from public.stores s
       where s.id = p_store_id and s.owner_user_id = v_caller
     ) then
    return jsonb_build_object('status', 'rejected', 'error', 'FORBIDDEN_ROLE');
  end if;

  -- Sérialise les imports concurrents de la même commande distante.
  perform pg_advisory_xact_lock(hashtextextended(p_integration_id::text || ':' || p_external_order_id, 0));

  select m.internal_id into v_existing
  from public.lightfunnels_entity_mappings m
  where m.integration_id = p_integration_id
    and m.entity_type = 'order'
    and m.lightfunnels_id = p_external_order_id;

  if v_existing is not null and exists (select 1 from public.orders o where o.id = v_existing) then
    -- Déjà importée : aucune réécriture des données métier Jisra.
    return jsonb_build_object('status', 'already_imported', 'order_id', v_existing);
  end if;

  v_delivery := greatest(coalesce((p_order->>'delivery_charge_to_customer')::numeric, 0), 0);
  v_rounding := least(greatest(coalesce((p_order->>'rounding_adjustment')::numeric, 0), 0), 1);
  v_target := greatest(coalesce((p_order->>'total_selling_price')::numeric, 0), 0);

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_quantity := greatest(coalesce((v_item->>'quantity')::integer, 1), 1);
    v_unit := greatest(coalesce((v_item->>'unit_selling_price')::numeric, 0), 0);
    v_items_total := v_items_total + (v_quantity * v_unit);
  end loop;

  v_discount := round(v_items_total - (v_target - v_delivery - v_rounding), 2);

  if v_discount < 0 then
    v_discount := 0;
    v_reconciled := false;
  end if;

  insert into public.orders (
    store_id, external_order_id, customer_name, phone, city, address,
    total_selling_price, delivery_charge_to_customer, rounding_adjustment,
    discount_type, discount_value, discount_amount, source, order_date, status, delivery_note
  )
  values (
    p_store_id,
    p_external_order_id,
    coalesce(nullif(btrim(p_order->>'customer_name'), ''), 'Client Lightfunnels'),
    nullif(btrim(coalesce(p_order->>'phone', '')), ''),
    nullif(btrim(coalesce(p_order->>'city', '')), ''),
    nullif(btrim(coalesce(p_order->>'address', '')), ''),
    v_target,
    v_delivery,
    v_rounding,
    case when v_discount > 0 then 'amount' else 'fixed' end,
    case when v_discount > 0 then v_discount else 0 end,
    v_discount,
    coalesce(nullif(p_order->>'source', ''), 'organic'),
    coalesce((p_order->>'order_date')::timestamptz, now()),
    'new',
    nullif(btrim(coalesce(p_order->>'delivery_note', '')), '')
  )
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    insert into public.order_items (
      store_id, order_id, product_id, product_variant_id,
      quantity, unit_selling_price, unit_purchase_cost_snapshot, item_type
    )
    values (
      p_store_id,
      v_order_id,
      (v_item->>'product_id')::uuid,
      nullif(v_item->>'product_variant_id', '')::uuid,
      greatest(coalesce((v_item->>'quantity')::integer, 1), 1),
      greatest(coalesce((v_item->>'unit_selling_price')::numeric, 0), 0),
      0,
      'product'
    );

    v_inserted := v_inserted + 1;
  end loop;

  insert into public.lightfunnels_entity_mappings (
    user_id, integration_id, store_id, entity_type, lightfunnels_id, internal_id,
    payload, external_financial_status, external_fulfillment_status,
    external_cancelled_at, total_reconciled, updated_at
  )
  values (
    v_owner, p_integration_id, p_store_id, 'order', p_external_order_id, v_order_id,
    p_payload,
    nullif(btrim(coalesce(p_external->>'financial_status', '')), ''),
    nullif(btrim(coalesce(p_external->>'fulfillment_status', '')), ''),
    nullif(btrim(coalesce(p_external->>'cancelled_at', '')), '')::timestamptz,
    v_reconciled,
    now()
  )
  on conflict (integration_id, entity_type, lightfunnels_id) do update
  set
    internal_id = excluded.internal_id,
    payload = excluded.payload,
    external_financial_status = excluded.external_financial_status,
    external_fulfillment_status = excluded.external_fulfillment_status,
    external_cancelled_at = excluded.external_cancelled_at,
    total_reconciled = excluded.total_reconciled,
    updated_at = now();

  return jsonb_build_object(
    'status', 'created',
    'order_id', v_order_id,
    'items', v_inserted,
    'discount', v_discount,
    'reconciled', v_reconciled
  );
end;
$function$;

comment on function public.rpc_import_lightfunnels_order(uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb) is
  'Import atomique et idempotent d''une commande Lightfunnels. Exige une liaison (integration + store + boutique distante) et, pour un appel avec session, un rôle owner/admin. SECURITY INVOKER : la RLS Jisra reste appliquée.';

revoke all on function public.rpc_import_lightfunnels_order(uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb) from public;
revoke all on function public.rpc_import_lightfunnels_order(uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb) from anon;
grant execute on function public.rpc_import_lightfunnels_order(uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.rpc_import_lightfunnels_order(uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb) to service_role;

