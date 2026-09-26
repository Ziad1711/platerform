-- ============================================================
-- Confirmation — traçabilité de l'assignation
-- Date d'assignation + origine, pour des statistiques non faussées.
-- ============================================================

alter table public.orders
  add column if not exists confirmation_assigned_at timestamptz null,
  add column if not exists confirmation_assignment_source text null;

alter table public.orders drop constraint if exists orders_confirmation_assignment_source_check;
alter table public.orders
  add constraint orders_confirmation_assignment_source_check
  check (
    confirmation_assignment_source is null
    or confirmation_assignment_source in (
      'automatic','first_contact','reassignment','manual','historical_backlog'
    )
  );

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
      NEW.confirmation_assigned_at := coalesce(NEW.confirmation_assigned_at, now());
      NEW.confirmation_assignment_source := coalesce(NEW.confirmation_assignment_source, 'manual');
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
      NEW.confirmation_assigned_at := now();
      NEW.confirmation_assignment_source := 'automatic';
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

create or replace function public.set_assignment_metadata_on_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if NEW.confirmation_agent_id is distinct from OLD.confirmation_agent_id then
    if NEW.confirmation_agent_id is null then
      NEW.confirmation_assigned_at := null;
      NEW.confirmation_assignment_source := null;
    elsif OLD.confirmation_agent_id is null then
      NEW.confirmation_assigned_at := now();
      NEW.confirmation_assignment_source := coalesce(NEW.confirmation_assignment_source, 'first_contact');
    else
      NEW.confirmation_assigned_at := now();
      NEW.confirmation_assignment_source := coalesce(NEW.confirmation_assignment_source, 'reassignment');
    end if;
  end if;
  return NEW;
end;
$$;

revoke all on function public.set_assignment_metadata_on_change() from public;
revoke execute on function public.set_assignment_metadata_on_change() from anon, authenticated;
grant execute on function public.set_assignment_metadata_on_change() to service_role;

drop trigger if exists trg_set_assignment_metadata on public.orders;
create trigger trg_set_assignment_metadata
  before update of confirmation_agent_id
  on public.orders
  for each row
  execute function public.set_assignment_metadata_on_change();

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
      jsonb_build_object(
        'method', coalesce(NEW.confirmation_assignment_source, 'automatic'),
        'assignedAt', NEW.confirmation_assigned_at
      )
    );
  end if;
  return NEW;
end;
$$;

revoke all on function public.log_order_assigned_on_insert() from public;
revoke execute on function public.log_order_assigned_on_insert() from anon, authenticated;
grant execute on function public.log_order_assigned_on_insert() to service_role;
