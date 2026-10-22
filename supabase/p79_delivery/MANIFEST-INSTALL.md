> **Sélection Release finale :** `release/RELEASE.md`, `release/STATUS.md` et `release/release-manifest.json` priment sur les états historiques ci-dessous. Préparation locale seulement, activation Production NO-GO.

# JISRA — Manifeste d'installation KPI V5 : P7.1 → P7.9 + R-BL4 + P8.1 → P8.4

Branche `p79/kpi-v5-consolidated`, HEAD Phase 2 `34aa955`, base P7.8 `8e8cf85`,
chaîne P7.5 `20ee087` → P7.7 `3a78351` → P7.8 `8e8cf85` → P7.9 → P8.1–P8.4.

**Document de livraison. Aucune migration appliquée par ce fichier.**
Installation initialement **inactive** : chaque étape est un lot séparé,
autorisé distinctement. Aucun `db push`.

**Phase 2 (reproductibilité)** : ce manifeste est doublé d'un manifeste
machine `00_manifest.json` (ordre, dépendances, empreintes SHA-256 complètes)
contrôlé par `tools/verify-package.mjs`. Voir `PHASE2-EVIDENCE.md` pour les
preuves, les cibles examinées et le verdict.


## 1. Règles générales

1. Une étape = une transaction, `psql -v ON_ERROR_STOP=1 --single-transaction`.
2. Aucune étape ne s'exécute si la précédente n'est pas vérifiée.
3. `p7_1_package/` et `.work/` restent hors de `supabase/migrations/` :
   `db push` ne peut pas les appliquer.
4. Les migrations **B13 historiques** de `p7_1_package/30`–`91` ne sont
   **jamais rejouées** : versions Test divergentes.
5. Aucune définition financière n'est modifiée par ce paquet.
6. Le rollback ne réintroduit jamais une permission retirée.

## 2. Ordre d'installation

| Étape | Lot | Contenu | État après l'étape |
|---|---|---|---|
| 0 | Prérequis | tzdata Production clos, `pg_cron`/`pg_net` disponibles, environnement autorisé | — |
| 1 | Socle inactif | `10_install_objects.sql` : 6 tables, 23 fonctions, 1 vue, ACL `service_role` | worker et réveil **désactivés**, aucun trigger KPI |
| 1b | Vérification socle | `90_verify.sql` stage `install` | PASS attendu |
| 2 | Permissions legacy | `reference/20261018213537_dashboard_legacy_financial_permissions.sql` (R-BL4) | wrappers `full`/`commercial`, implémentations internes fermées |
| 3 | Configuration rollout | 6 fichiers `2026101918*.sql`, ordre strict | `kill_switch = true`, `requested_mode = legacy`, 0 cohorte |
| 4 | Corrections P7.7 | 6 fichiers `20261020100000` → `20261020105000` | qualité v2, CA par ville, graphique aligné |
| 5 | Corrections P7.8 | `20261020110000`, `20261020111000` | finalisation des métadonnées |
| 6 | Corrections P7.9 — **mode inactif** | `p79_delivery/10_install_p79_functions.sql` : 4 fonctions + ACL, **aucun producteur** | 0 trigger qualité ; fonctions inertes |
| 6b | Référence historique | les 4 migrations `2026102012*` (inchangées) : équivalent du mode actif en une passe | ce que Test a réellement reçu |
| 7 | Vérification mode inactif | `p79_delivery/90_verify_p79.sql` stage `inactive` | 13 contrôles PASS |
| 8 | **Activation du producteur** | `p79_delivery/20_activate_p79_quality_trigger.sql` (gated) | 1 trigger qualité |
| 9 | Vérification mode actif | `90_verify_p79.sql` stage `active` | 13 contrôles PASS |
| 10 | Correction P8.1 | `migrations/20261021120000_p81_invitation_inviter_authorization.sql` | inviter autorisé, RPC atomique |
| 11 | Correction P8.2 | `migrations/20261022093000_p82_expense_write_permissions.sql` | 6 politiques Dépenses gouvernées |
| 12 | Correction P8.3 M1 | `migrations/20261023100000_p83_revoked_member_product_functions.sql` | 3 fonctions produits filtrées |
| 13 | Correction P8.3 M2 | `migrations/20261023100100_p83_revoked_member_write_policies.sql` | 41 politiques d'écriture |
| 14 | Correction P8.3 M3 | `migrations/20261023100200_p83_revoked_member_read_policies.sql` | 21 politiques de lecture |
| 15 | Correction P8.4 D4 | `migrations/20261023110000_p84_delivery_order_column_guard.sql` | trigger `a_p84_delivery_order_columns` |
| 16 | Correction P8.4 S2 | `migrations/20261023110100_p84_stock_movement_write_policies.sql` | mouvements stock gouvernés |
| 17 | Correction P8.4 RPC | `migrations/20261023120000_p84_confirmation_rpc_isolation.sql` | isolation Confirmation |
| 18 | Vérification finale | `90_verify.sql` (install) + `90_verify_p79.sql` (inactive) + `93_preflight_capture.sql` | compteurs métier inchangés, 0 producteur |

