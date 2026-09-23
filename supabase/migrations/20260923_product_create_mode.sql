-- ============================================================================
-- Création explicite d'un produit dans rpc_save_product_catalog
--
-- Problème corrigé : l'application génère l'identifiant du produit avant
-- l'upload des images puis l'envoie à la RPC. La RPC interprétait la présence
-- d'un identifiant comme une mise à jour et levait PRODUCT_NOT_FOUND lors de
-- la création (« Produit introuvable dans ce store. »).
--
-- Le client précise désormais son intention via p_mode :
--   'create' : le produit est inséré avec l'identifiant fourni (ou généré) ;
--   'update' : mise à jour, PRODUCT_NOT_FOUND si le produit est absent du store ;
--   'auto'   : comportement historique (identifiant absent = création).
--
-- Si l'identifiant fourni existe déjà dans le store, la création devient une
-- mise à jour afin de rester idempotente.
-- ============================================================================

drop function if exists public.rpc_save_product_catalog(uuid, jsonb, jsonb, jsonb);

create or replace function public.rpc_save_product_catalog(
  p_store_id uuid,
  p_product jsonb,
  p_variants jsonb,
  p_images jsonb,
  p_mode text default 'auto'
) returns jsonb
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare
  v_mode text := coalesce(nullif(btrim(coalesce(p_mode, '')), ''), 'auto');
  v_product_id uuid;
  v_category_id uuid;
  v_variant jsonb;
  v_variant_id uuid;
  v_image_ops jsonb;
  v_keep_variants uuid[] := '{}';
  v_removed_urls text[] := '{}';
  v_index integer := 0;
  v_variant_count integer := 0;
