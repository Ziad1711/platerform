> **Mise à jour Release :** ce document conserve les constats historiques. Le statut final et les réserves sont dans `release/STATUS.md` et la sélection autoritative dans `release/release-manifest.json`. Aucun ancien NOT COVERED/PASS ne remplace ces conclusions.

# KPI V5 — Phase 3 : qualification finale (dossier unique)

**Date :** 21/10/2026 — **Branche :** `p79/kpi-v5-consolidated` — **HEAD :** `34aa955`.
**Mode :** ACT, exécution autonome, cible de référence
`C:\Users\HP-EXE\Documents\erp ecom\jisra-kpi-v5-consolidated`.
**Aucune écriture** Supabase, aucune migration, aucun benchmark, aucun commit,
push, merge, déploiement, aucun changement MCP, aucun projet créé.

> Ce dossier remplace les rapports partiels : il contient les contrôles exécutés,
> les corrections locales, ce qui est réellement couvert, ce qui ne l'est pas,
> et le critère exact de déblocage de chaque point ouvert.

---

## 1. Sécurité de l'exécution

| Environnement | Réf | Usage réel cette phase |
|---|---|---|
| Production | `attvfeoqgbxsnnsllatt` | `SELECT` catalogue + conversions de fuseau uniquement |
| TEST partagé | `goqedvcdmgtejtyrawsp` | **aucun accès** (MCP non exposé pour cette réf) |
| B13 | `biqrgdopcvkrbgfxkzxm` | **aucun accès** |
| Ancien P7 isolé | `qxtqtzmxkwiohfbmwcdt` | `SELECT` d'état (installation inactive) |

Aucune configuration MCP modifiée. Aucun objet créé. Les cinq fichiers de la
Phase 1 sont préservés ; une seule modification s'y ajoute (§2).

---

## 2. Corrections locales de la phase

### 2.1 Agrégat commercial : plus de zéro fabriqué pour les coûts

`lib/dashboard/kpi-reader-mappers.ts`, fonction `sumTotals` : pour un accès
`commercial`, le RPC omet `purchase_cost`, `delivery_fee_cost`,
`confirmation_cost`, `contribution_margin`. L'agrégat les reconstituait à `'0'`
(somme de clés absentes). Ces clés sont désormais supprimées de l'agrégat.

- Portée : restitution uniquement, aucune règle financière touchée.
- Effet : l'objet agrégé respecte le contrat du payload (champ absent ≠ zéro).
- Vérification : oracle §3.2, cas `commercial_no_margin` (PASS).

### 2.2 Corrections techniques du harnais (dans les nouveaux artefacts, sans
toucher aux fichiers v2 validés)

| Défaut constaté | Conséquence | Correction |
|---|---|---|
| v2 : commande + articles dans **une** transaction | coût non représentatif du parcours applicatif | v3 : `create_order` puis `create_items`, deux instructions, deux COMMIT |
| v2 : imports `orders + items` en un statement | même biais sur les lots 200 | v3 : `import_orders_*` puis `import_items_*` séparés, + `import_orders_unlinked_*` |
| v2 : aucune modification d'article | trigger `order_items` non mesuré en écriture | v3 : section `update_item_price` |
| v2 : aucun import 600 | seuil d'exploitation non couvert | v3 : sections `import_*_600` |
| v2 : `Get-Percentile` recevait des `ArrayList` imbriqués | risque d'échec de conversion au calcul | v3 : `Flatten-Section` aplatit en `[double[]]` |
| v2 : garde `p79.bench_p7_ref` jamais positionnée | garde inopérante | v3 : liste d'interdiction explicite + double saisie |
| v2 : ni fraîcheur ni verrous | critères I.1 non mesurables | v3 : `p79_v3_visible()` + `lock_sampler.ps1` |
| `Read-B13Log` n'extrait que 5 métriques | `visible_after_write` ignoré | v3 : extraction complémentaire dans le pilote |

Aucune fonction métier (`rpc_dashboard_*`, agrégats, triggers, worker) n'a été
modifiée.

---

## 3. Contrôles exécutés

### 3.1 Candidat et typage

