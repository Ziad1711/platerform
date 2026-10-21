# P8.3 — Préparation : permissions conservées après révocation

**Projet :** `jisra-test` / `goqedvcdmgtejtyrawsp` — **Date :** 21/10/2026.
**Statut :** **M1, M2 et M3 appliquées sur TEST et validées — 20/20 tests JWT PASS, zéro résidu.**

## 1. Périmètre exact

Capture installée : **77 politiques** mentionnant `store_members`, **3 fonctions** produits.

| Catégorie | Nombre |
|---|---|
| M1 — fonctions produits | 3 |
| M2 — politiques d'écriture (a/w/d/ALL) | 41 |
| M3 — politiques de lecture (SELECT) | 21 |
| Déjà gouvernées (filtre de statut présent) | 10 |
| **Exclues — propriété de boutique** | **5** |
| Bloquées (forme non reconnue) | **0** |

## 2. Défaut

Un membre `status='revoked'` conserve son `role` et sa ligne. Toute politique qui ne teste pas `store_members.status` continue donc de l'autoriser :

- **62 politiques** portaient une sous-requête `store_members` sans filtre de statut (formes A et B) ;
- **3 fonctions** `can_manage_store_products`, `can_manage_store_products_admin`, `can_view_store_products` ne filtraient pas le statut, contrairement aux 34 autres fonctions `public` qui le font ;
- les helpers applicatifs (`verifyStoreAccess`, `getAccessibleStoreIds`) filtrent déjà `status='active'` : les routes API ne sont pas concernées.

## 3. Lots préparés

| Lot | Fichier | Contenu |
|---|---|---|
| M1 | `20261023100000_p83_revoked_member_product_functions.sql` | 3 `CREATE OR REPLACE FUNCTION` avec `and sm.status = 'active'` |
| M2 | `20261023100100_p83_revoked_member_write_policies.sql` | 41 `drop policy` + `create policy` (écritures) |
| M3 | `20261023100200_p83_revoked_member_read_policies.sql` | 21 `drop policy` + `create policy` (lectures) |

Chaque politique conserve : table, nom, permissivité, commande et **rôles cibles** (`public`, ou `authenticated` pour `ai_usage_insert_own_scoped_store`). Seule la condition de statut est ajoutée.

**Politiques `FOR ALL`** (10) : si `with check` est absent, PostgreSQL applique `using` à INSERT et UPDATE ; l'injection dans `using` couvre donc les quatre commandes. Quand les deux expressions existent, **les deux** ont été transformées (49 injections pour 41 politiques).

## 4. Méthode de transformation (pas de remplacement aveugle)

Deux formes reconnues, chacune validée avant injection :

- **A** — `FROM store_members <alias> WHERE ( … )` : injection de `AND (<alias>.status = 'active'::text)` avant la parenthèse fermante, uniquement si le bloc contient **une** égalité `<alias>.user_id = auth.uid()` et aucun `status`.
- **B** — `(SELECT … FROM store_members WHERE … )` sans alias : vérification que la sous-requête est bien un `SELECT` parenthésé, sans `GROUP BY`/`ORDER BY`/`LIMIT`, avec une égalité unique `user_id = auth.uid()`.

Toute autre forme **bloque** la politique (exclue des lots et listée). Résultat : **0 blocage** après extension aux deux formes identifiées ; les 19 politiques initialement bloquées l'étaient pour la forme B.

## 5. Rollbacks verbatim

`20_rollback_m1.sql`, `20_rollback_m2.sql`, `20_rollback_m3.sql` : définitions recopiées depuis la capture, sans la condition de statut.

**Vérification** : 62 politiques contrôlées, `using` et `with check` identiques à la capture (comparaison après normalisation des espaces) — **62/62 conformes**, aucune anomalie. M1 restaure les `pg_get_functiondef` d'origine ; ACL inchangées (la migration ne les touche pas).

## 6. Contrat proposé — politiques de propriété (5, non modifiées)

Les 5 politiques de `store_members` autorisent via `stores.owner_user_id = auth.uid()`, indépendamment de `store_members.status` :

