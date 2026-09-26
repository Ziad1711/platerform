-- ============================================================
-- Correctifs commissions de confirmation (audit)
-- 1. Ne pas recalculer un snapshot déjà existant.
-- 2. Recalculer le bénéfice après modification de confirmation_cost_allocated.
-- 3. RPC de performance basée sur les snapshots (commission acquise).
-- 4. Ignorer les anciennes règles expense_automation `agent_commission`.
-- ============================================================

-- 1 + 2. Synchronisation de la commission sur changement de statut.
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

  -- Le snapshot n'est créé que s'il n'existe pas encore. Une correction de statut
  -- ne doit jamais réappliquer le tarif courant à une commande déjà snapshottée.
  if NEW.status = 'confirmed'
     and OLD.status is distinct from 'confirmed'
     and NEW.confirmation_commission_status is null then
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

  -- Recalcul explicite du bénéfice : le trigger de commission s'exécute après le
  -- trigger de bénéfice (ordre alphabétique des triggers BEFORE), donc le coût
  -- confirmé n'était pas pris en compte au moment du calcul initial.
  NEW.profit := (
    coalesce(NEW.total_selling_price, 0)
    - coalesce(NEW.buy_price, 0)
    - coalesce(NEW.ads_cost_allocated, 0)
    - coalesce(NEW.confirmation_cost_allocated, 0)
    - coalesce(NEW.delivery_fee, 0)
    + coalesce(NEW.delivery_charge_to_customer, 0)
  )::numeric(12,2);

  return NEW;
end;
$$;
-- 3. RPC de performance (multi-store) basée sur les snapshots.
drop function if exists public.rpc_dashboard_confirmation_performance(uuid[], timestamptz, timestamptz);
create or replace function public.rpc_dashboard_confirmation_performance(
  p_store_ids uuid[],
  p_start_date timestamptz default null,
  p_end_date timestamptz default null
)
returns table (
  agent_id uuid,
  agent_name text,
  total_orders bigint,
  confirmed_orders bigint,
  delivered_orders bigint,
  rejected_orders bigint,
  potential_commission numeric,
  earned_commission numeric,
  paid_commission numeric,
  confirmation_rate numeric
)
language sql
stable
as $$
  select
    ca.id as agent_id,
    ca.name as agent_name,
    count(*)::bigint as total_orders,
    count(*) filter (where o.status in ('confirmed','picked_up','sent','delivered'))::bigint as confirmed_orders,
    count(*) filter (where o.status = 'delivered')::bigint as delivered_orders,
    count(*) filter (where o.status in ('confirmation_rejected','wrong_number','no_answer','voicemail','cancelled','refused'))::bigint as rejected_orders,
    coalesce(sum(coalesce(o.confirmation_commission_amount, 0)) filter (where o.confirmation_commission_status in ('pending','earned','paid')), 0)::numeric as potential_commission,
    coalesce(sum(coalesce(o.confirmation_commission_amount, 0)) filter (where o.confirmation_commission_status in ('earned','paid')), 0)::numeric as earned_commission,
    coalesce(sum(coalesce(o.confirmation_commission_amount, 0)) filter (where o.confirmation_commission_status = 'paid'), 0)::numeric as paid_commission,
    case
      when count(*) > 0
      then (count(*) filter (where o.status in ('confirmed','picked_up','sent','delivered'))::numeric / count(*)::numeric) * 100
      else 0
    end as confirmation_rate
  from public.confirmation_agents ca
  inner join public.orders o on o.confirmation_agent_id = ca.id
  where ca.store_id = any(p_store_ids)
    and exists (
      select 1
      from public.store_members sm
      where sm.store_id = ca.store_id
        and sm.user_id = auth.uid()
    )
    and (p_start_date is null or o.order_date >= p_start_date)
    and (p_end_date is null or o.order_date <= p_end_date)
  group by ca.id, ca.name
  order by count(*) desc
$$;
-- 4. Le moteur de dépenses ignore les anciennes règles `agent_commission` afin
-- d'éviter un double comptage (la commission est désormais gérée via
-- `confirmation_cost_allocated`).
create or replace function public.process_order_expense_automation(p_order_id uuid, p_event text)
returns integer
language plpgsql
as $$
declare
  v_order public.orders%rowtype;
  v_rule record;
  v_amount numeric;
  v_expense_date timestamptz;
  v_source_hash text;
  v_count integer := 0;
begin
  select * into v_order from public.orders where id = p_order_id;

  if not found then
    return 0;
  end if;

  v_expense_date := case
    when p_event = 'delivered' then coalesce(v_order.delivered_at, v_order.updated_at, now())
    when p_event = 'confirmed' then coalesce(v_order.confirmed_at, v_order.updated_at, now())
    else coalesce(v_order.order_date, v_order.created_at, now())
  end;

  for v_rule in
    select *
    from public.expense_automation_rules r
    where r.store_id = v_order.store_id
      and r.is_active = true
      and r.source_table = 'orders'
      and r.calculation_mode is distinct from 'agent_commission'
      and (
        r.trigger_status = p_event
        or (p_event = 'lead' and r.trigger_status = 'prospect')
      )
      and (
        r.applies_to_all_agents = true
        or (r.confirmation_agent_id is not null and r.confirmation_agent_id = v_order.confirmation_agent_id)
      )
    order by r.priority asc, r.created_at asc
  loop
    if not public.evaluate_expense_rule_conditions(v_rule.conditions, v_order, p_event) then
      continue;
    end if;

    v_amount := case
      when v_rule.calculation_mode = 'percentage'
        then (coalesce(v_order.total_selling_price, 0) * coalesce(v_rule.amount_value, 0) / 100.0)
      else coalesce(v_rule.amount_value, 0)
    end;

    if v_amount <= 0 then
      continue;
    end if;

    v_source_hash := 'order_rule:' || v_rule.id::text || ':' || v_order.id::text || ':' || p_event;

    insert into public.expenses (
      store_id,
      category_id,
      expense_date,
      amount,
      note,
      expense_type,
      status,
      source_type,
      source_table,
      source_id,
      source_hash,
      automation_rule_id
    ) values (
      v_order.store_id,
      v_rule.category_id,
      v_expense_date,
      v_amount,
      coalesce(v_rule.note, v_rule.name),
      'automated',
      'active',
      'automation_rule',
      'orders',
      v_order.id,
      v_source_hash,
      v_rule.id
    )
    on conflict (source_hash) where source_hash is not null do nothing;

    if found then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;


