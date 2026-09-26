-- ============================================================
-- 20260927100200 — Finances : devise des règlements = devise du store
-- ------------------------------------------------------------
-- Constat (audit prod) : `rpc_record_agent_payment` portait
-- `p_currency text DEFAULT 'MAD'` et le dialogue de versement agent n'envoie
-- jamais `p_currency`. Pour un store dont la devise n'est pas MAD, tout
-- versement était donc étiqueté MAD — violation de la règle métier
-- « ne jamais additionner des devises différentes » (plan Finances, §9).
--
-- Correctif : plus aucun littéral MAD. La devise utilisée provient de
-- `p_currency` lorsqu'il est fourni explicitement, sinon de la devise du
-- store ciblé (`stores.currency`, NOT NULL). Signature inchangée (seule la
-- valeur par défaut évolue), donc aucun appel existant n'est cassé.
--
-- Les règlements et achats fournisseurs sont traités dans la migration
-- compagnon `20260927100300_finance_payment_currency_from_store_suppliers`.
-- ============================================================

create or replace function public.rpc_record_agent_payment(
  p_store_id uuid,
  p_agent_id uuid,
  p_amount numeric,
  p_currency text default null,
  p_paid_at timestamptz default now(),
  p_payment_method text default null,
  p_reference text default null,
  p_note text default null,
  p_allocations jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id uuid;
  v_alloc record;
  v_total numeric := 0;
  v_allocated numeric;
  v_currency text;
begin
  if not public.can_record_store_payments(p_store_id) then
    raise exception 'FORBIDDEN';
  end if;

  v_currency := upper(coalesce(
    nullif(btrim(p_currency), ''),
    (select s.currency from public.stores s where s.id = p_store_id)
  ));
  if v_currency is null then
    raise exception 'STORE_CURRENCY_MISSING';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if not exists (
    select 1 from public.confirmation_agents where id = p_agent_id and store_id = p_store_id
  ) then
    raise exception 'AGENT_NOT_FOUND';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_allocations) as x(order_id uuid, amount numeric)
    where x.order_id is null or x.amount is null or x.amount <= 0
  ) then
    raise exception 'INVALID_ALLOCATION';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_allocations) as x(order_id uuid, amount numeric)
    where not exists (
      select 1 from public.orders o
      where o.id = x.order_id
        and o.store_id = p_store_id
        and o.confirmation_agent_id = p_agent_id
        and o.confirmation_commission_status in ('earned','paid')
    )
  ) then
    raise exception 'ALLOCATION_ORDER_INVALID';
  end if;

  select coalesce(sum(x.amount), 0) into v_total
  from jsonb_to_recordset(p_allocations) as x(order_id uuid, amount numeric);

  if v_total <> p_amount then
    raise exception 'ALLOCATION_TOTAL_MISMATCH';
  end if;

  for v_alloc in
    with alloc as (
      select x.order_id as oid, sum(x.amount)::numeric as tot
      from jsonb_to_recordset(p_allocations) as x(order_id uuid, amount numeric)
      group by x.order_id
    )
    select a.oid as order_id, a.tot as amount, o.confirmation_commission_amount as commission
    from alloc a
    join public.orders o on o.id = a.oid
    for update of o
  loop
    select coalesce(sum(al.amount), 0) into v_allocated
    from public.confirmation_agent_payment_allocations al
    where al.order_id = v_alloc.order_id;

    if v_alloc.amount > (coalesce(v_alloc.commission, 0) - v_allocated) then
      raise exception 'ALLOCATION_EXCEEDS_REMAINING';
    end if;
  end loop;

  insert into public.confirmation_agent_payments
    (store_id, agent_id, amount, currency, paid_at, payment_method, reference, note, created_by)
  values (p_store_id, p_agent_id, p_amount, v_currency, p_paid_at, p_payment_method, p_reference, p_note, auth.uid())
  returning id into v_payment_id;

  for v_alloc in
    select * from jsonb_to_recordset(p_allocations) as x(order_id uuid, amount numeric)
  loop
    insert into public.confirmation_agent_payment_allocations (store_id, payment_id, order_id, amount)
    values (p_store_id, v_payment_id, v_alloc.order_id, v_alloc.amount);

    update public.orders o
    set confirmation_commission_status = 'paid'
    where o.id = v_alloc.order_id
      and (coalesce(o.confirmation_commission_amount, 0)
           - coalesce((select sum(a.amount) from public.confirmation_agent_payment_allocations a
                       where a.order_id = o.id), 0)) <= 0;
  end loop;

  return v_payment_id;
end;
$$;
