-- ============================================================
-- Nettoyage de `rpc_products_deletion_report` (même signature, même ACL)
-- ============================================================
-- La version précédente portait un branchement redondant autour de `v_deletable`
-- (deux `if` successifs pour le même résultat) et recalculait le total des produits
-- supprimables par agrégation JSON au lieu de compter au fil de la boucle. Aucun
-- changement de comportement : seuls le corps de la fonction et le comptage sont revus.
-- ============================================================

create or replace function public.rpc_products_deletion_report(
  p_store_id uuid,
  p_product_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor uuid := auth.uid();
  v_items jsonb := '[]'::jsonb;
  v_selected integer := 0;
  v_deletable integer := 0;
  v_blocked_sales integer := 0;
  v_blocked_stock integer := 0;
  v_is_deletable boolean;
  v_row record;
begin
  if v_actor is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if p_store_id is null or p_product_ids is null or array_length(p_product_ids, 1) is null then
    raise exception 'MISSING_PRODUCT_IDS';
  end if;

  if not public.can_manage_store_products_admin(p_store_id) then
    raise exception 'FORBIDDEN';
  end if;

  for v_row in
    select
      p.id,
      p.name,
      (select count(*) from public.order_items oi where oi.product_id = p.id) as sales_count,
      (select count(*) from public.inventory_movements im where im.product_id = p.id) as movement_count,
      (
        select count(*) from public.inventory_movements im
        where im.product_id = p.id
          and im.movement_type = 'in'
          and (im.supplier_id is not null or im.source_type = 'purchase')
      ) as purchase_count,
      (
        select coalesce(jsonb_agg(distinct s.src), '[]'::jsonb)
        from (
          select 'lightfunnels'::text as src
          from public.lightfunnels_entity_mappings m
          where m.internal_id = p.id and m.entity_type = 'product'
          union all
          select 'youcan'::text
          from public.youcan_entity_mappings m
          where m.internal_id = p.id and m.entity_type = 'product'
          union all
          select 'facebook'::text
          from public.facebook_campaign_mappings m
          where m.product_id = p.id
        ) s
      ) as sources
    from public.products p
    where p.store_id = p_store_id
      and p.id = any(p_product_ids)
    order by p.name
  loop
    v_selected := v_selected + 1;
    v_is_deletable := v_row.sales_count = 0 and v_row.movement_count = 0;

    if v_is_deletable then
      v_deletable := v_deletable + 1;
    end if;

    if v_row.sales_count > 0 then
      v_blocked_sales := v_blocked_sales + 1;
    end if;

    -- Toute ligne de stock (entrée ou sortie) bloque la suppression : c'est ce que la
    -- contrainte de clé étrangère impose déjà, autant le dire avant de cliquer.
    if v_row.movement_count > 0 then
      v_blocked_stock := v_blocked_stock + 1;
    end if;

    v_items := v_items || jsonb_build_object(
      'id', v_row.id,
      'name', v_row.name,
      'deletable', v_is_deletable,
      'reasons',
        (case when v_row.sales_count > 0 then jsonb_build_array('IN_SALES') else '[]'::jsonb end)
        || (case when v_row.movement_count > 0 then jsonb_build_array('HAS_STOCK_MOVEMENTS') else '[]'::jsonb end),
      'in_sales', v_row.sales_count,
      'stock_movements', v_row.movement_count,
      'purchases', v_row.purchase_count,
      'sources', v_row.sources
    );
  end loop;

  return jsonb_build_object(
    'ok', true,
    'store_id', p_store_id,
    'items', v_items,
    'totals', jsonb_build_object(
      'selected', v_selected,
      'deletable', v_deletable,
      'blocked_in_sales', v_blocked_sales,
      'blocked_in_stock', v_blocked_stock
    )
  );
end;
$function$;

revoke all on function public.rpc_products_deletion_report(uuid, uuid[]) from public;
revoke all on function public.rpc_products_deletion_report(uuid, uuid[]) from anon;
grant execute on function public.rpc_products_deletion_report(uuid, uuid[]) to authenticated, service_role;
