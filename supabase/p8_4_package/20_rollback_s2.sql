-- ============================================================
-- P8.4 S2 - Rollback verbatim (etat installe avant la migration)
-- Source : capture du 21/10 (capture-p84-policies.json), expressions
-- recopiees telles quelles. Aucune donnee touchee.
-- ============================================================

drop policy if exists "Store members can insert inventory movements" on public.inventory_movements;
create policy "Store members can insert inventory movements" on public.inventory_movements as permissive for insert to public
  with check ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = inventory_movements.store_id) AND (sm.user_id = auth.uid()) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text, 'staff'::text])) AND (sm.status = 'active'::text)))));

drop policy if exists "Store members can update inventory movements" on public.inventory_movements;
create policy "Store members can update inventory movements" on public.inventory_movements as permissive for update to public
  using ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = inventory_movements.store_id) AND (sm.user_id = auth.uid()) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text, 'staff'::text])) AND (sm.status = 'active'::text)))));

-- Verification post-rollback (lecture seule)
select pol.polname, pol.polcmd,
       pg_get_expr(pol.polqual, pol.polrelid) as using_expr,
       pg_get_expr(pol.polwithcheck, pol.polrelid) as check_expr
from pg_policy pol
join pg_class c on c.oid = pol.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'inventory_movements'
order by pol.polcmd, pol.polname;
