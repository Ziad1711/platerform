-- ============================================================
-- 20260927100100 — Privilèges : fonctions sensibles retirées à `anon`
-- ------------------------------------------------------------
-- Constat (audit production) : plusieurs fonctions SECURITY DEFINER étaient
-- exécutables par le rôle `anon` (clé publique). Cause : les privilèges par
-- défaut du schéma `public` accordent explicitement EXECUTE à
-- `anon` / `authenticated` / `service_role` à chaque création de fonction,
-- donc un `revoke ... from public` seul ne suffit pas — il faut retirer
-- nommément `anon`.
--
-- Fonctions visées (écriture, suppression ou fuite inter-store) :
--   * accept_team_invitation            : écrit dans store_members
--   * change_member_role / remove_member: modifient les membres d'un store
--   * delete_store                      : supprime un store
--   * replay_youcan_webhook             : rejoue un webhook (supprime des commandes)
--   * rpc_ingest_public_order           : crée commandes + articles (API publique)
--   * rpc_public_catalog_stock_snapshot : expose le stock d'un store quelconque
--   * rpc_delete_orders / rpc_duplicate_orders : écrivent sur `orders`
--   * get_my_stores                     : liste les stores de l'utilisateur
--   * recompute_provider_connected_count: réécrit des métriques de providers
--
-- Aucun de ces appels ne provient d'un contexte anonyme : les routes serveur
-- utilisent le client lié à la session (`authenticated`) ou le client
-- service-role. Les helpers de politiques RLS (`is_store_member`,
-- `is_store_admin_or_owner`, `can_*`) ne sont volontairement pas touchés :
-- ils sont référencés par des politiques `public` et restent sans effet
-- pour un appelant anonyme (`auth.uid()` est NULL).
-- ============================================================

revoke all on function public.accept_team_invitation(text) from public;
revoke all on function public.accept_team_invitation(text) from anon;
grant execute on function public.accept_team_invitation(text) to authenticated, service_role;

revoke all on function public.change_member_role(uuid, uuid, text) from public;
revoke all on function public.change_member_role(uuid, uuid, text) from anon;
grant execute on function public.change_member_role(uuid, uuid, text) to authenticated, service_role;

revoke all on function public.remove_member(uuid, uuid) from public;
revoke all on function public.remove_member(uuid, uuid) from anon;
grant execute on function public.remove_member(uuid, uuid) to authenticated, service_role;

revoke all on function public.delete_store(uuid) from public;
revoke all on function public.delete_store(uuid) from anon;
grant execute on function public.delete_store(uuid) to authenticated, service_role;

revoke all on function public.replay_youcan_webhook(uuid) from public;
revoke all on function public.replay_youcan_webhook(uuid) from anon;
grant execute on function public.replay_youcan_webhook(uuid) to service_role;

revoke all on function public.rpc_ingest_public_order(uuid, uuid, text, text, jsonb, jsonb) from public;
revoke all on function public.rpc_ingest_public_order(uuid, uuid, text, text, jsonb, jsonb) from anon;
grant execute on function public.rpc_ingest_public_order(uuid, uuid, text, text, jsonb, jsonb) to service_role;

revoke all on function public.rpc_public_catalog_stock_snapshot(uuid, uuid[]) from public;
revoke all on function public.rpc_public_catalog_stock_snapshot(uuid, uuid[]) from anon;
grant execute on function public.rpc_public_catalog_stock_snapshot(uuid, uuid[]) to service_role;

revoke all on function public.rpc_delete_orders(uuid[]) from public;
revoke all on function public.rpc_delete_orders(uuid[]) from anon;
grant execute on function public.rpc_delete_orders(uuid[]) to authenticated, service_role;

revoke all on function public.rpc_duplicate_orders(uuid[]) from public;
revoke all on function public.rpc_duplicate_orders(uuid[]) from anon;
grant execute on function public.rpc_duplicate_orders(uuid[]) to authenticated, service_role;

revoke all on function public.get_my_stores() from public;
revoke all on function public.get_my_stores() from anon;
grant execute on function public.get_my_stores() to authenticated, service_role;

revoke all on function public.recompute_provider_connected_count(uuid) from public;
revoke all on function public.recompute_provider_connected_count(uuid) from anon;
grant execute on function public.recompute_provider_connected_count(uuid) to authenticated, service_role;
