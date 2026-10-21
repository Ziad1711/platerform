-- ============================================================
-- P8.4 RPC - isolation multi-tenant et perimetre Confirmation
-- Version : 20261023120000
-- Projet : jisra-test / goqedvcdmgtejtyrawsp
-- ------------------------------------------------------------
-- Defauts reproduits :
--  (1) v_actor_role NULL (aucune appartenance dans la boutique visee)
--      contournait `NOT IN (...)` -> un agent Confirmation du store S
--      pouvait confirmer une commande du store F ;
--  (2) une commande non assignee etait auto-attribuee a l'appelant.
--
-- Methode : patch par expression sur la definition INSTALLEE
-- (pg_get_functiondef), avec controle d'echec a chaque etape : si le
-- fragment attendu est absent, la migration echoue (aucune application
-- partielle). Aucune reecriture du corps.
--
-- Concurrence : les deux RPC verrouillent la commande (`for update`) avant
-- tout controle, donc l'assignation ne peut pas changer entre la
-- verification et l'UPDATE.
-- ============================================================

do $$
declare
  v_def text;
  v_new text;
begin
  -- ---------- (1) rpc_order_confirmation_action ----------
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'rpc_order_confirmation_action'
  limit 1;

  if v_def is null then
    raise exception 'P84_RPC_ACTION_NOT_FOUND';
  end if;

  -- 1a. role absent = refus explicite (NULL ne doit jamais passer)
  v_new := regexp_replace(
    v_def,
    'if\s+v_actor_role\s+not\s+in\s*\(\s*''owner''\s*,\s*''admin''\s*,\s*''confirmation''\s*\)\s+then',
    'if v_actor_role is null or v_actor_role not in (''owner'',''admin'',''confirmation'') then'
  );
  if v_new = v_def then
    raise exception 'P84_RPC_ACTION_ROLE_GUARD_NOT_FOUND';
  end if;
  v_def := v_new;

  -- 1b. perimetre agent strict : une commande non assignee est refusee
  v_new := regexp_replace(
    v_def,
    'if\s+v_order\.confirmation_agent_id\s+is\s+not\s+null\s+and\s+v_order\.confirmation_agent_id\s*<>\s*v_agent_id\s+then',
    'if v_order.confirmation_agent_id is null or v_order.confirmation_agent_id <> v_agent_id then'
  );
  if v_new = v_def then
    raise exception 'P84_RPC_ACTION_ASSIGN_GUARD_NOT_FOUND';
  end if;
  v_def := v_new;

  -- 1c. neutralisation de l'auto-assignation residuelle
  v_new := regexp_replace(
    v_def,
    'if\s+v_order\.confirmation_agent_id\s+is\s+null\s+and\s+v_agent_id\s+is\s+not\s+null\s+then',
    'if false then'
  );
  if v_new = v_def then
    raise exception 'P84_RPC_ACTION_SELFASSIGN_NOT_FOUND';
  end if;

  execute v_new;

  -- ---------- (2) rpc_update_confirmation_order_details ----------
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'rpc_update_confirmation_order_details'
  limit 1;

  if v_def is null then
    raise exception 'P84_RPC_EDIT_NOT_FOUND';
  end if;

  v_new := regexp_replace(
    v_def,
    'if\s+v_actor_role\s+not\s+in\s*\(\s*''owner''\s*,\s*''admin''\s*,\s*''confirmation''\s*\)\s+then',
    'if v_actor_role is null or v_actor_role not in (''owner'',''admin'',''confirmation'') then'
  );
  if v_new = v_def then
    raise exception 'P84_RPC_EDIT_ROLE_GUARD_NOT_FOUND';
  end if;

  execute v_new;
end $$;

-- ---------- ACL : acces strictement necessaires ----------
revoke all on function public.rpc_order_confirmation_action(uuid, text, timestamptz, text, text, text, integer) from public;
revoke all on function public.rpc_order_confirmation_action(uuid, text, timestamptz, text, text, text, integer) from anon;
grant execute on function public.rpc_order_confirmation_action(uuid, text, timestamptz, text, text, text, integer) to authenticated, service_role;

revoke all on function public.rpc_update_confirmation_order_details(uuid, text, text, text, text, numeric, text, uuid, text, jsonb) from public;
revoke all on function public.rpc_update_confirmation_order_details(uuid, text, text, text, text, numeric, text, uuid, text, jsonb) from anon;
grant execute on function public.rpc_update_confirmation_order_details(uuid, text, text, text, text, numeric, text, uuid, text, jsonb) to authenticated, service_role;

-- ---------- Garde-fou post-application ----------
do $$
declare
  v_bad int;
begin
  select count(*) into v_bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('rpc_order_confirmation_action', 'rpc_update_confirmation_order_details')
    and p.prosrc ~ 'if\s+v_actor_role\s+not\s+in';

  if v_bad > 0 then
    raise exception 'P84_RPC_GUARD_INCOMPLETE: % fonction(s)', v_bad;
  end if;
end $$;
