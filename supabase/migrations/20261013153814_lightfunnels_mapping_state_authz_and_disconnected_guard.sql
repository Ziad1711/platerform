-- ============================================================
-- Lightfunnels : correctifs de revue (autorisation du helper, garde de déconnexion)
--
-- 1. `lightfunnels_order_mapping_state` (SECURITY DEFINER) n'autorise plus l'absence de session
--    en soi : sans session, l'appelant doit être le client privilégié (`auth.role() =
--    'service_role'`, le webhook). Toute autre exécution anonyme est refusée avec
--    `FORBIDDEN_CALLER`, au lieu de laisser passer la lecture non filtrée par la RLS.
--
-- 2. `rpc_import_lightfunnels_order` retrouve la garde d'installation déconnectée
--    (`i.status <> 'disconnected'`) perdue lors de sa redéfinition : `disconnect` conserve la
--    ligne d'intégration (mappings préservés) en effaçant les jetons, et un appel direct à la
--    RPC ne doit pas créer de commande au nom d'une installation déconnectée. Les routes HTTP
--    vérifient déjà le statut ; la base le vérifie de nouveau, y compris pour un appel direct.
--
-- Signature, SECURITY INVOKER et droits inchangés ; patch ciblé et idempotent.
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
  elsif coalesce(auth.role(), '') <> 'service_role' then
    -- Sans session, seul le client privilégié (webhook) est accepté : `auth.uid()` nul
    -- n'autorise rien à lui seul.
    raise exception 'FORBIDDEN_CALLER' using errcode = 'P0001';
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
  'État d''une commande distante pour un store lié : none | orphan | other_store | verified. SECURITY DEFINER car la RLS empêche de distinguer « commande supprimée » de « commande d''un autre store » ; la session doit être propriétaire de l''installation, sans session seul `service_role` est accepté. N''expose aucun identifiant interne.';

-- ---------- Patch ciblé de la RPC d'import ----------

do $migration$
declare
  v_def text;
  v_def_new text;
  v_anchor text;
  v_repl text;
begin
  select pg_get_functiondef(
    'public.rpc_import_lightfunnels_order(uuid,uuid,uuid,text,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure
  ) into v_def;

  if coalesce(btrim(v_def), '') = '' then
    raise exception 'RPC_INTROUVABLE: public.rpc_import_lightfunnels_order';
  end if;

  if position('disconnected' in v_def) > 0 then
    raise notice 'rpc_import_lightfunnels_order : etat de connexion deja verifie';
    return;
  end if;

  v_anchor := E'      and i.provider = ''lightfunnels''\n  ) then';
  v_repl := E'      and i.provider = ''lightfunnels''\n      and i.status <> ''disconnected''\n  ) then';

  v_def_new := replace(v_def, v_anchor, v_repl);

  if v_def_new = v_def then
    raise exception 'ANCRE_INTROUVABLE dans public.rpc_import_lightfunnels_order';
  end if;

  execute v_def_new;
end
$migration$;