`store_members_insert_owner_admin`, `store_members_update_owner_admin`, `store_members_delete_owner_admin`, `store_members_select_self_or_store_admin`, et la seconde branche DELETE propriétaire.

**Contrat proposé :** la propriété est un attribut de la ligne `stores`, pas de l'appartenance.
1. Le propriétaire légitime conserve ses droits d'administration même si sa ligne d'appartenance a été révoquée.
2. Un **membre non propriétaire** révoqué perd tout accès : c'est l'objet de M2/M3.
3. Le trigger `block_store_member_mutation` interdit déjà `OWNER_CANNOT_BE_REMOVED` / `OWNER_ROLE_IMMUTABLE` : une ligne propriétaire ne peut pas être révoquée par les chemins applicatifs. À vérifier en précontrôle qu'aucune ligne `role='owner' and status='revoked'` n'existe.

**Arbitrage requis** (hors P8.3) : si le métier veut qu'une révocation du propriétaire retire aussi ses droits, il faut traiter `stores.owner_user_id` — non couvert ici.

## 7. Tests prévus (harnais `p83-dynamic`)

| Acteur | Action attendue |
|---|---|
| Membre `revoked` (rôle admin) | `suppliers` SELECT 0 ligne · INSERT 403 · `inventory_movements` INSERT 403 · `expense_categories` UPDATE 0 ligne · `products` SELECT 403 (helper) |
| Admin actif | mêmes écritures autorisées |
| Owner actif | autorité de propriété inchangée |
| Viewer actif | lectures inchangées, écritures refusées |
| Stock manager actif | `products` lecture et gestion autorisées |
| Boutique étrangère | refus sur toutes les familles |

Nettoyage par identifiants enregistrés, résidus attendus nuls. Aucun fournisseur externe appelé.

## 8. Risques

| Risque | Parade |
|---|---|
| 41 politiques d'écriture : régression d'un flux légitime | validation stricte de chaque expression + rollback verbatim 62/62 + tests par rôle |
| 21 politiques de lecture : écran vide pour un membre actif | les actifs satisfont toujours `status='active'` ; test de lecture par rôle |
| Politique `FOR ALL` partiellement protégée | injection dans `using` **et** `with check` ; comptage 49/41 |
| Forme inattendue ignorée silencieusement | blocage explicite, 0 blocage restant |
| Propriétaire révoqué | hors périmètre, contrat documenté, précontrôle requis |

## 9. Application et résultats (TEST)

| Lot | Migration | Historique | Contrôle installé |
|---|---|---|---|
| M1 | `20261023100000` | enregistrée | 3/3 fonctions filtrent `sm.status = 'active'` |
| M2 | `20261023100100` | enregistrée | 46/46 politiques d'écriture gouvernées |
| M3 | `20261023100200` | enregistrée | 72/72 politiques hors `store_members` gouvernées |

`max_version = 20261023100200`.

**Tests JWT (REST/RPC directs) — 20/20 PASS, résidus 0 à chaque lot :**

- **M1 (6)** — `revoked` : `can_view_store_products` = false, `can_manage_store_products` = false ; `stock_manager` actif : true/true ; admin actif : `can_manage_store_products_admin` = true ; boutique étrangère : false.
- **M2 (7)** — `revoked` admin et viewer : INSERT `suppliers` 403 ; `revoked` : UPDATE 0 ligne ; `revoked` viewer : INSERT `expense_categories` 403 ; boutique étrangère 403 ; admin actif 201 ; viewer actif 403.
- **M3 (7)** — `revoked` admin et viewer : SELECT `suppliers` 0 ligne ; `revoked` : SELECT `expense_categories` 0 ligne ; boutique étrangère 0 ligne ; admin et viewer actifs ≥ 1 ligne ; admin actif sur `expense_categories` ≥ 1 ligne.

Les 5 politiques de propriété sont restées **inchangées** (comparaison exacte avec la capture).

## 10. Verdict

**PASS — P8.3 clôturé.** Restent ouverts : les trois routes P8.2 (NOT COVERED au runtime) et l'arbitrage métier sur la révocation d'un propriétaire.