| Contrôle | Commande | Résultat |
|---|---|---|
| TypeScript | `node_modules/.bin/tsc --noEmit --pretty false` | **PASS** (exit 0, 0 diagnostic) |
| Paquet statique | `node supabase/p79_delivery/tools/verify-package.mjs` | **PASS — 220/220** |
| Auto-tests harnais | `b13-tests.ps1` (sans base) | **PASS 18/18** |
| Syntaxe PowerShell v3 | parseur AST | **PASS** (`run_final_campaign.ps1`, `lock_sampler.ps1`) |
| Structure SQL v3 | 50 balises `$fn$` (25 fonctions), 12 sections | **PASS** |

`git status` reste limité aux 5 fichiers de la Phase 1 + livrables Phase 2/3.

### 3.2 Oracle de restitution multi-boutiques (exécuté)

Vérification temporaire hors dépôt important le module réel
(`kpi-reader-mappers.ts`, type stripping Node 24), comparée à une arithmétique
rationnelle entière indépendante.

| Cas | Attendu | Résultat |
|---|---|---|
| 2 boutiques homogènes | AOV/ROAS/marge recalculés sur les sommes | **PASS** |
| Aucune moyenne de ratios | AOV ≠ moyenne des AOV boutique | **PASS** |
| Dénominateurs nuls | `0` ou `0.000000`, jamais `NaN`/`Infinity` | **PASS** |
| Devises mixtes | `mixed=true`, `totals=null` | **PASS** |
| Droits mixtes | `mixed=true`, `totals=null` | **PASS** |
| Accès commercial | marge et coûts absents | **PASS** (après §2.1) |
| Période incomplète | `incomplete=true` propagé, couverture sommée | **PASS** |
| Sélection vide | `totals=null`, `stores=0` | **PASS** |
| Boutique unique | payload transmis sans recalcul | **PASS** |
| Somme décimale | `0.1 + 0.2 = 0.3` exact | **PASS** |

**20/20 PASS.** Les formules correspondent au RPC (`aov = revenue/delivered`,
`delivery_rate = 100·delivered/orders`, `cpl = ads/orders`, `cpa = ads/delivered`,
`roas = revenue/ads`, `margin_rate = 100·marge/revenue`), tronquées à 6 décimales

### 3.3 Production — lecture seule (re-vérifiée)

| Contrôle | Résultat |
|---|---|
| Version | PostgreSQL **17.6** aarch64 |
| Objets KPI (`dashboard%` relations) | **0** |
| Fonctions `dashboard_kpi%` | **0** |
| Dernière migration enregistrée | `20261014212643` |
| Fuseau `Africa/Casablanca` | voir §3.4 |

Conclusion : la Production est encore un socle vierge de KPI V5. Aucune table à
reconstruire, aucun agrégat à migrer.

### 3.4 Casablanca — référence corrigée selon IANA 2026c

La conclusion historique « UTC+1 après le 20/09/2026 » était erronée.
IANA 2026c (2026-07-08) prévoit UTC+0 permanent à partir du 20/09/2026.
Référence : https://data.iana.org/time-zones/tzdb/NEWS et fichier africa.

| Instant UTC | Attendu IANA | B13 observé (action 2) | Ancien relevé Production |
|---|---|---|---|
| 25/02/2026 12:00Z | 12:00 (+00) | 12:00 | 12:00 |
| 01/07/2026 12:00Z | 13:00 (+01) | 13:00 | 13:00 |
| 20/09/2026 01:00Z | 01:00 (+00) | 01:00 | 02:00 |
| 21/10/2026 23:30Z | même jour 23:30 (+00) | même jour 23:30 | lendemain 00:30 |

B13 : PASS sur cette matrice ; numéro tzdata installé non certifié.
Ancien PASS calendrier Production retiré : le relevé historique diverge de la
référence corrigée aux deux derniers instants. Aucun nouveau relevé Production,
aucune maintenance automatique ; toute intervention nécessiterait une décision
séparée. TEST n'est pas requalifié ici.
La preuve comportementale B13 permet de proposer readiness_tzdata ; le drapeau
reste false et n'est pas modifié dans cette action.

### 3.5 Ancien P7 — installation réellement inactive

Relevé `SELECT` : `kill_switch=true`, `requested_mode=legacy`, **0 cohorte**,
worker `enabled=false`, réveil `enabled=false`, 0 événement en attente,
0 agrégat, 22 fonctions KPI, **0 trigger KPI actif**, lecteur présent.

