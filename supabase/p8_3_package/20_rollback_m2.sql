-- ============================================================
-- P8.3 M2 - rollback verbatim
-- Genere depuis la capture de l'etat installe TEST (voir MATRICE.md).
-- Regle : injection validee par analyse d'expression, jamais par
-- remplacement textuel aveugle. Les politiques bloquees sont exclues.
-- Tables, commandes, permissivite et roles cibles sont reproduits a
-- l'identique : seule la condition de statut est ajoutee.
-- ============================================================

drop policy if exists "ai_usage_insert_own_scoped_store" on public."ai_usage";
create policy "ai_usage_insert_own_scoped_store" on public."ai_usage" as permissive for insert to authenticated
  with check (((auth.uid() = user_id) AND ((store_id IS NULL) OR (EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = ai_usage.store_id) AND (sm.user_id = auth.uid())))))));

drop policy if exists "ameex_configs_manage" on public."ameex_configs";
create policy "ameex_configs_manage" on public."ameex_configs" as permissive for all to public
  using ((store_id IN ( SELECT store_members.store_id
   FROM store_members
  WHERE (store_members.user_id = auth.uid()))))
  with check ((store_id IN ( SELECT store_members.store_id
   FROM store_members
  WHERE (store_members.user_id = auth.uid()))));

drop policy if exists "Store members can insert blacklist entries" on public."blacklist_entries";
create policy "Store members can insert blacklist entries" on public."blacklist_entries" as permissive for insert to public
  with check ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = blacklist_entries.store_id) AND (sm.user_id = auth.uid()) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text, 'staff'::text]))))));

drop policy if exists "Store members can delete blacklist entries" on public."blacklist_entries";
create policy "Store members can delete blacklist entries" on public."blacklist_entries" as permissive for delete to public
  using ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = blacklist_entries.store_id) AND (sm.user_id = auth.uid()) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text, 'staff'::text]))))));

drop policy if exists "Store members can insert blacklist rules" on public."blacklist_rules";
create policy "Store members can insert blacklist rules" on public."blacklist_rules" as permissive for insert to public
  with check ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = blacklist_rules.store_id) AND (sm.user_id = auth.uid()) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text, 'staff'::text]))))));

drop policy if exists "Store members can update blacklist rules" on public."blacklist_rules";
create policy "Store members can update blacklist rules" on public."blacklist_rules" as permissive for update to public
  using ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = blacklist_rules.store_id) AND (sm.user_id = auth.uid()) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text, 'staff'::text]))))))
  with check ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = blacklist_rules.store_id) AND (sm.user_id = auth.uid()) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text, 'staff'::text]))))));

drop policy if exists "Owner or admin can insert confirmation agents" on public."confirmation_agents";
create policy "Owner or admin can insert confirmation agents" on public."confirmation_agents" as permissive for insert to public
  with check ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = confirmation_agents.store_id) AND (sm.user_id = auth.uid()) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));

drop policy if exists "Owner or admin can delete confirmation agents" on public."confirmation_agents";
create policy "Owner or admin can delete confirmation agents" on public."confirmation_agents" as permissive for delete to public
  using ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = confirmation_agents.store_id) AND (sm.user_id = auth.uid()) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));

drop policy if exists "Owner or admin can update confirmation agents" on public."confirmation_agents";
create policy "Owner or admin can update confirmation agents" on public."confirmation_agents" as permissive for update to public
  using ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = confirmation_agents.store_id) AND (sm.user_id = auth.uid()) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));

drop policy if exists "confirmation_settings_write_owner_admin" on public."confirmation_settings";
create policy "confirmation_settings_write_owner_admin" on public."confirmation_settings" as permissive for all to public
  using (((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = confirmation_settings.store_id) AND (sm.user_id = auth.uid()) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text]))))) OR (EXISTS ( SELECT 1
   FROM stores s
  WHERE ((s.id = confirmation_settings.store_id) AND (s.owner_user_id = auth.uid()))))))
  with check (((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = confirmation_settings.store_id) AND (sm.user_id = auth.uid()) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text]))))) OR (EXISTS ( SELECT 1
   FROM stores s
  WHERE ((s.id = confirmation_settings.store_id) AND (s.owner_user_id = auth.uid()))))));

drop policy if exists "Owner or admin can insert delivery companies" on public."delivery_companies";
create policy "Owner or admin can insert delivery companies" on public."delivery_companies" as permissive for insert to public
  with check ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = delivery_companies.store_id) AND (sm.user_id = auth.uid()) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));

drop policy if exists "Owner or admin can delete delivery companies" on public."delivery_companies";
create policy "Owner or admin can delete delivery companies" on public."delivery_companies" as permissive for delete to public
  using ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = delivery_companies.store_id) AND (sm.user_id = auth.uid()) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));

drop policy if exists "Owner or admin can update delivery companies" on public."delivery_companies";
create policy "Owner or admin can update delivery companies" on public."delivery_companies" as permissive for update to public
  using ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = delivery_companies.store_id) AND (sm.user_id = auth.uid()) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));

