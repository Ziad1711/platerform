# Livraison inactive Production — procédure exécutable (NON EXÉCUTÉE)

Source unique : commit **`9dc13e11fe5894c9dcfdbc9aac8a566fcc726fd9`**.
18 lots, 28 fichiers, **0 écart d'empreinte** avec `release-manifest.json`.
Aucune commande de ce document n'a été exécutée. Aucune activation V5.
État visé : installation **inerte** — aucun producteur, aucun job, worker et
réveil `false`, `kill_switch=true`, `requested_mode=legacy`, 0 cohorte,
`KPI_READER_V5` à 0 ou absent.

## 0. Préconditions bloquantes

1. Autorisation écrite distincte : cible Production, opérateur, fenêtre, dérogation
   performance si applicable.
2. Préflight P8 : 62/62 couples nom+table conformes (fait le 22/10/2026).
3. **Timezone** : la Production renvoie UTC+1 après le 20/09/2026 (tzdata < 2026c).
   `readiness_tzdata` ne pourra pas être attesté. Décision requise **avant
   activation**, pas avant l'installation inactive : les deux sont indépendantes.
4. Sauvegarde/restauration de la cible démontrée, ou procédure de retour §4 acceptée.
5. Vérifier qu'aucun lot n'est déjà installé : `93_preflight_capture.sql` section
   `kpi` vide. Si `max(version) >= 20261021120000`, **ARRÊT** : ne jamais renommer
   une migration pour contourner.

```
URL=...                      # connexion Production, écriture autorisée pour cette fenêtre
PSQL="psql \"$URL\" -v ON_ERROR_STOP=1"
```
`ON_ERROR_STOP=1` sur **toutes** les commandes. Aucun `supabase db push`.

## 1. Ordre exact et barrières

| # | Lot | Fichiers | Barrière de sortie |
|---|---|---|---|
| 5 | CAPTURE_SOCLE (verify) | `p79_delivery/93_preflight_capture.sql` | `kpi` vide ; compteurs de référence enregistrés ; `prerequisites` vrais hors `pg_cron`/`pg_net` |
| 10 | P7.1_SOCLE (install) | `p7_1_package/10_install_objects.sql` | 6 tables, 23 fonctions, **0 trigger**, worker/réveil `false` |
| 20 | P7.1_VERIFY_INSTALL (verify) | `p7_1_package/90_verify.sql` stage `install` | toutes lignes PASS. À exécuter **ici**, avant R-BL4/P7.7 : les empreintes P7.1 ne sont plus valides après corrections |
| 30 | RBL4 (security) | `p7_1_package/reference/20261018213537_dashboard_legacy_financial_permissions.sql` | `dashboard_legacy_access` + `_rbl4_impl_*` présents ; wrappers owner/commercial ; surcharge `uuid[]` fermée aux clients |
| 40 | P7.4_ROLLOUT_CONFIG (install) | 6 fichiers `20261019183241` → `20261019183800` | `kill_switch=true`, `legacy`, 0 cohorte, 0 événement |
| 50 | P7.7_CORRECTIONS (install) | 6 fichiers `20261020100000` → `20261020105000` | `to_regprocedure` des fonctions cibles ; **ne pas** relancer `90_verify` par empreinte |
| 60 | P7.8_CORRECTIONS (install) | `20261020110000`, `20261020111000` | `dashboard_kpi_finalize_store_state` présent, transitions appliquées |
| 70 | P7.9_INACTIVE (install) | `p79_delivery/10_install_p79_functions.sql` | 4 objets P7.9 présents, **0 trigger** `trg_kpi_%` |
| 80 | P7.9_VERIFY_INACTIVE (verify) | `p79_delivery/90_verify_p79.sql` stage `inactive` | toutes lignes PASS |
| 90 | P8.1 (security) | `20261021120000` | `can_invite_to_store` présent |
| 91 | P8.2 (security) | `20261022093000` | `can_manage_store_expenses` + 6 politiques Dépenses |
| 92 | P8.3_M1 (security) | `20261023100000` | 3 fonctions produits filtrées |
| 93 | P8.3_M2 (security) | `20261023100100` | 41 politiques d'écriture réécrites (préflight 62/62 OK) |
| 94 | P8.3_M3 (security) | `20261023100200` | 21 politiques de lecture réécrites |
| 95 | P8.4_D4 (security) | `20261023110000` | trigger `a_p84_delivery_order_columns` présent |
| 96 | P8.4_S2 (security) | `20261023110100` | mouvements stock gouvernés ; M2 **déjà** appliqué |
| 97 | P8.4_RPC (security) | `20261023120000` | isolation Confirmation active |
| 100 | FINAL_VERIFY (verify) | `release/verify-inactive.sql` | **toutes lignes PASS** |

Un seul FAIL ⇒ arrêt immédiat, aucun lot suivant.

## 2. Commandes (une transaction par lot)

