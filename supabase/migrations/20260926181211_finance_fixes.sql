-- ============================================================
-- Finance — correctifs : double comptage pub + imputations répétées
-- ============================================================

create or replace function public.rpc_finance_overview(
  p_store_id uuid,
  p_start_date timestamptz default null,
  p_end_date timestamptz default null
)
returns table (
  store_id uuid,
  currency text,
  revenue numeric,
  cost_of_goods numeric,
  delivery_cost numeric,
  ad_spend numeric,
  commission numeric,
  other_expenses numeric,
  operating_result numeric,
  delivered_orders bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with scoped_orders as (
    select o.*
    from public.orders o
    where o.store_id = p_store_id
      and (p_start_date is null or o.order_date >= p_start_date)
      and (p_end_date is null or o.order_date < p_end_date)
  ),
  order_item_totals as (
    select
      oi.order_id,
      sum(coalesce(oi.quantity, 0) * coalesce(oi.unit_selling_price, 0))::numeric as item_revenue,
      sum(coalesce(oi.quantity, 0) * coalesce(oi.unit_purchase_cost_snapshot, 0))::numeric as item_purchase_cost
    from public.order_items oi
    join scoped_orders so on so.id = oi.order_id
    group by oi.order_id
  ),
  ads_daily as (
    select coalesce(sum(coalesce(a.spend_converted, a.spend, 0)), 0)::numeric as total
    from public.ad_spend_daily a
    where a.store_id = p_store_id
      and (p_start_date is null or a.spend_date >= p_start_date)
      and (p_end_date is null or a.spend_date < p_end_date)
  ),
  ads_allocated as (
    select coalesce(sum(coalesce(so.ads_cost_allocated, 0)), 0)::numeric as total
    from scoped_orders so
  ),
  other_exp as (
    select coalesce(sum(coalesce(e.amount, 0)), 0)::numeric as total
    from public.expenses e
    left join public.expense_categories c on c.id = e.category_id
    where e.store_id = p_store_id
      and e.status = 'active'
      and coalesce(c.type, '') is distinct from 'ads'
      and (p_start_date is null or e.expense_date >= p_start_date)
      and (p_end_date is null or e.expense_date < p_end_date)
  ),
  base as (
    select
      coalesce(sum(coalesce(oit.item_revenue, 0)) filter (where so.status = 'delivered'), 0)::numeric as revenue,
      coalesce(sum(coalesce(oit.item_purchase_cost, so.buy_price, 0)) filter (where so.status = 'delivered'), 0)::numeric as cogs,
      coalesce(sum(coalesce(so.delivery_fee, 0)) filter (where so.status = 'delivered'), 0)::numeric as delivery,
      coalesce(sum(coalesce(so.confirmation_cost_allocated, 0)) filter (where so.status = 'delivered'), 0)::numeric as commission,
      count(so.id) filter (where so.status = 'delivered')::bigint as delivered
    from scoped_orders so
    left join order_item_totals oit on oit.order_id = so.id
  )
  select
    p_store_id,
    (select s.currency from public.stores s where s.id = p_store_id),
    b.revenue,
    b.cogs,
    b.delivery,
    case when (select total from ads_daily) > 0 then (select total from ads_daily) else (select total from ads_allocated) end,
    b.commission,
    (select total from other_exp),
    b.revenue - b.cogs - b.delivery
      - case when (select total from ads_daily) > 0 then (select total from ads_daily) else (select total from ads_allocated) end
      - b.commission
      - (select total from other_exp),
    b.delivered
  from base b
  where public.can_view_store_finances(p_store_id);
$$;

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
  v_allocated numeric;
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

  select coalesce(sum(x.amount), 0) into v_total
  from jsonb_to_recordset(p_allocations) as x(order_id uuid, amount numeric)
  where x.amount is not null and x.amount > 0;

  if v_total <= 0 then
    raise exception 'INVALID_ALLOCATION';
  end if;
  if v_total <> p_amount then
    raise exception 'ALLOCATION_TOTAL_MISMATCH';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_allocations) as x(order_id uuid, amount numeric)
    where x.order_id is null
       or not exists (
         select 1 from public.orders o
         where o.id = x.order_id
           and o.store_id = p_store_id
           and o.confirmation_agent_id = p_agent_id
           and o.confirmation_commission_status in ('earned','paid')
       )
  ) then
    raise exception 'ALLOCATION_ORDER_INVALID';
  end if;

  for v_alloc in
    with alloc as (
      select x.order_id as oid, sum(x.amount)::numeric as tot
      from jsonb_to_recordset(p_allocations) as x(order_id uuid, amount numeric)
      where x.order_id is not null and x.amount is not null and x.amount > 0
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
  values (p_store_id, p_agent_id, p_amount, p_currency, p_paid_at, p_payment_method, p_reference, p_note, auth.uid())
  returning id into v_payment_id;

  for v_alloc in
    select * from jsonb_to_recordset(p_allocations) as x(order_id uuid, amount numeric)
    where x.order_id is not null and x.amount is not null and x.amount > 0
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
  v_allocated numeric;
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

  select coalesce(sum(x.amount), 0) into v_total
  from jsonb_to_recordset(p_allocations) as x(purchase_id uuid, amount numeric)
  where x.amount is not null and x.amount > 0;

  if v_total <= 0 then
    raise exception 'INVALID_ALLOCATION';
  end if;
  if v_total <> p_amount then
    raise exception 'ALLOCATION_TOTAL_MISMATCH';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_allocations) as x(purchase_id uuid, amount numeric)
    where x.purchase_id is null
       or not exists (
         select 1 from public.supplier_purchases p
         where p.id = x.purchase_id
           and p.store_id = p_store_id
           and p.supplier_id = p_supplier_id
       )
  ) then
    raise exception 'ALLOCATION_PURCHASE_INVALID';
  end if;

  for v_alloc in
    with alloc as (
      select x.purchase_id as pid, sum(x.amount)::numeric as tot
      from jsonb_to_recordset(p_allocations) as x(purchase_id uuid, amount numeric)
      where x.purchase_id is not null and x.amount is not null and x.amount > 0
      group by x.purchase_id
    )
    select a.pid as purchase_id, a.tot as amount, p.amount_due as due
    from alloc a
    join public.supplier_purchases p on p.id = a.pid
    for update of p
  loop
    select coalesce(sum(al.amount), 0) into v_allocated
    from public.supplier_payment_allocations al
    where al.purchase_id = v_alloc.purchase_id;

    if v_alloc.amount > (coalesce(v_alloc.due, 0) - v_allocated) then
      raise exception 'ALLOCATION_EXCEEDS_REMAINING';
    end if;
  end loop;

  insert into public.supplier_payments
    (store_id, supplier_id, amount, currency, paid_at, payment_method, reference, note, created_by)
  values (p_store_id, p_supplier_id, p_amount, p_currency, p_paid_at, p_payment_method, p_reference, p_note, auth.uid())
  returning id into v_payment_id;

  for v_alloc in
    select * from jsonb_to_recordset(p_allocations) as x(purchase_id uuid, amount numeric)
    where x.purchase_id is not null and x.amount is not null and x.amount > 0
  loop
    insert into public.supplier_payment_allocations (store_id, payment_id, purchase_id, amount)
    values (p_store_id, v_payment_id, v_alloc.purchase_id, v_alloc.amount);
  end loop;

  return v_payment_id;
end;
$$;