### Dépendances réelles vérifiées

1. **R-BL4 avant P7.9** : `10_install_p79_functions.sql` appelle
   `dashboard_legacy_access` et `_rbl4_impl_dashboard_revenue_chart`.
2. **P7.9 inactif avant P8** : P8 ne touche aucun objet KPI, mais l'ordre
   chronologique des migrations est conservé (`2026102112…` → `2026102312…`).
3. **P8.3 M2 avant P8.4 S2** : S2 réécrit la politique `inventory_movements`
   que M2 aurait sinon laissée sans le filtre de statut le plus récent.
4. **P8.3 prérequiert le socle de politiques** : M2/M3 recréent 62 politiques
   capturées sur TEST par `drop if exists` + `create`. Sur une cible dont le
   socle ne les contient pas, elles seraient **créées**, pas corrigées : état
   non reproductible. Voir `PHASE2-EVIDENCE.md`, point ouvert O2.


## 3. Activation — lots séparés, jamais implicites

| Lot | Fichier | Effet | Prérequis |
|---|---|---|---|
| A | `p7_1_package/20_extensions_prerequisites.sql` | `pg_net` / `pg_cron`, réveil préparé | étape 1 PASS |
| B | `p7_1_package/30_activate_invalidations.sql` | 5 triggers producteurs | R-BL4 appliqué, worker désactivé |
| C | `p7_1_package/31_activate_wakeup.sql` | trigger de réveil (optionnel) | lot B |
| D | `p7_1_package/40_activate_worker.sql` | 2 jobs cron + `enabled = true` | lot B, budget approuvé |
| E | `41_backfill.sql` | backfill manuel, fenêtre ≤ 31 jours | lot D |
| F | `p79_delivery/20_activate_p79_quality_trigger.sql` | trigger qualité P7.9 | étape 6 appliquée |
| G | lecteur V5 | `KPI_READER_V5=1` + configuration `requested_mode` | shadow validé, autorisation distincte |

**Le trigger qualité P7.9 (F) est un producteur** : il peut rester absent après
l'étape 6 (la fonction est alors inerte). Son activation est une décision
d'exploitation, pas une conséquence de l'installation.

### Deux modes explicites

| Mode | Script | Trigger qualité | Vérification |
|---|---|---|---|
| Inactif | `10_install_p79_functions.sql` | absent | `stage = inactive` |
| Actif | `20_activate_p79_quality_trigger.sql` | présent | `stage = active` |

`10_install_p79_functions.sql` est **généré** depuis les quatre migrations
approuvées : chaque corps est copié à l'identique (vérifié par inclusion
stricte dans les sources), et aucune instruction `create trigger` n'y figure.
Les quatre migrations restent inchangées et deviennent la référence du mode
actif ; elles ne sont pas rejouées sur Test.

L'activation du lecteur (G) n'est **pas** incluse dans ce paquet : voir
`p7_1_package/50_reader_activation.md` et `P7.5-PRODUCTION-CONFIG.md`.

## 4. Signatures SHA-256 des fichiers du paquet

Empreintes tronquées à 16 caractères, **calculées sur contenu normalisé LF**
(CRLF → LF). Les valeurs complètes (64 caractères) sont dans `00_manifest.json`
et contrôlées par `tools/verify-package.mjs`. Les anciennes valeurs de ce
tableau, calculées sur un checkout CRLF, changeaient selon la plateforme :
c'était un défaut de reproductibilité, pas une modification SQL.

