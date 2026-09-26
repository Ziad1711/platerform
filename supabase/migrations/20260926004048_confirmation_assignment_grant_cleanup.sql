-- ============================================================
-- Confirmation — nettoyage des privilèges résiduels
-- Supprime l'ancienne surcharge et révoque anon/authenticated
-- sur les fonctions internes.
-- ============================================================

drop function if exists public.pick_confirmation_agent(uuid);

revoke execute on function public.pick_confirmation_agent(uuid, uuid) from anon, authenticated;
revoke execute on function public.reassign_orders_on_agent_deactivation() from anon, authenticated;
revoke execute on function public.can_view_all_store_orders(uuid) from anon;
revoke execute on function public.can_manage_store_orders(uuid) from anon;
revoke execute on function public.is_order_assigned_to_actor(uuid) from anon;

grant execute on function public.pick_confirmation_agent(uuid, uuid) to service_role;
grant execute on function public.reassign_orders_on_agent_deactivation() to service_role;
grant execute on function public.can_view_all_store_orders(uuid) to authenticated, service_role;
grant execute on function public.can_manage_store_orders(uuid) to authenticated, service_role;
grant execute on function public.is_order_assigned_to_actor(uuid) to authenticated, service_role;
