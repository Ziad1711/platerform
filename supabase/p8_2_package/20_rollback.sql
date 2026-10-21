-- ============================================================
-- P8.2 - Rollback de la migration 20261022093000
-- Projet autorise : jisra-test / goqedvcdmgtejtyrawsp
-- ------------------------------------------------------------
-- Aucune donnee n'est touchee : uniquement des definitions de
-- politiques et la suppression du helper ajoute par la migration.
--
-- Les expressions ci-dessous sont recopiees depuis la capture de
-- l'etat installe (21/10/2026) : 8 politiques permissives, roles
-- cibles = PUBLIC, expressions relevees telles quelles.
-- ============================================================

-- (1) Modeles recurrents : etat installe avant migration
drop policy if exists "Users can insert recurring templates for their stores" on public.expense_recurring_templates;
create policy "Users can insert recurring templates for their stores" on public.expense_recurring_templates
  for insert to public
  with check ((store_id IN ( SELECT store_members.store_id
   FROM store_members
  WHERE (store_members.user_id = auth.uid()))));

drop policy if exists "Users can update their store's recurring templates" on public.expense_recurring_templates;
create policy "Users can update their store's recurring templates" on public.expense_recurring_templates
  for update to public
  using ((store_id IN ( SELECT store_members.store_id
   FROM store_members
  WHERE (store_members.user_id = auth.uid()))));

drop policy if exists "Users can delete their store's recurring templates" on public.expense_recurring_templates;
create policy "Users can delete their store's recurring templates" on public.expense_recurring_templates
  for delete to public
  using ((store_id IN ( SELECT store_members.store_id
   FROM store_members
  WHERE (store_members.user_id = auth.uid()))));

-- (2) Depenses : etat installe avant migration
drop policy if exists "Store members can insert expenses" on public.expenses;
create policy "Store members can insert expenses" on public.expenses
  for insert to public
  with check ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = expenses.store_id) AND (sm.user_id = auth.uid()) AND (sm.status = 'active'::text) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text, 'staff'::text]))))));

drop policy if exists "Store members can update expenses" on public.expenses;
create policy "Store members can update expenses" on public.expenses
  for update to public
  using ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = expenses.store_id) AND (sm.user_id = auth.uid()) AND (sm.status = 'active'::text) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text, 'staff'::text]))))));

drop policy if exists "Owner or admin can delete expenses" on public.expenses;
create policy "Owner or admin can delete expenses" on public.expenses
  for delete to public
  using ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = expenses.store_id) AND (sm.user_id = auth.uid()) AND (sm.status = 'active'::text) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));

-- (3) Supprimer le helper ajoute par la migration
--     (aucune politique ne doit encore le referencer : les blocs
--     ci-dessus l'ont remplace).
drop function if exists public.can_manage_store_expenses(uuid);

-- (4) Verifications post-rollback (lecture seule)
-- a. plus aucune politique d'ecriture ne cite le helper :
select count(*) = 0 as helper_references_removed
from pg_policy pol
join pg_class c on c.oid = pol.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('expenses','expense_recurring_templates')
  and (
    coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || ' ' ||
    coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')
  ) ilike '%can_manage_store_expenses%';

-- b. le helper a disparu :
select count(*) = 0 as helper_dropped
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'can_manage_store_expenses';

-- c. les politiques correspondent a la capture :
select c.relname as table_name, pol.polname, pol.polcmd,
       pg_get_expr(pol.polqual, pol.polrelid) as using_expr,
       pg_get_expr(pol.polwithcheck, pol.polrelid) as check_expr
from pg_policy pol
join pg_class c on c.oid = pol.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('expenses','expense_recurring_templates')
order by c.relname, pol.polcmd, pol.polname;
