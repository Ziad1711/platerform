-- ============================================================
-- Finance — interdire la suppression d'un store possédant un
-- historique financier (achats, paiements ou versements agents).
-- ============================================================

create or replace function public.delete_store(p_store_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.store_members
    where store_id = p_store_id
      and user_id = auth.uid()
      and role = 'owner'
      and status = 'active'
  ) then
    raise exception 'UNAUTHORIZED: only owner can delete store';
  end if;

  if exists (
    select 1 from public.supplier_purchases where store_id = p_store_id
    union all
    select 1 from public.supplier_payments where store_id = p_store_id
    union all
    select 1 from public.confirmation_agent_payments where store_id = p_store_id
  ) then
    raise exception 'STORE_HAS_FINANCIAL_HISTORY';
  end if;

  delete from public.stores where id = p_store_id;
end;
$$;
