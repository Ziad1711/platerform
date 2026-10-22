# Compatibilité timezone KPI V5 sans mise à jour serveur

## Conclusion : POSSIBLE, non exécuté

Une couche SQL locale reproduit exactement la règle IANA 2026c pour
`Africa/Casablanca`, sans toucher à tzdata ni à la Production. Elle reste
**non appliquée** : elle exige une fenêtre d'écriture B13 pour être qualifiée,
interdite dans cette mission, et un nouveau commit.

Avantage décisif : la Production n'a **aucun objet KPI** (0 table, 0 fonction).
La correction sera donc active **avant** la première agrégation : aucune donnée
KPI à recalculer, aucune journée historique déplacée après coup.

## Conversions réellement utilisées

Le frontend est déjà indépendant d'ICU : `lib/dashboard/business-time.ts` épingle
les transitions 2018→2026e, dont `2026-09-20T01:00Z`. Seul le SQL dépend du
tzdata serveur.

| Fonction | Sites | Sens |
|---|---|---|
| `dashboard_kpi_business_date` | 1 | instant → date métier |
| `dashboard_kpi_invalidate_insert_stmt` | 5 | instant → date métier |
| `dashboard_kpi_invalidate_trg` (+ qualité P7.9) | 12 | instant → date métier |
| `dashboard_kpi_direct_day` (`20261020104000`) | 2 | borne de journée |
| `dashboard_kpi_rebuild_day` (`20261020111000`) | 2 | borne de journée |
| `rpc_dashboard_kpi_reader` | 1 | `partial` (jour courant) |
| `dashboard_kpi_aggregate_order/_delivery` | 0 | reçoivent des **instants** |

Les agrégats reçoivent `p_start`/`p_end` déjà calculés : ils n'ont pas de
conversion propre. C'est ce qui rend la correction bornée à 6 fonctions + 1 RPC.

## Deux seuils distincts, à ne pas confondre

1. **Instant → heure locale** : seuil `timestamptz '2026-09-20 01:00:00+00'`.
   Avant : règle native ; à partir de : `+00`.
2. **Heure murale → instant** (bornes de journée) : seuil
   `timestamp '2026-09-20 02:00'`, **pas** `00:00`. Sinon la journée du 20/09
   serait décalée d'une heure : sa borne de début est encore en `+01`.

Extrait testé (lecture seule, B13) :
```sql
-- instant -> date métier
case when p_ts >= timestamptz '2026-09-20 01:00:00+00'
     then (p_ts at time zone 'UTC')
     else (p_ts at time zone coalesce(p_tz,'Africa/Casablanca')) end

-- heure murale -> instant
case when p_local >= timestamp '2026-09-20 02:00'
     then (p_local at time zone 'UTC')
     else (p_local at time zone p_tz) end
```
Les deux branches doivent être neutres pour tout fuseau autre que Casablanca.
Fonctions candidates : `dashboard_kpi_local_ts(ts, tz)` et
`dashboard_kpi_local_instant(local_ts, tz)`, `IMMUTABLE` est **exclu**
(dépendance à un seuil constant mais sémantique de conversion) : `STABLE`,
`SECURITY INVOKER`, `search_path=public, pg_temp`.

## Tests réellement effectués (B13, lecture seule)

| Matrice | Résultat |
|---|---|
| Instant → local, 12 instants (2018, 2019, 2025, Ramadan 2026, juillet, `00:59:59Z`, `01:00:00Z`, `01:00:01Z`, 21/10, 2027) | **12/12 identiques** aux règles 2026c |
| Heure murale → instant, 9 journées (dont 19, 20 et 21/09/2026) | **9/9 identiques** |
| Effet de bord | aucune écriture ; requêtes `default_transaction_read_only=on` |

Ces tests valident l'**expression**, pas une installation : aucun `CREATE` exécuté.

## Ce que la modification implique

1. Nouvelle migration additive (fonctions de compatibilité) **avant** les lots
   P7.1, puis 6 `CREATE OR REPLACE` + 1 RPC réécrits.
2. `p7_1_package/90_verify.sql` contient des **empreintes md5 codées en dur** pour
   `dashboard_kpi_business_date`, `aggregate_*`, `direct_day`, `rebuild_day`,
   `invalidate_*` : elles devront être régénérées, sinon le lot 20 échoue à tort.
3. `90_verify_p79.sql` : idem pour le producteur qualité.
4. `00_manifest.json` / `release-manifest.json` : nouvelles empreintes ; nouveau
   commit (interdit ici).
5. Re-qualification : une fenêtre B13 (6 fonctions + triggers) pour rejouer
   exactitude, frontières de journée et `rollback/reprise`. Les preuves actuelles
   ne couvrent pas les corps modifiés.

## Risques résiduels

- **Double correction** si Supabase met à jour tzdata : sans effet, la branche
  `+00` reste correcte ; les instants antérieurs gardent la règle native.
- **Fuseaux non Casablanca** : comportement inchangé si les fonctions délèguent
  au moteur hors du cas ciblé ; à vérifier par un test dédié.
- **Ambiguïté locale 01:00–02:00 le 20/09** : hors bornes de journée (minuit),
  donc sans impact sur les agrégats ; à documenter comme limite connue.
- **Lecture seule testée, exécution non testée** : aucune installation réelle.

## Impact sur la livraison inactive

**Aucun.** Les 18 lots inactifs ne dépendent pas des conversions de journées et
peuvent être livrés tels quels. La compatibilité conditionne seulement
l'**activation** (`readiness_tzdata`, agrégats corrects à partir du 20/09/2026).
Ordre recommandé : livraison inactive d'abord, correction timezone dans une
fenêtre distincte, puis activation.
