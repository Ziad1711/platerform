-- ============================================================
-- P8.3 M1 - rollback verbatim
-- Genere depuis la capture de l'etat installe TEST (voir MATRICE.md).
-- Regle : injection validee par analyse d'expression, jamais par
-- remplacement textuel aveugle. Les politiques bloquees sont exclues.
-- Tables, commandes, permissivite et roles cibles sont reproduits a
-- l'identique : seule la condition de statut est ajoutee.
-- ============================================================

CREATE OR REPLACE FUNCTION public.can_manage_store_products(p_store_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.store_members sm
    where sm.store_id = p_store_id
      and sm.user_id = auth.uid()
      and sm.role in ('owner', 'admin', 'stock_manager')
  )
  or exists (
    select 1 from public.stores s
    where s.id = p_store_id and s.owner_user_id = auth.uid()
  );
$function$
;

CREATE OR REPLACE FUNCTION public.can_manage_store_products_admin(p_store_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.store_members sm
    where sm.store_id = p_store_id
      and sm.user_id = auth.uid()
      and sm.role in ('owner', 'admin')
  )
  or exists (
    select 1 from public.stores s
    where s.id = p_store_id and s.owner_user_id = auth.uid()
  );
$function$
;

CREATE OR REPLACE FUNCTION public.can_view_store_products(p_store_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.store_members sm
    where sm.store_id = p_store_id and sm.user_id = auth.uid()
  )
  or exists (
    select 1 from public.stores s
    where s.id = p_store_id and s.owner_user_id = auth.uid()
  );
$function$
;
