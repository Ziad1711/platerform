> **Mise à jour Release :** ce document conserve les constats historiques. Le statut final et les réserves sont dans `release/STATUS.md` et la sélection autoritative dans `release/release-manifest.json`. Aucun ancien NOT COVERED/PASS ne remplace ces conclusions.

# KPI V5 — Phase 2 : reproductibilité et validation du backend (preuves)

**Date :** 21/10/2026 — **Branche :** `p79/kpi-v5-consolidated` — **HEAD :** `34aa955`.
**Mode :** ACT, exécution autonome dans les limites du brief.
**Aucune écriture Supabase, aucun `db push`, aucun commit, push, merge ni
déploiement, aucun appel fournisseur externe, aucune activation KPI V5.**

## 1. Périmètre livré

| Livrable | Fichier | État |
|---|---|---|
| Manifeste final machine | `00_manifest.json` | créé |
| Manifeste d'installation complété | `MANIFEST-INSTALL.md` | mis à jour |
| Vérificateur statique | `tools/verify-package.mjs` | créé, 220/220 PASS |
| Rollback combiné | `92_rollback_combined.sql` | créé |
| Capture de socle (lecture seule) | `93_preflight_capture.sql` | créé |
| Dossier de preuves | `PHASE2-EVIDENCE.md` | ce fichier |

Les cinq fichiers frontend de la Phase 1 sont intacts :
`components/dashboard/ads-cost-chart.tsx`, `kpi-cards.tsx`, `revenue-chart.tsx`,
`lib/dashboard/kpi-reader-mappers.ts`, `lib/dashboard/use-kpi-rollout.tsx`
(`git status --porcelain` = 5 lignes `M`, aucune autre modification).

## 2. Candidat Git et historique

| Contrôle | Constat |
|---|---|
| Branche | `p79/kpi-v5-consolidated` |
| HEAD | `34aa955` (P8.4 RPC Confirmation) |
| Arbre | 5 fichiers modifiés Phase 1, aucun fichier non suivi |
| Migrations présentes | 182 fichiers, dont P8.1→P8.4 (`2026102112…` → `2026102312…`) |
| R-BL4 de référence | identique octet pour octet à la migration `20261018213537` |
| Rejeu B13 | aucun : les migrations `b13_*` ne figurent ni dans les étapes ni dans les activations |

## 3. Cibles examinées (aucune écriture)

| Cible | Réf | Constat de lecture | Décision |
|---|---|---|---|
| Production | `attvfeoqgbxsnnsllatt` | PG 17.6 ; 3 730 commandes, 10 boutiques ; **0 objet KPI**, 0 rollout ; `max_version = 20261014212643` | **interdite en écriture** ; lecture seule |
| TEST partagé | `goqedvcdmgtejtyrawsp` | `jisra-test`, PG 17.11 | **interdite** (brief) |
| P7 isolé | `qxtqtzmxkwiohfbmwcdt` (« jisra test 2 ») | PG 17.11 ; 0 boutique, 0 commande ; socle P7.1 + P7.4 ; 22 fonctions `dashboard_kpi_*` + lecteur ; 0 trigger ; R-BL4 absent ; P7.7/P7.8/P7.9 absents | **non retenue** (voir §3.1) |
| Projet tiers | `jchrsvylvagfnkwzwqsy` | « boudilmeryem0@gmail.com's Project », PG 17.6 | non documenté, **non autorisé** |
| B13 C0 | — | cible de mesure B13 | **interdite** (brief) |

Le MCP `supabase-p7` est configuré sur
`mcp.supabase.com/mcp?project_ref=qxtqtzmxkwiohfbmwcdt` ; son identité
correspond au projet documenté `qxtqtzmxkwiohfbmwcdt` (PG 17.11, base vide de
données métier). La lecture a été faite uniquement en `SELECT`.

### 3.1 Pourquoi le P7 isolé n'est pas une cible de répétition

1. **État incompatible** : R-BL4 et P7.7/P7.8 sont absents. L'étape 6 (P7.9)
   appelle `dashboard_legacy_access` et `_rbl4_impl_dashboard_revenue_chart` :
   elle échouerait sans appliquer d'abord R-BL4 et P7.7. Le paquet complet
   changerait massivement l'état de cette cible.
2. **Réinstallation impossible sans destruction** : `10_install_objects.sql`
   refuse de s'appliquer si les objets KPI existent (`P71_ALREADY_INSTALLED`).
   Une installation « depuis zéro » exigerait de supprimer le socle P7.3, donc
   de détruire la preuve de cette phase.
3. **Restauration non prouvable** : aucun mécanisme de sauvegarde/restauration
   n'est exposé (ni PITR, ni snapshot) ; le brief exige une restauration
   démontrée avant écriture.
