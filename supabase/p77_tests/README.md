# P7.7 — Tests synthétiques C1/C2/C3

Ces fichiers sont **autonomes** : aucune dépendance aux agrégateurs, au lecteur V5,
aux fonctions corrigées ou à des données métier. Ils s'exécutent en `SELECT`
uniquement, sur `jisra-test`.

| Fichier | Contenu | Attendu |
|---|---|---|
| `c1_ads_contract.sql` | règle publicité suivie/allouée, additivité du profit, jour publicitaire seul | 2 lignes PASS |
| `c2_city_revenue.sql` | CA par ville = lignes livrées, statuts exclus, NULL, borne de fin exclusive | 7 lignes PASS |
| `c3_quality_reconciliation.sql` | sous-total, total reconstitué, remise, livraison client, arrondi, tolérance 0,01 | 10 lignes PASS |

## Exécution

```bash
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f c1_ads_contract.sql
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f c2_city_revenue.sql
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f c3_quality_reconciliation.sql
```

Sans `psql`, coller chaque fichier dans l'éditeur SQL du projet Test.
Aucune écriture n'est effectuée : tout est en CTE `values`.

## Résultats obtenus le 20/10/2026 (lecture seule, jisra-test)

| Fichier | Résultat |
|---|---|
| C1 | **2/2 PASS** (publicité 150,00 / 35,00 ; profit 660,00 / 127,00) |
| C2 | **7/7 PASS** (CA 330,00 ; A 100,00 ; B 200,00 ; NULL 30,00 ; borne exclue) |
| C3 | **10/10 PASS** |

## Tests après application des migrations (à exécuter sur Test, sur autorisation)

1. `rpc_dashboard_city_performance` : `total_revenue` des lignes livrées, somme des
   villes = CA des cartes, borne de fin exclusive, appartenance active.
2. `_rbl4_impl_dashboard_revenue_chart` (via le wrapper) : `totalProfit` et
   `totalAds` égaux aux cartes legacy ; points incluant une journée publicitaire
   sans commande.
3. `rpc_dashboard_kpi_quality_status` : `days_quality_v1 > 0` avant reconstruction,
   `mismatch_orders` cohérent avec les agrégats, puis `days_quality_v2` après
   recalcul ciblé.
4. Vérifier que les montants financiers (CA, achats, livraison, confirmation)
   restent identiques aux valeurs du rapport P7.6.
