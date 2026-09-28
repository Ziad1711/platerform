-- ============================================================
-- 20260927110000 — Stock → achat fournisseur : lien atomique
-- ------------------------------------------------------------
-- Un achat saisi dans Stock (entrée avec fournisseur) crée, dans
-- la même transaction, la dette fournisseur correspondante.
-- La page Fournisseurs ne fait que saisir les règlements ; la page
-- Finances reste une synthèse en lecture seule.
-- ============================================================

-- ---------- Lien mouvement de stock <-> achat fournisseur ----------
alter table public.supplier_purchases
  add column if not exists movement_id uuid
  references public.inventory_movements(id) on delete restrict;

create unique index if not exists supplier_purchases_movement_id_idx
  on public.supplier_purchases(movement_id)
  where movement_id is not null;

-- ---------- Périmètre : qui peut écrire dans le stock ----------
create or replace function public.can_manage_store_stock(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.store_members sm
    where sm.store_id = p_store_id
      and sm.user_id = auth.uid()
      and sm.status = 'active'
      and sm.role in ('owner', 'admin', 'stock_manager')
  )
  or exists (
    select 1 from public.stores s
    where s.id = p_store_id and s.owner_user_id = auth.uid()
  );
$$;

comment on function public.can_manage_store_stock(uuid) is
  'Vrai si l''utilisateur peut créer/modifier un achat de stock : owner, admin ou stock_manager actif.';

-- ---------- RPC : créer un achat de stock + la dette fournisseur ----------
create or replace function public.rpc_record_stock_purchase(
  p_store_id uuid,
  p_supplier_id uuid,
  p_product_id uuid,
  p_quantity int,
  p_unit_cost numeric,
  p_product_variant_id uuid default null,
  p_invoice_reference text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_movement_id uuid;
  v_total numeric;
  v_currency text;
  v_invoice text;
begin
  if not public.can_manage_store_stock(p_store_id) then
    raise exception 'FORBIDDEN';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'INVALID_QUANTITY';
  end if;
  if p_unit_cost is null or p_unit_cost < 0 then
    raise exception 'INVALID_UNIT_COST';
  end if;
  if not exists (select 1 from public.suppliers where id = p_supplier_id and store_id = p_store_id) then
    raise exception 'SUPPLIER_NOT_FOUND';
  end if;
  if not exists (select 1 from public.products where id = p_product_id and store_id = p_store_id) then
    raise exception 'PRODUCT_NOT_FOUND';
  end if;
  if p_product_variant_id is not null and not exists (
    select 1 from public.product_variants where id = p_product_variant_id and product_id = p_product_id
  ) then
    raise exception 'VARIANT_NOT_FOUND';
  end if;

  v_currency := (select s.currency from public.stores s where s.id = p_store_id);
  if v_currency is null then
    raise exception 'STORE_CURRENCY_MISSING';
  end if;

  v_invoice := nullif(btrim(p_invoice_reference), '');
  v_total := p_quantity * p_unit_cost;

  insert into public.inventory_movements
    (store_id, product_id, product_variant_id, supplier_id, movement_type,
     quantity, remaining_qty, unit_cost, total_cost, invoice_number,
     source_type)
  values
    (p_store_id, p_product_id, p_product_variant_id, p_supplier_id, 'in',
     p_quantity, p_quantity, p_unit_cost, v_total, v_invoice,
     'supplier_purchase')
  returning id into v_movement_id;

  insert into public.supplier_purchases
    (store_id, supplier_id, amount_due, currency, purchase_date,
     invoice_reference, movement_id, created_by)
  values
    (p_store_id, p_supplier_id, v_total, v_currency, now(),
     v_invoice, v_movement_id, auth.uid());

  return v_movement_id;
end;
$$;

-- ---------- RPC : modifier un achat de stock (avant tout paiement) ----------
create or replace function public.rpc_update_stock_purchase(
  p_movement_id uuid,
  p_product_id uuid,
  p_quantity int,
  p_unit_cost numeric,
  p_product_variant_id uuid default null,
  p_supplier_id uuid default null,
  p_invoice_reference text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_purchase_id uuid;
  v_total numeric;
  v_invoice text;
begin
  select store_id into v_store_id
  from public.inventory_movements
  where id = p_movement_id;

  if v_store_id is null then
    raise exception 'MOVEMENT_NOT_FOUND';
  end if;

  if not public.can_manage_store_stock(v_store_id) then
    raise exception 'FORBIDDEN';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'INVALID_QUANTITY';
  end if;
  if p_unit_cost is null or p_unit_cost < 0 then
    raise exception 'INVALID_UNIT_COST';
  end if;
  if not exists (select 1 from public.products where id = p_product_id and store_id = v_store_id) then
    raise exception 'PRODUCT_NOT_FOUND';
  end if;
  if p_product_variant_id is not null and not exists (
    select 1 from public.product_variants where id = p_product_variant_id and product_id = p_product_id
  ) then
    raise exception 'VARIANT_NOT_FOUND';
  end if;
  if p_supplier_id is not null and not exists (
    select 1 from public.suppliers where id = p_supplier_id and store_id = v_store_id
  ) then
    raise exception 'SUPPLIER_NOT_FOUND';
  end if;

  select id into v_purchase_id
  from public.supplier_purchases
  where movement_id = p_movement_id;

  -- Une dette déjà (partiellement) réglée ne doit pas être modifiée en silence.
  if v_purchase_id is not null then
    if p_supplier_id is null then
      raise exception 'SUPPLIER_REQUIRED';
    end if;
    if exists (
      select 1 from public.supplier_payment_allocations a
      where a.purchase_id = v_purchase_id
    ) then
      raise exception 'PURCHASE_ALREADY_PAID';
    end if;
  end if;

  v_invoice := nullif(btrim(p_invoice_reference), '');
  v_total := p_quantity * p_unit_cost;

  update public.inventory_movements
  set product_id = p_product_id,
      product_variant_id = p_product_variant_id,
      supplier_id = p_supplier_id,
      quantity = p_quantity,
      remaining_qty = p_quantity,
      unit_cost = p_unit_cost,
      total_cost = v_total,
      invoice_number = v_invoice
  where id = p_movement_id;

  if v_purchase_id is not null then
    update public.supplier_purchases
    set supplier_id = p_supplier_id,
        amount_due = v_total,
        invoice_reference = v_invoice
    where id = v_purchase_id;
  end if;
end;
$$;

-- ---------- Grants ----------
revoke all on function public.can_manage_store_stock(uuid) from public;
revoke all on function public.rpc_record_stock_purchase(uuid, uuid, uuid, int, numeric, uuid, text) from public;
revoke all on function public.rpc_update_stock_purchase(uuid, uuid, int, numeric, uuid, uuid, text) from public;

grant execute on function public.can_manage_store_stock(uuid) to authenticated, service_role;
grant execute on function public.rpc_record_stock_purchase(uuid, uuid, uuid, int, numeric, uuid, text) to authenticated;
grant execute on function public.rpc_update_stock_purchase(uuid, uuid, int, numeric, uuid, uuid, text) to authenticated;