```bash
# 5 — capture (table temporaire : la transaction est obligatoire)
$PSQL --single-transaction -f supabase/p79_delivery/93_preflight_capture.sql \
  | tee evidence/00-capture-socle.txt

# 10 — socle inerte
$PSQL --single-transaction -f supabase/p7_1_package/10_install_objects.sql

# 20 — vérification initiale, avant toute correction
$PSQL -c "set p7.stage='install'" -f supabase/p7_1_package/90_verify.sql

# 30 — R-BL4
$PSQL --single-transaction -f supabase/p7_1_package/reference/20261018213537_dashboard_legacy_financial_permissions.sql

# 40 — configuration rollout, ordre strict
for f in 20261019183241 20261019183328 20261019183342 \
         20261019183349 20261019183712 20261019183800; do
  $PSQL --single-transaction -f "$(ls supabase/migrations/${f}*.sql)"
done

# 50 + 60 — corrections P7.7 et P7.8
for f in 20261020100000 20261020101000 20261020102000 \
         20261020103000 20261020104000 20261020105000 \
         20261020110000 20261020111000; do
  $PSQL --single-transaction -f "$(ls supabase/migrations/${f}*.sql)"
done

# 70 — P7.9 inactif (aucun producteur)
$PSQL --single-transaction -f supabase/p79_delivery/10_install_p79_functions.sql

# 80 — vérification P7.9 inactif
$PSQL -c "set p79.stage='inactive'" -f supabase/p79_delivery/90_verify_p79.sql

# 90 → 97 — P8, ordre strict, une transaction par fichier
for f in 20261021120000 20261022093000 20261023100000 20261023100100 \
         20261023100200 20261023110000 20261023110100 20261023120000; do
  $PSQL --single-transaction -f "$(ls supabase/migrations/${f}*.sql)"
done

# 100 — contrôle final obligatoire
$PSQL -f supabase/p79_delivery/release/verify-inactive.sql
```

- Ne jamais concaténer deux lots dans une transaction unique.
- `90_verify.sql` par empreinte s'exécute **uniquement au lot 20**. Après
  P7.7/P7.8/P7.9 les empreintes changent : contrôler par présence, pas par hash.
- `set p7.stage` / `set p79.stage` sont des réglages de session, pas des écritures.

## 3. Contrôle final (bloquant, lecture seule)

`verify-inactive.sql` : 0 producteur `trg_kpi_%`, 0 job `jisra_kpi%`,
worker et réveil `false`, `kill_switch=true`, `requested_mode='legacy'`,
0 cohorte et 0 événement de rollout. Côté application, hors SQL :
`KPI_READER_V5` à `0`/absent et `KPI_READER_V5_PRODUCTION_ACK` absent.
Toute ligne FAIL interdit la suite et l'activation.

## 4. Retour en cas d'échec

1. **Échec dans une transaction** : lot annulé intégralement. Corriger la cause,
   relancer **ce seul** lot ; aucune autre action.
2. **Échec après des lots commités** : arrêt. Ne supprimer ni table, ni journal,
   ni agrégat. Deux options seulement : correction en avant approuvée, ou
   `92_rollback_combined.sql` (script du paquet, garde
   `p79.combined_rollback_authorized='yes'`, qui vérifie compteurs et digests P8).
3. **Interdits** : `REINSTALL-P71-PRODUCERS.sql`, `REINSTALL-QUALITY-PRODUCER.sql`,
   `release/REINSTALL-QUALITY-RELEASE.sql`, toute capture C0 de B13 : artefacts de
   qualification, jamais des restaurations Production.
4. Après tout retour : refaire le lot 5 (capture) et les barrières, puis décider
   d'une nouvelle fenêtre.

## 5. Risques d'exécution identifiés

| Risque | Portée | Parade |
|---|---|---|
| `90_verify` par empreinte après P7.7+ | faux FAIL | exécuter uniquement au lot 20 |
| Collision de version migration | P8.1 refusée | arrêt, jamais de renommage |
| Politique P8.3 sur une autre table | création involontaire | préflight 62/62 fait ; revérifier si la cible change |
| `--single-transaction` sur un fichier avec `BEGIN` | erreur d'imbrication | vérifier les sources avant application |
| Absence de `pg_cron`/`pg_net` | sans effet ici | aucune extension pendant la livraison inactive |
| Timezone pré-2026c | activation impossible | demande Supabase §6 |

## 6. Blocages ouverts (hors livraison inactive)

- **Timezone Production** : version tzdata à obtenir de Supabase, puis mise à jour
  et nouveau contrôle de la matrice IANA 2026c. Sans cela : `readiness_tzdata`
  impossible, activation V5 interdite.
- **Performance** : `import_orders_600` médiane +15,27/+15,44 % (exception
  proposée, non signée) ; `update_item_price` p95 +50,51/+242 % (risque non
  accepté, attribution inconnue). Aucun correctif de trigger justifié.
- **Reprise après rollback** : garde `30_activate_invalidations` à 23 fonctions
  incompatible avec un socle final (24/25). Stratégie confirmée : reprise par
  définitions live vérifiées, garde non élargi.
- **Installation initiale complète** : NON COVERED ; cette procédure est la
  première occasion de la produire réellement.

