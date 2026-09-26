-- ============================================================
-- 20260927100000 — RLS : suppression des politiques permissives héritées
-- ------------------------------------------------------------
-- Constat (audit production) : 12 politiques nommées
-- "Enable <cmd> access for authenticated users" (role authenticated)
-- portaient `qual = true` / `with_check = true` sur `stores`,
-- `store_members`, `expenses` et `ad_spend_daily`. Les politiques
-- PERMISSIVE se cumulant en OR, elles annulaient tout cloisonnement :
--   * tout compte authentifié lisait/écrivait les données de tous les stores ;
--   * il pouvait s'auto-inscrire `admin` dans `store_members` (with_check true),
--     puis lire/écrire `expenses` et `ad_spend_daily` de n'importe quel store ;
--   * il pouvait réécrire `stores.owner_user_id` (prise de contrôle du store).
--
-- Les politiques cloisonnées par store existent déjà et couvrent les flux
-- légitimes (création de store, gestion des membres, dépenses, publicité).
-- Seule la lecture de `stores` par un membre non propriétaire n'était
-- garantie que par `stores_select_member_or_owner` : malgré son nom elle ne
-- testait que `owner_user_id`, elle est donc redéfinie sur le périmètre
-- membre (le sélecteur de store et les listes d'intégrations en dépendent).
-- ============================================================

drop policy if exists "Enable read access for authenticated users" on public.stores;
drop policy if exists "Enable insert access for authenticated users" on public.stores;
drop policy if exists "Enable update access for authenticated users" on public.stores;
drop policy if exists "Enable delete access for authenticated users" on public.stores;

drop policy if exists "Enable read access for authenticated users" on public.store_members;
drop policy if exists "Enable insert access for authenticated users" on public.store_members;
drop policy if exists "Enable update access for authenticated users" on public.store_members;
drop policy if exists "Enable delete access for authenticated users" on public.store_members;

drop policy if exists "Enable read access for authenticated users" on public.expenses;
drop policy if exists "Enable insert access for authenticated users" on public.expenses;

drop policy if exists "Enable read access for authenticated users" on public.ad_spend_daily;
drop policy if exists "Enable insert access for authenticated users" on public.ad_spend_daily;

-- Lecture de `stores` : propriétaire OU membre du store.
drop policy if exists stores_select_member_or_owner on public.stores;
create policy stores_select_member_or_owner on public.stores
  for select
  to authenticated
  using (owner_user_id = auth.uid() or public.is_store_member(id));