**PASS** : l'état sûr « installation inactive » est démontrable et stable.
Cela ne prouve ni l'installation depuis le manifeste, ni le rollback (§6).

---

## 4. Phase 1 — ce qui est couvert, ce qui manque exactement

Couvert (preuves ci-dessus) :
- ratios multi-boutiques recalculés sur les composantes, sans moyenne ;
- aucun faux zéro dans l'agrégat (dénominateur nul, accès commercial, sélection vide) ;
- devises/droits mixtes non additionnés ;
- propagation de `incomplete` et de la couverture ;
- TypeScript valide, diff limité.

Compteurs « Confirmées » / « Expédiées » : la correction remplace les `0` codés
en dur par une lecture bornée (`orders` avec listes de statuts du RPC) et par
`null` en cas d'erreur. **La présentation « indisponible » a été implémentée ;
les valeurs réelles restent à confirmer** sur données TEST.

**NOT COVERED — validations manquantes (précises) :**

| Validation | Pourquoi absente | Critère de déblocage |
|---|---|---|
| Rendu réel « RPC en erreur → — » et « variation masquée » | exige une session authentifiée + injection de panne | session TEST réelle (owner + commercial) + coupure RPC contrôlée |
| Compteurs confirmés/expédiés exacts | exige des données réelles et le rôle adéquat | jeu TEST avec statuts variés, comparaison au SQL |
| Rendu multi-boutiques réel (devises/droits mixtes) | exige 2 boutiques accessibles avec devises et rôles différents | compte TEST multi-boutiques |
| Navigation legacy/V5 sur mêmes données | exige le flag activé | cohorte TEST temporaire (acte autorisé distinct) |


---

## 5. Protocole B13 v3 — prêt, non exécuté

Artefacts (nouveaux, les fichiers v2 restent intacts et validés) :

| Fichier | Rôle |
|---|---|
| `final/b13_v3/scenarios_app_path.sql` | scénarios du parcours réel + mesures (25 fonctions, 12 sections) |
| `final/b13_v3/run_final_campaign.ps1` | pilote : gardes, blocs appariés, verdict, restauration |
| `final/b13_v3/lock_sampler.ps1` | échantillonnage `pg_locks` + écriture concurrente |
| `b13/thresholds.json` | seuils **inchangés** (réutilisés) |

### 5.1 États

| État | Producteurs | Worker | Ce que la mesure prouve |
|---|---|---|---|
| **A** | désactivés (6) | arrêté | coût métier de référence |
| **C-écriture** | actifs | arrêté | coût synchrone attribuable aux producteurs |
| **C-exploitation** | actifs | actif (cron) | coût opérationnel réel + drainage + fraîcheur |

Chaque état est refusé si la configuration réelle ne correspond pas (worker
activé pour C-écriture, ou non activé pour C-exploitation).

### 5.2 Scénarios obligatoires (tous présents)

| Scénario | Section mesurée | Transactions |
|---|---|---|
| création commande | `create_order` | 1 par itération, COMMIT inclus |
| création articles (liaison tardive) | `create_items` | **transaction distincte** de la commande |
| modification rounding | `update_rounding` | 1 par itération |
| modification sous-total | `update_subtotal` | 1 par itération |
| modification non pertinente (contrôle) | `update_unrelated` | 1 par itération |
| modification d'article (prix) | `update_item_price` | 1 par itération |
| import 200 : commandes | `import_orders_200` | ensembliste, COMMIT inclus |
| import 200 : articles | `import_items_200` | **transaction séparée** |
| import 600 : commandes / articles | `import_orders_600`, `import_items_600` | idem |
| import sans liaison d'articles | `import_orders_unlinked_200` | commandes seules |
| écriture concurrente autre boutique | `lock_sampler.ps1 -ConcurrentWriter` | processus séparé |
| drainage | `drain_seconds` | `NULL` → NOT COVERED si worker arrêté |
| fraîcheur commit → agrégat | `p79_v3_visible()` | 5 marqueurs en C-exploitation |

### 5.3 Échantillonnage et analyse

- 5 blocs, ordre A/C puis C/A (échauffement exclu) ;
- ≥ 100 observations par section unitaire et par bloc ;
- 20 lots par taille d'import (200 et 600) ;
- analyse : valeurs brutes, médianes, p95, dispersion inter-blocs, écart absolu
  et relatif **A → C du même run** (jamais un ancien A comparé à un nouveau C) ;
