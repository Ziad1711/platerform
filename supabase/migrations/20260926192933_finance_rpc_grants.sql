-- ============================================================
-- Finance — privilèges : retrait d'`anon` sur les fonctions du module
-- ------------------------------------------------------------
-- Les privilèges par défaut du schéma `public` accordent EXECUTE à `anon`,
-- `authenticated` et `service_role` à chaque nouvelle fonction
-- (`pg_default_acl`). Les migrations Finance ne révoquaient que le pseudo-rôle
-- PUBLIC, d'où la persistance de `anon:EXECUTE` constatée le 26/09/2026.
-- Les fonctions sont SECURITY DEFINER et gardées par `auth.uid()` : aucune
-- donnée ne fuit par ce privilège, mais `anon` n'en a aucun usage. On le
-- retire nommément (défense en profondeur).
--
-- À reprendre pour toute nouvelle fonction du module Finances : un
-- `revoke all ... from public` seul est insuffisant.
-- ============================================================

-- Soldes et détails de lecture
revoke all on function public.rpc_finance_agent_balances(uuid[]) from public;
revoke all on function public.rpc_finance_agent_balances(uuid[]) from anon;
grant execute on function public.rpc_finance_agent_balances(uuid[]) to authenticated, service_role;

revoke all on function public.rpc_finance_agent_orders(uuid, uuid) from public;
revoke all on function public.rpc_finance_agent_orders(uuid, uuid) from anon;
grant execute on function public.rpc_finance_agent_orders(uuid, uuid) to authenticated, service_role;

revoke all on function public.rpc_finance_supplier_balances(uuid[]) from public;
revoke all on function public.rpc_finance_supplier_balances(uuid[]) from anon;
grant execute on function public.rpc_finance_supplier_balances(uuid[]) to authenticated, service_role;

revoke all on function public.rpc_finance_supplier_purchases(uuid, uuid) from public;
revoke all on function public.rpc_finance_supplier_purchases(uuid, uuid) from anon;
grant execute on function public.rpc_finance_supplier_purchases(uuid, uuid) to authenticated, service_role;

-- Enregistrement des règlements
revoke all on function public.rpc_record_agent_payment(uuid, uuid, numeric, text, timestamptz, text, text, text, jsonb) from public;
revoke all on function public.rpc_record_agent_payment(uuid, uuid, numeric, text, timestamptz, text, text, text, jsonb) from anon;
grant execute on function public.rpc_record_agent_payment(uuid, uuid, numeric, text, timestamptz, text, text, text, jsonb) to authenticated, service_role;

revoke all on function public.rpc_record_supplier_payment(uuid, uuid, numeric, text, timestamptz, text, text, text, jsonb) from public;
revoke all on function public.rpc_record_supplier_payment(uuid, uuid, numeric, text, timestamptz, text, text, text, jsonb) from anon;
grant execute on function public.rpc_record_supplier_payment(uuid, uuid, numeric, text, timestamptz, text, text, text, jsonb) to authenticated, service_role;

revoke all on function public.rpc_record_supplier_purchase(uuid, uuid, numeric, text, timestamptz, timestamptz, text, text) from public;
revoke all on function public.rpc_record_supplier_purchase(uuid, uuid, numeric, text, timestamptz, timestamptz, text, text) from anon;
grant execute on function public.rpc_record_supplier_purchase(uuid, uuid, numeric, text, timestamptz, timestamptz, text, text) to authenticated, service_role;

-- Gardes d'autorisation (appelées en interne par les RPC du module)
revoke all on function public.can_view_store_finances(uuid) from public;
revoke all on function public.can_view_store_finances(uuid) from anon;
grant execute on function public.can_view_store_finances(uuid) to authenticated, service_role;

revoke all on function public.can_record_store_payments(uuid) from public;
revoke all on function public.can_record_store_payments(uuid) from anon;
grant execute on function public.can_record_store_payments(uuid) to authenticated, service_role;
