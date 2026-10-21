-- ============================================================
-- P8.3 M3 - politiques de lecture : appartenance active
-- Genere depuis la capture de l'etat installe TEST (voir MATRICE.md).
-- Regle : injection validee par analyse d'expression, jamais par
-- remplacement textuel aveugle. Les politiques bloquees sont exclues.
-- Tables, commandes, permissivite et roles cibles sont reproduits a
-- l'identique : seule la condition de statut est ajoutee.
-- ============================================================

drop policy if exists "ameex_configs_select" on public."ameex_configs";
create policy "ameex_configs_select" on public."ameex_configs" as permissive for select to public
  using ((store_id IN ( SELECT store_members.store_id
   FROM store_members
  WHERE (store_members.user_id = auth.uid()) AND status = 'active'::text)));

drop policy if exists "ameex_webhook_events_store_select" on public."ameex_webhook_events";
create policy "ameex_webhook_events_store_select" on public."ameex_webhook_events" as permissive for select to public
  using ((store_id IN ( SELECT sm.store_id
   FROM store_members sm
  WHERE (sm.user_id = auth.uid() AND (sm.status = 'active'::text)))));

drop policy if exists "Store members can view blacklist entries" on public."blacklist_entries";
create policy "Store members can view blacklist entries" on public."blacklist_entries" as permissive for select to public
  using ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = blacklist_entries.store_id) AND (sm.user_id = auth.uid()) AND (sm.status = 'active'::text)))));

drop policy if exists "Store members can view blacklist rules" on public."blacklist_rules";
create policy "Store members can view blacklist rules" on public."blacklist_rules" as permissive for select to public
  using ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = blacklist_rules.store_id) AND (sm.user_id = auth.uid()) AND (sm.status = 'active'::text)))));

drop policy if exists "Store members can view confirmation agents" on public."confirmation_agents";
create policy "Store members can view confirmation agents" on public."confirmation_agents" as permissive for select to public
  using ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = confirmation_agents.store_id) AND (sm.user_id = auth.uid()) AND (sm.status = 'active'::text)))));

drop policy if exists "confirmation_settings_select_store_members" on public."confirmation_settings";
create policy "confirmation_settings_select_store_members" on public."confirmation_settings" as permissive for select to public
  using (((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = confirmation_settings.store_id) AND (sm.user_id = auth.uid()) AND (sm.status = 'active'::text)))) OR (EXISTS ( SELECT 1
   FROM stores s
  WHERE ((s.id = confirmation_settings.store_id) AND (s.owner_user_id = auth.uid()))))));

drop policy if exists "Store members can view delivery companies" on public."delivery_companies";
create policy "Store members can view delivery companies" on public."delivery_companies" as permissive for select to public
  using ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = delivery_companies.store_id) AND (sm.user_id = auth.uid()) AND (sm.status = 'active'::text)))));

drop policy if exists "Users can view their store's automation rules" on public."expense_automation_rules";
create policy "Users can view their store's automation rules" on public."expense_automation_rules" as permissive for select to public
  using ((store_id IN ( SELECT store_members.store_id
   FROM store_members
  WHERE (store_members.user_id = auth.uid()) AND status = 'active'::text)));

drop policy if exists "Store members can view expense categories" on public."expense_categories";
create policy "Store members can view expense categories" on public."expense_categories" as permissive for select to public
  using ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = expense_categories.store_id) AND (sm.user_id = auth.uid()) AND (sm.status = 'active'::text)))));

drop policy if exists "Users can view their store's recurring templates" on public."expense_recurring_templates";
create policy "Users can view their store's recurring templates" on public."expense_recurring_templates" as permissive for select to public
  using ((store_id IN ( SELECT store_members.store_id
   FROM store_members
  WHERE (store_members.user_id = auth.uid()) AND status = 'active'::text)));

drop policy if exists "facebook_campaign_mappings_select" on public."facebook_campaign_mappings";
create policy "facebook_campaign_mappings_select" on public."facebook_campaign_mappings" as permissive for select to public
  using ((store_id IN ( SELECT sm.store_id
   FROM store_members sm
  WHERE (sm.user_id = auth.uid() AND (sm.status = 'active'::text)))));

drop policy if exists "facebook_sync_errors_select" on public."facebook_sync_errors";
create policy "facebook_sync_errors_select" on public."facebook_sync_errors" as permissive for select to public
  using (((store_id IS NULL) OR (store_id IN ( SELECT sm.store_id
   FROM store_members sm
  WHERE (sm.user_id = auth.uid() AND (sm.status = 'active'::text))))));

drop policy if exists "forcelog_configs_select" on public."forcelog_configs";
create policy "forcelog_configs_select" on public."forcelog_configs" as permissive for select to public
  using ((store_id IN ( SELECT store_members.store_id
   FROM store_members
  WHERE (store_members.user_id = auth.uid()) AND status = 'active'::text)));

drop policy if exists "Store members can view inventory_consumptions" on public."inventory_consumptions";
create policy "Store members can view inventory_consumptions" on public."inventory_consumptions" as permissive for select to public
  using ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = inventory_consumptions.store_id) AND (sm.user_id = auth.uid()) AND (sm.status = 'active'::text)))));

drop policy if exists "Store members can view inventory movements" on public."inventory_movements";
create policy "Store members can view inventory movements" on public."inventory_movements" as permissive for select to public
  using ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = inventory_movements.store_id) AND (sm.user_id = auth.uid()) AND (sm.status = 'active'::text)))));

drop policy if exists "Store members can view product_categories" on public."product_categories";
create policy "Store members can view product_categories" on public."product_categories" as permissive for select to public
  using ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = product_categories.store_id) AND (sm.user_id = auth.uid()) AND (sm.status = 'active'::text)))));

drop policy if exists "idempotency_select_store_members" on public."public_order_idempotency";
create policy "idempotency_select_store_members" on public."public_order_idempotency" as permissive for select to public
  using ((store_id IN ( SELECT store_members.store_id
   FROM store_members
  WHERE (store_members.user_id = auth.uid()) AND status = 'active'::text)));

drop policy if exists "ingestion_logs_select_store_members" on public."public_order_ingestion_logs";
create policy "ingestion_logs_select_store_members" on public."public_order_ingestion_logs" as permissive for select to public
  using ((store_id IN ( SELECT store_members.store_id
   FROM store_members
  WHERE (store_members.user_id = auth.uid()) AND status = 'active'::text)));

drop policy if exists "sendit_configs_select" on public."sendit_configs";
create policy "sendit_configs_select" on public."sendit_configs" as permissive for select to public
  using ((store_id IN ( SELECT store_members.store_id
   FROM store_members
  WHERE (store_members.user_id = auth.uid()) AND status = 'active'::text)));

drop policy if exists "Store members can view supplier ledger" on public."supplier_ledger";
create policy "Store members can view supplier ledger" on public."supplier_ledger" as permissive for select to public
  using ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = supplier_ledger.store_id) AND (sm.user_id = auth.uid()) AND (sm.status = 'active'::text)))));

drop policy if exists "Store members can view suppliers" on public."suppliers";
create policy "Store members can view suppliers" on public."suppliers" as permissive for select to public
  using ((EXISTS ( SELECT 1
   FROM store_members sm
  WHERE ((sm.store_id = suppliers.store_id) AND (sm.user_id = auth.uid()) AND (sm.status = 'active'::text)))));
