# Audit transactionnel — PostgreSQL distant jetable

Paquet **prêt à exécuter**, mais **jamais exécuté** : aucun projet, aucune base,
aucun rôle distant créé ; aucun SQL d'écriture lancé ; aucun push.

| Fichier | Rôle |
|---|---|
| [`PROTOCOL.md`](./PROTOCOL.md) | protocole : prévol, séquence, PASS/FAIL, nettoyage, autorisations |
| [`DEPENDENCIES.md`](./DEPENDENCIES.md) | DDL exact requis, dépendances, source du schéma, commande d'export (non exécutée) |
| `sql/00_preflight.sql` | garde d'identité, TLS, version, rôles, base vide |
| `sql/05_auth_shim.sql` | rôles émulés (`anon`/`authenticated`/`service_role`) + `auth.uid()` |
| `sql/10_bootstrap_audit.sql` | harnais `audit` : résultats, assertions, capture SQLSTATE, injection d'échec tardif |
| `sql/20_verify_schema_ready.sql` | vérifie les objets requis et relève les FK réelles |
| `sql/30_fixtures.sql` | données 100 % synthétiques (5 profils, 2 boutiques, 2 plans) |
| `sql/90_assertions.sql` | invariants, réconciliation, verdict `GO/NO-GO` |
| `sql/99_cleanup.sql` | retrait fixtures + harnais (ne détruit pas la base) |
| `scenarios/sequential.sql` | R1, R3, R4, R7, R8, R9, R10, R11, S1, **R13**, R14 |
| `scenarios/concurrent_a.sql` / `_b.sql` | R2, R6, R12 (barrières + preuve de contention) |
| `scenarios/lease_a.sql` / `_b.sql` | R5 : bail expirant pendant l'attente d'un verrou |
| `run/run_audit.sh` | orchestrateur (logs + `results.csv`) |
| `run/env.example` | variables attendues (placeholders uniquement) |

## Ordre imposé

```
00 prévol → 05 rôles/auth → 10 harnais → 20 schéma → 30 fixtures
→ sequential → concurrent A+B → lease A+B → 90 assertions → archivage → 99 cleanup
```

## Garanties techniques apportées par ce paquet

- **GRANT/REVOKE transactionnels** : `02` a été corrigé (les privilèges étaient
  hors transaction) ; un test statique (`S13`) empêche la régression.
- **Orchestration A/B déterministe** : barrières `pg_advisory_lock` posées par A,
  preuve de contention par `lock_timeout` ⇒ SQLSTATE `55P03` (jamais une simple
  mesure de temps).
- **Capture SQLSTATE** systématique (`audit.expect_error`), aucune erreur avalée.
- **Rollback après débit réellement prouvé** (R13) : trigger `AFTER UPDATE` sur
  `ai_credit_wallets`, donc erreur **postérieure** à l'écriture du débit.
- **Zéro donnée métier** : fixtures synthétiques, prévol refusant une base non vide.

## Limites déclarées

`auth.uid()` est un shim ; PostgREST et le service Auth ne sont pas exercés. Un
`GO` éventuel ne vaudra que pour le périmètre SQL/RLS/transactions, et seulement
après exécution réelle.