begin
  if not exists (
    select 1 from public.store_members sm
    where sm.store_id = p_store_id
      and sm.user_id = auth.uid()
      and sm.role = any (array['owner', 'admin', 'staff'])
  ) then
    raise exception 'STORE_ACCESS_DENIED';
  end if;

  if v_mode not in ('create', 'update', 'auto') then
    raise exception 'INVALID_SAVE_MODE';
  end if;

  v_product_id := nullif(p_product->>'id', '')::uuid;
  v_category_id := nullif(p_product->>'category_id', '')::uuid;

  if v_product_id is not null and exists (
    select 1 from public.products p
    where p.id = v_product_id and p.store_id = p_store_id
  ) then
    v_mode := 'update';
  elsif v_mode = 'create' and v_product_id is not null and exists (
    select 1 from public.products p where p.id = v_product_id
  ) then
    raise exception 'PRODUCT_ALREADY_EXISTS';
  elsif v_mode = 'auto' then
    v_mode := 'create';
  end if;

  if v_mode = 'create' then
    if v_product_id is null then
      v_product_id := gen_random_uuid();
    end if;

    insert into public.products (
      id, store_id, name, slug, sku, short_description, description, old_price, category_id,
      sort_order, default_selling_price, default_purchase_cost, stock_tracking_mode,
      publication_status, stock_setup_confirmed_at
    )
    values (
      v_product_id,
      p_store_id,
      coalesce(nullif(btrim(p_product->>'name'), ''), 'Produit'),
      nullif(btrim(coalesce(p_product->>'slug', '')), ''),
      nullif(btrim(coalesce(p_product->>'sku', '')), ''),
      nullif(btrim(coalesce(p_product->>'short_description', '')), ''),
      nullif(btrim(coalesce(p_product->>'description', '')), ''),
      nullif(p_product->>'old_price', '')::numeric,
      v_category_id,
      coalesce((p_product->>'sort_order')::integer, 0),
      coalesce((p_product->>'default_selling_price')::numeric, 0),
      coalesce((p_product->>'default_purchase_cost')::numeric, 0),
      coalesce(nullif(p_product->>'stock_tracking_mode', ''), 'variant'),
      coalesce(nullif(p_product->>'publication_status', ''), 'active'),
      case when coalesce((p_product->>'confirm_stock_setup')::boolean, false) then now() else null end
    )
    returning id into v_product_id;
  else
    if v_product_id is null then
      raise exception 'PRODUCT_NOT_FOUND';
    end if;

    -- Chaque colonne n'est modifiée que si la clé est présente dans le payload.
    update public.products
    set name = case when p_product ? 'name'
          then coalesce(nullif(btrim(p_product->>'name'), ''), name) else name end,
        slug = case when p_product ? 'slug'
          then nullif(btrim(coalesce(p_product->>'slug', '')), '') else slug end,
        sku = case when p_product ? 'sku'
          then nullif(btrim(coalesce(p_product->>'sku', '')), '') else sku end,
        short_description = case when p_product ? 'short_description'
          then nullif(btrim(coalesce(p_product->>'short_description', '')), '') else short_description end,
        description = case when p_product ? 'description'
          then nullif(btrim(coalesce(p_product->>'description', '')), '') else description end,
        old_price = case when p_product ? 'old_price'
          then nullif(p_product->>'old_price', '')::numeric else old_price end,
        category_id = case when p_product ? 'category_id' then v_category_id else category_id end,
        sort_order = case when p_product ? 'sort_order'
          then coalesce((p_product->>'sort_order')::integer, sort_order) else sort_order end,
        default_selling_price = case when p_product ? 'default_selling_price'
          then coalesce((p_product->>'default_selling_price')::numeric, default_selling_price) else default_selling_price end,
        default_purchase_cost = case when p_product ? 'default_purchase_cost'
          then coalesce((p_product->>'default_purchase_cost')::numeric, default_purchase_cost) else default_purchase_cost end,
        stock_tracking_mode = case when p_product ? 'stock_tracking_mode'
          then coalesce(nullif(p_product->>'stock_tracking_mode', ''), stock_tracking_mode) else stock_tracking_mode end,
        publication_status = case when p_product ? 'publication_status'
          then coalesce(nullif(p_product->>'publication_status', ''), publication_status) else publication_status end,
        stock_setup_confirmed_at = case
          when coalesce((p_product->>'confirm_stock_setup')::boolean, false) then now()
          else stock_setup_confirmed_at
        end
    where id = v_product_id and store_id = p_store_id;

    if not found then
      raise exception 'PRODUCT_NOT_FOUND';
    end if;
  end if;

  -- Variantes : une seule par défaut, conservation des identifiants existants.
  if p_variants is not null then
    -- Le défaut n'est libéré que si de nouvelles variantes sont réellement écrites.
    if jsonb_array_length(coalesce(p_variants, '[]'::jsonb)) > 0 then
      update public.product_variants
      set is_default = false, updated_at = now()
      where product_id = v_product_id and is_default = true;
    end if;

    for v_variant in select * from jsonb_array_elements(coalesce(p_variants, '[]'::jsonb))
    loop
      v_variant_id := nullif(v_variant->>'id', '')::uuid;

      if v_variant_id is not null and not exists (
        select 1 from public.product_variants
        where id = v_variant_id and product_id = v_product_id
      ) then
        v_variant_id := null;
      end if;

      if v_variant_id is null and nullif(btrim(coalesce(v_variant->>'sku', '')), '') is not null then
        select id into v_variant_id
        from public.product_variants
        where product_id = v_product_id and sku = v_variant->>'sku'
        limit 1;
      end if;

      if v_variant_id is null then
        insert into public.product_variants (
          store_id, product_id, name, sku, selling_price, purchase_cost, old_price,
          is_default, sort_order, option_values, stock_multiplier
        )
        values (
          p_store_id,
          v_product_id,
          coalesce(nullif(btrim(v_variant->>'name'), ''), 'Variante'),
          coalesce(nullif(btrim(v_variant->>'sku'), ''), 'SKU'),
          coalesce((v_variant->>'selling_price')::numeric, 0),
          coalesce((v_variant->>'purchase_cost')::numeric, 0),
          nullif(v_variant->>'old_price', '')::numeric,
          coalesce((v_variant->>'is_default')::boolean, false),
          coalesce((v_variant->>'sort_order')::integer, v_index),
          coalesce(v_variant->'option_values', '{}'::jsonb),
          greatest(coalesce((v_variant->>'stock_multiplier')::integer, 1), 1)
        )
        returning id into v_variant_id;
      else
        update public.product_variants
        set name = coalesce(nullif(btrim(v_variant->>'name'), ''), name),
            sku = coalesce(nullif(btrim(v_variant->>'sku'), ''), sku),
            selling_price = case when v_variant ? 'selling_price'
              then coalesce((v_variant->>'selling_price')::numeric, 0) else selling_price end,
            purchase_cost = case when v_variant ? 'purchase_cost'
              then coalesce((v_variant->>'purchase_cost')::numeric, 0) else purchase_cost end,
            old_price = case when v_variant ? 'old_price'
              then nullif(v_variant->>'old_price', '')::numeric else old_price end,
            is_default = case when v_variant ? 'is_default'
              then coalesce((v_variant->>'is_default')::boolean, false) else is_default end,
            sort_order = case when v_variant ? 'sort_order'
              then coalesce((v_variant->>'sort_order')::integer, sort_order) else sort_order end,
            option_values = case when v_variant ? 'option_values'
              then coalesce(v_variant->'option_values', '{}'::jsonb) else option_values end,
            stock_multiplier = case when v_variant ? 'stock_multiplier'
              then greatest(coalesce((v_variant->>'stock_multiplier')::integer, 1), 1) else stock_multiplier end,
            updated_at = now()
        where id = v_variant_id;
      end if;

      v_keep_variants := v_keep_variants || v_variant_id;
      v_variant_count := v_variant_count + 1;

      -- Images propres à la variante
      v_image_ops := public.rpc_replace_product_images(
        p_store_id,
        v_product_id,
        v_variant_id,
        coalesce(v_variant->'images', '[]'::jsonb)
      );

      v_removed_urls := v_removed_urls || coalesce(
        array(select jsonb_array_elements_text(v_image_ops->'removed_urls')),
        '{}'::text[]
      );

      v_index := v_index + 1;
    end loop;

    -- Les variantes retirées ne sont supprimées que si le payload en contient encore.
    if v_variant_count > 0 then
      delete from public.product_variants
      where product_id = v_product_id
        and not (id = any(v_keep_variants));
    end if;

    -- Le site doit toujours recevoir une variante présélectionnable.
    if v_variant_count > 0 and not exists (
      select 1 from public.product_variants
      where product_id = v_product_id and is_default = true
    ) then
      update public.product_variants
      set is_default = true, updated_at = now()
      where id = (
        select id from public.product_variants
        where product_id = v_product_id
        order by sort_order asc, created_at asc, id asc
        limit 1
      );
    end if;
  end if;

  -- Galerie produit
  if p_images is not null then
    v_image_ops := public.rpc_replace_product_images(p_store_id, v_product_id, null, p_images);

    v_removed_urls := v_removed_urls || coalesce(
      array(select jsonb_array_elements_text(v_image_ops->'removed_urls')),
      '{}'::text[]
    );

    update public.products p
    set image_url = (
      select pi.image_url
      from public.product_images pi
      where pi.product_id = p.id and pi.product_variant_id is null
      order by pi.is_primary desc, pi.sort_order asc, pi.created_at asc
      limit 1
    )
    where p.id = v_product_id;
  end if;

  return jsonb_build_object(
    'product_id', v_product_id,
    'removed_image_urls', to_jsonb(coalesce(v_removed_urls, '{}'))
  );
end;
$function$;

revoke all on function public.rpc_save_product_catalog(uuid, jsonb, jsonb, jsonb, text) from public, anon;
grant execute on function public.rpc_save_product_catalog(uuid, jsonb, jsonb, jsonb, text) to authenticated, service_role;

