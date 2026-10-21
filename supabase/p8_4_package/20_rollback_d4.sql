-- ============================================================
-- P8.4 D4 - Rollback (definitions seulement, aucune donnee)
-- Retire la garde et ses deux fonctions.
-- Aucune politique n'est touchee : D4 n'en cree ni ne modifie.
-- ============================================================

drop trigger if exists a_p84_delivery_order_columns on public.orders;
drop function if exists public.p84_guard_delivery_order_columns();
drop function if exists public.p84_is_delivery_only(uuid);

-- Verification post-rollback (lecture seule)
select count(*) = 0 as guard_removed
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'orders' and t.tgname = 'a_p84_delivery_order_columns';

select count(*) = 0 as functions_removed
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('p84_guard_delivery_order_columns', 'p84_is_delivery_only');
