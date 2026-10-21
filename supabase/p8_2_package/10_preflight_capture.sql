-- ============================================================
-- P8.2 - Capture prealable (LECTURE SEULE)
-- Projet autorise : jisra-test / goqedvcdmgtejtyrawsp
-- ------------------------------------------------------------
-- A executer AVANT la migration 20261022093000. La sortie de la
-- requete (1) est la source du rollback 20_rollback.sql : la
-- conserver hors depot.
-- Aucune requete ici ne modifie l'etat.
-- ============================================================

-- (1) Politiques installees sur les deux tables du module Depenses
select c.relname as table_name,
       pol.polname as policy_name,
       case pol.polcmd
         when 'r' then 'SELECT' when 'a' then 'INSERT'
         when 'w' then 'UPDATE' when 'd' then 'DELETE'
         else 'ALL'
       end as command,
       pol.polpermissive as permissive,
       case when exists (select 1 from unnest(pol.polroles) as r(role_oid) where role_oid = 0)
            then 'PUBLIC'
            else (select string_agg(quote_ident(rolname), ', ' order by rolname)
                  from pg_roles where oid = any(pol.polroles))
       end as roles,
       pg_get_expr(pol.polqual, pol.polrelid) as using_expr,
       pg_get_expr(pol.polwithcheck, pol.polrelid) as check_expr,
       format(
         'create policy %I on %I.%I as %s for %s to %s%s%s;',
         pol.polname, n.nspname, c.relname,
         case when pol.polpermissive then 'permissive' else 'restrictive' end,
         case pol.polcmd
           when 'r' then 'select' when 'a' then 'insert'
           when 'w' then 'update' when 'd' then 'delete' else 'all'
         end,
         case when exists (select 1 from unnest(pol.polroles) as r(role_oid) where role_oid = 0)
              then 'public'
              else (select string_agg(quote_ident(rolname), ', ' order by rolname)
                    from pg_roles where oid = any(pol.polroles))
         end,
         case when pol.polqual is not null
              then E'\n  using (' || pg_get_expr(pol.polqual, pol.polrelid) || ')'
              else '' end,
         case when pol.polwithcheck is not null
              then E'\n  with check (' || pg_get_expr(pol.polwithcheck, pol.polrelid) || ')'
              else '' end
       ) as restore_sql
from pg_policy pol
join pg_class c on c.oid = pol.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('expenses','expense_recurring_templates')
order by c.relname,
         case pol.polcmd when 'r' then 1 when 'a' then 2 when 'w' then 3 when 'd' then 4 else 5 end,
         pol.polname;

-- (2) Etat du helper et des roles concernes
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'can_manage_store_expenses')::int as helper_exists,
  (select count(*) from public.store_members where role = 'staff')::int as staff_rows,
  (select count(*) from public.store_members where role = 'accountant')::int as accountant_rows,
  (select count(*) from public.store_members where role = 'viewer')::int as viewer_rows,
  (select count(*) from public.store_members where status <> 'active')::int as inactive_rows,
  (select count(*) from public.expenses)::int as expenses_rows,
  (select count(*) from public.expense_recurring_templates)::int as templates_rows;
