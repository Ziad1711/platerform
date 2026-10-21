-- ============================================================
-- P8.4 S2 - Stock Manager : ecriture des mouvements alignee sur stock.manage
-- Version : 20261023110100
-- Projet : jisra-test / goqedvcdmgtejtyrawsp
-- ------------------------------------------------------------
-- Defaut reproduit : un `stock_manager` actif ne pouvait pas inserer un
-- mouvement de stock par REST (403), la politique ne listant que
-- owner/admin/staff (role `staff` inexistant), alors que le role detient
-- `stock.manage` et que la page Stock ecrit directement dans la table.
--
-- Correctif : INSERT et UPDATE s'appuient sur le helper existant
-- can_manage_store_stock(store_id) = owner/admin/stock_manager actif
-- (+ repli proprietaire du store).
-- DELETE reste inchange (owner/admin) ; SELECT reste inchange.
-- ============================================================

drop policy if exists "Store members can insert inventory movements" on public.inventory_movements;
create policy "Store members can insert inventory movements" on public.inventory_movements
  as permissive for insert to public
  with check (public.can_manage_store_stock(store_id));

drop policy if exists "Store members can update inventory movements" on public.inventory_movements;
create policy "Store members can update inventory movements" on public.inventory_movements
  as permissive for update to public
  using (public.can_manage_store_stock(store_id))
  with check (public.can_manage_store_stock(store_id));