- les observations d'une même transaction ne sont jamais traitées comme des
  commits indépendants (une instruction = une transaction).

### 5.4 Verdict

| Verdict | Règle |
|---|---|
| `PASS_UNDER_BUDGETS` | médiane ≤ 15 %, p95 ≤ 25 %, 0 deadlock, attente verrou < 50 ms, drainage < 30 s, fraîcheur p95 < 5 s |
| `FAIL` | un budget dépassé, deadlock attribuable, divergence inexpliquée |
| `NOT_COVERED` | worker absent (drainage/fraîcheur), aucune attente observée, scénario non exécuté |

**Statut : NOT COVERED** — aucune cible n'autorise l'écriture. Le script refuse
toute autre référence que `biqrgdopcvkrbgfxkzxm`, exige la double saisie, un
propriétaire connu, un wrapper nominatif, et restaure l'état des six producteurs
même en cas d'échec.

---

## 6. Oracle financier et multi-boutiques — prêt

`final/oracle/financial_exactness_oracle.sql` (lecture seule) :

1. **Écarts par jour** : recalcul indépendant des 13 composantes décisives
   (commandes, livrées, annulées, retours, en attente, confirmées, non classées,
   CA, coût d'achat, livraison, confirmation, commandes sans lignes, écart
   lignes/total) comparé à `dashboard_daily_metrics`, avec la journée métier
   résolue dans le fuseau de la boutique. Seules les divergences sortent.
2. **Périodes** : courante vs précédente de même longueur, ratios calculés sur
   les composantes (jamais moyennés), libellé `COMPARABLE` / `NO_COVERAGE`.
3. **Couverture** : journées demandées / agrégées / sales / manquantes, retards,
   événements réessayés, âge du dernier rebuild.
4. **Invariants** : `updated_at ≥ last_rebuild_at`, séquence ≤ journal,
   compteurs non négatifs, worker et réveil.
5. **Buckets non additifs** : `confirmed_like ≤ orders`, `sent_like ≤ confirmed_like`.

