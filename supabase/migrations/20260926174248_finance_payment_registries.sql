-- ============================================================
-- Finance — registres de règlements (agents + fournisseurs)
-- ============================================================

-- ---------- Helpers ----------
create or replace function public.can_view_store_finances(p_store_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.stores s where s.id = p_store_id and s.owner_user_id = auth.uid()
  )
  or exists (
    select 1 from public.store_members sm
    where sm.store_id = p_store_id
      and sm.user_id = auth.uid()
      and sm.status = 'active'
      and sm.role in ('owner','admin','accountant')
  );
$$;

create or replace function public.can_record_store_payments(p_store_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.stores s where s.id = p_store_id and s.owner_user_id = auth.uid()
  )
  or exists (
    select 1 from public.store_members sm
    where sm.store_id = p_store_id
      and sm.user_id = auth.uid()
      and sm.status = 'active'
      and sm.role in ('owner','admin','accountant')
  );
$$;

revoke all on function public.can_view_store_finances(uuid) from public;
revoke all on function public.can_record_store_payments(uuid) from public;
grant execute on function public.can_view_store_finances(uuid) to authenticated, service_role;
grant execute on function public.can_record_store_payments(uuid) to authenticated, service_role;

create table if not exists public.confirmation_agent_payments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  agent_id uuid not null references public.confirmation_agents(id) on delete cascade,
  amount numeric not null check (amount > 0),
  currency text not null default 'MAD',
  paid_at timestamptz not null default now(),
  payment_method text,
  reference text,
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.confirmation_agent_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  payment_id uuid not null references public.confirmation_agent_payments(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete restrict,
  amount numeric not null check (amount > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.supplier_purchases (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  amount_due numeric not null check (amount_due >= 0),
  currency text not null default 'MAD',
  purchase_date timestamptz not null default now(),
  due_date timestamptz,
  invoice_reference text,
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.supplier_payments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  amount numeric not null check (amount > 0),
  currency text not null default 'MAD',
  paid_at timestamptz not null default now(),
  payment_method text,
  reference text,
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.supplier_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  payment_id uuid not null references public.supplier_payments(id) on delete cascade,
  purchase_id uuid not null references public.supplier_purchases(id) on delete restrict,
  amount numeric not null check (amount > 0),
  created_at timestamptz not null default now()
);

create index if not exists confirmation_agent_payments_agent_idx
  on public.confirmation_agent_payments(store_id, agent_id);
create index if not exists confirmation_agent_payment_allocations_order_idx
  on public.confirmation_agent_payment_allocations(store_id, order_id);
create index if not exists supplier_purchases_supplier_idx
  on public.supplier_purchases(store_id, supplier_id);
create index if not exists supplier_payments_supplier_idx
  on public.supplier_payments(store_id, supplier_id);
create index if not exists supplier_payment_allocations_purchase_idx
  on public.supplier_payment_allocations(store_id, purchase_id);

-- ---------- RLS ----------
alter table public.confirmation_agent_payments enable row level security;
alter table public.confirmation_agent_payment_allocations enable row level security;
alter table public.supplier_purchases enable row level security;
alter table public.supplier_payments enable row level security;
alter table public.supplier_payment_allocations enable row level security;

create policy confirmation_agent_payments_select on public.confirmation_agent_payments for select
  using (public.can_view_store_finances(store_id));
create policy confirmation_agent_payments_insert on public.confirmation_agent_payments for insert
  with check (public.can_record_store_payments(store_id));

create policy confirmation_agent_payment_allocations_select on public.confirmation_agent_payment_allocations for select
  using (public.can_view_store_finances(store_id));
create policy confirmation_agent_payment_allocations_insert on public.confirmation_agent_payment_allocations for insert
  with check (public.can_record_store_payments(store_id));

create policy supplier_purchases_select on public.supplier_purchases for select
  using (public.can_view_store_finances(store_id));
create policy supplier_purchases_insert on public.supplier_purchases for insert
  with check (public.can_record_store_payments(store_id));

create policy supplier_payments_select on public.supplier_payments for select
  using (public.can_view_store_finances(store_id));
create policy supplier_payments_insert on public.supplier_payments for insert
  with check (public.can_record_store_payments(store_id));

create policy supplier_payment_allocations_select on public.supplier_payment_allocations for select
  using (public.can_view_store_finances(store_id));
create policy supplier_payment_allocations_insert on public.supplier_payment_allocations for insert
  with check (public.can_record_store_payments(store_id));

-- ---------- RPC : enregistrer un versement agent ----------
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
      and o.confirmation_commission_status in ('earned','paid');

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

-- ---------- RPC : enregistrer un achat fournisseur ----------
create or replace function public.rpc_record_supplier_purchase(
  p_store_id uuid,
  p_supplier_id uuid,
  p_amount_due numeric,
  p_currency text default 'MAD',
  p_purchase_date timestamptz default now(),
  p_due_date timestamptz default null,
  p_invoice_reference text default null,
  p_note text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.can_record_store_payments(p_store_id) then
    raise exception 'FORBIDDEN';
  end if;
  if p_amount_due is null or p_amount_due < 0 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if not exists (select 1 from public.suppliers where id = p_supplier_id and store_id = p_store_id) then
    raise exception 'SUPPLIER_NOT_FOUND';
  end if;

  insert into public.supplier_purchases
    (store_id, supplier_id, amount_due, currency, purchase_date, due_date, invoice_reference, note, created_by)
  values (p_store_id, p_supplier_id, p_amount_due, p_currency, p_purchase_date, p_due_date, p_invoice_reference, p_note, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------- RPC : enregistrer un paiement fournisseur ----------
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
      and p.supplier_id = p_supplier_id;

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

-- ---------- RPC : soldes agents ----------
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
    coalesce(sum(o.confirmation_commission_amount) filter (where o.confirmation_commission_status in ('earned','paid')), 0)::numeric as earned_commission,
    coalesce(pd.total, 0)::numeric as paid_commission,
    (coalesce(sum(o.confirmation_commission_amount) filter (where o.confirmation_commission_status in ('earned','paid')), 0)::numeric
      - coalesce(pd.total, 0)::numeric) as remaining
  from public.confirmation_agents ca
  left join public.orders o on o.confirmation_agent_id = ca.id
  left join paid pd on pd.agent_id = ca.id and pd.store_id = ca.store_id
  where ca.store_id = any(p_store_ids)
    and exists (
      select 1 from public.store_members sm
      where sm.store_id = ca.store_id and sm.user_id = auth.uid()
    )
  group by ca.id, ca.name, ca.store_id, pd.total
  order by ca.name;
$$;

-- ---------- RPC : soldes fournisseurs ----------
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
    coalesce(du.total, 0)::numeric as total_due,
    coalesce(pd.total, 0)::numeric as total_paid,
    (coalesce(du.total, 0)::numeric - coalesce(pd.total, 0)::numeric) as remaining
  from public.suppliers s
  left join due du on du.supplier_id = s.id and du.store_id = s.store_id
  left join paid pd on pd.supplier_id = s.id and pd.store_id = s.store_id
  where s.store_id = any(p_store_ids)
    and exists (
      select 1 from public.store_members sm
      where sm.store_id = s.store_id and sm.user_id = auth.uid()
    )
  order by s.name;
$$;

-- ---------- Grants ----------
revoke all on function public.rpc_record_agent_payment(uuid, uuid, numeric, text, timestamptz, text, text, text, jsonb) from public;
revoke all on function public.rpc_record_supplier_purchase(uuid, uuid, numeric, text, timestamptz, timestamptz, text, text) from public;
revoke all on function public.rpc_record_supplier_payment(uuid, uuid, numeric, text, timestamptz, text, text, text, jsonb) from public;
revoke all on function public.rpc_finance_agent_balances(uuid[]) from public;
revoke all on function public.rpc_finance_supplier_balances(uuid[]) from public;

grant execute on function public.rpc_record_agent_payment(uuid, uuid, numeric, text, timestamptz, text, text, text, jsonb) to authenticated;
grant execute on function public.rpc_record_supplier_purchase(uuid, uuid, numeric, text, timestamptz, timestamptz, text, text) to authenticated;
grant execute on function public.rpc_record_supplier_payment(uuid, uuid, numeric, text, timestamptz, text, text, text, jsonb) to authenticated;
grant execute on function public.rpc_finance_agent_balances(uuid[]) to authenticated;
grant execute on function public.rpc_finance_supplier_balances(uuid[]) to authenticated;




