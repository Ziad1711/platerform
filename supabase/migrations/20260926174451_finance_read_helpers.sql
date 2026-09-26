-- ============================================================
-- Finance — RPC de lecture pour les écrans de paiement
-- ============================================================

create or replace function public.rpc_finance_agent_orders(p_store_id uuid, p_agent_id uuid)
returns table (
  order_id uuid,
  customer_name text,
  phone text,
  commission_amount numeric,
  allocated numeric,
  remaining numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    o.id,
    o.customer_name,
    o.phone,
    coalesce(o.confirmation_commission_amount, 0)::numeric,
    coalesce((select sum(a.amount) from public.confirmation_agent_payment_allocations a where a.order_id = o.id), 0)::numeric,
    (coalesce(o.confirmation_commission_amount, 0)
      - coalesce((select sum(a.amount) from public.confirmation_agent_payment_allocations a where a.order_id = o.id), 0))::numeric
  from public.orders o
  where o.store_id = p_store_id
    and o.confirmation_agent_id = p_agent_id
    and o.confirmation_commission_status in ('earned','paid')
    and coalesce(o.confirmation_commission_amount, 0) > 0
    and public.can_view_store_finances(p_store_id)
  order by o.order_date desc;
$$;

create or replace function public.rpc_finance_supplier_purchases(p_store_id uuid, p_supplier_id uuid)
returns table (
  purchase_id uuid,
  amount_due numeric,
  allocated numeric,
  remaining numeric,
  purchase_date timestamptz,
  invoice_reference text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    coalesce(p.amount_due, 0)::numeric,
    coalesce((select sum(a.amount) from public.supplier_payment_allocations a where a.purchase_id = p.id), 0)::numeric,
    (coalesce(p.amount_due, 0)
      - coalesce((select sum(a.amount) from public.supplier_payment_allocations a where a.purchase_id = p.id), 0))::numeric,
    p.purchase_date,
    p.invoice_reference
  from public.supplier_purchases p
  where p.store_id = p_store_id
    and p.supplier_id = p_supplier_id
    and public.can_view_store_finances(p_store_id)
  order by p.purchase_date desc;
$$;

revoke all on function public.rpc_finance_agent_orders(uuid, uuid) from public;
revoke all on function public.rpc_finance_supplier_purchases(uuid, uuid) from public;
grant execute on function public.rpc_finance_agent_orders(uuid, uuid) to authenticated;
grant execute on function public.rpc_finance_supplier_purchases(uuid, uuid) to authenticated;
