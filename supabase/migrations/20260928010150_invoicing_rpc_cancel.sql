-- ---------- RPC : annuler une facture (numéro conservé) ----------
create or replace function public.rpc_cancel_invoice(
  p_invoice_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_invoice public.invoices%rowtype;
begin
  if v_actor is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if p_invoice_id is null then
    raise exception 'MISSING_INVOICE_ID';
  end if;

  select * into v_invoice from public.invoices where id = p_invoice_id for update;

  if not found then
    raise exception 'INVOICE_NOT_FOUND';
  end if;

  if not public.can_issue_store_invoices(v_invoice.store_id) then
    raise exception 'FORBIDDEN';
  end if;

  if v_invoice.status = 'cancelled' then
    return jsonb_build_object(
      'invoiceId', v_invoice.id,
      'status', 'cancelled',
      'alreadyCancelled', true
    );
  end if;

  update public.invoices
     set status = 'cancelled',
         cancelled_at = now(),
         cancelled_by = v_actor,
         cancellation_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_invoice_id;

  return jsonb_build_object(
    'invoiceId', p_invoice_id,
    'status', 'cancelled',
    'alreadyCancelled', false
  );
end;
$$;

comment on function public.rpc_cancel_invoice(uuid, text) is
  'Annule une facture émise sans libérer son numéro. Owner/admin actif uniquement.';

revoke all on function public.rpc_issue_invoice(uuid, uuid, jsonb, jsonb, jsonb) from public;
grant execute on function public.rpc_issue_invoice(uuid, uuid, jsonb, jsonb, jsonb)
  to authenticated, service_role;

revoke all on function public.rpc_cancel_invoice(uuid, text) from public;
grant execute on function public.rpc_cancel_invoice(uuid, text)
  to authenticated, service_role;

revoke all on function public.can_view_store_invoices(uuid) from public;
grant execute on function public.can_view_store_invoices(uuid) to authenticated, service_role;

revoke all on function public.can_issue_store_invoices(uuid) from public;
grant execute on function public.can_issue_store_invoices(uuid) to authenticated, service_role;
