-- ============================================================
-- Lightfunnels : état d'une commande distante, lisible sans ambiguïté de RLS
--
-- Vérification en base : depuis une session propriétaire de l'installation, la RPC ne peut pas
-- lire la commande d'un **autre** store (RLS `orders`). Le contrôle « la liaison pointe-t-elle
-- une commande d'un autre store ? » restait donc aveugle et la commande était recréée.
--
-- `lightfunnels_order_mapping_state` lit les deux tables **sans filtre RLS** (SECURITY DEFINER)
-- et ne renvoie qu'un état, sans identifiant ni donnée personnelle :
--   none | orphan (commande supprimée) | other_store | verified.
-- L'autorisation est vérifiée dans la fonction : un appel avec session doit être le
-- propriétaire de l'installation Lightfunnels (le webhook, sans session, est déjà authentifié
-- par sa signature).
--
-- La RPC d'import utilise cet état au lieu d'une lecture filtrée par la RLS ; le patch est
-- ciblé (même signature, aucun changement d'ACL) et idempotent.
-- ============================================================

create or replace function public.lightfunnels_order_mapping_state(
  p_integration_id uuid,
  p_store_id uuid,
  p_external_order_id text
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_caller uuid := auth.uid();
  v_internal uuid;
  v_mapping_store uuid;
  v_order_store uuid;
begin
  -- SECURITY DEFINER : l'autorisation ne peut pas venir de la RLS, elle est donc explicite.
  if v_caller is not null then
    if not exists (
      select 1
      from public.integrations i
      where i.id = p_integration_id
        and i.user_id = v_caller
        and i.provider = 'lightfunnels'
    ) then
      raise exception 'FORBIDDEN_INTEGRATION' using errcode = 'P0001';
    end if;
  end if;

  select m.internal_id, m.store_id
  into v_internal, v_mapping_store
  from public.lightfunnels_entity_mappings m
  where m.integration_id = p_integration_id
    and m.entity_type = 'order'
    and m.lightfunnels_id = p_external_order_id;

  if v_internal is null then
    return 'none';
  end if;

  select o.store_id into v_order_store
  from public.orders o
  where o.id = v_internal;

  if v_order_store is null then
    -- Commande absente : liaison orpheline si elle visait bien ce store, incohérente sinon.
    return case
      when v_mapping_store is not null and v_mapping_store <> p_store_id then 'other_store'
      else 'orphan'
    end;
  end if;

  if v_order_store <> p_store_id then
    return 'other_store';
  end if;

  return 'verified';
end;
$function$;

comment on function public.lightfunnels_order_mapping_state(uuid, uuid, text) is
  'État d''une commande distante pour un store lié : none | orphan | other_store | verified. SECURITY DEFINER car la RLS empêche de distinguer « commande supprimée » de « commande d''un autre store » ; la session doit être propriétaire de l''installation. N''expose aucun identifiant interne.';

revoke all on function public.lightfunnels_order_mapping_state(uuid, uuid, text) from public;
revoke all on function public.lightfunnels_order_mapping_state(uuid, uuid, text) from anon;
grant execute on function public.lightfunnels_order_mapping_state(uuid, uuid, text) to authenticated;
grant execute on function public.lightfunnels_order_mapping_state(uuid, uuid, text) to service_role;

-- ---------- Patch ciblé de la RPC d'import ----------

do $migration$
declare
  v_def text;
  v_def_new text;
  v_step text;
  v_repl text;
begin
  select pg_get_functiondef(
    'public.rpc_import_lightfunnels_order(uuid,uuid,uuid,text,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure
  ) into v_def;

  if coalesce(btrim(v_def), '') = '' then
    raise exception 'RPC_INTROUVABLE: public.rpc_import_lightfunnels_order';
  end if;

  if position('lightfunnels_order_mapping_state' in v_def) > 0 then
    raise notice 'rpc_import_lightfunnels_order : etat deja consulte';
    return;
  end if;

  v_def_new := v_def;

  -- 1. Déclaration : l'état remplace la lecture de `orders.store_id` (filtrée par la RLS).
  v_step := replace(
    v_def_new,
    E'  v_existing_store uuid;',
    E'  v_mapping_state text;'
  );
  if v_step = v_def_new then raise exception 'ANCRE_INTROUVABLE: declare'; end if;
  v_def_new := v_step;

  -- 2. Lecture de l'état, sans filtre RLS.
  v_step := replace(
    v_def_new,
    E'    select o.store_id into v_existing_store\n    from public.orders o\n    where o.id = v_existing;',
    E'    v_mapping_state := public.lightfunnels_order_mapping_state(\n      p_integration_id, p_store_id, p_external_order_id\n    );'
  );
  if v_step = v_def_new then raise exception 'ANCRE_INTROUVABLE: select orders'; end if;
  v_def_new := v_step;

  -- 3. « Déjà importée » : commande vérifiée dans le store cible.
  v_step := replace(
    v_def_new,
    E'    if v_existing_store = p_store_id then',
    E'    if v_mapping_state = ''verified'' then'
  );
  if v_step = v_def_new then raise exception 'ANCRE_INTROUVABLE: verified'; end if;
  v_def_new := v_step;

  -- 4. Collision entre boutiques : refus, aucune création.
  v_step := replace(
    v_def_new,
    E'    if v_existing_store is not null then',
    E'    if v_mapping_state = ''other_store'' then'
  );
  if v_step = v_def_new then raise exception 'ANCRE_INTROUVABLE: other_store'; end if;
  v_def_new := v_step;

  execute v_def_new;
end
$migration$;
