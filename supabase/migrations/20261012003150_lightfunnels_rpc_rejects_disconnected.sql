-- ============================================================
-- Lightfunnels : la RPC d'import refuse une installation déconnectée
--
-- `disconnect` conserve la ligne d'intégration (mappings préservés) en effaçant les jetons :
-- sans ce contrôle, un appel direct à la RPC pouvait encore créer une commande au nom d'une
-- installation déconnectée. Les états récupérables (`connected`, `error`) restent acceptés.
--
-- Patch ciblé de la fonction existante (même signature, aucun changement d'ACL).
-- ============================================================

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
    raise notice 'rpc_import_lightfunnels_order : statut deja verifie';
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