| Étape | Fichier | SHA-256 (LF) |
|---|---|---|
| 1 | `p7_1_package/10_install_objects.sql` | `489173d306ba68ae…` |
| 1b | `p7_1_package/90_verify.sql` | `54df156eb2a8c3d0…` |
| 2 | `p7_1_package/reference/20261018213537_dashboard_legacy_financial_permissions.sql` | `ed895623a9ca6450…` |
| 3 | `migrations/20261019183241_kpi_rollout_config.sql` | `06797b8554a12189…` |
| 3 | `migrations/20261019183328_kpi_rollout_reader.sql` | `262cd91379df83a0…` |
| 3 | `migrations/20261019183342_kpi_rollout_shadow.sql` | `d685ed85fbf1ec42…` |
| 3 | `migrations/20261019183349_kpi_rollout_event.sql` | `a25e5075f2e65987…` |
| 3 | `migrations/20261019183712_kpi_rollout_trigger_names.sql` | `2d1d0744b5613346…` |
| 3 | `migrations/20261019183800_kpi_rollout_function_names.sql` | `bfff049797b34640…` |
| 4 | `migrations/20261020100000_p77_c2_city_performance.sql` | `f6d74b6d3c229d27…` |
| 4 | `migrations/20261020101000_p77_c3_quality_version.sql` | `e3b744bd5e0531c9…` |
| 4 | `migrations/20261020102000_p77_c3_aggregate_order.sql` | `f90fb1a0ea973a1c…` |
| 4 | `migrations/20261020103000_p77_c3_aggregate_delivery.sql` | `af068196ad36740c…` |
| 4 | `migrations/20261020104000_p77_c3_direct_day.sql` | `3ad8f90bf03115e5…` |
| 4 | `migrations/20261020105000_p77_c1_revenue_chart_ads.sql` | `1d0dc55c777d9fff…` |
| 5 | `migrations/20261020110000_p78_finalize_store_state.sql` | `08e191984efaabc7…` |
| 5 | `migrations/20261020111000_p78_rebuild_day_finalizes.sql` | `07bf3e1e8a7d3578…` |
| 6 | `p79_delivery/10_install_p79_functions.sql` | `ecece1e37edb2b09…` |
| 6b | `migrations/20261020120000_p79_quality_invalidation.sql` | `ca35c40303fa67a6…` |
| 6b | `migrations/20261020120100_p79_quality_status_permissions.sql` | `49af7220ec0a2d9f…` |
| 6b | `migrations/20261020120200_p79_finalize_state_transitions.sql` | `3332dbf570af3bc7…` |
| 6b | `migrations/20261020120300_p79_multistore_chart_restriction.sql` | `03e8501ff9c0b7d4…` |
| 7 | `p79_delivery/90_verify_p79.sql` | `831ea26c18feed93…` |
| 8 | `migrations/20261021120000_p81_invitation_inviter_authorization.sql` | `3ca0b69337d6e798…` |
| 9 | `migrations/20261022093000_p82_expense_write_permissions.sql` | `610876098e4b2efd…` |
| 10 | `migrations/20261023100000_p83_revoked_member_product_functions.sql` | `8b8451641628de21…` |
| 11 | `migrations/20261023100100_p83_revoked_member_write_policies.sql` | `bb76752716adf599…` |
| 12 | `migrations/20261023100200_p83_revoked_member_read_policies.sql` | `1e15efa93f8efa8d…` |
| 13 | `migrations/20261023110000_p84_delivery_order_column_guard.sql` | `c4e8c84cc95236de…` |
| 14 | `migrations/20261023110100_p84_stock_movement_write_policies.sql` | `7b53a2a6e7d09af9…` |
| 15 | `migrations/20261023120000_p84_confirmation_rpc_isolation.sql` | `38f465b80700a7e9…` |
| A | `p7_1_package/20_extensions_prerequisites.sql` | `f0c5f2d92b0fb1b7…` |
| B | `p7_1_package/30_activate_invalidations.sql` | `818fb364a1dc1348…` |
| C | `p7_1_package/31_activate_wakeup.sql` | `f35763904906102a…` |
| D | `p7_1_package/40_activate_worker.sql` | `94cd5cf23de91251…` |
| E | `p7_1_package/41_backfill.sql` | `20fe6b62b84aaa50…` |
| F | `p79_delivery/20_activate_p79_quality_trigger.sql` | `792dbf0f3774c241…` |
| R | `p7_1_package/91_rollback.sql` | `a0ed321ec81f8ce2…` |
| R | `p79_delivery/91_rollback_p79.sql` | `270b675d4bbb9811…` |
| R | `p79_delivery/92_rollback_combined.sql` | `60f15ca719532400…` |
| P | `p79_delivery/93_preflight_capture.sql` | `8478641836d5148b…` |


### 4.1 Préconditions d'exécution

| Précondition | Contrôle | Bloquant |
|---|---|---|
| Socle métier | 6 tables + 2 fonctions + schéma `vault` | oui |
| Objets KPI absents | `93_preflight_capture.sql`, section `kpi` | oui |
| Aucun trigger/job KPI | sections `kpi.triggers` et `kpi.cron_jobs` | oui |
| Extensions | `pg_net`/`pg_cron` (lots A et D seulement) | non avant A/D |
| Historique migrations | `max_version < 20261021120000` | oui pour P8.1 |
| Politiques P8.3 | 41 + 21 politiques présentes dans le socle | oui pour P8.3 |
| Cible | jetable et restauration démontrée | oui |

### 4.2 Cible autorisée

