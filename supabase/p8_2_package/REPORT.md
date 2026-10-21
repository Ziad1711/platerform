# P8.2 — Écritures non autorisées du module Dépenses

**Projet :** `jisra-test` / `goqedvcdmgtejtyrawsp` — **Date :** 21/10/2026.
**Statut :** migration appliquée et validée. Trois routes API au statut **NOT COVERED** au runtime.

## 1. Défauts corrigés

| # | Défaut constaté avant migration | Preuve |
|---|---|---|
| D-1 | `expense_recurring_templates` : INSERT/UPDATE/DELETE ouverts à **tout membre**, y compris `viewer` et membre `revoked` | Politiques installées : `store_id IN (SELECT store_id FROM store_members WHERE user_id = auth.uid())` — ni `status`, ni `role` |
| D-2 | `expenses` : écritures limitées à `('owner','admin','staff')` ; rôle `staff` inexistant, `accountant` exclu malgré `expenses.manage` | Politiques installées |
| D-3 | Routes d'intégration contrôlant l'appartenance seule | `verifyStoreAccess` / `getAccessibleStoreIds` sans permission d'action |

`staff` : 0 ligne sur TEST (retrait sans effet). `accountant` : décision métier = INSERT/UPDATE/DELETE autorisés.

## 2. Correctif

`supabase/migrations/20261022093000_p82_expense_write_permissions.sql`

- helper `public.can_manage_store_expenses(uuid)` — `owner`, `admin`, `accountant`, appartenance **active** ; `SECURITY DEFINER`, `search_path=public` ; ACL `authenticated` + `service_role` (PUBLIC et anon révoqués) ;
- 6 politiques d'écriture (3 modèles récurrents, 3 dépenses) réécrites avec ce helper ; **UPDATE** doté d'un `with check` (absent auparavant) ;
- **SELECT inchangée** sur les deux tables : `viewer` conserve la lecture ;
- garde-fou d'application : échec si une politique d'écriture ne cite pas le helper.

Routes : `delivery/tracking/sync` (`delivery.manage` **ou** `integrations.manage`), `rapid-delivery/sync` et `digylog/disconnect` (`integrations.manage`), cette dernière recevant en plus `assertTrustedOrigin`. Gardes placées **avant** tout client admin et tout effet de bord.

UI : `expenses/page.tsx` masque création, modal et bascule auto sans `expenses.manage` (badge de lecture conservé).

## 3. Vérifications

| Contrôle | Résultat |
|---|---|
| Politiques d'écriture gouvernées | **6/6** |
| `tsc --noEmit` | PASS |
| `next build` | PASS |
| Historique des migrations | `max_version = 20261022093000`, ligne présente |

### Tests dynamiques (JWT réels, REST direct) — 15/15 PASS

`S1` viewer INSERT modèle → 403 · `S2` owner INSERT modèle → 201 · `S3` viewer SELECT modèles → lignes visibles ·
`S4` viewer UPDATE → 0 ligne · `S5` viewer DELETE → 0 ligne · `S6` owner UPDATE → 1 ligne · `S7` owner DELETE → 1 ligne ·
`S8` owner INSERT dépense → 201 · `S9` viewer INSERT dépense → 403 · `S10` accountant INSERT → 201 ·
`S11` accountant UPDATE → 1 ligne · `S12` accountant DELETE → 1 ligne · `S13` admin INSERT → 201 ·
`S14` viewer SELECT dépenses → lignes visibles · `S15` membre `revoked` INSERT modèle → 403.

Harnais : `p82-dynamic.mjs`, hors dépôt. Registre par identifiants, nettoyage par IDs uniquement.
Résidus après campagne : `expenses 0 · templates 0 · categories 0 · members 0 · stores 0 · profiles 0 · users 0`.
État final identique au baseline : 6 utilisateurs, 13 boutiques, 16 appartenances, 54 dépenses, 0 modèle.

## 4. NOT COVERED

Les trois routes modifiées **n'ont pas été exercées au runtime** : aucun environnement TEST n'exécute ce code au moment de la campagne (pas de `.env.local` local, aucun déploiement Preview autorisé). Les gardes sont vérifiées statiquement, à une position antérieure à tout effet de bord, mais **aucune requête HTTP** ne les a validées. Ne pas les considérer comme corrigées avant un test sur un environnement portant ce code.

## 5. Hors périmètre

Lot 2 des intégrations (41 routes sous `verifyStoreAccess` sans permission) : **non autorisé** à cette étape.
`assistant/*`, `invoices/*`, `orders/*`, `team/confirmation-agents`, `settings/invoicing`, `facebook-ads/*`, `youcan/*` : à cadrer séparément.
Rôles, `role_permissions`, confidentialité coûts/profits : inchangés.
