-- ============================================================
-- 20260927100300 — Finances : devise des règlements fournisseurs = devise du store
-- ------------------------------------------------------------
-- Suite de `20260927100200_finance_payment_currency_from_store`
-- (règlements agents). Même constat et même correctif pour les
-- règlements fournisseurs et les achats fournisseurs :
-- `p_currency text DEFAULT 'MAD'` + UI qui n'envoie jamais `p_currency`
-- → tout versement/achat d'un store non-MAD était étiqueté MAD.
--
-- Correctif : plus aucun littéral MAD. La devise provient de `p_currency`
-- lorsqu'il est fourni explicitement, sinon de `stores.currency` du store.
-- Signatures inchangées (seule la valeur par défaut évolue).
-- ============================================================

create or replace function public.rpc_record_supplier_payment(
  p_store_id uuid,
  p_supplier_id uuid,
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
  if not exists (select 1 from public.suppliers where id = p_supplier_id and store_id = p_store_id) then
    raise exception 'SUPPLIER_NOT_FOUND';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_allocations) as x(purchase_id uuid, amount numeric)
    where x.purchase_id is null or x.amount is null or x.amount <= 0
  ) then
    raise exception 'INVALID_ALLOCATION';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_allocations) as x(purchase_id uuid, amount numeric)
    where not exists (
      select 1 from public.supplier_purchases p
      where p.id = x.purchase_id
        and p.store_id = p_store_id
        and p.supplier_id = p_supplier_id
    )
  ) then
    raise exception 'ALLOCATION_PURCHASE_INVALID';
  end if;

  select coalesce(sum(x.amount), 0) into v_total
  from jsonb_to_recordset(p_allocations) as x(purchase_id uuid, amount numeric);

  if v_total <> p_amount then
    raise exception 'ALLOCATION_TOTAL_MISMATCH';
  end if;

  for v_alloc in
    with alloc as (
      select x.purchase_id as pid, sum(x.amount)::numeric as tot
      from jsonb_to_recordset(p_allocations) as x(purchase_id uuid, amount numeric)
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
  values (p_store_id, p_supplier_id, p_amount, v_currency, p_paid_at, p_payment_method, p_reference, p_note, auth.uid())
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

create or replace function public.rpc_record_supplier_purchase(
  p_store_id uuid,
  p_supplier_id uuid,
  p_amount_due numeric,
  p_currency text default null,
  p_purchase_date timestamptz default now(),
  p_due_date timestamptz default null,
  p_invoice_reference text default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
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

  if p_amount_due is null or p_amount_due < 0 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if not exists (select 1 from public.suppliers where id = p_supplier_id and store_id = p_store_id) then
    raise exception 'SUPPLIER_NOT_FOUND';
  end if;

  insert into public.supplier_purchases
    (store_id, supplier_id, amount_due, currency, purchase_date, due_date, invoice_reference, note, created_by)
  values (p_store_id, p_supplier_id, p_amount_due, v_currency, p_purchase_date, p_due_date, p_invoice_reference, p_note, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

-- Privilèges : `anon` déjà retiré par `20260927100100`, rappelés pour qu'une
-- base reconstruite depuis les migrations garde exactement le même état.
revoke all on function public.rpc_record_supplier_payment(uuid, uuid, numeric, text, timestamptz, text, text, text, jsonb) from anon;
grant execute on function public.rpc_record_supplier_payment(uuid, uuid, numeric, text, timestamptz, text, text, text, jsonb) to authenticated, service_role;

revoke all on function public.rpc_record_supplier_purchase(uuid, uuid, numeric, text, timestamptz, timestamptz, text, text) from anon;
grant execute on function public.rpc_record_supplier_purchase(uuid, uuid, numeric, text, timestamptz, timestamptz, text, text) to authenticated, service_role;
