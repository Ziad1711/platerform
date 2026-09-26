-- ============================================================
-- Assignation automatique des commandes aux agents de confirmation
-- ============================================================

-- 1. Colonnes opérationnelles sur confirmation_agents
alter table public.confirmation_agents
  add column if not exists is_active boolean not null default true,
  add column if not exists assignment_weight integer not null default 1,
  add column if not exists max_open_orders integer null,
  add column if not exists last_assigned_at timestamptz null,
  add column if not exists updated_at timestamptz null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'confirmation_agents_member_store_unique'
  ) then
    alter table public.confirmation_agents
      add constraint confirmation_agents_member_store_unique unique (member_id, store_id);
  end if;
end $$;

create index if not exists confirmation_agents_active_idx
  on public.confirmation_agents (store_id, is_active)
  where is_active = true;

create index if not exists orders_confirmation_agent_queue_idx
  on public.orders (store_id, confirmation_agent_id, status)
  where confirmation_agent_id is not null;

-- 2. Synchronisation automatique des fiches agents depuis store_members
create or replace function public.sync_confirmation_agent_for_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if NEW.role = 'confirmation' and NEW.status = 'active' then
    select coalesce(
      nullif(trim(p.full_name), ''),
      nullif(trim(p.first_name || ' ' || p.last_name), ''),
      nullif(trim(NEW.invited_email), ''),
      'Agent'
    )
    into v_name
    from public.profiles p
    where p.id = NEW.user_id;

    v_name := coalesce(nullif(trim(v_name), ''), 'Agent');

    insert into public.confirmation_agents (member_id, store_id, name)
    values (NEW.id, NEW.store_id, v_name)
    on conflict (member_id, store_id)
    do update set is_active = true, updated_at = now();
  else
    update public.confirmation_agents
    set is_active = false, updated_at = now()
    where member_id = NEW.id and store_id = NEW.store_id;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_sync_confirmation_agent on public.store_members;
create trigger trg_sync_confirmation_agent
  after insert or update of role, status
  on public.store_members
  for each row
  execute function public.sync_confirmation_agent_for_member();

-- 3. Sélection de l'agent le moins chargé
create or replace function public.pick_confirmation_agent(p_store_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_agent_id uuid;
begin
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
    and sm.status = 'active'
    and sm.role = 'confirmation'
    and (ca.max_open_orders is null or load.open_count < ca.max_open_orders)
  order by load.open_count asc, ca.last_assigned_at asc nulls first, ca.id asc
  limit 1;

  return v_agent_id;
end;
$$;

-- 4. Assignation automatique à l'insertion
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
    return NEW;
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

drop trigger if exists trg_assign_confirmation_agent on public.orders;
create trigger trg_assign_confirmation_agent
  before insert
  on public.orders
  for each row
  execute function public.assign_confirmation_agent_on_insert();

-- 5. Reprise de l'existant
do $$
declare
  r record;
  v_name text;
begin
  for r in
    select sm.id as member_id, sm.store_id, sm.user_id, sm.invited_email
    from public.store_members sm
    where sm.role = 'confirmation' and sm.status = 'active'
  loop
    select coalesce(
      nullif(trim(p.full_name), ''),
      nullif(trim(p.first_name || ' ' || p.last_name), ''),
      nullif(trim(r.invited_email), ''),
      'Agent'
    )
    into v_name
    from public.profiles p
    where p.id = r.user_id;

    v_name := coalesce(nullif(trim(v_name), ''), 'Agent');

    insert into public.confirmation_agents (member_id, store_id, name)
    values (r.member_id, r.store_id, v_name)
    on conflict (member_id, store_id)
    do update set is_active = true, updated_at = now();
  end loop;
end $$;

-- 5b. Assigner les commandes encore dans le circuit sans agent (répartition équilibrée).
do $$
declare
  r record;
  v_agent uuid;
begin
  for r in
    select o.id, o.store_id
    from public.orders o
    where o.confirmation_agent_id is null
      and o.status in (
        'new','confirmation_rejected',
        'follow_up_1','follow_up_2','follow_up_3','follow_up_4','follow_up_5',
        'no_answer','wrong_number','voicemail'
      )
    order by o.order_date asc, o.id asc
  loop
    v_agent := public.pick_confirmation_agent(r.store_id);
    if v_agent is not null then
      update public.orders
      set confirmation_agent_id = v_agent
      where id = r.id;
      update public.confirmation_agents
      set last_assigned_at = now(), updated_at = now()
      where id = v_agent;
    end if;
  end loop;
end $$;