drop policy if exists "digylog_configs_store_access" on public."digylog_configs";
create policy "digylog_configs_store_access" on public."digylog_configs" as permissive for all to public
  using ((store_id IN ( SELECT store_members.store_id
   FROM store_members
  WHERE (store_members.user_id = auth.uid()))));

drop policy if exists "digylog_webhook_events_store_access" on public."digylog_webhook_events";
create policy "digylog_webhook_events_store_access" on public."digylog_webhook_events" as permissive for all to public
  using ((store_id IN ( SELECT store_members.store_id
   FROM store_members
  WHERE (store_members.user_id = auth.uid()))));

drop policy if exists "Users can insert automation rules for their stores" on public."expense_automation_rules";
create policy "Users can insert automation rules for their stores" on public."expense_automation_rules" as permissive for insert to public
  with check ((store_id IN ( SELECT store_members.store_id
   FROM store_members
  WHERE (store_members.user_id = auth.uid()))));

drop policy if exists "Users can delete their store's automation rules" on public."expense_automation_rules";
create policy "Users can delete their store's automation rules" on public."expense_automation_rules" as permissive for delete to public
  using ((store_id IN ( SELECT store_members.store_id
   FROM store_members
  WHERE (store_members.user_id = auth.uid()))));

drop policy if exists "Users can update their store's automation rules" on public."expense_automation_rules";
create policy "Users can update their store's automation rules" on public."expense_automation_rules" as permissive for update to public
  using ((store_id IN ( SELECT store_members.store_id
   FROM store_members
  WHERE (store_members.user_id = auth.uid()))));

drop policy if exists "Store members can insert expense categories" on public."expense_categories";
create policy "Store members can insert expense categories" on public."expense_categories" as permissive for insert to public
  with check ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = expense_categories.store_id) AND (sm.user_id = auth.uid()) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text, 'staff'::text]))))));

drop policy if exists "Owner or admin can delete expense categories" on public."expense_categories";
create policy "Owner or admin can delete expense categories" on public."expense_categories" as permissive for delete to public
  using ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = expense_categories.store_id) AND (sm.user_id = auth.uid()) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));

drop policy if exists "Store members can update expense categories" on public."expense_categories";
create policy "Store members can update expense categories" on public."expense_categories" as permissive for update to public
  using ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = expense_categories.store_id) AND (sm.user_id = auth.uid()) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text, 'staff'::text]))))));

drop policy if exists "facebook_account_store_configs_all" on public."facebook_ad_account_store_configs";
create policy "facebook_account_store_configs_all" on public."facebook_ad_account_store_configs" as permissive for all to public
  using (((user_id = auth.uid()) AND (store_id IN ( SELECT sm.store_id
   FROM store_members sm
  WHERE (sm.user_id = auth.uid()))) AND (EXISTS ( SELECT 1
   FROM integrations i
  WHERE ((i.id = facebook_ad_account_store_configs.integration_id) AND (i.user_id = auth.uid()) AND (i.provider = 'facebook-ads'::text)))) AND (EXISTS ( SELECT 1
   FROM facebook_ad_accounts a
  WHERE ((a.id = facebook_ad_account_store_configs.ad_account_id) AND (a.integration_id = facebook_ad_account_store_configs.integration_id) AND (a.user_id = auth.uid()))))))
  with check (((user_id = auth.uid()) AND (store_id IN ( SELECT sm.store_id
   FROM store_members sm
  WHERE (sm.user_id = auth.uid()))) AND (EXISTS ( SELECT 1
   FROM integrations i
  WHERE ((i.id = facebook_ad_account_store_configs.integration_id) AND (i.user_id = auth.uid()) AND (i.provider = 'facebook-ads'::text)))) AND (EXISTS ( SELECT 1
   FROM facebook_ad_accounts a
  WHERE ((a.id = facebook_ad_account_store_configs.ad_account_id) AND (a.integration_id = facebook_ad_account_store_configs.integration_id) AND (a.user_id = auth.uid()))))));

drop policy if exists "facebook_campaign_mappings_all" on public."facebook_campaign_mappings";
create policy "facebook_campaign_mappings_all" on public."facebook_campaign_mappings" as permissive for all to public
  using ((store_id IN ( SELECT sm.store_id
   FROM store_members sm
  WHERE (sm.user_id = auth.uid()))))
  with check ((store_id IN ( SELECT sm.store_id
   FROM store_members sm
  WHERE (sm.user_id = auth.uid()))));

drop policy if exists "forcelog_configs_manage" on public."forcelog_configs";
create policy "forcelog_configs_manage" on public."forcelog_configs" as permissive for all to public
  using ((store_id IN ( SELECT store_members.store_id
   FROM store_members
  WHERE (store_members.user_id = auth.uid()))))
  with check ((store_id IN ( SELECT store_members.store_id
   FROM store_members
  WHERE (store_members.user_id = auth.uid()))));

