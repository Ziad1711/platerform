-- ============================================================
-- Finance — garde-fou "historique financier" au niveau de la
-- table stores : bloque TOUTE suppression (directe ou via RPC),
-- quel que soit le client (authenticated, service_role, SQL).
-- ============================================================

create or replace function public.block_store_delete_with_financial_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- SECURITY DEFINER : la détection ne doit pas dépendre des droits/RLS de l'appelant.
  if exists (select 1 from public.supplier_purchases where store_id = old.id)
     or exists (select 1 from public.supplier_payments where store_id = old.id)
     or exists (select 1 from public.confirmation_agent_payments where store_id = old.id)
  then
    raise exception 'STORE_HAS_FINANCIAL_HISTORY';
  end if;

  return old;
end;
$$;

drop trigger if exists trg_stores_block_financial_history on public.stores;

create trigger trg_stores_block_financial_history
before delete on public.stores
for each row
execute function public.block_store_delete_with_financial_history();