- **Interdits** : Production (`attvfeoqgbxsnnsllatt`), TEST partagé
  (`goqedvcdmgtejtyrawsp`), B13 C0 isolé.
- Autorisée : cible créée pour la répétition, **ou** cible existante dont
  l'identité et la restauration sont prouvées avant écriture.
- État au 21/10/2026 : aucune cible jetable autorisée disponible ; l'exécution
  dynamique est donc **NOT COVERED**. Voir `PHASE2-EVIDENCE.md` §3.

### 4.3 Rollback

| Ordre | Script | Effet |
|---|---|---|
| 0 | hors SQL | `KPI_READER_V5` retiré, redéploiement |
| 1 | `92_rollback_combined.sql` | lecteur legacy, worker et réveil arrêtés, 5 producteurs P7.1 et trigger P7.9 retirés, P8 conservé et vérifié |
| 2 | `91_rollback.sql` | diagnostic P7.1 seul |
| 3 | `91_rollback_p79.sql` | diagnostic P7.9 seul (contrôle journal inadapté à une cible vide) |
| 4 | `p8_*/20_rollback*.sql` | diagnostic seulement, jamais urgence Production |
| 5 | reprise | lots B → F → D puis vérifications, reconstruction avant lecteur |

Le rollback combiné **ne supprime aucune table**, aucun journal, aucun agrégat,
aucun run, et **ne touche aucun objet P8** : il compare les empreintes de
fonctions et de politiques avant/après et échoue visiblement si elles changent.


## 5. Correspondance avec l'état Test

L'application P7.9 sur jisra-test a été faite en **un bundle unique**
(`20261020120000_p79_p0_closure_bundle`, version `20261020005512`) contenant les
quatre fichiers de l'étape 6. Les migrations P7.7/P7.8 n'apparaissent pas dans
l'historique Supabase de Test mais leurs objets sont installés et leurs
empreintes vérifiées.

### Traçabilité bundle ↔ sources

| Élément | Valeur |
|---|---|
| Bundle appliqué sur Test | `20261020005512` — `20261020120000_p79_p0_closure_bundle` |
| Sources correspondantes | les **quatre** fichiers `2026102012*.sql` de cette branche |
| Ordre dans le bundle | `120000` → `120100` → `120200` → `120300` |
| Mode du bundle | **actif** (installation + trigger qualité dans la même transaction) |
| Historique P7.7/P7.8 sur Test | absent de `supabase_migrations`, objets présents et empreintes conformes |

Le bundle est l'exécution des quatre sources concaténées : il ne remplace aucune
d'entre elles et ne doit jamais être rejoué.

Conclusion : **l'historique de Test n'est pas une preuve de reproductibilité**.
Seule une installation propre sur cible vide, suivie des vérifications des
étapes 1b, 7 et 9, peut qualifier la reproductibilité.

## 6. Contrôles attendus après installation

1. `90_verify.sql` stage `install` : 23 fonctions, 6 tables, 0 trigger KPI.
2. `p79_delivery/90_verify_p79.sql` : 4 objets P7.9, ACL conformes.
3. Compteurs : `trg_kpi_%` = 6 après P7.8, **7** après activation du trigger
   qualité (réveil désactivé compris).
4. Aucune ligne métier modifiée : `orders`, `order_items`, `ad_spend_daily`,
   `stores` intacts.
5. `kill_switch = true`, `requested_mode = legacy`, 0 cohorte, 0 événement.
6. P8 : `can_invite_to_store`, `can_manage_store_expenses`, trigger
   `a_p84_delivery_order_columns` et garde `v_actor_role is null` présents.
7. `tools/verify-package.mjs` : 220 contrôles statiques PASS (ordre,
   dépendances, empreintes LF, invariants d'inactivité, rollback).


## 7. Interdits

- `db push`, `supabase migration up` automatique, rejeu des migrations B13.
- Activation implicite du worker, du réveil ou du lecteur V5.
- Backfill hors fenêtre ou sur HIST-STORE sans autorisation dédiée.
- Modification d'une définition financière dans un lot de livraison.
- Rollback réintroduisant `rpc_dashboard_kpi_quality_status` sans contrôle
  d'accès, ou rouvrant `rpc_dashboard_revenue_chart(uuid[])` aux clients.
- Utiliser un rollback P8 comme bouton d'urgence : il restaure un état
  antérieur vulnérable (diagnostic/reproduction uniquement).
- Exécuter `92_rollback_combined.sql` sans `p79.combined_rollback_authorized=yes`.
- Considérer `91_rollback_p79.sql` comme preuve de non-perte : son contrôle
  `invalidation_journal_preserved` attend `count(*) > 0` et rend FAIL sur une
  cible sans données. `92` compare les compteurs avant/après.
