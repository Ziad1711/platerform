-- ============================================================
-- Confirmation — blocage des écritures directes des agents
-- Un agent confirmation ne peut plus modifier une commande directement
-- (statut, montants, client…) : uniquement via les RPC sécurisées.
-- ============================================================

create or replace function public.is_confirmation_agent_of_store(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.store_members sm
    where sm.store_id = p_store_id
      and sm.user_id = auth.uid()
      and sm.status = 'active'
      and sm.role = 'confirmation'
  );
$$;

revoke all on function public.is_confirmation_agent_of_store(uuid) from public;
revoke execute on function public.is_confirmation_agent_of_store(uuid) from anon;
grant execute on function public.is_confirmation_agent_of_store(uuid) to authenticated, service_role;

create or replace function public.protect_order_write_by_agent()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('postgres', 'service_role')
     and not public.is_order_store_admin(OLD.store_id)
     and public.is_confirmation_agent_of_store(OLD.store_id) then
    raise exception 'FORBIDDEN';
  end if;
  return NEW;
end;
$$;

revoke all on function public.protect_order_write_by_agent() from public;
revoke execute on function public.protect_order_write_by_agent() from anon, authenticated;
grant execute on function public.protect_order_write_by_agent() to service_role;

drop trigger if exists trg_protect_confirmation_agent_id on public.orders;
drop function if exists public.protect_confirmation_agent_id_change();

drop trigger if exists trg_protect_order_write_by_agent on public.orders;
create trigger trg_protect_order_write_by_agent
  before update on public.orders
  for each row
  execute function public.protect_order_write_by_agent();
