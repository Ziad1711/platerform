# Harnais B13 (v2) — baseline appariée sur environnement isolé

But : mesurer le **coût marginal des producteurs KPI** sur une cible isolée, avec
des états initiaux identiques et sans jamais toucher un environnement partagé.

## Garde-fous (tous obligatoires)

1. `p79.bench_env = 'isolated'`
2. `p79.bench_confirm = 'SCHEDULED-ISOLATED-RUN'`
3. **aucune sentinelle jisra-test** dans `stores` (boutique pilote `d6bfa510…`
   et boutiques de test `aaaaaaaa-…0001..0003`, `1a1bdb7f…`, `57d00a07…`,
   `6872472a…`, `8d8c39d2…`) et **≤ 20 boutiques**

Production et jisra-test sont donc refusés par construction. La vérification
finale de la cible reste opérateur : contrôler l'URL du service avant de lancer.

## État initial identique entre variantes

`p79_bench_begin()` recrée boutique/produit/état puis supprime commandes,
partitions, événements et état de la seule boutique de benchmark. Il est appelé
**au début de chaque variante**, et la teardown à la fin : aucune accumulation
entre tours ni entre campagnes.

## Variantes

| Variante | Producteurs KPI |
|---|---|
| **A** | **tous désactivés** : `trg_kpi_mark_order_insert`, `trg_kpi_invalidate_orders`, `…_orders_insert`, `…_orders_quality`, `…_order_items`, `…_ad_spend` |
| **C** | tous activés (état P7.9) |

`p79_bench_producer_state()` expose l'état effectif, imprimé au démarrage de
chaque variante : la baseline A est vérifiée, pas supposée.

Les triggers **métier** (recalcul financier, synchronisation des totaux,
allocation publicitaire, automatisation des dépenses) restent actifs dans les
deux variantes.

## Scénarios mesurés

| Section | Nature |
|---|---|
| `create_unit` | 1 commande + 2 lignes par instruction (transaction propre) |
| `update_rounding` | arrondi seul (production d'invalidation P7.9) |
| `update_subtotal` | sous-total seul (production d'invalidation P7.9) |
| `update_unrelated` | colonne non pertinente (témoin : aucun travail KPI) |
| `import_bulk` | **import groupé** : deux `INSERT … SELECT` pour N commandes et 2N lignes |
| `import_loop` | import par boucle, conservé **uniquement** pour comparaison explicite |

## Instrumentation

- une instruction par itération ⇒ une transaction par itération ;
- sections délimitées (`SECTION:nom`) et comptage vérifié par le pilote ;
- médiane et p95 par section, surcoût relatif C/A ;
- `pg_stat_database.deadlocks` avant/après ;
- `drain_seconds` : temps de retour à zéro des événements de la boutique, **si**
  le worker est activé ; sinon `NOT_COVERED` (aucune activation implicite) ;
- attentes de verrou individuelles : **NON INSTRUMENTÉES** dans cette version —
  un relevé `pg_locks`/`pg_stat_activity` parallèle reste nécessaire, faute de
  quoi le critère « verrou < 50 ms » est `NOT COVERED`.

## Restauration

Le pilote enveloppe la campagne dans `try/finally` : tous les triggers
`trg_kpi_*` des tables métier sont réactivés et les fixtures supprimées, même si
une variante échoue. Le script SQL restaure également les producteurs en fin de
parcours nominal.

## Exécution

```powershell
.\run_bench.ps1 -Service jisra-bench -Iterations 100 -ImportBatch 200 -ImportRounds 10 -Rounds 3
```

Un tour d'échauffement jeté est recommandé. Le pilote écrit un JSON horodaté et
sort en code 2 si un budget est dépassé.

## Mesure du drainage réel

`p79_bench_drain()` (appel direct) ne mesure qu'un drainage synchrone.
Le drainage **après COMMIT** se mesure séparément avec `drain_after_commit.sql` :
injection committée, puis attente **passive** du cron (aucun appel à
`dashboard_kpi_worker_run`), avec `pending` et `elapsed_s` en sortie.
Si le worker de la cible est désactivé, la mesure est refusée — pas de
`NOT_COVERED` silencieux.

## Ce que ce harnais ne prouve pas

1. **Aucun benchmark exécuté ici** : aucune donnée de cette version ne qualifie
   B13. Le verdict historique reste **FAIL** jusqu'à mesure sur isolé.
2. Attribution par trigger : nécessite `EXPLAIN (ANALYZE)` par scénario.
3. Publications concurrentes du worker : impossibles, worker single-flight.
4. Transfert Production : PostgreSQL 17.6 ARM64 ≠ 17.11 x86_64.

## Verdict

`PASS_UNDER_BUDGETS`, `FAIL` ou `NOT_COVERED` selon `thresholds.json`. Une
dérogation doit préciser écart relatif **et absolu**, volume, seuils d'arrêt,
durée et surveillance ; elle ne transforme pas un FAIL en PASS.
