# Harnais B13 — baseline appariée (isolé uniquement)

But : mesurer le **coût marginal des producteurs KPI** sur la même cible, avec
les mêmes données et les mêmes triggers métier, sans jamais toucher à un
environnement partagé.

## Interdits

- exécution sur **jisra-test partagé** ou sur **Production** ;
- désactivation de triggers hors environnement isolé autorisé ;
- `setval`, `TRUNCATE`, arrêt global du worker.

Le harnais refuse de démarrer si `p79.bench_env <> 'isolated'` ou si la base
contient plus de 20 boutiques.

## Variantes

| Variante | Producteurs KPI | Mesure |
|---|---|---|
| **A** | désactivés (5 triggers) | coût métier seul |
| **C** | activés (état P7.9) | coût complet |

Les triggers **métier** (`recalc_order_financials`, `sync_order_total`,
allocation publicitaire, automatisation dépenses) restent actifs dans les deux
variantes : ils dominent historiquement le coût et ne doivent pas être modifiés.

## Campagne

```powershell
# environnement isolé, service PostgreSQL local déjà configuré
.\run_bench.ps1 -Service jisra-bench -Iterations 100 -ImportBatch 200 -ImportRounds 10 -Rounds 3
```

- une instruction par itération ⇒ une transaction par itération, donc aucune
  déduplication inter-itérations ;
- alternance AB/BA à chaque tour ;
- un tour d'échauffement jeté est recommandé avant de retenir les mesures ;
- le script restaure les producteurs et supprime les fixtures de benchmark.

## Mesures produites

Médiane et p95 par section (`Create`, `Rounding`, `Subtotal`, `Unrelated`,
`Import`), surcoût relatif de C par rapport à A, nombre d'échantillons.

Seuils proposés : voir `thresholds.json` (médiane ≤ 15 %, p95 ≤ 25 %,
verrou métier < 50 ms, drainage < 30 s, 0 deadlock).

## Ce que le harnais ne couvre pas

1. **Attribution par trigger** : seule une instrumentation `EXPLAIN (ANALYZE)`
   par scénario le permet ; elle est à ajouter si un dépassement doit être
   expliqué.
2. **Verrous** : le harnais ne mesure pas les attentes individuelles. Un relevé
   `pg_locks`/`pg_stat_activity` en parallèle est nécessaire, sinon le critère
   reste **NOT COVERED**.
3. **Publications concurrentes du worker** : impossible, le worker est
   single-flight (verrou consultatif global).
4. **Transfert vers Production** : PostgreSQL 17.6 ARM64 en Production contre
   17.11 x86_64 en Test ; les chiffres ne sont pas transposables sans mesure
   sur la cible réelle.

## Verdict

- **PASS** : tous les budgets respectés, aucun deadlock, backlog drainé.
- **FAIL** : budget dépassé, deadlock, ou écart financier inexpliqué.
- **NOT COVERED** : échantillon insuffisant, mesure de verrou absente, scénario
  non exécuté.

Une dérogation documentée doit préciser l'écart relatif **et absolu**, le volume
maximal, les seuils d'arrêt, la durée de validité et la surveillance.
