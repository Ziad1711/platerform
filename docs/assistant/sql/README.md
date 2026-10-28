# Migrations proposées — assistant IA (Lot 1 renforcé)

**AUCUN FICHIER DE CE DOSSIER N'A ÉTÉ EXÉCUTÉ.**

Emplacement volontaire hors de `supabase/migrations/` : un `supabase db push` ne
peut pas les appliquer par inadvertance.

| Fichier | Objet | Impact code / activation |
|---|---|---|
| `01_assistant_privileges.proposed.sql` | Révoque `anon`/`PUBLIC`, retire `TRUNCATE`/`REFERENCES`/`TRIGGER`, retire UPDATE/DELETE sur messages et journal, policies rejouables limitées à `authenticated`. **Aucune RPC d'écriture.** | Aucun |
| `02_assistant_thread_scope_rls.proposed.sql` | Lecture de l'historique conditionnée à l'accès financier **courant** (`full`), quarantaine des conversations `store_id IS NULL`, création liée à une boutique autorisée, immuabilité propriétaire/boutique | Aucun (le code gère déjà `full` et `store_id`) |
| `03_assistant_idempotency_guard.proposed.sql` | Registre `assistant_requests` (états, bail, empreinte, `credits_reserved/charged`), RPC `begin`/`fail` pour le client, `complete` **réservée au backend** | `ASSISTANT_IDEMPOTENCY_REGISTRY=enabled` |
| `05_assistant_atomic_finalization.proposed.sql` | Finalisation transactionnelle `rpc_assistant_finalize_request` (messages + journal + débit + clôture du registre), **`service_role` uniquement** ; réservation souple de crédits | `ASSISTANT_FINALIZE_ATOMIC=enabled`, `ASSISTANT_CREDIT_RESERVATION=enabled` |
| `04_assistant_thread_store_review.sql` | Revue **lecture seule** des conversations sans boutique + options de remédiation (aucune activée) | Aucun |

## Ordre impératif

`01` → `02` → `03` → **déploiement du code backend** (`05` déjà en place) → `05`
→ activation progressive des drapeaux.

`01` et `02` ne nécessitent aucun changement de code : elles peuvent être
appliquées seules. `03` et `05` ne doivent être appliquées qu'avec le code du lot
correspondant déjà déployé.

## Garanties réelles par étape

| Étape | Idempotence | Atomicité finale | Historique protégé |
|---|---|---|---|
| Code seul (état actuel) | mono-instance (verrou mémoire) + rejeu par métadonnées | non | oui via API, non via PostgREST |
| + `01`/`02` | idem | idem | **oui** (RLS + quarantaine) |
| + `03` | **inter-instances** (bail + empreinte) | non | oui |
| + `05` | inter-instances | **oui** (une transaction) | oui |

Aucun de ces fichiers ne contenant de `create table` ou de fonction accordée en
écriture à `authenticated` n'est « fiable » au sens du modèle de menace : les
écritures fiables restent réservées au backend (`service_role`).

## Procédure

1. Revue par le propriétaire du projet ; aucune application automatique.
2. Sauvegarde de `chat_threads`, `chat_messages`, `ai_usage`, `ai_credit_wallets`.
3. Application **une migration à la fois**, avec contrôles après chaque étape.
4. Pour `03`/`05` : surveiller `assistant_requests` (états `in_progress` bloqués,
   baux expirés) et vérifier qu'aucun appel client ne cible les fonctions backend.
5. Ne jamais révoquer `rpc_dashboard_confirmation_performance` sans préserver les
   compteurs consommés par le Dashboard.


**AUCUN FICHIER DE CE DOSSIER N'A ÉTÉ EXÉCUTÉ.**

Ils sont volontairement placés hors de `supabase/migrations/` pour qu'un
`supabase db push` ne puisse pas les appliquer par inadvertance.

| Fichier | Objet | Impact code |
|---|---|---|
| `01_assistant_privileges.proposed.sql` | Révoque `anon`, retire `TRUNCATE`/`REFERENCES`/`TRIGGER`, restreint les policies à `authenticated` (section 1) ; écriture assistant via RPC `SECURITY DEFINER` (section 2) | Section 1 : aucun. Section 2 : `addMessage()` doit appeler la RPC pour `assistant`/`system` |
| `02_assistant_thread_scope_rls.proposed.sql` | RLS de lecture conditionnée à l'accès courant à la boutique | Aucun |
| `03_assistant_idempotency_guard.proposed.sql` | Index unique partiel `(thread_id, metadata->>'request_id')` | Traitement du code `23505` dans `POST /api/assistant/chat` |
| `04_assistant_thread_store_review.sql` | Revue des conversations sans boutique + options de remédiation (aucune activée) | Aucun (lecture seule) |

## Procédure recommandée

1. Revue de chaque fichier par le propriétaire du projet.
2. Vérification en environnement de validation autorisé (pas Supabase-test, pas Docker).
3. Sauvegarde des tables `chat_threads`, `chat_messages`, `ai_usage`.
4. Application **une migration à la fois**, avec contrôle des policies et des
   privilèges après chaque étape.
5. Pour `01` section 2 et `03` : livrer d'abord le changement de code associé.

Ordre : `01` (section 1) → `02` → `01` (section 2) avec code → `03` avec code → `04` (décision produit).
