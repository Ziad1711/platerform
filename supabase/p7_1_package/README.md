# P7.1 — Mode d'emploi du paquet

**Ne rien appliquer en Production sans autorisation P7.2 explicite.**
**P7.0 (tzdata Production) doit être clos avant toute application.**

Le paquet est volontairement placé **hors de `supabase/migrations/`** :
`supabase db push` ne peut donc pas l'appliquer par accident.

## Fichiers

| Fichier | Rôle | État par défaut |
|---|---|---|
| `00_manifest.json` | empreintes, écarts, verdict | BLOCKED |
| `10_install_objects.sql` | tables, fonctions, vue, ACL | inerte |
| `20_extensions_prerequisites.sql` | pg_net / pg_cron | lot séparé |
| `30_activate_invalidations.sql` | 5 triggers | lot séparé |
| `31_activate_wakeup.sql` | trigger de réveil | optionnel |
| `40_activate_worker.sql` | worker + purge | lot séparé |
| `41_backfill.sql` | gabarit de backfill | manuel |
| `50_reader_activation.md` | activation frontend | non exécuté |
| `90_verify.sql` | contrôles | lecture + table temp |
| `91_rollback.sql` | retour arrière | niveau 1 sûr |
| `tools/` | génération et contrôles statiques | hors Production |

## Commandes exactes (environnement non-production uniquement)

`psql` doit exécuter le `SET` et le fichier dans **la même session** :

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -c "set p7.install_authorized='yes'" \
  --single-transaction -f 10_install_objects.sql
```

Vérification :

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -c "set p7.stage='install'" \
  -f 90_verify.sql
```

Activation des invalidations :

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -c "set p7.activate_invalidations='yes'" \
  --single-transaction -f 30_activate_invalidations.sql
```

R-BL4 (lot séparé, uniquement avant shadow ou rollback legacy sécurisé ;
non appliqué par `10`) :

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  --single-transaction \
  -f reference/20261018213537_dashboard_legacy_financial_permissions.sql
```

Extensions (uniquement après `10`) puis worker :

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -c "set p7.extensions_authorized='yes'" \
  --single-transaction -f 20_extensions_prerequisites.sql

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -c "set p7.activate_worker='yes'" \
  --single-transaction -f 40_activate_worker.sql
```

Backfill (une fenêtre à la fois, 31 jours maximum) :

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -c "set p7.backfill='yes'" \
  -c "set p7.backfill_store_id='<UUID>'" \
  -c "set p7.backfill_from='2026-09-01'" \
  -c "set p7.backfill_to='2026-09-07'" \
  --single-transaction -f 41_backfill.sql
```

Rollback niveau 1 :

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -c "set p7.rollback_authorized='yes'" \
  --single-transaction -f 91_rollback.sql
```

## Contrôles statiques

```bash
node tools/verify-static.mjs
```

Attendu : `{"checks":33,"passed":33,"failed":0,"verdict":"PASS"}`.

Régénération (hors Production) : `tools/build-acl.mjs`, `build-verify.mjs`,
`build-rollback.mjs`, `build-manifest.mjs`.

## Précautions

- Ne jamais exécuter `10_install_objects.sql` sur une base où les tables KPI
  existent : le garde-fou lève `P71_ALREADY_INSTALLED`.
- Ne jamais rejouer les migrations B13 historiques : versions divergentes.
- Ne pas supprimer `pg_cron` au rollback si d'autres jobs l'utilisent.
- Ne pas purger le journal avant rapprochement.
- Le mode `shadow` et le déblocage Production du lecteur ne sont pas dans ce
  paquet : voir `50_reader_activation.md`.