4. **Autorisation** : cette cible est documentée « qualification isolée » pour
   P7.3 ; aucune autorisation Phase 2 ne la désigne explicitement.

Conséquence : **aucune écriture**. Les scripts et validations sont prêts, mais
l'exécution dynamique reste à faire sur une cible explicitement autorisée.

## 4. Preuve dynamique en lecture seule : socle inactif

Relevé `SELECT` sur `qxtqtzmxkwiohfbmwcdt` (aucun DDL, aucune écriture) :

| Invariant | Attendu | Observé | Verdict |
|---|---|---|---|
| Tables KPI | 6 + 3 rollout | 9 | PASS |
| Fonctions `dashboard_kpi_*` | 22 + lecteur | 22 + `rpc_dashboard_kpi_reader` | PASS |
| Triggers `trg_kpi_*` | 0 | 0 | PASS |
| Jobs `jisra_kpi%` | 0 | 0 | PASS |
| `worker_enabled` | false | false | PASS |
| `wakeup_enabled` | false | false | PASS |
| `kill_switch` | true | true | PASS |
| `requested_mode` | legacy | legacy | PASS |
| Cohortes | 0 | 0 | PASS |
| Lecteur : `authenticated` / `anon` | true / false | true / false | PASS |
| Données métier | 0 | 0 boutique, 0 commande | PASS |

Cette preuve porte sur le socle P7.1 + configuration P7.4 seulement : elle
**ne démontre pas** la chaîne P7.1→P7.9→P8, ni le rollback, ni la reprise.

## 5. Validations statiques exécutées

`node supabase/p79_delivery/tools/verify-package.mjs` → **220/220 PASS, exit 0**.

| Famille | Ce qui est prouvé |
|---|---|
| Ordre | étapes strictement croissantes, identifiants uniques |
| Dépendances | chaque `requires` est déjà satisfait (R-BL4 avant P7.9, M2 avant S2) |
| Fichiers | chaque chemin existe, chaque SHA-256 correspond |
| Inactivité | aucun `create trigger`, `cron.schedule` ou `net.http_post` au premier niveau dans les deux installs |
| Interrupteurs | worker et réveil insérés à `enabled = false` ; 6 RLS fermées, 0 politique client |
| Rollout | `kill_switch` par défaut `true`, `requested_mode` par défaut `legacy` |
| Activations | les 6 scripts sont gardés par `current_setting('p7/p79.…')` |
| Rollback | garde présente, 5 producteurs P7.1 + producteur P7.9 couverts, worker/réveil/lecteur arrêtés, aucune table ni politique supprimée, empreintes P8 comparées |
| Syntaxe | blocs dollar équilibrés (16 marqueurs dans 92, 4 dans 93) |
| Interdits | aucun rejeu `b13_*` |

Autres contrôles locaux :

- `00_manifest.json` : JSON valide (chargé par le vérificateur).
- `git status --porcelain` : 5 fichiers Phase 1 uniquement.
- Aucun fichier de test créé.

### 5.1 Correction de reproductibilité constatée (O1)

Les empreintes de l'ancien tableau `MANIFEST-INSTALL.md` étaient calculées sur
un checkout **CRLF** : `10_install_objects.sql` y valait `f5645526e9c1f480…`.
Sur contenu normalisé **LF**, il vaut `489173d306ba68ae…`, sans aucune
modification SQL. Un checkout Linux aurait donc invalidé tout le manifeste.
Le manifeste final impose la normalisation LF (même règle que
`p7_1_package/tools/verify-static.mjs`) et enregistre les valeurs complètes.

## 6. Rollback : couverture et limites

| Exigence | Preuve statique |
|---|---|
| Producteur qualité P7.9 couvert | `drop trigger … trg_kpi_invalidate_orders_quality` puis `drop function …` |
| 5 producteurs P7.1 couverts | 5 `drop trigger if exists trg_kpi_…` (hors qualité) |
| Worker arrêté | `cron.unschedule` des 2 jobs + `enabled = false` |
| Réveil arrêté | `enabled = false` + `drop trigger trg_kpi_wakeup` |
| Lecteur legacy | `kill_switch = true`, `requested_mode = 'legacy'` |
| Données conservées | aucune instruction `drop table`, `delete` ou `truncate` |
| P8 non annulé | aucune suppression d'objet P8 ; digests fonctions/politiques comparés avant/après |
| Protections P7.9 conservées | digest des 3 objets durcis comparé ; aucun retour aux versions antérieures |
| Non-perte | compteurs métier, journal, agrégats et runs comparés avant/après |

