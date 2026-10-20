# JISRA — Manifeste d'installation KPI V5 : P7.1 → P7.9

Branche `p79/kpi-v5-consolidated`, base `8e8cf85` (P7.8), chaîne
P7.5 `20ee087` → P7.7 `3a78351` → P7.8 `8e8cf85` → P7.9.

**Document de livraison. Aucune migration appliquée par ce fichier.**
Installation initialement **inactive** : chaque étape est un lot séparé,
autorisé distinctement. Aucun `db push`.

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

Empreintes tronquees a 16 caracteres ; les valeurs completes sont recalculees par le controle statique local.

| Étape | Fichier | Rôle | SHA-256 |
|---|---|---|---|
| 1 | `p7_1_package/10_install_objects.sql` | socle KPI inactif | `f5645526e9c1f480…` |
| 1b | `p7_1_package/90_verify.sql` | verification socle | `bba3210a6371f2f0…` |
| 2 | `p7_1_package/reference/20261018213537_dashboard_legacy_financial_permissions.sql` | R-BL4 | `b9e3c1a612b6cbeb…` |
| 3 | `migrations/20261019183241_kpi_rollout_config.sql` | rollout config | `5d077e8f7faa3b04…` |
| 3 | `migrations/20261019183328_kpi_rollout_reader.sql` | rollout reader | `793d074da175416b…` |
| 3 | `migrations/20261019183342_kpi_rollout_shadow.sql` | shadow check | `5de37ae9cdc42e59…` |
| 3 | `migrations/20261019183349_kpi_rollout_event.sql` | rollout event | `b6f614fc4734a992…` |
| 3 | `migrations/20261019183712_kpi_rollout_trigger_names.sql` | trigger names | `b7140d579bd648ad…` |
| 3 | `migrations/20261019183800_kpi_rollout_function_names.sql` | function names | `9f18074bceb89ea6…` |
| 4 | `migrations/20261020100000_p77_c2_city_performance.sql` | P7.7 villes | `17f8e8064c21f788…` |
| 4 | `migrations/20261020101000_p77_c3_quality_version.sql` | P7.7 qualite | `2f618da08549e8d4…` |
| 4 | `migrations/20261020102000_p77_c3_aggregate_order.sql` | P7.7 agg order | `80ce1ce732a060ba…` |
| 4 | `migrations/20261020103000_p77_c3_aggregate_delivery.sql` | P7.7 agg delivery | `164ce605cb6ef05f…` |
| 4 | `migrations/20261020104000_p77_c3_direct_day.sql` | P7.7 direct day | `b54ccf095febb0f0…` |
| 4 | `migrations/20261020105000_p77_c1_revenue_chart_ads.sql` | P7.7 graphique | `9fd23594715b5602…` |
| 5 | `migrations/20261020110000_p78_finalize_store_state.sql` | P7.8 finalisation | `f0b0a699f0b158bf…` |
| 5 | `migrations/20261020111000_p78_rebuild_day_finalizes.sql` | P7.8 rebuild | `eba77d8607724615…` |
| 6 | `p79_delivery/10_install_p79_functions.sql` | P7.9 INACTIF (0 producteur) | `3f4b9361f722f680…` |
| 6b | `migrations/20261020120000_p79_quality_invalidation.sql` | P7.9 source historique 1 | `34b38666858af41c…` |
| 6b | `migrations/20261020120100_p79_quality_status_permissions.sql` | P7.9 source historique 2 | `b72ba50c71646b05…` |
| 6b | `migrations/20261020120200_p79_finalize_state_transitions.sql` | P7.9 source historique 3 | `71e34126a20b62f9…` |
| 6b | `migrations/20261020120300_p79_multistore_chart_restriction.sql` | P7.9 source historique 4 | `befdf37a6b60fcb8…` |
| 7 | `p79_delivery/90_verify_p79.sql` | verification P7.9 (2 modes) | `64f97b3b3b851d21…` |
| A | `p7_1_package/20_extensions_prerequisites.sql` | extensions | `fcec195c3116154d…` |
| B | `p7_1_package/30_activate_invalidations.sql` | 5 producteurs | `8680b204bde3b909…` |
| C | `p7_1_package/31_activate_wakeup.sql` | reveil | `01778e6b12d4cacf…` |
| D | `p7_1_package/40_activate_worker.sql` | worker | `2f18ff6446eadac6…` |
| E | `p7_1_package/41_backfill.sql` | backfill | `095244ea78a756b3…` |
| F | `p79_delivery/20_activate_p79_quality_trigger.sql` | trigger qualite (gated) | `3a7e431bb386498c…` |
| R | `p7_1_package/91_rollback.sql` | rollback P7.1 | `be8c87532d86e9da…` |
| R | `p79_delivery/91_rollback_p79.sql` | rollback P7.9 | `482383fcc5251065…` |

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

## 7. Interdits

- `db push`, `supabase migration up` automatique, rejeu des migrations B13.
- Activation implicite du worker, du réveil ou du lecteur V5.
- Backfill hors fenêtre ou sur HIST-STORE sans autorisation dédiée.
- Modification d'une définition financière dans un lot de livraison.
- Rollback réintroduisant `rpc_dashboard_kpi_quality_status` sans contrôle
  d'accès, ou rouvrant `rpc_dashboard_revenue_chart(uuid[])` aux clients.
