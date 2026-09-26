-- ============================================================
-- Confirmation — protection réelle de la colonne d'assignation
-- Révoque l'exposition de log_order_assigned_on_insert et
-- interdit le changement de confirmation_agent_id par le rôle applicatif
-- (seuls owner/admin via l'app, ou une RPC interne, le peuvent).
-- ============================================================

revoke execute on function public.log_order_assigned_on_insert() from anon, authenticated;
grant execute on function public.log_order_assigned_on_insert() to service_role;

create or replace function public.is_order_store_admin(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.stores s where s.id = p_store_id and s.owner_user_id = auth.uid()
  )
  or exists (
    select 1 from public.store_members sm
    where sm.store_id = p_store_id
      and sm.user_id = auth.uid()
      and sm.status = 'active'
      and sm.role in ('owner','admin')
  );
$$;

revoke all on function public.is_order_store_admin(uuid) from public;
revoke execute on function public.is_order_store_admin(uuid) from anon;
grant execute on function public.is_order_store_admin(uuid) to authenticated, service_role;

create or replace function public.protect_confirmation_agent_id_change()
returns trigger
language plpgsql
as $$
begin
  if NEW.confirmation_agent_id is distinct from OLD.confirmation_agent_id
     and current_user not in ('postgres', 'service_role')
     and not public.is_order_store_admin(NEW.store_id) then
    raise exception 'FORBIDDEN';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_protect_confirmation_agent_id on public.orders;
create trigger trg_protect_confirmation_agent_id
  before update of confirmation_agent_id
  on public.orders
  for each row
  execute function public.protect_confirmation_agent_id_change();
