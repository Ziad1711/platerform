# JISRA — Paquet P7.1 KPI V5

**Verdict paquet : PASS (P7.3).** La reproductibilité stricte a été démontrée
sur le projet isolé `qxtqtzmxkwiohfbmwcdt`. L'installation en Production reste
non autorisée et dépend de tzdata et R-BL4.

- Source des définitions : `jisra-test` (`goqedvcdmgtejtyrawsp`), PostgreSQL 17.11.
- Cible : Production (`attvfeoqgbxsnnsllatt`), PostgreSQL 17.6 ARM64, lecture seule.
- Snapshot : 23 fonctions, 68 812 caractères, **23/23 empreintes MD5 conformes**.
- Contrôles statiques : **33/33 PASS** après corrections P7.3
  (`verification-static.json`).
- Aucun SQL exécuté en Production. Aucun push, aucun déploiement.
- B13 reste **FAIL strict** sous acceptation conditionnelle B.
- **P7.2 : BLOCKED** — voir `P7.2-QUALIFICATION.md` et `P7.2-evidence.json`
  (installation complète non exécutée, tzdata/R-BL4/frontend bloquants).
- **P7.3 : PASS — qualification fonctionnelle et réinstallation propre sur
  `qxtqtzmxkwiohfbmwcdt`.** Voir `P7.3-MCP.md` et `P7.3-evidence.json`.

## 1. Inventaire Test et écarts avec le dépôt

### 1.1 Migrations KPI appliquées sur Test

| Version | Nom |
|---|---|
| 20261018172953 | kpi_worker_bounded_p1 |
| 20261018173021 | kpi_worker_bounded_p1_fix_cfg_record |
| 20261018173308 | kpi_worker_bounded_p1_stop_reason_fidelity |
| 20261018180222 | kpi_resume_respects_worker_switch |
| 20261018183910 | kpi_invalidate_single_row_per_partition |
| 20261018184153 | kpi_note_dedupe_per_transaction |
| 20261018185833 | kpi_statement_level_insert_coalescing |
| 20261018190111 | kpi_revert_statement_triggers |
| 20261018191154 | kpi_reader_helpers |
| 20261018191249 | kpi_reader_rpc |
| 20261018191411 | kpi_reader_direct_rank_fix |
| 20261018191623 | kpi_purge_orphans_and_retention |
| 20261018205301 | p6_dashboard_rpc_revoke_public_anon |
| 20261018213537 | dashboard_legacy_financial_permissions |
| 20261018230705 | b13_invalidation_hot_path |
| 20261018230852 | b13_statement_insert |
| 20261018231324 | b13_revert_item_statement |
| 20261018231616 | b13_order_flag_cache |
| 20261018231745 | b13_order_insert_flag |
| 20261018232703 | b13_preinsert_flag |
| 20261018233211 | b13_simplify_insert_stmt |

Les migrations `p3_bench*` sont des objets de mesure Test et sont **exclues**.

### 1.2 Fichiers locaux correspondants

Présents : `20261018213537`, puis `20261018230000`, `230500`, `231000`,
`231500`, `232000`, `232500`.

Écarts :

- aucune migration locale pour P1–P6 (worker borné, reprise, lecteur,
  rétention, revoke) ;
- les versions B13 locales diffèrent de l'historique Test
  (ex. `230000` local vs `230705` Test) ;
- `20261018232500_b13_final_state.sql` local n'est pas une migration Test :
  l'état final Test provient de `232703` + `233211`.

**Conséquence : le snapshot Test est la seule référence autoritaire. Les
fichiers historiques ne doivent pas être rejoués.**

## 2. Objets du paquet

| Famille | Nombre | Fichier |
|---|---|---|
| Tables KPI | 6 | `10_install_objects.sql` |
| Vue de santé | 1 | `10_install_objects.sql` |
| Fonctions KPI + lecteur | 23 | `10_install_objects.sql` (snapshot) |
| Index | 9 | `10_install_objects.sql` |
| Contraintes (hors trigger) | 27 | `10_install_objects.sql` |
| Triggers d'invalidation | 5 | `30_activate_invalidations.sql` |
| Trigger de réveil | 1 | `31_activate_wakeup.sql` |
| Jobs cron | 2 | `40_activate_worker.sql` |

## 3. Ordre d'application

1. **P7.0** — tzdata Production corrigé et vérifié (hors paquet).
2. `10_install_objects.sql` — objets seuls, **inertes**.
3. `90_verify.sql` avec `p7.stage=install`.
4. `20_extensions_prerequisites.sql` — **après `10`**, optionnel, lot séparé ;
   pg_cron démarre son ordonnanceur mais ne crée aucun job.