drop policy if exists "Store members can insert inventory_consumptions" on public."inventory_consumptions";
create policy "Store members can insert inventory_consumptions" on public."inventory_consumptions" as permissive for insert to public
  with check ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = inventory_consumptions.store_id) AND (sm.user_id = auth.uid()) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text, 'staff'::text, 'confirmation_agent'::text]))))));

drop policy if exists "Owner or admin can delete inventory_consumptions" on public."inventory_consumptions";
create policy "Owner or admin can delete inventory_consumptions" on public."inventory_consumptions" as permissive for delete to public
  using ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = inventory_consumptions.store_id) AND (sm.user_id = auth.uid()) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));

drop policy if exists "Store members can update inventory_consumptions" on public."inventory_consumptions";
create policy "Store members can update inventory_consumptions" on public."inventory_consumptions" as permissive for update to public
  using ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = inventory_consumptions.store_id) AND (sm.user_id = auth.uid()) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text, 'staff'::text]))))))
  with check ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = inventory_consumptions.store_id) AND (sm.user_id = auth.uid()) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text, 'staff'::text]))))));

drop policy if exists "Store members can insert inventory movements" on public."inventory_movements";
create policy "Store members can insert inventory movements" on public."inventory_movements" as permissive for insert to public
  with check ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = inventory_movements.store_id) AND (sm.user_id = auth.uid()) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text, 'staff'::text]))))));

drop policy if exists "Owner or admin can delete inventory movements" on public."inventory_movements";
create policy "Owner or admin can delete inventory movements" on public."inventory_movements" as permissive for delete to public
  using ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = inventory_movements.store_id) AND (sm.user_id = auth.uid()) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));

drop policy if exists "Store members can update inventory movements" on public."inventory_movements";
create policy "Store members can update inventory movements" on public."inventory_movements" as permissive for update to public
  using ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = inventory_movements.store_id) AND (sm.user_id = auth.uid()) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text, 'staff'::text]))))));

drop policy if exists "orders_delete_store_scope" on public."orders";
create policy "orders_delete_store_scope" on public."orders" as permissive for delete to public
  using (((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = orders.store_id) AND (sm.user_id = auth.uid()) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text]))))) OR (EXISTS ( SELECT 1
   FROM stores s
  WHERE ((s.id = orders.store_id) AND (s.owner_user_id = auth.uid()))))));

drop policy if exists "Store members can insert product_categories" on public."product_categories";
create policy "Store members can insert product_categories" on public."product_categories" as permissive for insert to public
  with check ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = product_categories.store_id) AND (sm.user_id = auth.uid()) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text, 'staff'::text]))))));

drop policy if exists "Owner or admin can delete product_categories" on public."product_categories";
create policy "Owner or admin can delete product_categories" on public."product_categories" as permissive for delete to public
  using ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = product_categories.store_id) AND (sm.user_id = auth.uid()) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));

drop policy if exists "Store members can update product_categories" on public."product_categories";
create policy "Store members can update product_categories" on public."product_categories" as permissive for update to public
  using ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = product_categories.store_id) AND (sm.user_id = auth.uid()) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text, 'staff'::text]))))));

drop policy if exists "sendit_configs_manage" on public."sendit_configs";
create policy "sendit_configs_manage" on public."sendit_configs" as permissive for all to public
  using ((store_id IN ( SELECT store_members.store_id
   FROM store_members
  WHERE (store_members.user_id = auth.uid()))))
  with check ((store_id IN ( SELECT store_members.store_id
   FROM store_members
  WHERE (store_members.user_id = auth.uid()))));

drop policy if exists "Store members can insert supplier ledger" on public."supplier_ledger";
create policy "Store members can insert supplier ledger" on public."supplier_ledger" as permissive for insert to public
  with check ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = supplier_ledger.store_id) AND (sm.user_id = auth.uid()) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text, 'staff'::text]))))));

drop policy if exists "Owner or admin can delete supplier ledger" on public."supplier_ledger";
create policy "Owner or admin can delete supplier ledger" on public."supplier_ledger" as permissive for delete to public
  using ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = supplier_ledger.store_id) AND (sm.user_id = auth.uid()) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));

drop policy if exists "Store members can update supplier ledger" on public."supplier_ledger";
create policy "Store members can update supplier ledger" on public."supplier_ledger" as permissive for update to public
  using ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = supplier_ledger.store_id) AND (sm.user_id = auth.uid()) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text, 'staff'::text]))))));

drop policy if exists "Store members can insert suppliers" on public."suppliers";
create policy "Store members can insert suppliers" on public."suppliers" as permissive for insert to public
  with check ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = suppliers.store_id) AND (sm.user_id = auth.uid()) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text, 'staff'::text]))))));

drop policy if exists "Owner or admin can delete suppliers" on public."suppliers";
create policy "Owner or admin can delete suppliers" on public."suppliers" as permissive for delete to public
  using ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = suppliers.store_id) AND (sm.user_id = auth.uid()) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));

drop policy if exists "Store members can update suppliers" on public."suppliers";
create policy "Store members can update suppliers" on public."suppliers" as permissive for update to public
  using ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = suppliers.store_id) AND (sm.user_id = auth.uid()) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text, 'staff'::text]))))));
