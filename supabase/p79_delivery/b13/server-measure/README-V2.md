# B13 — protocole serveur **v2** (corrections de représentativité)

La v1 (`server_measure.sql`) reste dans le dépôt comme **historique NON QUALIFIANT**.
Aucun résultat v1 ne doit être agrégé avec les résultats v2.

## Défauts corrigés

| # | Défaut v1 | Correction v2 |
|---|---|---|
| 1 | imports mesurés en `p_n` boucles de `p_n` commandes | **`:batches` lots de `:size` commandes** (10 × 200, 400 lignes/lot) |
| 2 | percentiles calculés en SQL, puis « médiane des p95 » | **échantillons bruts exportés** (`\copy … TO :samples_file`), percentiles calculés sur les observations |
| 3 | volumes non vérifiés | compteurs avant/après + `RAISE EXCEPTION P79_SRV_VOLUME_MISMATCH` |
| 4 | drapeau transactionnel de la commande de référence laissé à `1` | drapeau **effacé** juste après sa création |
| 5 | nombre d'invalidations approximatif | compteur **avant/après** par scénario |

## Limite non contournée : la transaction

La mesure reste **intra-transaction**. Conséquences assumées :

- le **coût du COMMIT n'est pas mesuré** ;
- le cache de fuseau, les drapeaux et la déduplication sont **chauds** ;
- un `ON CONFLICT DO NOTHING` répété mesure un chemin de conflit, pas une insertion neuve.

Ces effets sont **identiques en A et en C**, donc la comparaison relative reste valide, mais les valeurs absolues ne représentent pas 100 transactions indépendantes. Une mesure par transaction exigerait une session par opération : coût réseau réintroduit ou instrumentation serveur dédiée — compromis explicitement écarté pour ne pas refondre le harnais.

## Protocole d'exécution

1. `p79_bench_begin()` — état initial identique ;
2. création d'une commande de référence **hors fenêtre chronométrée**, drapeau effacé ;
3. purge des invalidations de setup ;
4. bascule des six triggers selon la variante ;
5. compteurs avant (commandes, articles, invalidations) ;
6. mesure + export CSV des durées brutes ;
7. compteurs après → **vérification stricte des volumes** ;
8. teardown + restauration des triggers.

## Agrégation

Les percentiles sont calculés sur les CSV bruts de toutes les répétitions d'une même variante et d'un même scénario. Aucune agrégation de p95 intermédiaires.

## Critères d'acceptation

- volumes exacts par scénario (échec bloquant sinon) ;
- ≥ 5 répétitions appariées A/C, ordre alterné ;
- mêmes conditions initiales ;
- médiane ≤ +15 %, p95 ≤ +25 % sur les observations brutes ;
- attentes de verrou : **NOT COVERED** si l'instrumentation reste un échantillonnage ;
- drainage cron : **NOT COVERED** (pas de `pg_cron`).
