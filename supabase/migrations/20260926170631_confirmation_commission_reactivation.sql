-- ============================================================
-- Correctif : réactivation d'une commission annulée + sémantique
-- de la commission "potentielle".
-- 1. Une commande re-confirmée réactive une commission annulée
--    (le montant snapshoté est conservé, jamais recalculé).
-- 2. `potential_commission` = commissions encore "pending" uniquement.
-- ============================================================

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
    if NEW.confirmation_commission_status is null then
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
    elsif NEW.confirmation_commission_status = 'cancelled'
       and coalesce(NEW.confirmation_commission_amount, 0) > 0 then
      -- Réactivation d'une commission annulée (l'ordre repasse dans le flux).
      if NEW.confirmation_commission_trigger = 'confirmed' then
        NEW.confirmation_commission_status := 'earned';
        NEW.confirmation_commission_earned_at := now();
        NEW.confirmation_cost_allocated := NEW.confirmation_commission_amount;
      else
        NEW.confirmation_commission_status := 'pending';
        NEW.confirmation_commission_earned_at := null;
        NEW.confirmation_cost_allocated := 0;
      end if;
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
    elsif NEW.confirmation_commission_status = 'cancelled'
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
-- 2. RPC multi-store : `potential_commission` = statut `pending` uniquement.
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
    coalesce(sum(coalesce(o.confirmation_commission_amount, 0)) filter (where o.confirmation_commission_status = 'pending'), 0)::numeric as potential_commission,
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