Limites explicites :

- `92` ne peut pas prouver la non-perte sur une cible vide autrement que par
  égalité `0 = 0` ; c'est une preuve d'invariance, pas de volume.
- Sur une cible sans données, `91_rollback_p79.sql` rend `FAIL` à tort sur
  `invalidation_journal_preserved` (`count(*) > 0`) : ne pas l'utiliser comme
  preuve de non-perte.
- La reprise n'est pas un script unique : c'est la ré-exécution ordonnée
  B → F → D puis vérifications (voir `MANIFEST-INSTALL.md` §4.3).

## 7. Verdict par critère

| # | Critère | Verdict | Preuve |
|---|---|---|---|
| 1 | Manifeste final complet, ordonné, reproductible | **PASS** | `00_manifest.json` + 220/220 |
| 2 | Installation inactive démontrée sur cible autorisée | **PARTIEL** | socle P7.1+P7.4 inactif prouvé en lecture seule ; chaîne complète NOT COVERED |
| 3 | Activation et rollback combiné validés sur cible jetable | **NOT COVERED** | aucune cible jetable avec restauration prouvée |
| 4 | Permissions P8 conservées | **PASS (statique)** | aucun `drop`/`create` P8 dans 92, digests comparés |
| 5 | Aucune perte de données métier | **PASS (statique)** | aucun `drop table`/`delete`/`truncate` |
| 6 | Aucun environnement perturbé | **PASS** | Production et TEST en lecture seule ; P7 isolé inchangé |
| 7 | Rapport PASS / FAIL / NOT COVERED | **PASS** | ce document, §7 et §8 |

**Aucun FAIL** constaté. **Verdict Phase 2 : PARTIELLE** — le paquet est
reproductible et contrôlé statiquement ; l'exécution dynamique (installation,
activation, rollback, reprise) reste bloquée faute de cible autorisée avec
restauration démontrée.

**Re-vérifié le 21/10/2026** : aucun environnement autorisé n'est disponible
(cf. §10) → verdict dynamique **NOT COVERED** maintenu, sans écriture.

## 8. Points ouverts

| ID | Sévérité | Point | Traitement |
|---|---|---|---|
| O1 | MAJEURE | empreintes dépendantes des fins de ligne | corrigé : normalisation LF, manifeste final |
| O2 | MAJEURE | P8.3 M2/M3 recréent 62 politiques capturées ; sur socle différent elles seraient créées | précondition `P8.3_BASELINE` documentée |
| O3 | MINEURE | `91_rollback_p79.sql` : contrôle journal `> 0` inadapté à une cible vide | `92` compare avant/après ; limite documentée |
| O4 | MINEURE | `10_install_p79_functions.sql` n'a pas de garde d'autorisation, contrairement à P7.1 | non modifié (aucune activation implicite) ; risque consigné |
| O5 | MINEURE | `kpi-reader-flag.ts` n'autorise le lecteur que sur TEST ou Production avec ACK | activation UI non démontrable sur un projet jetable ; RPC testable en SQL |
| O6 | BLOQUANT | aucun mécanisme de sauvegarde/restauration exposé | bloque l'exécution dynamique ; nécessite une autorisation et un moyen de restauration |

## 9. Commandes prêtes pour une cible autorisée

Remplacer `$URL` par la chaîne de connexion de la cible **autorisée**, jamais
Production, jamais TEST partagé, jamais B13 C0.

