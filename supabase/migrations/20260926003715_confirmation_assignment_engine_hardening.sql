-- ============================================================
-- Confirmation — moteur d'assignation durci
-- Sélection atomique (advisory lock), validation de l'agent fourni,
-- réassignation automatique à la désactivation, événements d'assignation.
-- ============================================================

create or replace function public.pick_confirmation_agent(p_store_id uuid, p_exclude_agent_id uuid default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_agent_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock((pg_catalog.hashtext('confirmation_assign:' || p_store_id::text))::bigint);

  select ca.id into v_agent_id
  from public.confirmation_agents ca
  join public.store_members sm on sm.id = ca.member_id
  left join lateral (
    select count(*)::int as open_count
    from public.orders o
    where o.store_id = ca.store_id
      and o.confirmation_agent_id = ca.id
      and o.status in (
        'new','confirmation_rejected',
        'follow_up_1','follow_up_2','follow_up_3','follow_up_4','follow_up_5',
        'no_answer','wrong_number','voicemail'
      )
  ) load on true
  where ca.store_id = p_store_id
    and ca.is_active = true
    and ca.id is distinct from p_exclude_agent_id
    and sm.status = 'active'
    and sm.role = 'confirmation'
    and (ca.max_open_orders is null or load.open_count < ca.max_open_orders)
  order by load.open_count asc, ca.last_assigned_at asc nulls first, ca.id asc
  limit 1;

  return v_agent_id;
end;
$$;

revoke all on function public.pick_confirmation_agent(uuid, uuid) from public;
grant execute on function public.pick_confirmation_agent(uuid, uuid) to service_role;

create or replace function public.assign_confirmation_agent_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent_id uuid;
begin
  if NEW.confirmation_agent_id is not null then
    if exists (
      select 1 from public.confirmation_agents ca
      join public.store_members sm on sm.id = ca.member_id
      where ca.id = NEW.confirmation_agent_id
        and ca.store_id = NEW.store_id
        and ca.is_active = true
        and sm.status = 'active'
        and sm.role = 'confirmation'
    ) then
      return NEW;
    else
      NEW.confirmation_agent_id := null;
    end if;
  end if;

  if coalesce(NEW.status, 'new') in (
    'new','confirmation_rejected',
    'follow_up_1','follow_up_2','follow_up_3','follow_up_4','follow_up_5',
    'no_answer','wrong_number','voicemail'
  ) then
    v_agent_id := public.pick_confirmation_agent(NEW.store_id);
    if v_agent_id is not null then
      NEW.confirmation_agent_id := v_agent_id;
      update public.confirmation_agents
      set last_assigned_at = now(), updated_at = now()
      where id = v_agent_id;
    end if;
  end if;

  return NEW;
end;
$$;

revoke all on function public.assign_confirmation_agent_on_insert() from public;
grant execute on function public.assign_confirmation_agent_on_insert() to service_role;

drop trigger if exists trg_assign_confirmation_agent on public.orders;
create trigger trg_assign_confirmation_agent
  before insert on public.orders
  for each row
  execute function public.assign_confirmation_agent_on_insert();

alter table public.order_confirmation_events
  drop constraint if exists order_confirmation_events_type_check;
alter table public.order_confirmation_events
  add constraint order_confirmation_events_type_check check (
    event_type = any (array[
      'no_answer','postponed','confirmed','cancelled_manual','cancelled_max_attempts',
      'customer_information_updated','order_items_updated','delivery_information_updated',
      'status_corrected','parcel_creation_succeeded','parcel_creation_failed',
      'assigned','reassigned','unassigned'
    ])
  );

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
