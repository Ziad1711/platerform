-- ============================================================
-- Commissions des agents de confirmation
-- ============================================================

-- 1. Réglages par défaut du store.
alter table public.confirmation_settings
  add column if not exists commission_enabled boolean not null default false,
  add column if not exists default_commission_amount numeric not null default 0,
  add column if not exists default_commission_trigger text not null default 'delivered';

alter table public.confirmation_settings drop constraint if exists confirmation_settings_commission_trigger_check;
alter table public.confirmation_settings
  add constraint confirmation_settings_commission_trigger_check
  check (default_commission_trigger in ('confirmed','delivered'));

-- 2. Configuration individuelle de l'agent.
alter table public.confirmation_agents
  add column if not exists commission_enabled boolean not null default false,
  add column if not exists commission_trigger text,
  add column if not exists use_store_commission_settings boolean not null default true;

alter table public.confirmation_agents drop constraint if exists confirmation_agents_commission_trigger_check;
alter table public.confirmation_agents
  add constraint confirmation_agents_commission_trigger_check
  check (commission_trigger is null or commission_trigger in ('confirmed','delivered'));

-- 3. Snapshot sur la commande.
alter table public.orders
  add column if not exists confirmation_commission_amount numeric not null default 0,
  add column if not exists confirmation_commission_trigger text,
  add column if not exists confirmation_commission_rule_source text,
  add column if not exists confirmation_commission_status text,
  add column if not exists confirmation_commission_earned_at timestamptz;

alter table public.orders drop constraint if exists orders_confirmation_commission_status_check;
alter table public.orders
  add constraint orders_confirmation_commission_status_check
  check (
    confirmation_commission_status is null
    or confirmation_commission_status in ('pending','earned','cancelled','paid')
  );

-- 4. Résolution de la commission (agent prioritaire, sinon store).
create or replace function public.resolve_confirmation_commission_for_order(p_order_id uuid)
returns table (commission_amount numeric, commission_trigger text, rule_source text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_agent public.confirmation_agents%rowtype;
  v_settings public.confirmation_settings%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found or v_order.confirmation_agent_id is null then
    return;
  end if;

  select * into v_agent from public.confirmation_agents
  where id = v_order.confirmation_agent_id;
  if not found or not coalesce(v_agent.is_active, false) then
    return;
  end if;

  if coalesce(v_agent.use_store_commission_settings, true) = false then
    if coalesce(v_agent.commission_enabled, false) = true
       and coalesce(v_agent.commission_per_order, 0) > 0 then
      return query select
        v_agent.commission_per_order,
        coalesce(v_agent.commission_trigger, 'delivered'),
        'agent'::text;
    end if;
    return;
  end if;

  select * into v_settings from public.confirmation_settings
  where store_id = v_order.store_id;
  if not found then return; end if;

  if coalesce(v_settings.commission_enabled, false) = true
     and coalesce(v_settings.default_commission_amount, 0) > 0 then
    return query select
      v_settings.default_commission_amount,
      coalesce(v_settings.default_commission_trigger, 'delivered'),
      'store_default'::text;
  end if;
end;
$$;

revoke all on function public.resolve_confirmation_commission_for_order(uuid) from public;
revoke execute on function public.resolve_confirmation_commission_for_order(uuid) from anon, authenticated;
grant execute on function public.resolve_confirmation_commission_for_order(uuid) to service_role;

-- 5. Synchronisation de la commission sur changement de statut.
create or replace function public.sync_confirmation_commission_on_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount numeric := 0;
  v_trigger text := null;
  v_source text := null;
begin
  if TG_OP <> 'UPDATE' or OLD.status is not distinct from NEW.status then
    return NEW;
  end if;

  if NEW.status = 'confirmed' and OLD.status is distinct from 'confirmed' then
    select ca.commission_amount, ca.commission_trigger, ca.rule_source
    into v_amount, v_trigger, v_source
    from public.resolve_confirmation_commission_for_order(NEW.id) ca;

    NEW.confirmation_commission_amount := coalesce(v_amount, 0);
    NEW.confirmation_commission_trigger := v_trigger;
    NEW.confirmation_commission_rule_source := coalesce(v_source, 'none');

    if v_trigger is null or coalesce(v_amount, 0) <= 0 then
      NEW.confirmation_commission_status := 'cancelled';
      NEW.confirmation_commission_earned_at := null;
      NEW.confirmation_cost_allocated := 0;
    elsif v_trigger = 'confirmed' then
      NEW.confirmation_commission_status := 'earned';
      NEW.confirmation_commission_earned_at := now();
      NEW.confirmation_cost_allocated := v_amount;
    else
      NEW.confirmation_commission_status := 'pending';
      NEW.confirmation_commission_earned_at := null;
      NEW.confirmation_cost_allocated := 0;
    end if;
  end if;

  if NEW.status = 'delivered' and OLD.status is distinct from 'delivered' then
    if NEW.confirmation_commission_status is null or NEW.confirmation_commission_status = '' then
      select ca.commission_amount, ca.commission_trigger, ca.rule_source
      into v_amount, v_trigger, v_source
      from public.resolve_confirmation_commission_for_order(NEW.id) ca;

      NEW.confirmation_commission_amount := coalesce(v_amount, 0);
      NEW.confirmation_commission_trigger := v_trigger;
      NEW.confirmation_commission_rule_source := coalesce(v_source, 'none');

      if v_trigger = 'delivered' and coalesce(v_amount, 0) > 0 then
        NEW.confirmation_commission_status := 'earned';
        NEW.confirmation_commission_earned_at := now();
        NEW.confirmation_cost_allocated := v_amount;
      else
        NEW.confirmation_commission_status := 'cancelled';
        NEW.confirmation_cost_allocated := 0;
      end if;
    elsif NEW.confirmation_commission_status = 'pending'
       and NEW.confirmation_commission_trigger = 'delivered'
       and coalesce(NEW.confirmation_commission_amount, 0) > 0 then
      NEW.confirmation_commission_status := 'earned';
      NEW.confirmation_commission_earned_at := now();
      NEW.confirmation_cost_allocated := NEW.confirmation_commission_amount;
    end if;
  end if;

  if NEW.status in ('cancelled','refused','returned_not_stocked','returned_stocked')
     and OLD.status is distinct from NEW.status
     and NEW.confirmation_commission_status = 'pending' then
    NEW.confirmation_commission_status := 'cancelled';
    NEW.confirmation_commission_earned_at := null;
    NEW.confirmation_cost_allocated := 0;
  end if;

  return NEW;
end;
$$;

revoke all on function public.sync_confirmation_commission_on_status() from public;
revoke execute on function public.sync_confirmation_commission_on_status() from anon, authenticated;
grant execute on function public.sync_confirmation_commission_on_status() to service_role;

drop trigger if exists trg_sync_confirmation_commission on public.orders;
create trigger trg_sync_confirmation_commission
  before update of status
  on public.orders
  for each row
  execute function public.sync_confirmation_commission_on_status();

