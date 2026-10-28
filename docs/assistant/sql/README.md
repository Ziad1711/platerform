# Migrations proposées — assistant IA (Lot 1)

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
