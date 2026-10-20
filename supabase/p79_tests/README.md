# P7.9 — Fermeture locale des risques P0

Aucune migration de ce lot n'est appliquée. Aucun test de ce dossier n'a été
exécuté sur une base : le lot est **préparé**, pas validé.

## Fichiers

| Fichier | Statut | Exécution |
|---|---|---|
| `finalization_transitions.sql` | matrice déterministe, lecture seule | après autorisation, jisra-test |
| `quality_permissions_matrix.sql` | matrice de décision, lecture seule | après autorisation, jisra-test |
| `business_cases.sql` | fixtures + assertions, transactions annulées | après autorisation, **jisra-test uniquement** |

## 1. Invalidation des composantes qualité (P0-1)

Migration : `20261020120000_p79_quality_invalidation.sql`.

Couvert par `business_cases.sql`, **bloc A** (transaction séparée, annulée) :

| Cas | Attendu |
|---|---|
| `rounding_adjustment` modifié seul | une invalidation `orders:UPDATE:quality:*` apparaît |
| colonne hors périmètre modifiée | aucune invalidation qualité |
| aucune des deux valeurs ne change | aucune invalidation |

Bloc A renvoie `NOT COVERED` si la boutique ne contient pas deux commandes sur
deux journées distinctes. `NOT COVERED` n'est jamais converti en PASS.

## 2. Permissions de l'état qualité (P0-2)

Migration : `20261020120100_p79_quality_status_permissions.sql`.

`quality_permissions_matrix.sql` vérifie la classification (10/10 attendu).
Le comportement réel de la RPC se vérifie ensuite, avec un JWT par rôle :

```sql
-- pour chaque rôle : owner, admin, accountant, viewer, marketer, staff,
--   membre inactif, utilisateur étranger
select public.rpc_dashboard_kpi_quality_status(
         array['<store_id>']::uuid[], date '2026-09-01', date '2026-10-01');
```

| Rôle | Attendu |
|---|---|
| owner / admin / accountant | `access_level = full`, `financial_diagnostics_visible = true`, six clés non nulles |
| viewer / marketer | `access_level = commercial`, `mismatch_orders` et `data_issues_orders` à `null` |
| staff / inactif / étranger | exception `DASHBOARD_NO_ACCESS` |
| sélection mixte (une boutique full + une sans droit) | exception `DASHBOARD_NO_ACCESS` |
| `p_from >= p_to` | exception `KPI_QUALITY_BAD_RANGE` |
| tableau vide ou `null` | exception `KPI_QUALITY_BAD_STORES` |

## 3. Transitions de finalisation (P0-3)

Migration : `20261020120200_p79_finalize_state_transitions.sql`.
Matrice : `finalization_transitions.sql` (13/13 attendu).

Points explicitement couverts : `paused` et `error` préservés ; `done` refusé
tant qu'une invalidation attend hors plage ; `no_partitions` remet
`computed_days` à 0 et rétrograde `done` vers `idle`.

Reste **NON COUVERT** par la matrice, à qualifier en réel :

| Cas | Raison |
|---|---|
| `no_state` | retour anticipé, aucune écriture ; qualifié par lecture du code seulement |
| erreur avant / après acquittement | dépend de la transaction de `rebuild_day`, non simulable sans écriture |
| publications concurrentes sur deux jours | garanti par l'ordre des verrous ; à mesurer en réel |
| états mixtes d'anciennes et nouvelles versions | modélisé, pas observé sur données réelles |

## 4. Surcharge multiboutiques du graphique (P0-4)

Migration : `20261020120300_p79_multistore_chart_restriction.sql`.

Contrôles après application (jisra-test) :

1. `has_function_privilege('authenticated', 'public.rpc_dashboard_revenue_chart(uuid[],timestamptz,timestamptz,text,timestamptz,timestamptz)', 'execute')` → `false` ;
2. même contrôle pour `anon` → `false` ; pour `service_role` → `true` ;
3. appel avec un JWT `authenticated` → `KPI_MULTISTORE_SURCHARGE_DISABLED` ;
4. `/dashboard` en mode « tous les magasins » : le graphique reste alimenté
   (boucle boutique unique), aucun appel `uuid[]` dans le réseau ;
5. non-régression : `components/dashboard/revenue-chart.tsx` et
   `profit-chart.tsx` fonctionnent sans modification.

La surcharge n'est **pas corrigée** : la consolidation par boutique, puis par
devise et niveau d'accès, reste un chantier distinct.

## 5. Jeu métier (bloc B de `business_cases.sql`)

Couverture préparée :

| Groupe | Cas |
|---|---|
| Revenus | livrée multi-lignes, livrée sans ligne, annulée, retour avec lignes |
| Achats | coût automatique, coût manuel différent des lignes, coût nul, valeurs nulles |
| Publicité | jour suivi positif, ligne à zéro, `spend_converted` nul, jour non suivi avec allocations livrée + non livrée, publicité sans commande |

Attention à l'ordre des fixtures : `trg_allocate_ads_on_ad_spend` remet à 0
toute allocation des commandes non `source = 'ads'` du jour dès qu'une dépense
est enregistrée. Les dépenses du jeu sont donc insérées **avant** les commandes,
et la devise de dépense est celle de la boutique (taux 1).
| Réconciliation | remise + livraison client + arrondi, anomalie réelle, plusieurs anomalies sur une commande comptée une seule fois |
| Temporalité | commande J1 / livraison J3, livraison sans date, borne de fin exacte, frontière Casablanca |

**NON COUVERT** (nécessite des fixtures supplémentaires et un JWT, hors de ce
dossier) : dimensions ville et agent, isolation entre deux boutiques, sélection
mixte de droits, devise différente. Protocole à préparer avant toute extension
de cohorte.

## 6. Conditions d'application sur jisra-test

1. autorisation explicite séparée ;
2. ordre : `...120000`, `...120100`, puis `...120200` et `...120300`
   (aucune dépendance croisée) ;
3. vérifier avant/après : nombre de triggers `trg_kpi_%` (5 → 6), ACL des deux
   fonctions du graphique, `pg_get_functiondef` des deux fonctions réécrites ;
4. exécuter les trois tests du dossier et consigner PASS/FAIL ;
5. boutiques hors cohorte : relever `to_jsonb(dashboard_kpi_store_state)`
   avant/après et vérifier qu'aucune ne change.

## 7. Rollback

| Migration | Rollback |
|---|---|
| `...120000` | `drop trigger if exists trg_kpi_invalidate_orders_quality on public.orders; drop function if exists public.dashboard_kpi_invalidate_orders_quality_trg();` |
| `...120100` | réappliquer `20261020101000_p77_c3_quality_version.sql` |
| `...120200` | réappliquer `20261020110000_p78_finalize_store_state.sql` |
| `...120300` | réappliquer le wrapper de `20261018213537_dashboard_legacy_financial_permissions.sql` puis `grant execute ... to authenticated` |

Aucun rollback ne décrémente une révision ni n'efface un acquittement.
