-- ============================================================
-- Suppression de produits : contrôle centralisé (toutes intégrations)
-- ============================================================
-- Contexte : la page Produits vérifiait les dépendances en TypeScript, produit par
-- produit, avant de supprimer. Résultat : un lot de plusieurs produits s'arrêtait au
-- premier produit lié, sans indiquer combien étaient réellement supprimables, et une vente
-- créée entre la vérification et la suppression pouvait échouer au milieu du lot.
--
-- Deux fonctions remplacent ce contrôle côté application :
--   * `rpc_products_deletion_report` : rapport lisible (supprimables / bloqués + motifs
--     + provenance d'intégration) — lecture seule, sans écriture ;
--   * `rpc_delete_products` : suppression **transactionnelle** des seuls produits sans
--     dépendance, avec bilan par produit. Les références sont revérifiées sous verrou.
--
-- Les contraintes `ON DELETE RESTRICT` sur `order_items` et `inventory_movements` restent
-- la dernière protection : elles ne sont pas contournées.
--
-- Aucune donnée n'est supprimée ni modifiée chez un fournisseur externe.
-- (Le branchement redondant de `rpc_products_deletion_report` est retiré par la migration
--  suivante, `rpc_products_deletion_report_cleanup`, même signature et même ACL.)
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

    declare
      v_reasons jsonb := '[]'::jsonb;
      v_is_deletable boolean;
    begin
      if v_row.sales_count > 0 then
        v_reasons := v_reasons || to_jsonb('IN_SALES'::text);
        v_blocked_sales := v_blocked_sales + 1;
      end if;

      if v_row.movement_count > 0 then
        v_reasons := v_reasons || to_jsonb('HAS_STOCK_MOVEMENTS'::text);
        v_blocked_stock := v_blocked_stock + 1;
      end if;

      v_is_deletable := v_row.sales_count = 0 and v_row.movement_count = 0;

      if v_is_deletable then
        v_deletable := v_deletable + 1;
      end if;

      v_items := v_items || jsonb_build_object(
        'id', v_row.id,
        'name', v_row.name,
        'deletable', v_is_deletable,
        'reasons', v_reasons,
        'in_sales', v_row.sales_count,
        'stock_movements', v_row.movement_count,
        'purchases', v_row.purchase_count,
        'sources', v_row.sources
      );
    end;
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

comment on function public.rpc_products_deletion_report(uuid, uuid[]) is
  'Rapport de suppression : produits supprimables, bloqués (ventes / mouvements de stock) et provenance d''intégration. Lecture seule, owner/admin du store.';

create or replace function public.rpc_delete_products(
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
  v_id uuid;
  v_product public.products%rowtype;
  v_deleted jsonb := '[]'::jsonb;
  v_blocked jsonb := '[]'::jsonb;
  v_sales integer;
  v_movements integer;
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

  foreach v_id in array p_product_ids loop
    -- Verrou : les dépendances sont relues dans la même transaction que la suppression.
    select * into v_product
    from public.products
    where id = v_id and store_id = p_store_id
    for update;

    if not found then
      v_blocked := v_blocked || jsonb_build_object(
        'id', v_id,
        'name', null,
        'reasons', jsonb_build_array('NOT_FOUND')
      );
      continue;
    end if;

    select count(*) into v_sales from public.order_items oi where oi.product_id = v_id;
    select count(*) into v_movements from public.inventory_movements im where im.product_id = v_id;

    if v_sales > 0 or v_movements > 0 then
      v_blocked := v_blocked || jsonb_build_object(
        'id', v_id,
        'name', v_product.name,
        'reasons', (case when v_sales > 0 then jsonb_build_array('IN_SALES') else '[]'::jsonb end)
          || (case when v_movements > 0 then jsonb_build_array('HAS_STOCK_MOVEMENTS') else '[]'::jsonb end),
        'in_sales', v_sales,
        'stock_movements', v_movements
      );
      continue;
    end if;

    -- Variantes et images partent en cascade ; les mappings d'intégration sont retirés
    -- explicitement pour qu'une resynchronisation ne voie pas une entité orpheline.
    delete from public.lightfunnels_entity_mappings
    where entity_type = 'product' and internal_id = v_id;

    delete from public.youcan_entity_mappings
    where entity_type = 'product' and internal_id = v_id;

    delete from public.products where id = v_id;

    v_deleted := v_deleted || to_jsonb(v_id);
  end loop;

  return jsonb_build_object(
    'ok', true,
    'deleted', v_deleted,
    'deletedCount', jsonb_array_length(v_deleted),
    'blocked', v_blocked
  );
end;
$function$;

comment on function public.rpc_delete_products(uuid, uuid[]) is
  'Suppression de produits sans dépendance (aucune vente, aucun mouvement de stock). Les produits liés sont refusés avec leur motif. Owner/admin du store.';

revoke all on function public.rpc_products_deletion_report(uuid, uuid[]) from public;
revoke all on function public.rpc_products_deletion_report(uuid, uuid[]) from anon;
grant execute on function public.rpc_products_deletion_report(uuid, uuid[]) to authenticated, service_role;

revoke all on function public.rpc_delete_products(uuid, uuid[]) from public;
revoke all on function public.rpc_delete_products(uuid, uuid[]) from anon;
grant execute on function public.rpc_delete_products(uuid, uuid[]) to authenticated, service_role;
