# Reconstruction du schéma métier représentatif (environnement isolé)

Objectif : disposer d'une cible où le coût d'écriture est **comparable** à la
réalité, sans données de production et sans dépendre de jisra-test.

**Aucune opération de ce document n'est exécutée dans cette campagne.**

## 1. Ce qui doit exister

| Catégorie | Objets |
|---|---|
| Tables métier | `stores`, `store_members`, `profiles`, `products`, `orders`, `order_items`, `ad_spend_daily` |
| Contraintes | clés primaires, clés étrangères (`store_id`, `order_id`, `product_id`), `CHECK` de statut, `NOT NULL` de `order_items.product_id`, `spend_converted` |
| Index | `(store_id, order_date)`, `(store_id, order_id)`, `(store_id, spend_date, platform)` |
| Fonctions métier | `order_purchase_cost`, `recalc_order_financials`, `sync_order_total_from_items`, `allocate_ads_cost_for_day`, `set_order_status_timestamps`, `orders_set_profit_before_write` |
| Triggers métier | `trg_order_items_recalc_order_financials`, `trg_order_items_sync_order_total`, `trg_allocate_ads_on_orders`, `trg_allocate_ads_on_ad_spend`, `trg_handle_order_expense_automation`, `trg_handle_order_status_inventory`, `trg_set_order_status_timestamps`, `trg_orders_set_profit_before_write` |
| Triggers de cohérence boutique | `trg_add_store_owner_member`, `trg_create_default_blacklist_rule`, `trg_enforce_store_quota` |
| Paquet KPI | installé séparément via `p79_delivery` (mode inactif puis activation) |

Les noms ci-dessus proviennent du dépôt et de l'inspection de jisra-test ; ils
doivent être **reconfirmés par comparaison de catalogues** après restauration.

## 2. Ce qui ne doit pas être copié

- toute donnée métier (`--schema-only` uniquement) ;
- les agrégats et l'état KPI (installés par le paquet, jamais copiés) ;
- les jobs `pg_cron`, extensions configurées, secrets, rôles applicatifs ;
- les politiques RLS et ACL propres à d'autres tenants, sauf si le scénario les
  exige (ce n'est pas le cas pour B13).

## 3. Obtention du schéma

Deux voies, toutes deux hors de cette campagne :

1. **Export structurel** : `pg_dump --schema-only` restreint aux tables et
   fonctions listées, depuis une source autorisée en lecture seule.
2. **Outil existant** : `p7_1_package/tools/export-prod-structure.sh` +
   `preflight-export.sql` (déjà présents), adaptés au périmètre métier.

Dans les deux cas : tri et revue manuelle avant application, aucune application
automatique.

## 4. Vérifications après restauration

| Contrôle | Méthode |
|---|---|
| Colonnes et types | comparaison `information_schema.columns` entre source et isolé |
| Contraintes | `pg_constraint` : PK, FK, CHECK |
| Triggers métier | liste `pg_trigger` restreinte aux tables métier, `tgenabled = 'O'` |
| Fonctions métier | `pg_get_functiondef` : empreintes comparées une à une |
| Absence de données | `count(*) = 0` sur les 7 tables |
| Absence de KPI | aucune table `dashboard_*` avant l'étape d'installation |

## 5. Portes d'acceptation

1. Les 8 triggers métier sont présents et actifs.
2. Les 6 fonctions métier sont identiques à la source (empreintes).
3. Aucune ligne métier, aucun job cron, aucun secret.
4. Le harnais B13 refuse toujours la cible tant que les garde-fous ne sont pas
   satisfaits (`p79.bench_env`, `p79.bench_confirm`, absence de sentinelles).

## 6. Risques connus

- Test contient des objets supplémentaires (intégrations, RLS, triggers de
  suivi) : un export trop large fausse la mesure et introduit des effets de bord.
- Un export trop étroit sous-estime le coût réel.
- PostgreSQL de Production est 17.6 ARM64 : **les chiffres de l'isolé ne sont
  pas transposables** ; ils servent à décider d'un budget, pas à le garantir.

## 7. Opérations nécessitant une autorisation distincte

1. Export structurel depuis une source (lecture seule) — autorisation d'accès.
2. Création de la cible isolée (projet ou base dédiée) — autorisation de coût.
3. Application du schéma et du paquet KPI sur la cible — écritures isolées.
4. Exécution du harnais (2 variantes, 3 tours) — campagne mesurée.
5. Nettoyage/teardown de la cible.
