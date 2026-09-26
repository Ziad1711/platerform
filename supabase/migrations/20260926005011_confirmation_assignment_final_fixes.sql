-- ============================================================
-- Confirmation — correctifs finaux
-- Journal assigned, distinction reassigned/unassigned,
-- protection de la colonne d'assignation, retrait de confirmation sur INSERT.
-- ============================================================

-- 1. Journal de l'assignation à l'insertion (AFTER INSERT).
create or replace function public.log_order_assigned_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.confirmation_agent_id is not null
     and coalesce(NEW.status, 'new') in (
       'new','confirmation_rejected',
       'follow_up_1','follow_up_2','follow_up_3','follow_up_4','follow_up_5',
       'no_answer','wrong_number','voicemail'
     ) then
    insert into public.order_confirmation_events (
      store_id, order_id, actor_user_id, agent_id, event_type,
      from_status, to_status, metadata
    ) values (
      NEW.store_id, NEW.id, null, NEW.confirmation_agent_id, 'assigned',
      coalesce(NEW.status, 'new'), coalesce(NEW.status, 'new'),
      jsonb_build_object('method', 'automatic')
    );
  end if;
  return NEW;
end;
$$;

revoke all on function public.log_order_assigned_on_insert() from public;
grant execute on function public.log_order_assigned_on_insert() to service_role;

drop trigger if exists trg_log_order_assigned on public.orders;
create trigger trg_log_order_assigned
  after insert on public.orders
  for each row
  execute function public.log_order_assigned_on_insert();

-- 2. Réassignation : reassigned (nouvel agent) / unassigned (aucun agent).
create or replace function public.reassign_orders_on_agent_deactivation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_new_agent uuid;
begin
  if (OLD.is_active is true and NEW.is_active is false) then
    for v_order in
      select o.id, o.store_id, o.status
      from public.orders o
      where o.confirmation_agent_id = OLD.id
        and o.status in (
          'new','confirmation_rejected',
          'follow_up_1','follow_up_2','follow_up_3','follow_up_4','follow_up_5',
          'no_answer','wrong_number','voicemail'
        )
      for update
    loop
      v_new_agent := public.pick_confirmation_agent(v_order.store_id, OLD.id);

      if v_new_agent is not null then
        update public.orders
        set confirmation_agent_id = v_new_agent, updated_at = now()
        where id = v_order.id;

        insert into public.order_confirmation_events (
          store_id, order_id, actor_user_id, agent_id, event_type,
          from_status, to_status, metadata
        ) values (
          v_order.store_id, v_order.id, null, v_new_agent, 'reassigned',
          v_order.status, v_order.status,
          jsonb_build_object('fromAgentId', OLD.id, 'reason', 'agent_deactivated')
        );
      else
        update public.orders
        set confirmation_agent_id = null, updated_at = now()
        where id = v_order.id;

        insert into public.order_confirmation_events (
          store_id, order_id, actor_user_id, agent_id, event_type,
          from_status, to_status, metadata
        ) values (
          v_order.store_id, v_order.id, null, null, 'unassigned',
          v_order.status, v_order.status,
          jsonb_build_object('fromAgentId', OLD.id, 'reason', 'agent_deactivated')
        );
      end if;
    end loop;
  end if;

  return NEW;
end;
$$;

revoke all on function public.reassign_orders_on_agent_deactivation() from public;
grant execute on function public.reassign_orders_on_agent_deactivation() to service_role;

drop trigger if exists trg_reassign_on_agent_deactivation on public.confirmation_agents;
create trigger trg_reassign_on_agent_deactivation
  before update of is_active
  on public.confirmation_agents
  for each row
  execute function public.reassign_orders_on_agent_deactivation();

-- 3. Interdire la modification directe de confirmation_agent_id par le rôle applicatif.
revoke update (confirmation_agent_id) on public.orders from authenticated, anon;

-- 4. Le rôle Confirmation ne crée pas de commandes directement.
drop policy if exists orders_insert_store_scope on public.orders;
create policy orders_insert_store_scope on public.orders for insert
with check (
  exists (
    select 1 from public.store_members sm
    where sm.store_id = orders.store_id
      and sm.user_id = auth.uid()
      and sm.status = 'active'
      and sm.role in ('owner','admin','delivery','accountant','stock_manager')
  )
  or exists (
    select 1 from public.stores s
    where s.id = orders.store_id and s.owner_user_id = auth.uid()
  )
);
