-- ============================================================
-- Finance — durcissement : rôle financier, écritures directes, concurrence
-- ============================================================

create or replace function public.rpc_finance_agent_balances(p_store_ids uuid[])
returns table (
  agent_id uuid,
  agent_name text,
  store_id uuid,
  earned_commission numeric,
  paid_commission numeric,
  remaining numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with paid as (
    select p.agent_id, p.store_id, sum(a.amount)::numeric as total
    from public.confirmation_agent_payments p
    join public.confirmation_agent_payment_allocations a on a.payment_id = p.id
    group by p.agent_id, p.store_id
  )
  select
    ca.id,
    ca.name,
    ca.store_id,
    coalesce(sum(o.confirmation_commission_amount) filter (where o.confirmation_commission_status in ('earned','paid')), 0)::numeric,
    coalesce(pd.total, 0)::numeric,
    (coalesce(sum(o.confirmation_commission_amount) filter (where o.confirmation_commission_status in ('earned','paid')), 0)::numeric
      - coalesce(pd.total, 0)::numeric)
  from public.confirmation_agents ca
  left join public.orders o on o.confirmation_agent_id = ca.id
  left join paid pd on pd.agent_id = ca.id and pd.store_id = ca.store_id
  where ca.store_id = any(p_store_ids)
    and public.can_view_store_finances(ca.store_id)
  group by ca.id, ca.name, ca.store_id, pd.total
  order by ca.name;
$$;

create or replace function public.rpc_finance_supplier_balances(p_store_ids uuid[])
returns table (
  supplier_id uuid,
  supplier_name text,
  store_id uuid,
  total_due numeric,
  total_paid numeric,
  remaining numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with paid as (
    select p.supplier_id, p.store_id, sum(a.amount)::numeric as total
    from public.supplier_payments p
    join public.supplier_payment_allocations a on a.payment_id = p.id
    group by p.supplier_id, p.store_id
  ),
  due as (
    select p.supplier_id, p.store_id, sum(p.amount_due)::numeric as total
    from public.supplier_purchases p
    group by p.supplier_id, p.store_id
  )
  select
    s.id,
    s.name,
    s.store_id,
    coalesce(du.total, 0)::numeric,
    coalesce(pd.total, 0)::numeric,
    (coalesce(du.total, 0)::numeric - coalesce(pd.total, 0)::numeric)
  from public.suppliers s
  left join due du on du.supplier_id = s.id and du.store_id = s.store_id
  left join paid pd on pd.supplier_id = s.id and pd.store_id = s.store_id
  where s.store_id = any(p_store_ids)
    and public.can_view_store_finances(s.store_id)
  order by s.name;
$$;

-- 2. Verrouillage des lignes cibles pour éviter le surpaiement en concurrence.
create or replace function public.rpc_record_agent_payment(
  p_store_id uuid,
  p_agent_id uuid,
  p_amount numeric,
  p_currency text default 'MAD',
  p_paid_at timestamptz default now(),
  p_payment_method text default null,
  p_reference text default null,
  p_note text default null,
  p_allocations jsonb default '[]'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id uuid;
  v_alloc record;
  v_total numeric := 0;
  v_remaining numeric;
begin
  if not public.can_record_store_payments(p_store_id) then
    raise exception 'FORBIDDEN';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if not exists (
    select 1 from public.confirmation_agents where id = p_agent_id and store_id = p_store_id
  ) then
    raise exception 'AGENT_NOT_FOUND';
  end if;

  for v_alloc in
    select * from jsonb_to_recordset(p_allocations) as x(order_id uuid, amount numeric)
  loop
    if v_alloc.order_id is null or v_alloc.amount is null or v_alloc.amount <= 0 then
      raise exception 'INVALID_ALLOCATION';
    end if;
    v_total := v_total + v_alloc.amount;

    select (coalesce(o.confirmation_commission_amount, 0)
            - coalesce((select sum(a.amount) from public.confirmation_agent_payment_allocations a
                        where a.order_id = o.id), 0))
    into v_remaining
    from public.orders o
    where o.id = v_alloc.order_id
      and o.store_id = p_store_id
      and o.confirmation_agent_id = p_agent_id
      and o.confirmation_commission_status in ('earned','paid')
    for update of o;

    if v_remaining is null then
      raise exception 'ALLOCATION_ORDER_INVALID';
    end if;
    if v_alloc.amount > v_remaining then
      raise exception 'ALLOCATION_EXCEEDS_REMAINING';
    end if;
  end loop;

  if v_total <> p_amount then
    raise exception 'ALLOCATION_TOTAL_MISMATCH';
  end if;

  insert into public.confirmation_agent_payments
    (store_id, agent_id, amount, currency, paid_at, payment_method, reference, note, created_by)
  values (p_store_id, p_agent_id, p_amount, p_currency, p_paid_at, p_payment_method, p_reference, p_note, auth.uid())
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

create or replace function public.rpc_record_supplier_payment(
  p_store_id uuid,
  p_supplier_id uuid,
  p_amount numeric,
  p_currency text default 'MAD',
  p_paid_at timestamptz default now(),
  p_payment_method text default null,
  p_reference text default null,
  p_note text default null,
  p_allocations jsonb default '[]'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id uuid;
  v_alloc record;
  v_total numeric := 0;
  v_remaining numeric;
begin
  if not public.can_record_store_payments(p_store_id) then
    raise exception 'FORBIDDEN';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if not exists (select 1 from public.suppliers where id = p_supplier_id and store_id = p_store_id) then
    raise exception 'SUPPLIER_NOT_FOUND';
  end if;

  for v_alloc in
    select * from jsonb_to_recordset(p_allocations) as x(purchase_id uuid, amount numeric)
  loop
    if v_alloc.purchase_id is null or v_alloc.amount is null or v_alloc.amount <= 0 then
      raise exception 'INVALID_ALLOCATION';
    end if;
    v_total := v_total + v_alloc.amount;

    select (coalesce(p.amount_due, 0)
            - coalesce((select sum(a.amount) from public.supplier_payment_allocations a
                        where a.purchase_id = p.id), 0))
    into v_remaining
    from public.supplier_purchases p
    where p.id = v_alloc.purchase_id
      and p.store_id = p_store_id
      and p.supplier_id = p_supplier_id
    for update of p;

    if v_remaining is null then
      raise exception 'ALLOCATION_PURCHASE_INVALID';
    end if;
    if v_alloc.amount > v_remaining then
      raise exception 'ALLOCATION_EXCEEDS_REMAINING';
    end if;
  end loop;

  if v_total <> p_amount then
    raise exception 'ALLOCATION_TOTAL_MISMATCH';
  end if;

  insert into public.supplier_payments
    (store_id, supplier_id, amount, currency, paid_at, payment_method, reference, note, created_by)
  values (p_store_id, p_supplier_id, p_amount, p_currency, p_paid_at, p_payment_method, p_reference, p_note, auth.uid())
  returning id into v_payment_id;

  for v_alloc in
    select * from jsonb_to_recordset(p_allocations) as x(purchase_id uuid, amount numeric)
  loop
    insert into public.supplier_payment_allocations (store_id, payment_id, purchase_id, amount)
    values (p_store_id, v_payment_id, v_alloc.purchase_id, v_alloc.amount);
  end loop;

  return v_payment_id;
end;
$$;

-- 3. Révoquer les écritures directes sur les tables finance :
--    seules les RPC `security definer` peuvent écrire (règles d'imputation garanties).
revoke insert, update, delete, truncate, references, trigger on public.confirmation_agent_payments from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.confirmation_agent_payment_allocations from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.supplier_purchases from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.supplier_payments from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.supplier_payment_allocations from anon, authenticated;

grant select on public.confirmation_agent_payments to authenticated;
grant select on public.confirmation_agent_payment_allocations to authenticated;
grant select on public.supplier_purchases to authenticated;
grant select on public.supplier_payments to authenticated;
grant select on public.supplier_payment_allocations to authenticated;


