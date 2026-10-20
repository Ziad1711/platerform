# B13 — Procédure reproductible sur la cible isolée

**Rien de cette procédure n'est exécuté.** Toutes les étapes distantes exigent
une autorisation séparée.

## Étape 0 — Préconditions

- nouveau projet Supabase dédié B13, région proche de la Production ;
- DDL local : `C:/Users/HP-EXE/Documents/JISRA-QA/P79-B13-export/public-schema.sql`
  (SHA-256 `27eb1b69…`) ;
- paquet de livraison de la branche `p79/kpi-v5-consolidated` ;
- `psql` 17 local + `pg_service.conf` dédié (aucun secret dans le dépôt).

## Étape 1 — Extensions et identité

```sql
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";
create extension if not exists pg_net;
create extension if not exists pg_stat_statements;
```

Créer **un** utilisateur `auth` synthétique (opérateur, interface Supabase) et
conserver son UUID pour le propriétaire de la boutique de benchmark.

## Étape 2 — Application du schéma

```bash
psql "service=b13-isolated" -v ON_ERROR_STOP=1 --single-transaction \
     -f public-schema.sql
```

Contrôles immédiats :

| Contrôle | Attendu |
|---|---|
| tables | 104 |
| fonctions | 184 |
| triggers | 69 |
| politiques RLS | 219 |
| lignes métier | 0 partout |
| `dashboard_kpi_wakeup_config` | 0 ligne |
| `trg_kpi_wakeup` | `tgenabled = 'D'` |
| jobs `cron.job` | 0 |

## Étape 3 — Paquet KPI en mode inactif

```bash
psql "service=b13-isolated" -v ON_ERROR_STOP=1 --single-transaction \
     -c "set p7.install_authorized='yes'" -f 10_install_objects.sql
psql "service=b13-isolated" -v ON_ERROR_STOP=1 -c "set p7.stage='install'" -f 90_verify.sql
```

Puis, dans l'ordre : R-BL4, configuration rollout OFF, P7.7, P7.8, puis
`p79_delivery/10_install_p79_functions.sql` (**aucun trigger**).

Vérification : `90_verify_p79.sql` avec `stage=inactive` → 13/13 PASS.

## Étape 4 — Activation contrôlée du producteur

```bash
psql "service=b13-isolated" -v ON_ERROR_STOP=1 --single-transaction \
     -c "set p79.activate_quality='yes'" -f 20_activate_p79_quality_trigger.sql
psql "service=b13-isolated" -v ON_ERROR_STOP=1 \
     -c "set p79.stage='active'" -f 90_verify_p79.sql
```

`trg_kpi_wakeup` reste **désactivé** ; `dashboard_kpi_wakeup_config` reste vide.

## Étape 5 — Campagne appariée

```powershell
$env:PGSERVICEFILE = "$env:APPDATA\postgresql\pg_service.conf"
$env:PGPASSFILE     = "$env:APPDATA\postgresql\pgpass.conf"
.\run_bench.ps1 -Service b13-isolated -Project <ref-b13> `
                -Iterations 100 -ImportBatch 200 -ImportRounds 10 -Rounds 3
```

Le pilote : capture `tgenabled`, vérifie `P79_GUARD_OK`, exécute A/C alternés,
calcule médiane/p95 et le delta de deadlocks, puis restaure **exactement** les
états capturés et supprime les fixtures.

## Étape 6 — Drainage après COMMIT

Worker de la cible activé uniquement pour cette phase :

```bash
psql "service=b13-isolated" \
  -c "set p79.bench_env='isolated'" -c "set p79.bench_confirm='SCHEDULED-ISOLATED-RUN'" \
  -c "set p79.bench_project='<ref-b13>'" -c "set p79.bench_allow='<ref-b13>'" \
  -v events=200 -f drain_after_commit.sql
```

Attendu : `pending_final = 0`, `claimed_by_cron > 0`, `elapsed_s` mesuré.
Aucun appel manuel à `dashboard_kpi_worker_run`.

## Étape 7 — Verrous (observation indépendante)

En parallèle de l'étape 5, lancer dans une seconde session :

```powershell
.\lock_observer.ps1 -Service b13-isolated -DurationSeconds 300
```

Sortie : nombre d'échantillons, attente maximale observée sur `Lock`, PID
bloqués. **Limite** : un échantillonnage à 100 ms peut manquer des attentes très
courtes ; le critère reste `PASS si max < 50 ms` mais la couverture est
partielle → à déclarer comme telle.

## Étape 8 — Teardown

1. `p79_bench_teardown()` (supprime boutique, produit, partitions, événements) ;
2. vérifier `stores = 0`, `orders = 0`, `dashboard_daily_metrics = 0` ;
3. restaurer `tgenabled` à l'état capturé ;
4. export des JSON de campagne + logs hors dépôt ;
5. suppression du projet sur autorisation distincte.

## GO / NO-GO pour créer la cible

**GO** si :
- audit de l'export PASS (aucun secret, aucun appel externe actif) ;
- extensions créables et `auth` synthétique disponible ;
- procédure ci-dessus acceptée ;
- budget et durée de vie du projet acceptés.

**NO-GO** si :
- le projet ne peut pas être isolé (facturation, accès) ;
- une extension requise est indisponible ;
- l'opérateur ne peut pas fournir l'utilisateur `auth` synthétique ;
- le teardown ne peut pas être garanti.

## Écarts assumés (à ne pas masquer dans le rapport final)

1. Le harnais mesure des **instructions SQL directes** ; l'application écrit via
   PostgREST (`INSERT` d'une ligne) et, pour les commandes publiques, via
   `rpc_ingest_public_order`. Le surcoût PostgREST n'est pas mesuré.
2. L'import groupé du harnais (2 `INSERT … SELECT`) est **plus efficace** qu'une
   boucle applicative : il sert à comparer A/C, pas à prédire le temps réel.
3. Les attentes de verrou restent partiellement couvertes.
