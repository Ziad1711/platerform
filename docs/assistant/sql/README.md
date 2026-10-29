# Assistant IA — package SQL de finalisation transactionnelle

**AUCUN FICHIER DE CE DOSSIER N'A ÉTÉ EXÉCUTÉ.** Ils sont volontairement hors de
`supabase/migrations/` : un `supabase db push` ne peut pas les appliquer par
inadvertance.

👉 **Procédure unique, ordre, préconditions, rollback et critères PASS/FAIL :
[`RUNBOOK.md`](./RUNBOOK.md).** Ce README ne fait qu'indexer les fichiers.

## Fichiers actifs

| Fichier | Objet | Prérequis | Rejouable |
|---|---|---|---|
| `01_assistant_privileges.proposed.sql` | Moindre privilège : retrait `anon`/`PUBLIC`, `TRUNCATE`/`REFERENCES`/`TRIGGER`, écriture `ai_usage` et portefeuille côté serveur uniquement, messages client en `role = 'user'`, policies rejouables | backend `service_role` déjà déployé | oui |
| `02_assistant_thread_scope_rls.proposed.sql` | Helpers d'autorisation (`ai_assistant.use` **et** finances `full`, utilisateur explicite), RLS de l'historique, quarantaine `store_id IS NULL`, immuabilité propriétaire/boutique | `01` | oui |
| `03b_assistant_idempotency_registry_v2.proposed.sql` | Registre `assistant_requests` (bail, jeton, empreinte, `credits_reserved/consumed/charged`), `begin`/`bind`/`complete`/`fail`/`reserve`/`release`, ordre de verrouillage unique, détachement `SET NULL` à la suppression de boutique (aucune cascade sur les preuves) | `01`, `02` | oui |
| `05b_assistant_finalization_v2.proposed.sql` | `rpc_assistant_finalize_request` : messages + journal + débit (via la source de vérité du plan) + clôture du registre dans une transaction ; `service_role` uniquement | `01`, `02`, `03b` | oui |

## Fichiers historiques (ne pas appliquer)

| Fichier | Statut |
|---|---|
| `03_assistant_idempotency_guard.proposed.sql` | obsolète — remplacé par `03b` (aucune surcharge ne doit subsister) |
| `05_assistant_atomic_finalization.proposed.sql` | obsolète — remplacé par `05b` |
| `04_assistant_thread_store_review.sql` | revue **lecture seule** des conversations sans boutique |

## Validation

| Élément | État |
|---|---|
| `scripts/assistant-tx-contract.synthetic-tests.cjs` | exécuté — 36/36 PASS (contrats TS + invariants SQL statiques) |
| `scripts/assistant-analytics-p1.synthetic-tests.cjs` | exécuté — 41/41 PASS |
| `scripts/assistant-final-targeted-tests.cjs` | exécuté — 47/47 PASS (registre, invariants, verrou global, allowlist, suppression de boutique, détachement du registre) |
| `MANIFEST.sha256` | 4 fichiers SQL autorisés, empreintes vérifiées (`sha256sum -c`) |
| `../PILOT-PRIVATE-RUNBOOK.md` | pilote privé : sauvegardes, ordre, contrôles, fermeture, rollback (non exécuté) |
| `docs/assistant/sql/postgres-two-connection-tests.sql` | **remplacé** par `neon-audit/scenarios/` — conservé pour historique |
| `docs/assistant/sql/neon-audit/` | **paquet d'exécution réel** : prévol, harnais, fixtures, scénarios A/B, assertions, nettoyage ([README](./neon-audit/README.md)) |
| Validation transactionnelle réelle | **NON PRONONCÉE** — exécution à autoriser (voir `neon-audit/PROTOCOL.md §7`) |

Un audit statique n'est pas une preuve transactionnelle : voir `RUNBOOK.md`
§Risques nécessitant une validation PostgreSQL.
