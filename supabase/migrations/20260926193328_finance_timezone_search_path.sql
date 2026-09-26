-- ============================================================
-- Finance — hygiène : `search_path` épinglé sur le helper de fuseau
-- ------------------------------------------------------------
-- `public.finance_business_timezone()` (migration 20260926210000) ne résout
-- aucun objet — elle renvoie une constante — et n'est pas SECURITY DEFINER,
-- mais le lint Supabase signale tout `search_path` mutable. On fige donc
-- explicitement le chemin de résolution, comme pour les RPC du module.
-- ============================================================

create or replace function public.finance_business_timezone()
returns text
language sql
immutable
set search_path = public
as $fn$
  select 'Africa/Casablanca'::text;
$fn$;

revoke all on function public.finance_business_timezone() from public;
revoke all on function public.finance_business_timezone() from anon, authenticated;
grant execute on function public.finance_business_timezone() to service_role;