Ce qui est déjà prouvé : la restitution (20/20, §3.2). Ce qui reste
**NOT COVERED** : la comparaison agrégats ↔ source, faute de base portant des
agrégats et des données métier (Production n'a aucun objet KPI ; P7 est vide).

---

## 7. Contrôles d'exploitation — préparés, partiellement exécutés

`final/ops/runtime_controls.sql` (lecture seule, 8 contrôles) : état du rollout
et du kill switch, producteurs actifs, worker et réveil, backlog par âge et
tentatives, fraîcheur par boutique, derniers passages worker, sessions bloquées,
conditions de retour legacy.

Colonnes validées par exécution réelle sur P7 (rollout, worker, worker_run,
store_state). Relevé obtenu :

| Élément | Valeur observée |
|---|---|
| `kill_switch` / `requested_mode` | `true` / `legacy` |
| `config_version` | 2 (inchangée depuis l'installation) |
| Cohortes | 0 |
| Worker / réveil | `false` / `false` |
| Budgets worker | 10 partitions, 5 000 événements, 4 s, timeout 10 s |
| Agrégats / événements | 0 / 0 |
| Triggers KPI actifs | 0 |

**PASS** pour l'état sûr « installation inactive ». **NOT COVERED** pour :
kill switch ≤ 15 s (exige une activation réelle), drainage et fraîcheur (worker
arrêté), arrêt/reprise, rollback combiné (exige une cible), retour legacy mesuré
(exige une session réelle).

Aucun de ces points ne peut être déclaré PASS sans base de qualification.


---

## 8. Matrice finale PASS / FAIL / NOT COVERED

| # | Critère (I.1) | Mesure utilisée | Verdict | Déblocage |
|---|---|---|---|---|
| 1 | Exactitude des restitutions | oracle 20/20 sur le module réel | **PASS** | — |
| 2 | Ratios multi-boutiques | composantes sommées, aucune moyenne | **PASS** | — |
| 3 | Aucun faux zéro (agrégat) | dénominateur nul, accès commercial, sélection vide | **PASS** | — |
| 4 | Devises / droits mixtes | `mixed=true`, `totals=null` | **PASS** | — |
| 5 | TypeScript | `tsc --noEmit` exit 0 | **PASS** | — |
| 6 | Paquet reproductible (statique) | 220/220 | **PASS** | — |
| 7 | Harnais : gardes et parsing | 18/18 | **PASS** | — |
| 8 | Protocole B13 v3 exécutable | syntaxe PS1 + 25 fonctions / 12 sections | **PASS** (préparation) | — |
| 9 | Production : socle vierge | 0 objet KPI, migration `20261014212643` | **PASS** | — |
| 10 | Production : calendrier | ancien attendu corrigé IANA 2026c (§3.4) | **ANCIEN PASS RETIRÉ** | décision séparée ; aucune écriture |
| 11 | Installation inactive (P7) | kill switch, legacy, 0 cohorte, worker off | **PASS** | — |
| 12 | Rendu réel en erreur / variation masquée | exige session authentifiée + panne injectée | **NOT COVERED** | session TEST + coupure RPC contrôlée |
| 13 | Compteurs confirmés/expédiés exacts | exige données réelles | **NOT COVERED** | jeu TEST avec statuts variés |
| 14 | Multi-boutiques réel (2 boutiques, rôles, devises) | exige un compte multi-boutiques | **NOT COVERED** | compte TEST dédié |
| 15 | Écritures réelles A/C (commits séparés, 200/600) | exige une cible autorisée | **NOT COVERED** | cible jetable + autorisation écrite |
| 16 | Worker : drainage, fraîcheur p95 | exige worker actif | **NOT COVERED** | même fenêtre autorisée |
| 17 | Contentions / deadlocks | exige écriture concurrente réelle | **NOT COVERED** | même fenêtre, `lock_sampler` |
| 18 | Exactitude agrégats ↔ source | exige agrégats + données métier | **NOT COVERED** | base de qualification peuplée |
| 19 | Installation / rollback / reprise | aucune cible jetable | **NOT COVERED** (Phase 2) | cible avec restauration prouvée |
| 20 | Kill switch ≤ 15 s, retour legacy | exige activation réelle | **NOT COVERED** | cohorte TEST temporaire |
| 21 | Permissions / révocation (JWT réels) | exige utilisateurs réels | **NOT COVERED** | comptes TEST owner/commercial |
| 22 | TEST : calendrier | TEST inaccessible cette phase | **NOT COVERED** | accès lecture TEST |

Aucun critère 12–22 n'est déclaré PASS ni contourné par une mesure indirecte.

---

## 9. Recommandation prioritaire (une seule)

**Obtenir une cible de qualification jetable, explicitement autorisée en
écriture, avec restauration prouvée — et y exécuter, dans une seule fenêtre :
rejeu du paquet (Phase 2) + campagne B13 v3 `C-écriture` puis `C-exploitation`
+ oracle financier.**

C'est le seul verrou qui libère simultanément les critères 15, 16, 17, 18 et 19.
Tant qu'il n'est pas levé, la mise en service reste **NO-GO**, non par défaut de
code mais par absence de preuve dynamique. Aucune autre optimisation n'est
justifiée avant cette mesure.

### Ce qui ne doit pas être fait entre-temps

- ne pas lancer de maintenance tzdata Production sur la base du tableau initial (§3.4) ;
- ne pas activer les producteurs KPI en Production ;
- ne pas modifier B13 pour « gagner du temps » ;
- ne pas présenter les états « indisponible » de la Phase 1 comme des valeurs exactes.

### Conditions de sortie

| Résultat de la fenêtre | Décision |
|---|---|
| budgets respectés, zéro divergence, rollback démontré | **GO** préparation Production (Phase 4) |
| un budget dépassé | **NO-GO** ciblé, une hypothèse, au plus deux variantes |
| instrumentation insuffisante | **NOT COVERED** maintenu, aucune extrapolation |

---

## 10. Inventaire des livrables de cette phase

```
supabase/p79_delivery/final/
├─ PHASE3-QUALIFICATION.md              (ce dossier)
├─ oracle/financial_exactness_oracle.sql
├─ ops/runtime_controls.sql
└─ b13_v3/
   ├─ scenarios_app_path.sql
   ├─ run_final_campaign.ps1
   └─ lock_sampler.ps1
```

Modification de code : `lib/dashboard/kpi-reader-mappers.ts` (§2.1) uniquement.
Aucun autre fichier de production n'a été touché.

pour l'affichage — aucun flottant.
