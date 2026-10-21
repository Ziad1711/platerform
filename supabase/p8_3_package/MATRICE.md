# P8.3 — Matrice des politiques liées à `store_members`

Capture : **77** politiques, **3** fonctions.

| Catégorie | Nombre |
|---|---|
| M1 — fonctions produits | 3 |
| M2 — politiques d'écriture | 41 |
| M3 — politiques de lecture | 21 |
| Déjà gouvernées (statut présent) | 10 |
| Exclues (propriété de boutique) | 5 |
| Bloquées (forme non reconnue) | 0 |

## Politiques traitées (M2 / M3)

| Table | Politique | Cmd | Perm. | Lot | Blocs injectés | USING (extrait) |
|---|---|---|---|---|---|---|
| ai_usage | ai_usage_insert_own_scoped_store | INSERT | true | M2 | 1 | ((auth.uid() = user_id) AND ((store_id IS NULL) OR (EXISTS ( SELECT 1  |
| ameex_configs | ameex_configs_manage | ALL | true | M2 | 2 | (store_id IN ( SELECT store_members.store_id FROM store_members WHERE  |
| ameex_configs | ameex_configs_select | SELECT | true | M3 | 1 | (store_id IN ( SELECT store_members.store_id FROM store_members WHERE  |
| ameex_webhook_events | ameex_webhook_events_store_select | SELECT | true | M3 | 1 | (store_id IN ( SELECT sm.store_id FROM store_members sm WHERE (sm.user |
| blacklist_entries | Store members can insert blacklist entries | INSERT | true | M2 | 1 | (EXISTS ( SELECT 1 FROM store_members sm WHERE ((sm.store_id = blackli |
| blacklist_entries | Store members can delete blacklist entries | DELETE | true | M2 | 1 | (EXISTS ( SELECT 1 FROM store_members sm WHERE ((sm.store_id = blackli |
| blacklist_entries | Store members can view blacklist entries | SELECT | true | M3 | 1 | (EXISTS ( SELECT 1 FROM store_members sm WHERE ((sm.store_id = blackli |
| blacklist_rules | Store members can insert blacklist rules | INSERT | true | M2 | 1 | (EXISTS ( SELECT 1 FROM store_members sm WHERE ((sm.store_id = blackli |
| blacklist_rules | Store members can view blacklist rules | SELECT | true | M3 | 1 | (EXISTS ( SELECT 1 FROM store_members sm WHERE ((sm.store_id = blackli |
| blacklist_rules | Store members can update blacklist rules | UPDATE | true | M2 | 2 | (EXISTS ( SELECT 1 FROM store_members sm WHERE ((sm.store_id = blackli |
| confirmation_agents | Owner or admin can insert confirmation agents | INSERT | true | M2 | 1 | (EXISTS ( SELECT 1 FROM store_members sm WHERE ((sm.store_id = confirm |
| confirmation_agents | Owner or admin can delete confirmation agents | DELETE | true | M2 | 1 | (EXISTS ( SELECT 1 FROM store_members sm WHERE ((sm.store_id = confirm |
| confirmation_agents | Store members can view confirmation agents | SELECT | true | M3 | 1 | (EXISTS ( SELECT 1 FROM store_members sm WHERE ((sm.store_id = confirm |
| confirmation_agents | Owner or admin can update confirmation agents | UPDATE | true | M2 | 1 | (EXISTS ( SELECT 1 FROM store_members sm WHERE ((sm.store_id = confirm |
| confirmation_settings | confirmation_settings_write_owner_admin | ALL | true | M2 | 2 | ((EXISTS ( SELECT 1 FROM store_members sm WHERE ((sm.store_id = confir |
| confirmation_settings | confirmation_settings_select_store_members | SELECT | true | M3 | 1 | ((EXISTS ( SELECT 1 FROM store_members sm WHERE ((sm.store_id = confir |
| delivery_companies | Owner or admin can insert delivery companies | INSERT | true | M2 | 1 | (EXISTS ( SELECT 1 FROM store_members sm WHERE ((sm.store_id = deliver |
| delivery_companies | Owner or admin can delete delivery companies | DELETE | true | M2 | 1 | (EXISTS ( SELECT 1 FROM store_members sm WHERE ((sm.store_id = deliver |
| delivery_companies | Store members can view delivery companies | SELECT | true | M3 | 1 | (EXISTS ( SELECT 1 FROM store_members sm WHERE ((sm.store_id = deliver |
| delivery_companies | Owner or admin can update delivery companies | UPDATE | true | M2 | 1 | (EXISTS ( SELECT 1 FROM store_members sm WHERE ((sm.store_id = deliver |
| digylog_configs | digylog_configs_store_access | ALL | true | M2 | 1 | (store_id IN ( SELECT store_members.store_id FROM store_members WHERE  |
| digylog_webhook_events | digylog_webhook_events_store_access | ALL | true | M2 | 1 | (store_id IN ( SELECT store_members.store_id FROM store_members WHERE  |
| expense_automation_rules | Users can insert automation rules for their stores | INSERT | true | M2 | 1 | (store_id IN ( SELECT store_members.store_id FROM store_members WHERE  |
| expense_automation_rules | Users can delete their store's automation rules | DELETE | true | M2 | 1 | (store_id IN ( SELECT store_members.store_id FROM store_members WHERE  |
| expense_automation_rules | Users can view their store's automation rules | SELECT | true | M3 | 1 | (store_id IN ( SELECT store_members.store_id FROM store_members WHERE  |
| expense_automation_rules | Users can update their store's automation rules | UPDATE | true | M2 | 1 | (store_id IN ( SELECT store_members.store_id FROM store_members WHERE  |
| expense_categories | Store members can insert expense categories | INSERT | true | M2 | 1 | (EXISTS ( SELECT 1 FROM store_members sm WHERE ((sm.store_id = expense |
| expense_categories | Owner or admin can delete expense categories | DELETE | true | M2 | 1 | (EXISTS ( SELECT 1 FROM store_members sm WHERE ((sm.store_id = expense |
| expense_categories | Store members can view expense categories | SELECT | true | M3 | 1 | (EXISTS ( SELECT 1 FROM store_members sm WHERE ((sm.store_id = expense |
| expense_categories | Store members can update expense categories | UPDATE | true | M2 | 1 | (EXISTS ( SELECT 1 FROM store_members sm WHERE ((sm.store_id = expense |
| expense_recurring_templates | Users can view their store's recurring templates | SELECT | true | M3 | 1 | (store_id IN ( SELECT store_members.store_id FROM store_members WHERE  |
| facebook_ad_account_store_configs | facebook_account_store_configs_all | ALL | true | M2 | 2 | ((user_id = auth.uid()) AND (store_id IN ( SELECT sm.store_id FROM sto |
| facebook_campaign_mappings | facebook_campaign_mappings_all | ALL | true | M2 | 2 | (store_id IN ( SELECT sm.store_id FROM store_members sm WHERE (sm.user |
| facebook_campaign_mappings | facebook_campaign_mappings_select | SELECT | true | M3 | 1 | (store_id IN ( SELECT sm.store_id FROM store_members sm WHERE (sm.user |
| facebook_sync_errors | facebook_sync_errors_select | SELECT | true | M3 | 1 | ((store_id IS NULL) OR (store_id IN ( SELECT sm.store_id FROM store_me |
| forcelog_configs | forcelog_configs_manage | ALL | true | M2 | 2 | (store_id IN ( SELECT store_members.store_id FROM store_members WHERE  |
| forcelog_configs | forcelog_configs_select | SELECT | true | M3 | 1 | (store_id IN ( SELECT store_members.store_id FROM store_members WHERE  |
| inventory_consumptions | Store members can insert inventory_consumptions | INSERT | true | M2 | 1 | (EXISTS ( SELECT 1 FROM store_members sm WHERE ((sm.store_id = invento |
| inventory_consumptions | Owner or admin can delete inventory_consumptions | DELETE | true | M2 | 1 | (EXISTS ( SELECT 1 FROM store_members sm WHERE ((sm.store_id = invento |
| inventory_consumptions | Store members can view inventory_consumptions | SELECT | true | M3 | 1 | (EXISTS ( SELECT 1 FROM store_members sm WHERE ((sm.store_id = invento |
| inventory_consumptions | Store members can update inventory_consumptions | UPDATE | true | M2 | 2 | (EXISTS ( SELECT 1 FROM store_members sm WHERE ((sm.store_id = invento |
| inventory_movements | Store members can insert inventory movements | INSERT | true | M2 | 1 | (EXISTS ( SELECT 1 FROM store_members sm WHERE ((sm.store_id = invento |
| inventory_movements | Owner or admin can delete inventory movements | DELETE | true | M2 | 1 | (EXISTS ( SELECT 1 FROM store_members sm WHERE ((sm.store_id = invento |
| inventory_movements | Store members can view inventory movements | SELECT | true | M3 | 1 | (EXISTS ( SELECT 1 FROM store_members sm WHERE ((sm.store_id = invento |
| inventory_movements | Store members can update inventory movements | UPDATE | true | M2 | 1 | (EXISTS ( SELECT 1 FROM store_members sm WHERE ((sm.store_id = invento |
| orders | orders_delete_store_scope | DELETE | true | M2 | 1 | ((EXISTS ( SELECT 1 FROM store_members sm WHERE ((sm.store_id = orders |
| product_categories | Store members can insert product_categories | INSERT | true | M2 | 1 | (EXISTS ( SELECT 1 FROM store_members sm WHERE ((sm.store_id = product |
| product_categories | Owner or admin can delete product_categories | DELETE | true | M2 | 1 | (EXISTS ( SELECT 1 FROM store_members sm WHERE ((sm.store_id = product |
| product_categories | Store members can view product_categories | SELECT | true | M3 | 1 | (EXISTS ( SELECT 1 FROM store_members sm WHERE ((sm.store_id = product |
| product_categories | Store members can update product_categories | UPDATE | true | M2 | 1 | (EXISTS ( SELECT 1 FROM store_members sm WHERE ((sm.store_id = product |
| public_order_idempotency | idempotency_select_store_members | SELECT | true | M3 | 1 | (store_id IN ( SELECT store_members.store_id FROM store_members WHERE  |
| public_order_ingestion_logs | ingestion_logs_select_store_members | SELECT | true | M3 | 1 | (store_id IN ( SELECT store_members.store_id FROM store_members WHERE  |
| sendit_configs | sendit_configs_manage | ALL | true | M2 | 2 | (store_id IN ( SELECT store_members.store_id FROM store_members WHERE  |
| sendit_configs | sendit_configs_select | SELECT | true | M3 | 1 | (store_id IN ( SELECT store_members.store_id FROM store_members WHERE  |
| supplier_ledger | Store members can insert supplier ledger | INSERT | true | M2 | 1 | (EXISTS ( SELECT 1 FROM store_members sm WHERE ((sm.store_id = supplie |
| supplier_ledger | Owner or admin can delete supplier ledger | DELETE | true | M2 | 1 | (EXISTS ( SELECT 1 FROM store_members sm WHERE ((sm.store_id = supplie |
| supplier_ledger | Store members can view supplier ledger | SELECT | true | M3 | 1 | (EXISTS ( SELECT 1 FROM store_members sm WHERE ((sm.store_id = supplie |
| supplier_ledger | Store members can update supplier ledger | UPDATE | true | M2 | 1 | (EXISTS ( SELECT 1 FROM store_members sm WHERE ((sm.store_id = supplie |
| suppliers | Store members can insert suppliers | INSERT | true | M2 | 1 | (EXISTS ( SELECT 1 FROM store_members sm WHERE ((sm.store_id = supplie |
| suppliers | Owner or admin can delete suppliers | DELETE | true | M2 | 1 | (EXISTS ( SELECT 1 FROM store_members sm WHERE ((sm.store_id = supplie |
| suppliers | Store members can view suppliers | SELECT | true | M3 | 1 | (EXISTS ( SELECT 1 FROM store_members sm WHERE ((sm.store_id = supplie |
| suppliers | Store members can update suppliers | UPDATE | true | M2 | 1 | (EXISTS ( SELECT 1 FROM store_members sm WHERE ((sm.store_id = supplie |

## Politiques exclues — arbitrage propriété

| Table | Politique | Cmd | USING | WITH CHECK |
|---|---|---|---|---|
| store_members | store_members_insert_owner_admin | INSERT | (aucune) | (((user_id = auth.uid()) AND (role = 'owner'::text) AND (EXISTS ( SELECT 1 FROM stores s WHERE ((s.id = store_members.store_id) AND (s.owner_user_id = auth.uid()))))) OR (EXISTS ( SELECT 1 FROM stores s WHERE ((s.id = store_members.store_id) AND (s.owner_user_id = auth.uid()))))) |
| store_members | store_members_admin_delete | DELETE | (is_store_admin_or_owner(store_id, auth.uid()) AND (NOT (EXISTS ( SELECT 1 FROM stores s WHERE ((s.id = store_members.store_id) AND (s.owner_user_id = store_members.user_id)))))) | (aucune) |
| store_members | store_members_delete_owner_admin | DELETE | ((EXISTS ( SELECT 1 FROM stores s WHERE ((s.id = store_members.store_id) AND (s.owner_user_id = auth.uid())))) AND (NOT (EXISTS ( SELECT 1 FROM stores s2 WHERE ((s2.id = store_members.store_id) AND (s2.owner_user_id = store_members.user_id)))))) | (aucune) |
| store_members | store_members_select_self_or_store_admin | SELECT | ((user_id = auth.uid()) OR (EXISTS ( SELECT 1 FROM stores s WHERE ((s.id = store_members.store_id) AND (s.owner_user_id = auth.uid()))))) | (aucune) |
| store_members | store_members_update_owner_admin | UPDATE | (EXISTS ( SELECT 1 FROM stores s WHERE ((s.id = store_members.store_id) AND (s.owner_user_id = auth.uid())))) | (EXISTS ( SELECT 1 FROM stores s WHERE ((s.id = store_members.store_id) AND (s.owner_user_id = auth.uid())))) |

## Politiques bloquées

Aucune.

## Couverture par table et commande

Pour chaque couple (table, commande), liste des politiques permissives restantes : une seule politique non gouvernée suffirait à rouvrir l’accès (les permissives se cumulent en OR).

| Table | Cmd | Permissives | Gouvernées après P8.3 |
|---|---|---|---|
| ad_spend_daily | DELETE | 1 | 1 |
| ad_spend_daily | INSERT | 1 | 1 |
| ad_spend_daily | SELECT | 1 | 1 |
| ad_spend_daily | UPDATE | 1 | 1 |
| ai_usage | INSERT | 1 | 1 |
| ameex_configs | ALL | 1 | 1 |
| ameex_configs | SELECT | 1 | 1 |
| ameex_webhook_events | SELECT | 1 | 1 |
| blacklist_entries | DELETE | 1 | 1 |
| blacklist_entries | INSERT | 1 | 1 |
| blacklist_entries | SELECT | 1 | 1 |
| blacklist_rules | INSERT | 1 | 1 |
| blacklist_rules | SELECT | 1 | 1 |
| blacklist_rules | UPDATE | 1 | 1 |
| confirmation_agents | DELETE | 1 | 1 |
| confirmation_agents | INSERT | 1 | 1 |
| confirmation_agents | SELECT | 1 | 1 |
| confirmation_agents | UPDATE | 1 | 1 |
| confirmation_settings | ALL | 1 | 1 |
| confirmation_settings | SELECT | 1 | 1 |
| delivery_companies | DELETE | 1 | 1 |
| delivery_companies | INSERT | 1 | 1 |
| delivery_companies | SELECT | 1 | 1 |
| delivery_companies | UPDATE | 1 | 1 |
| delivery_tracking_claims | SELECT | 1 | 1 |
| delivery_tracking_locks | SELECT | 1 | 1 |
| delivery_tracking_state | SELECT | 1 | 1 |
| digylog_configs | ALL | 1 | 1 |
| digylog_webhook_events | ALL | 1 | 1 |
| expense_automation_rules | DELETE | 1 | 1 |
| expense_automation_rules | INSERT | 1 | 1 |
| expense_automation_rules | SELECT | 1 | 1 |
| expense_automation_rules | UPDATE | 1 | 1 |
| expense_categories | DELETE | 1 | 1 |
| expense_categories | INSERT | 1 | 1 |
| expense_categories | SELECT | 1 | 1 |
| expense_categories | UPDATE | 1 | 1 |
| expense_recurring_templates | SELECT | 1 | 1 |
| expenses | SELECT | 1 | 1 |
| facebook_ad_account_store_configs | ALL | 1 | 1 |
| facebook_campaign_mappings | ALL | 1 | 1 |
| facebook_campaign_mappings | SELECT | 1 | 1 |
| facebook_sync_errors | SELECT | 1 | 1 |
| forcelog_configs | ALL | 1 | 1 |
| forcelog_configs | SELECT | 1 | 1 |
| inventory_consumptions | DELETE | 1 | 1 |
| inventory_consumptions | INSERT | 1 | 1 |
| inventory_consumptions | SELECT | 1 | 1 |
| inventory_consumptions | UPDATE | 1 | 1 |
| inventory_movements | DELETE | 1 | 1 |
| inventory_movements | INSERT | 1 | 1 |
| inventory_movements | SELECT | 1 | 1 |
| inventory_movements | UPDATE | 1 | 1 |
| orders | DELETE | 1 | 1 |
| orders | INSERT | 1 | 1 |
| product_categories | DELETE | 1 | 1 |
| product_categories | INSERT | 1 | 1 |
| product_categories | SELECT | 1 | 1 |
| product_categories | UPDATE | 1 | 1 |
| public_order_idempotency | SELECT | 1 | 1 |
| public_order_ingestion_logs | SELECT | 1 | 1 |
| sendit_configs | ALL | 1 | 1 |
| sendit_configs | SELECT | 1 | 1 |
| store_members ⚠️ | DELETE | 2 | 0 |
| store_members ⚠️ | INSERT | 1 | 0 |
| store_members ⚠️ | SELECT | 1 | 0 |
| store_members ⚠️ | UPDATE | 1 | 0 |
| stores | UPDATE | 1 | 1 |
| supplier_ledger | DELETE | 1 | 1 |
| supplier_ledger | INSERT | 1 | 1 |
| supplier_ledger | SELECT | 1 | 1 |
| supplier_ledger | UPDATE | 1 | 1 |
| suppliers | DELETE | 1 | 1 |
| suppliers | INSERT | 1 | 1 |
| suppliers | SELECT | 1 | 1 |
| suppliers | UPDATE | 1 | 1 |

