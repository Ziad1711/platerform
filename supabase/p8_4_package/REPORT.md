# P8.4 — Correction D4 et S2

**Projet :** `jisra-test` / `goqedvcdmgtejtyrawsp` — **Date :** 21/10/2026.
**Statut :** appliqué et vérifié — **13/13 tests JWT PASS, zéro résidu.**

## 1. Défauts corrigés

| # | Défaut reproduit | Preuve avant correctif |
|---|---|---|
| D4 | Rôle `delivery` modifiant `total_selling_price` par PATCH REST | 200, 1 ligne modifiée |
| S2 | `stock_manager` bloqué sur l'INSERT direct d'un mouvement | 403 `new row violates row-level security policy` |

## 2. Correctifs

### D4 — `20261023110000_p84_delivery_order_column_guard.sql`

- `public.p84_is_delivery_only(uuid)` : vrai uniquement si l'appelant est `delivery` actif **et** n'est ni owner/admin ni propriétaire du store.
- `public.p84_guard_delivery_order_columns()` : trigger `BEFORE UPDATE` en **SECURITY INVOKER** (donc `current_user` = rôle réel).
  - Ignore les contextes privilégiés (`service_role`, `postgres`) → les routes applicatives (`/api/orders/status`, client admin) restent intactes.
  - Refuse toute modification de `store_id` (`ORDER_STORE_IMMUTABLE`).
  - Pour un `delivery` pur, compare `to_jsonb(old)` et `to_jsonb(new)` **après retrait d'une liste blanche** : `status`, `delivery_status`, `delivery_note`, `delivery_company_id`, `tracking_number`, `delivery_city_external_id`, `delivery_status_source`, `last_status_update_at`, `updated_at`. Toute autre colonne modifiée → `DELIVERY_COLUMN_FORBIDDEN`.
- Trigger nommé `a_p84_delivery_order_columns` : s'exécute **avant** les triggers `set_*`/`trg_*`, ce qui évite les faux positifs liés aux colonnes recalculées (updated_at, profit, timestamps de statut, normalisation).

### S2 — `20261023110100_p84_stock_movement_write_policies.sql`

- INSERT et UPDATE de `inventory_movements` → `public.can_manage_store_stock(store_id)` (owner/admin/stock_manager actif + repli propriétaire).
- UPDATE gagne un `with check` (absent auparavant).
- DELETE (owner/admin) et SELECT : inchangés.

## 3. Rollbacks

- `20_rollback_d4.sql` : drop trigger + 2 fonctions, vérifications incluses.
- `20_rollback_s2.sql` : politiques recréées **verbatim** depuis la capture du 21/10 (`capture-p84-policies.json`), vérification incluse.

## 4. Tests (JWT réels, REST direct) — 13/13 PASS

| # | Test | Résultat |
|---|---|---|
| V1 | Livraison modifie le prix | refusé, prix en base inchangé (500) |
| V2 | Livraison modifie statut **et** prix | refus intégral, statut inchangé |
| V3 | Livraison modifie la note | 1 ligne |
| V4 | Livraison change le statut | 1 ligne |
| V5 | Livraison sur boutique étrangère | 0 ligne |
| V6 | Stock Manager INSERT mouvement | 201 |
| V7 | Stock Manager UPDATE mouvement | 1 ligne |
| V8 | Stock Manager DELETE mouvement | 0 ligne (réservé owner/admin) |
| V9 | Viewer INSERT mouvement | 403 |
| V10 | Membre `revoked` INSERT mouvement | 403 |
| V11/V12 | Owner / Admin INSERT mouvement | 201 |
| V13 | Contexte privilégié (postgres) modifie le prix | autorisé |

Résidus après campagne : `orders 0 · movements 0 · stores 0 · members 0 · products 0 · users 0`.

## 5. Risques restants

- La liste blanche Livraison est volontairement stricte : si un parcours légitime doit modifier `delivery_fee` ou une colonne d'attribution, il faudra l'ajouter explicitement.
- Les routes applicatives restent **NOT COVERED** au runtime (aucun déploiement TEST du code).
- C3 (auto-assignation Confirmation) reste **NOT COVERED** ; RPC Confirmation non modifiée conformément au périmètre.
- `product_variants` / `product_images` non modifiées (écart S5 documenté, hors périmètre).

## 6. Verdict

**GO** pour D4 et S2 : anomalies corrigées et vérifiées, opérations légitimes conservées, rollback validé.
