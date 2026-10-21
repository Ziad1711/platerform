-- ============================================================
-- P8.3 - Capture prealable (LECTURE SEULE)
-- Projet : jisra-test / goqedvcdmgtejtyrawsp
-- Rejouer cette requete AVANT toute application et conserver la sortie
-- hors depot : elle est la source des rollbacks verbatim.
-- ============================================================
select c.relname as table_name,
       pol.polname as policy_name,
       pol.polcmd::text as cmd,
       pol.polpermissive as permissive,
       array_to_string(pol.polroles, ',') as roles,
       pg_get_expr(pol.polqual, pol.polrelid) as using_expr,
       pg_get_expr(pol.polwithcheck, pol.polrelid) as check_expr
from pg_policy pol
join pg_class c on c.oid = pol.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and (coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || ' ' ||
       coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')) ilike '%store_members%'
order by c.relname, pol.polcmd, pol.polname;

select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef,
       pg_get_userbyid(p.proowner) as owner,
       p.proacl::text as acl,
       pg_get_functiondef(p.oid) as def
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('can_manage_store_products','can_manage_store_products_admin','can_view_store_products')
order by p.proname;
