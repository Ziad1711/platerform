
-- ---------- RLS ----------
alter table public.store_invoice_settings enable row level security;
alter table public.invoice_counters enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;

-- Compteur : inaccessible aux clients, même en lecture (RPC security definer).
revoke all on public.invoice_counters from anon, authenticated;

revoke all on public.store_invoice_settings from anon;
revoke all on public.invoices from anon;
revoke all on public.invoice_items from anon;

grant select, insert, update on public.store_invoice_settings to authenticated;
grant select on public.invoices to authenticated;
grant select on public.invoice_items to authenticated;

drop policy if exists store_invoice_settings_select on public.store_invoice_settings;
create policy store_invoice_settings_select on public.store_invoice_settings
  for select to authenticated
  using (public.can_view_store_invoices(store_id));

drop policy if exists store_invoice_settings_insert on public.store_invoice_settings;
create policy store_invoice_settings_insert on public.store_invoice_settings
  for insert to authenticated
  with check (public.can_issue_store_invoices(store_id));

drop policy if exists store_invoice_settings_update on public.store_invoice_settings;
create policy store_invoice_settings_update on public.store_invoice_settings
  for update to authenticated
  using (public.can_issue_store_invoices(store_id))
  with check (public.can_issue_store_invoices(store_id));

-- Factures : lecture seule pour les rôles autorisés. Aucune politique
-- d'insertion/mise à jour/suppression : les RPC en sont le seul chemin.
drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices
  for select to authenticated
  using (public.can_view_store_invoices(store_id));

drop policy if exists invoice_items_select on public.invoice_items;
create policy invoice_items_select on public.invoice_items
  for select to authenticated
  using (public.can_view_store_invoices(store_id));
