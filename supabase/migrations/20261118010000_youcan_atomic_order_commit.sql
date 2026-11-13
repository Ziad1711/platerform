-- Une seule transaction pour commande, articles, mapping et réservation.
-- Aucun rattrapage ni modification de commandes historiques.
begin;
set local lock_timeout = '5s';

create function public.rpc_commit_youcan_order(
  p_integration_id uuid, p_youcan_order_id text, p_token uuid,
  p_user_id uuid, p_store_id uuid, p_order jsonb, p_items jsonb, p_payload jsonb
)
returns uuid language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  reservation public.youcan_order_claims;
  existing_id uuid;
  created_id uuid;
begin
  if p_token is null or nullif(btrim(p_youcan_order_id),'') is null
    or jsonb_typeof(p_order) is distinct from 'object'
    or jsonb_typeof(p_items) is distinct from 'array'
    or jsonb_array_length(p_items)>1000 then
    raise exception 'YOUCAN_COMMIT_INVALID';
  end if;
  if not exists(select 1 from public.integrations i
    join public.youcan_integration_configs c on c.integration_id=i.id
    where i.id=p_integration_id and i.provider='youcan' and i.user_id=p_user_id and c.store_id=p_store_id) then
    raise exception 'YOUCAN_COMMIT_SCOPE';
  end if;

  select * into reservation from public.youcan_order_claims
    where integration_id=p_integration_id and youcan_order_id=p_youcan_order_id for update;
  if not found then raise exception 'YOUCAN_CLAIM_MISSING'; end if;

  select m.internal_id into existing_id from public.youcan_entity_mappings m
    join public.orders o on o.id=m.internal_id and o.store_id=p_store_id
    where m.integration_id=p_integration_id and m.entity_type='order' and m.youcan_id=p_youcan_order_id;
  if existing_id is not null then return existing_id; end if;
  if reservation.order_id is not null then
    raise exception 'YOUCAN_COMMIT_INCONSISTENT';
  end if;
  if reservation.claim_token<>p_token then raise exception 'YOUCAN_CLAIM_LOST'; end if;

  if exists(select 1 from jsonb_array_elements(p_items) line
    where not exists(select 1 from public.products p
      where p.id=(line->>'product_id')::uuid and p.store_id=p_store_id)
    or (line->>'product_variant_id' is not null and not exists(
      select 1 from public.product_variants v where v.id=(line->>'product_variant_id')::uuid
      and v.product_id=(line->>'product_id')::uuid))) then
    raise exception 'YOUCAN_ITEM_SCOPE';
  end if;

  insert into public.orders(store_id,customer_name,phone,address,city,status,order_date,
    total_selling_price,rounding_adjustment,delivery_charge_to_customer,source)
  values(p_store_id,p_order->>'customer_name',p_order->>'phone',p_order->>'address',p_order->>'city','new',
    (p_order->>'order_date')::timestamptz,(p_order->>'total_selling_price')::numeric,
    (p_order->>'rounding_adjustment')::numeric,(p_order->>'delivery_charge_to_customer')::numeric,'ads')
  returning id into created_id;

  insert into public.order_items(store_id,order_id,product_id,product_variant_id,quantity,
    unit_selling_price,unit_purchase_cost_snapshot,item_type)
  select p_store_id,created_id,(line->>'product_id')::uuid,(line->>'product_variant_id')::uuid,
    (line->>'quantity')::integer,(line->>'unit_selling_price')::numeric,0,'product'
  from jsonb_array_elements(p_items) line;

  insert into public.youcan_entity_mappings(user_id,integration_id,store_id,entity_type,youcan_id,internal_id,payload,updated_at)
  values(p_user_id,p_integration_id,p_store_id,'order',p_youcan_order_id,created_id,p_payload,now())
  on conflict(integration_id,entity_type,youcan_id) do update
    set internal_id=excluded.internal_id,payload=excluded.payload,updated_at=excluded.updated_at;

  update public.youcan_order_claims set order_id=created_id,claimed_at=now()
    where integration_id=p_integration_id and youcan_order_id=p_youcan_order_id;
  return created_id;
end $$;
alter function public.rpc_commit_youcan_order(uuid,text,uuid,uuid,uuid,jsonb,jsonb,jsonb) owner to supabase_admin;
revoke all on function public.rpc_commit_youcan_order(uuid,text,uuid,uuid,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.rpc_commit_youcan_order(uuid,text,uuid,uuid,uuid,jsonb,jsonb,jsonb) to service_role;
commit;