5. `30_activate_invalidations.sql` — 5 triggers, aucun worker.
6. `90_verify.sql` avec `p7.stage=invalidations`.
7. `40_activate_worker.sql` — worker + purge.
8. `90_verify.sql` avec `p7.stage=worker`.
9. `41_backfill.sql` — fenêtres de 31 jours maximum, jamais automatique.
10. `31_activate_wakeup.sql` — optionnel, après configuration Vault.
11. `50_reader_activation.md` — activation frontend, P7.2 uniquement.
12. `90_verify.sql` avec `p7.stage=all` (sans réveil) ou `wakeup` (avec).
13. `91_rollback.sql` en cas d'incident.

## 4. Garanties de l'installation initiale

`10_install_objects.sql` :

- ne crée **aucun trigger**, **aucun job**, **aucun webhook** ;
- n'appelle jamais `net.http_post` au moment de l'installation ;
- insère deux lignes de configuration `enabled = false` ;
- ferme les tables (RLS sans politique, ACL clients révoquées) ;
- révoque `PUBLIC`/`anon`/`authenticated` sur toutes les fonctions internes ;
- accorde le lecteur uniquement à `authenticated` + `service_role`.

Garde-fous : autorisation `p7.install_authorized=yes`, refus si objets KPI,
trigger KPI ou job KPI déjà présents, vérification des prérequis métier.

## 5. Prérequis et dépendances

Présents en Production (vérifiés en lecture) : `stores`, `orders`,
`order_items`, `ad_spend_daily`, `can_view_store_finances(uuid)`,
`order_purchase_cost(text,numeric,numeric)`, schéma `vault`.

Absents en Production : `pg_net`, `pg_cron`, objets KPI, objets R-BL4.

Blocages : tzdata, R-BL4 pour le rollback/shadow legacy, verrou frontend
Production dans `lib/dashboard/kpi-reader-flag.ts`.

## 6. Écarts documentés

| ID | Sévérité | Sujet | Décision |
|---|---|---|---|
| D01 | BLOCKING | tzdata Production | corriger et vérifier avant tout backfill |
| D02 | BLOCKING | P1–P6 absentes du dépôt | snapshot Test autoritaire |
| D03 | MAJEURE | versions B13 divergentes | ne pas rejouer l'historique |
| D04 | MAJEURE | ACL Test : EXECUTE PUBLIC sur `invalidate_insert_stmt` | le paquet révoque ; écart volontaire |
| D05 | MINEURE | rôle `jisra_kpi_worker` absent en Production | grant `service_role` seulement |
| D06 | MAJEURE | R-BL4 absent en Production | appliquer avant shadow/rollback legacy |
| D07 | MINEURE | pg_net 0.20.0 Prod vs 0.20.4 Test | vérifier `net.http_post` après installation |
| D08 | MAJEURE | PostgreSQL 17.6 ARM vs 17.11 x86 | ne pas transposer les mesures B13 |
| D09 | BLOCKING | lecteur V5 bloqué par le code | modification P7.2 + autorisation |

## 7. Preuves

- `verification-static.json` : 23/23 PASS.
- `.work/snapshot.sql` : 23 marqueurs, 23/23 MD5.
- Empreinte agrégée Test = empreinte locale : `7c42c7ec3479d25f88d876be4f842bca`.
- Comptages Test : 6 tables ; colonnes 33 / 13 / 17 / 7 / 10 / 7 ;
  27 contraintes hors trigger ; 9 index ; 12 colonnes de vue ; 6 RLS ;
  0 politique ; 6 triggers ; 2 jobs.
- ACL Test : `reader_auth = true`, `reader_anon = false`, `service_exec = 23`,
  `client_exec_internal = 1` (anomalie Test corrigée par le paquet).

## 8. Rollback

`91_rollback.sql` niveau 1 : arrêt worker/réveil, désactivation des jobs,
suppression des 6 triggers, **conservation** du journal, des agrégats et des
runs. Niveau 2 commenté : suppression des objets après export et rapprochement.

Interdits : toucher aux tables métier, purger le journal avant rapprochement,
restaurer globalement la Production, supprimer des événements non traités.

## 9. GO / NO-GO P7.2

**GO** si : tzdata vérifié, R-BL4 appliqué, clone ou branche d'essai disponible,
`10` + `90(stage=install)` PASS, rollback testé, autorisation humaine.

**NO-GO** si : tzdata divergent, R-BL4 absent, ACL non conformes, trigger ou
job créé par l'installation, écart d'empreinte, ou absence de preuve d'exécution
sur un environnement non-production.

**État actuel : BLOCKED — aucune exécution supplémentaire autorisée.**
