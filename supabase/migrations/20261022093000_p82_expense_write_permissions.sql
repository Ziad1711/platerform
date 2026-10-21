-- ============================================================
-- P8.2 - Permissions d'ecriture du module Depenses
-- Version : 20261022093000
-- Projet cible : jisra-test / goqedvcdmgtejtyrawsp
-- ------------------------------------------------------------
-- Objet :
--   (1) helper can_manage_store_expenses(store_id) = owner/admin/
--       accountant, appartenance ACTIVE ;
--   (2) expense_recurring_templates : INSERT/UPDATE/DELETE gardes
--       (aujourd'hui ouverts a tout membre, y compris viewer et
--       membre inactif) ;
--   (3) expenses : INSERT/UPDATE/DELETE alignes sur le helper
--       (retrait du role inexistant `staff`, ajout de `accountant`
--       qui detient deja expenses.manage).
--   Les politiques SELECT ne sont PAS touchees : viewer conserve
--   la lecture (expenses.view).
-- Hors portee : les huit roles, role_permissions, la confidentialite
-- couts/profits, et toutes les autres tables ou routes.
-- Idempotence : drop policy if exists / create or replace.
-- ============================================================

-- (1) Helper partage
create or replace function public.can_manage_store_expenses(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.store_members m
    where m.store_id = p_store_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role in ('owner','admin','accountant')
  );
$$;

revoke all on function public.can_manage_store_expenses(uuid) from public;
revoke all on function public.can_manage_store_expenses(uuid) from anon;
grant execute on function public.can_manage_store_expenses(uuid) to authenticated, service_role;

-- (2) Modeles recurrents : ecritures reservees aux gestionnaires
drop policy if exists "Users can insert recurring templates for their stores" on public.expense_recurring_templates;
create policy "Users can insert recurring templates for their stores" on public.expense_recurring_templates
  for insert to public
  with check (public.can_manage_store_expenses(store_id));

drop policy if exists "Users can update their store's recurring templates" on public.expense_recurring_templates;
create policy "Users can update their store's recurring templates" on public.expense_recurring_templates
  for update to public
  using (public.can_manage_store_expenses(store_id))
  with check (public.can_manage_store_expenses(store_id));

drop policy if exists "Users can delete their store's recurring templates" on public.expense_recurring_templates;
create policy "Users can delete their store's recurring templates" on public.expense_recurring_templates
  for delete to public
  using (public.can_manage_store_expenses(store_id));

-- (3) Depenses : meme garde, accountant inclus
drop policy if exists "Store members can insert expenses" on public.expenses;
create policy "Store members can insert expenses" on public.expenses
  for insert to public
  with check (public.can_manage_store_expenses(store_id));

drop policy if exists "Store members can update expenses" on public.expenses;
create policy "Store members can update expenses" on public.expenses
  for update to public
  using (public.can_manage_store_expenses(store_id))
  with check (public.can_manage_store_expenses(store_id));

drop policy if exists "Owner or admin can delete expenses" on public.expenses;
create policy "Owner or admin can delete expenses" on public.expenses
  for delete to public
  using (public.can_manage_store_expenses(store_id));

-- (4) Garde-fou : aucune politique d'ecriture non gouvernee
do $$
declare
  v_left text;
begin
  select string_agg(c.relname || '.' || pol.polname, ', ' order by c.relname, pol.polname)
  into v_left
  from pg_policy pol
  join pg_class c on c.oid = pol.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('expenses','expense_recurring_templates')
    and pol.polcmd in ('a','w','d')
    and (
      coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || ' ' ||
      coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')
    ) not ilike '%can_manage_store_expenses%';

  if v_left is not null then
    raise exception 'P8.2_BLOCKED_UNGOVERNED_POLICY: %', v_left;
  end if;
end $$;