```bash
# 0. Capture de socle (lecture seule)
psql "$URL" -v ON_ERROR_STOP=1 --single-transaction -f supabase/p79_delivery/93_preflight_capture.sql

# 1. Socle inactif + vérification
psql "$URL" -v ON_ERROR_STOP=1 --single-transaction \
  -c "set p7.install_authorized='yes'" -f supabase/p7_1_package/10_install_objects.sql
psql "$URL" -v ON_ERROR_STOP=1 -c "set p7.stage='install'" -f supabase/p7_1_package/90_verify.sql

# 2. R-BL4 puis rollout, P7.7, P7.8
psql "$URL" -v ON_ERROR_STOP=1 --single-transaction \
  -f supabase/p7_1_package/reference/20261018213537_dashboard_legacy_financial_permissions.sql
for f in 20261019183241 20261019183328 20261019183342 20261019183349 20261019183712 20261019183800 \
         20261020100000 20261020101000 20261020102000 20261020103000 20261020104000 20261020105000 \
         20261020110000 20261020111000; do
  psql "$URL" -v ON_ERROR_STOP=1 --single-transaction -f "supabase/migrations/${f}"*.sql
done

# 3. P7.9 inactif + vérification du mode inactif
psql "$URL" -v ON_ERROR_STOP=1 --single-transaction -f supabase/p79_delivery/10_install_p79_functions.sql
psql "$URL" -v ON_ERROR_STOP=1 -c "set p79.stage='inactive'" -f supabase/p79_delivery/90_verify_p79.sql

# 4. P8.1 -> P8.4 (ordre strict du manifeste)
for f in 20261021120000 20261022093000 20261023100000 20261023100100 20261023100200 \
         20261023110000 20261023110100 20261023120000; do
  psql "$URL" -v ON_ERROR_STOP=1 --single-transaction -f "supabase/migrations/${f}"*.sql
done

# 5. Rollback combine puis verification de non-perte et de P8
psql "$URL" -v ON_ERROR_STOP=1 --single-transaction \
  -c "set p79.combined_rollback_authorized='yes'" -f supabase/p79_delivery/92_rollback_combined.sql

# 6. Reprise controlee (aucune activation implicite)
psql "$URL" -v ON_ERROR_STOP=1 --single-transaction \
  -c "set p7.activate_invalidations='yes'" -f supabase/p7_1_package/30_activate_invalidations.sql
psql "$URL" -v ON_ERROR_STOP=1 --single-transaction \
  -c "set p79.activate_quality='yes'" -f supabase/p79_delivery/20_activate_p79_quality_trigger.sql
psql "$URL" -v ON_ERROR_STOP=1 --single-transaction \
  -c "set p7.activate_worker='yes'" -f supabase/p7_1_package/40_activate_worker.sql
psql "$URL" -v ON_ERROR_STOP=1 -c "set p7.stage='all'" -f supabase/p7_1_package/90_verify.sql
psql "$URL" -v ON_ERROR_STOP=1 -c "set p79.stage='active'" -f supabase/p79_delivery/90_verify_p79.sql
```

Aucune de ces commandes n'a été exécutée pendant la Phase 2.

## 10. Prérequis de déblocage (re-vérifié le 21/10/2026)

Aucune cible de qualification **jetable et autorisée** n'existe. Décision :
conserver le verdict dynamique **NOT COVERED**, n'écrire nulle part, ne créer
aucun projet.

### 10.1 Environnements exclus

| Environnement | Réf | Motif |
|---|---|---|
| Production | `attvfeoqgbxsnnsllatt` | lecture seule stricte |
| TEST partagé | `goqedvcdmgtejtyrawsp` | écriture interdite |
| B13 isolé | `biqrgdopcvkrbgfxkzxm` | cible de mesure, réf codée en dur dans `b13/*.ps1` |
| Ancien P7 isolé | `qxtqtzmxkwiohfbmwcdt` | état P7.1+P7.4 à préserver, R-BL4 absent |
| Projet tiers | `jchrsvylvagfnkwzwqsy` | absent du dépôt, PG 17.6 identique à Production |

Inventaire management : **2 projets visibles, inchangés** (mêmes `created_at`) ;
aucun projet créé. Les scripts B13 (`run_bench.ps1`, `run_campaign.ps1`,
`b13-tests.ps1`) refusent toute autre réf que `biqrgdopcvkrbgfxkzxm`.

### 10.2 Conditions à remplir par la future cible

1. Réf dédiée, distincte des cinq environnements ci-dessus.
2. Identité prouvée : Management API (`id`, `name`, `region`, `status`) +
   PostgreSQL 17.x + base sans donnée métier.
3. **Restauration prouvée avant écriture** : PITR/backup disponible, ou
   `pg_dump --schema-only` exécuté et restauration testée, avec horodatage et
   empreinte du dump.
4. Autorisation écrite explicite : « écritures autorisées sur `<ref>` pour la
   répétition KPI V5 Phase 2 ».

### 10.3 Contrôles préalables (lecture seule)

- `93_preflight_capture.sql` : section `kpi` vide, `counts` de référence.
- `max_version < 20261021120000` (sinon renommer le fichier P8.1 avant dépôt).
- 41 + 21 politiques P8.3 présentes dans le socle (précondition `P8.3_BASELINE`).

### 10.4 Critères de sortie du verdict dynamique

| Étape | Attendu |
|---|---|
| Socle inactif | `90_verify.sql` stage `install` PASS, 0 trigger, 0 job |
| P7.9 inactif | `90_verify_p79.sql` stage `inactive` PASS, 0 trigger qualité |
| Activation | 7 triggers `trg_kpi_%`, 2 jobs, 0 cohorte par défaut |
| Rollback `92` | toutes lignes PASS, compteurs identiques, digests P8 identiques |
| Reprise | B → F → D puis `90_verify(all)` et `90_verify_p79(active)` PASS |

