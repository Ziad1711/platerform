# B13 — protocole de mesure serveur

Objectif : mesurer le **coût des producteurs KPI** sans que la latence client
(Windows -> Supabase Sweden) ne domine le résultat.

## Pourquoi le protocole précédent est invalidé

L'échauffement `b13-20261020-185228.json` montre `update_unrelated` (colonne
`customer_name` seule, aucun trigger KPI ne peut s'y déclencher) à **+132,8 %**
de médiane. Une opération sans travail KPI ne peut pas doubler de coût : la
différence A/C mesurée était du bruit réseau (aller-retour pooler ~75-85 ms
contre un coût serveur réel de l'ordre de 0,1-1 ms).

## Principe retenu

Chronométrage **dans la session serveur** :

```sql
t0 := clock_timestamp();
<operation>
t1 := clock_timestamp();
```

- exclut la latence client et l'aller-retour pooler ;
- inclut les attentes de verrou, les I/O, le coût des triggers métier et KPI ;
- **n'inclut pas** le COMMIT : les scénarios restent dans une transaction.

## Limites assumées

| Méthode | Apport | Limite |
|---|---|---|
| `clock_timestamp()` serveur (retenue) | coût réel par opération, réseau exclu | pas d'attribution par trigger ; pas de COMMIT |
| `EXPLAIN (ANALYZE, BUFFERS)` | plan, buffers, `Execution Time` | **ré-exécute** l'opération ; pas de découpage par trigger ; à réserver aux updates unitaires sous `ROLLBACK` |
| `pg_stat_statements` | agrégats normalisés, cache | nécessite un reset pour isoler une fenêtre (interdit) ; mélange sessions |

`EXPLAIN (ANALYZE)` modifie réellement les données : il ne s'utilise **que**
dans une transaction terminée par `ROLLBACK`, ou sur une copie de table.

## Scénarios conservés

`create_unit`, `update_rounding`, `update_subtotal`, `update_unrelated`,
`import_bulk`, `import_loop` — volumes officiels inchangés.

## Comparaison A/C

1. `p79_bench_begin()` : état identique, triggers conformes à la variante ;
2. mesure serveur de `n` itérations ;
3. comptage des invalidations produites ;
4. `p79_bench_teardown()` puis restauration exacte des triggers ;
5. répétition des variantes en alternance jusqu'à **au moins 5 répétitions**
   par section et par variante, puis médiane/p95 sur les échantillons poolés.

## Seuils (inchangés)

médiane <= +15 %, p95 <= +25 %, attente de verrou < 50 ms, zéro deadlock
supplémentaire. En dessous de 5 répétitions, le résultat reste **NOT COVERED**.
