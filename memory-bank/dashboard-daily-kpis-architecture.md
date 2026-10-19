# JISRA — KPI quotidiens précalculés (ADR-DASH-001)

**Document de référence unique du chantier.** Il contient : la décision, le contrat de suivi, les lots et tâches, les décisions métier ouvertes, le registre de preuves et le journal d'exécution.

| Champ | Valeur |
|---|---|
| Statut de l'ADR | **Orientation architecture/produit approuvée** par le propriétaire le 16/10/2026 |
| Statut d'exécution | **L0, L1 (`NOT VALIDATED`), T2.1, T2.2 exécutés. T2.3 V1 : NO-GO (§14). V2 : NO-GO (§15). V3 : 15 défauts V2 corrigés mais 5 défauts résiduels (§16). **V4 : 26/26 contrôles PASS, 9 self-tests + 4 mutations externes rejetées, 5 défauts V3 corrigés (§17) — tests dynamiques `BLOCKED` — NON DONE.** T3 → L9 non entamés. Aucune exécution SQL, aucune activation, aucun déploiement. |
| Dernière mise à jour | 17/10/2026 — T2.3 V3 : corrections de l'audit V2 (hors dépôt), contrôles exécutés |
| Arbitrages du propriétaire | **B01=A, B02=B, B03=C, B04=B, B05=A, B06=B, B07=A provisoire, B08=A adaptée, B09=A, B10=A provisoire, B11=A, B12=A adaptée, B13=C, B14=A ; S01 approuvée sous réserve de preuve de concurrence.** Enregistrés dans §10 et §11 |
| Autorisations en vigueur | Aucune autorisation de migration, d'écriture Supabase, de push ou de déploiement pour ce chantier |

**Documents liés (ne pas dupliquer leur contenu ici) :**

- Contrat Finances existant : `memory-bank/finance-module-plan.md` (référence opposable, non modifiée par ce chantier).
- Chantier performance frontend/Auth/bootstrap : `memory-bank/performance-optimization-plan.md` et `memory-bank/performance-progress.md`.
- Contexte applicatif : `memory-bank/activeContext.md`, `memory-bank/systemPatterns.md`, `memory-bank/techContext.md`.

---

## 1. ADR-DASH-001 — Décision

### 1.1 Contexte historique

Le dashboard JISRA calcule ses indicateurs à l'ouverture, depuis plusieurs RPC Supabase (`rpc_dashboard_kpi_metrics`, `rpc_dashboard_revenue_chart`, `rpc_dashboard_ads_cost_chart`, `rpc_dashboard_top_products`, `rpc_dashboard_city_performance`, `rpc_dashboard_confirmation_performance`, `rpc_dashboard_order_time_performance`, `rpc_dashboard_profit_chart`) plus des lectures directes pour les dernières activités. En mode « Tous les magasins », l'agrégation est faite côté navigateur, en boucle sur les boutiques accessibles, pour chaque widget et chaque période.

Les travaux antérieurs ont amélioré le bootstrap d'identité, l'isolation du cache et les parcours Auth. Ils ne remplacent pas les calculs métier du dashboard par un modèle précalculé.

La documentation historique (`systemPatterns.md`) prévoyait une bascule vers des métriques précalculées **au-delà de 500 000 commandes**. Cette condition est remplacée : le précalcul devient l'orientation retenue, indépendamment de ce seuil.

### 1.2 Problèmes constatés et mesures disponibles

- Multiplication des lecteurs et des appels, proportionnelle au nombre de boutiques.
- Calculs redondants : une modification locale non commitée supprime déjà un second calcul du CA dans les cartes (voir §8, E03).
- Définitions divergentes entre cartes et graphiques (voir §4).
- Le parallélisme accru ne réduit pas le travail SQL et augmente la pression sur PostgreSQL.
- Les triggers métier existants (`trg_order_items_recalc_order_financials`, `trg_allocate_ad_spend`, `trg_allocate_ads_from_ad_spend`, `trg_allocate_ads_from_orders`) produisent déjà des écritures en cascade.
- Aucune chaîne asynchrone KPI, aucun agrégat quotidien, aucun mécanisme de fraîcheur sous 5 s n'existe (voir §8, E08, E09, E12).

L'audit fourni par le propriétaire rapporte des latences réseau parfois supérieures aux durées SQL. **Aucune baseline chiffrée comparable n'a été retrouvée ou reproduite pour ce chantier.** Aucun gain de performance n'est établi.

### 1.3 Alternatives étudiées

| Alternative | Avantage | Limite retenue |
|---|---|---|
| Conserver les agrégations directes | Simplicité, lecture des sources courantes | Coût récurrent par ouverture ; divergence maintenue entre lecteurs |
| Paralléliser davantage | Peut réduire certaines attentes | Ne réduit pas le travail SQL ; accentue la pression PostgreSQL |
| Une seule RPC monolithique directe | Moins d'allers-retours | Le recalcul historique reste complet à chaque ouverture |
| Cache frontend ou serveur seul | Réduit les lectures répétées | Invalidation historique et multi-session insuffisantes |
| Rafraîchissement périodique global | Exploitation simple | Fraîcheur et coût du recalcul global, non ciblé par boutique |
| Calcul complet synchrone par trigger | Cohérence immédiate | Impact direct sur les écritures, verrouillages, cascades |
| **Agrégats quotidiens + invalidation durable + reconstruction asynchrone** | Lecture bornée par journées, reprise, fraîcheur observable | Complexité opérationnelle et cohérence éventuelle |

### 1.4 Décision retenue

Architecture hybride :

1. La **journée métier par boutique** est l'unité principale d'agrégation.
2. Les agrégats stockent des **composantes additives, numérateurs, dénominateurs et informations de couverture** — jamais uniquement des ratios ou des valeurs déjà arbitrées.
3. Chaque modification pertinente produit une **invalidation durable et légère**, sans calcul financier synchrone dans le trigger.
4. Un **worker asynchrone idempotent** reconstruit les partitions affectées, avec bail et reprise après incident.
5. Des **lecteurs agrégés sécurisés** servent cartes et séries, avec des composantes communes.
6. Le **dashboard ouvert s'actualise** sans rechargement.
7. **Lecteurs distincts conservés** pour produits, villes, agents, horaires et dernières activités.
8. **Lecteurs directs conservés** pendant la transition, comme oracle de référence et voie de retour.

### 1.5 Raisons

- Supprimer le recalcul historique à chaque ouverture.
- Mutualiser les définitions entre cartes et graphiques.
- Couvrir toutes les voies d'écriture, y compris imports et intégrations.
- Traiter les corrections historiques, les suppressions et les changements de boutique.
- Mesurer séparément lectures, écritures et fraîcheur de bout en bout.

### 1.6 Objectifs mesurables

- Égalité des résultats avec le contrat métier approuvé (§4, décisions B01 → B14).
- Zéro accès non autorisé aux agrégats, RPC et événements.
- Zéro invalidation perdue (concurrence, suppression, reprise).
- Rafraîchissement automatique du dashboard ouvert, sans rechargement.
- Fraîcheur réelle mesurée et comparée à la cible **< 5 secondes**.
- KPI et séries principaux servis par les agrégats, hors exceptions approuvées.
- Absence d'impact significatif sur les écritures, selon budgets approuvés (§4, B13).
- Historique couvert et rapproché, sans journée manquante masquée par un zéro.

### 1.7 Limitations et compromis

- Cohérence **éventuelle** entre écriture métier et affichage (choix assumé).
- Stockage et exploitation supplémentaires (partitions, file, état).
- Les ratios (CPL, CPA, ROAS, marge) ne sont pas additifs : calculés depuis les totaux.
- Les périodes partielles peuvent nécessiter un lecteur direct de bordure (B08).
- La fraîcheur après ingestion ne garantit pas la fraîcheur des sources externes (Meta, transporteurs).
- La consolidation multidevise exige une règle explicite (B09).

### 1.8 Risques

Contrat financier ambigu ; invalidation incomplète ; courses reconstruction/écriture ; contention sur les journées très actives ; retard ou arrêt du worker ; fuite via RPC, abonnement ou cache ; historique incomplet ; dérive entre migrations locales et schéma réel (voir §7 et §8, E10).

### 1.9 Conditions de révision de la décision

Réexaminer ADR-DASH-001 si :

- la cible de 5 secondes échoue sur charge représentative ;
- la reconstruction d'une journée devient excessivement coûteuse ;
- la file ou ses verrous dégradent les écritures ;
- le coût d'exploitation dépasse le budget accepté ;
- une granularité différente est exigée par le métier ;
- la cohérence éventuelle est incompatible avec un usage validé.

Toute alternative doit être **mesurée** puis soumise à une nouvelle décision produit. Ne pas déclarer le projet terminé en silence.

### 1.10 Éléments explicitement non approuvés

Migration ou modification de production ; installation ou activation d'extension ; création payante d'environnement ; changement de formule financière ; modification du contrat Finances ; suppression ou déplacement des triggers métier existants ; modification de données historiques ; nouvelle dépendance npm ; push, déploiement ou activation d'ordonnanceur ; acceptation d'un délai supérieur à 5 secondes.

---

## 2. Règles de suivi

### 2.1 Statuts

| Statut | Définition |
|---|---|
| PLANNED | Préparé, non commencé |
| IMPLEMENTED | Modifications présentes dans le code ou le schéma |
| TESTED | Tests exécutés sur le candidat exact, résultats consignés |
| VALIDATED | Critères d'acceptation satisfaits et approbation humaine obtenue lorsqu'elle est requise |
| DEPLOYED | Version effectivement servie, identifiée par son commit ou son déploiement |
| BLOCKED | Obstacle identifié, cause exacte et action de déblocage consignées |
| NOT RUN | Prévu mais non exécuté |

Un lot peut cumuler plusieurs statuts (`IMPLEMENTED`, `NOT VALIDATED`, `NOT DEPLOYED`). **Un build ou une compilation réussie ne vaut pas validation.** Un test non exécuté n'est jamais PASS : il est `NOT RUN` ou `BLOCKED`.

### 2.2 Règles d'exécution permanentes

A. Ne jamais déclarer une tâche terminée parce que le code compile.
B. DONE seulement si les critères d'acceptation sont satisfaits et les preuves existent.
C. Ne jamais réutiliser un log ou un résultat de test ancien pour valider un nouveau changement.
D. Les tests s'exécutent sur le contenu exact livré (SHA, hash de diff, empreinte de schéma).
E. Comparer les KPI avant/après sur données et périodes équivalentes.
F. Vérifier les autorisations multi-boutiques, les rôles et les risques de fuite (REST, RPC, abonnement, cache).
G. Mesurer la charge et la latence des lectures **et** des écritures.
H. Aucun calcul financier lourd dans un trigger synchrone.
I. Vérifier modifications historiques, suppressions, changements de boutique, corrections publicitaires et concurrence.
J. Préserver les fonctionnalités existantes et les modifications des sessions concurrentes.
K. Migrations versionnées, réversibles ou accompagnées d'une procédure de retour réaliste.
L. Aucun déploiement, push, changement de production, modification de données métier ou migration de production sans autorisation explicite.
M. Une preview liée à Supabase Production n'est jamais un environnement isolé.
N. Ne jamais déclarer PASS un test non exécuté.
O. Tout contrôle bloqué est déclaré BLOCKED avec sa cause exacte et les actions nécessaires.
P. En cas d'échec d'un critère critique : arrêt, diagnostic, pas de poursuite.

### 2.3 Conditions d'arrêt globales

Environnement d'écriture non isolé ; autorisation manquante ; fichier concurrent modifié dans le périmètre sans réconciliation ; définition financière non approuvée ; fuite de données ; invalidation perdue ; résultat financier inexpliqué ; corruption, deadlock ou régression critique ; preuve non rattachable au candidat.

---

## 3. Lots et tâches

```text
L0/T0 — Référence documentaire et gel du périmètre          ← exécuté (documentation seule)
L1/T1 — Contrat métier, temporel et permissions             ← rédigé (definition_version = 1), en attente de validation
L2/T2 — Isolation, dispositif reproductible, exécution async (BLOCKED : ordonnanceur à valider)
L3/T3 — Structures, sécurité, lecteur direct de référence
L4/T4 — Reconstruction asynchrone et reprise
L5/T5 — Invalidation de toutes les écritures pertinentes
L6/T6 — Historique, couverture et rapprochement
L7/T7 — Lecteur agrégé et dashboard vivant
L8/T8 — Validation intégrale, charge et rollback éprouvé
L9/T9 — Activation contrôlée (autorisation distincte obligatoire)
```

Référence des chemins : `R = c:/Users/HP-EXE/Documents/erp ecom/platerform` (chemins absolus).

### 3.1 Contrat commun à toutes les tâches

Chaque tâche exige : identifiant, objectif et justification, état initial vérifié, dépendances, zones de code, modifications exactes et leur ordre, risques et protections, tests automatiques, tests fonctionnels et de sécurité, critères d'acceptation mesurables, preuves attendues, rollback, conditions d'arrêt spécifiques, définition de DONE.

Une tâche est DONE uniquement si ses opérations sont achevées, ses critères mesurables satisfaits, ses tests exécutés, ses preuves enregistrées, son rollback vérifié au niveau exigé, et si aucun contrôle critique n'est FAIL ou BLOCKED.

### 3.2 T0 — Référence documentaire et protection du périmètre — DONE

- **Zones** : `R/memory-bank/dashboard-daily-kpis-architecture.md` (nouveau) ; liens ajoutés dans `activeContext.md`, `systemPatterns.md`, `performance-progress.md`.
- **Modifications** : ADR, règles de suivi, lots, décisions ouvertes, registre de preuves, journal.
- **Interdits respectés** : aucun fichier applicatif modifié, aucune migration, aucune écriture Supabase, aucun push, aucun déploiement.
- **Protection des sessions concurrentes** : `R/components/dashboard/kpi-cards.tsx` et `R/tsconfig.tsbuildinfo` restent modifiés mais **non touchés**.
- **Critères** : une seule ADR de référence ; zéro modification applicative ou SQL ; tous les liens résolvables ; empreintes avant/après consignées (§8, E13).
- **Rollback** : suppression des ajouts documentaires du lot (fichier + liens).
- **Preuves** : §8 (E02, E03, E13) et §9 (journal L0).

### 3.3 T1 — Contrat métier, temporel et permissions — IMPLEMENTED (documentation), NOT VALIDATED

- **Objectif** : figer ce qui doit être précalculé, comment, sur quelles bornes, avec quels droits, avant de fixer des colonnes.
- **Zones** : `R/components/dashboard/kpi-cards.tsx`, `R/components/dashboard/revenue-chart.tsx`, `R/components/dashboard/ads-cost-chart.tsx`, `R/lib/utils.ts`, `R/lib/auth/permissions.ts`, RPC `rpc_dashboard_*`, `rpc_finance_overview`, `rpc_finance_daily_series`, `R/memory-bank/finance-module-plan.md`.
- **Livrable** : `definition_version = 1` rédigé champ par champ (§10) + 16 cas chiffrés (§10.12) + décisions bloquantes (§11.1).
- **Acceptation** : 100 % des champs du futur lecteur couverts **et** zéro arbitrage critique non résolu. → **Première condition satisfaite ; seconde condition en attente** (BL-1 → BL-7, dont BL-4 et BL-5 à valider explicitement).
- **Rollback** : revenir à la version documentaire précédente ; aucun chiffre livré n'a changé.
- **Arrêt spécifique** : désaccord sur CA, publicité, reconnaissance, fuseau ou accès financier.
- **Statut** : `IMPLEMENTED` (documentation) — `NOT VALIDATED`, en attente d'approbation du contrat et des décisions bloquantes.

### 3.4 T2 → T9 — cadrage contractuel

| Tâche | Objectif | Dépendances | Acceptation principale | Rollback |
|---|---|---|---|---|
| T2 | Isolation réelle, dispositif reproductible, exécution asynchrone mesurée | T1 + autorisation d'environnement | Zéro écriture possible vers Production ; reprise démontrée après perte de réveil ; cadence compatible avec la cible | Désactiver les composants isolés ; conserver les résultats |
| T3 | Structures versionnées, RLS, révocations, lecteur direct de référence | T2, T1, autorisation de migration (isolé uniquement) | Égalité exacte avec les cas T1 ; zéro accès interdit ; zéro écriture cliente interne | Désactiver les nouveaux lecteurs ; revenir aux lecteurs historiques |
| T4 | Claim borné, bail, fencing, publication atomique, reprise | T3 | 100 rejeux sans dérive ; aucun événement concurrent perdu ; worker périmé incapable de publier | Pause du worker ; événements conservés ; dashboard sur lecteurs directs |
| T5 | Invalidation de toutes les voies d'écriture (`INSERT`/`UPDATE`/`DELETE`, OLD/NEW, lignes, coûts, publicité, dépenses) | T4 | 100 % des événements du contrat couverts ; zéro agrégation synchrone ajoutée | Désactiver les nouveaux triggers ; noter la plage à reconstruire |
| T6 | Backfill par lots, couverture par boutique et rapprochement avec les sources | T5 | 100 % des journées attendues couvertes ou explicitement marquées ; zéro écart inexpliqué | Retirer le statut « prêt » ; conserver les sources |
| T7 | Lecteur agrégé cohérent, requête partagée, actualisation des onglets | T6 + matrice d'accès + transport de révision | Totaux cartes/séries identiques ; zéro donnée inter-compte ; mise à jour sans rechargement | Sélecteur de retour au lecteur direct ; arrêt des abonnements KPI |
| T8 | Matrice complète, charge, fraîcheur, rollback éprouvé | T7 + budgets approuvés | Tous les contrôles critiques PASS ; cible 5 s évaluée ; budgets respectés | Retour direct éprouvé + rattrapage |
| T9 | Activation progressive et clôture | T8 + autorisations séparées | Les 12 critères globaux satisfaits sur le périmètre approuvé | Lecteur direct d'abord ; pause worker ; événements conservés |

---

## 4. Décisions métier ouvertes (B01 → B14)

**Statut global : ARBITRÉ le 16/10/2026** — voir §10 pour le contrat `definition_version = 1` et §11 pour les réserves. Les exemples chiffrés ci-dessous sont des **reconstructions arithmétiques à partir du SQL inspecté** (§8, E04, E05), jamais des mesures sur données réelles.

### B01 — Définition du CA du dashboard

- **Actuellement démontré** : cartes et graphiques somment `quantity × unit_selling_price` des lignes des commandes `status = 'delivered'` (`rpc_dashboard_kpi_metrics`, `rpc_dashboard_revenue_chart`). La remise au niveau commande (`discount_amount`) et le port facturé au client (`delivery_charge_to_customer`) ne sont **pas** retirés. Une autre RPC historique (`rpc_dashboard_kpi_metrics(p_store_ids)`) expose pourtant `total_delivery_charge`, donc la notion existe ailleurs.
- **Recommandation** : conserver le CA brut des lignes (montant produit) et exposer séparément la remise, le port facturé et le CA net. Ne pas changer la définition maintenant : cela modifierait rétroactivement tous les chiffres affichés. Le précalcul stocke les composantes, le choix d'affichage reste réversible.
- **Exemple** : commande livrée, 2 articles 300 + 200 = 500, remise 50, port facturé 30. Aujourd'hui : CA = 500. Option nette : 500 − 50 + 30 = 480 (ou 450 hors port).
- **Conséquences** : CA brut = comparable à l'existant ; CA net = plus proche du montant encaissable mais rupture de continuité avec l'historique et avec Finances.
- **Choix à approuver** : (a) brut + composantes exposées **[recommandé]** ; (b) net ; (c) deux indicateurs affichés.

### B02 — Date de reconnaissance

- **Actuellement démontré** : le dashboard utilise exclusivement `orders.order_date` (cohorte de commande). Le module Finances reconnaît à la livraison : `coalesce(delivered_at, order_date)`. Les deux périmètres ne sont donc pas comparables sur les périodes glissantes.
- **Recommandation** : conserver `order_date` comme base du dashboard (continuité, cohérence avec les filtres actuels) **et** précalculer en parallèle le CA/coûts par date de livraison, pour permettre un rapprochement Finances sans changer l'existant.
- **Exemple** : commande 500 MAD passée le 30/09, livrée le 02/10. Dashboard : septembre. Finances : octobre. En septembre, carte 500 / Finances 0.
- **Conséquences** : deux dates = deux colonnes par composante ; stockage doublé sur les montants, pas sur les compteurs. Sans cette double date, tout rapprochement futur exigera un backfill complet.
- **Choix à approuver** : (a) `order_date` seul ; (b) **`order_date` + date de livraison en parallèle [recommandé]** ; (c) basculer sur la livraison.

### B03 — Profit dashboard

- **Actuellement démontré** : `profit = CA − achat − livraison − confirmation − publicité`, sans les `expenses`, sans commissions acquises, sans distinction « payé/dû ». `rpc_finance_overview` calcule un **résultat opérationnel** incluant commissions acquises et autres charges, avec indicateurs `data_issues`, `estimated_orders` et `result_is_reliable`.
- **Recommandation** : ne pas fusionner. Conserver une **marge contributive** dans le dashboard (produit, logistique, publicité) et afficher le résultat opérationnel dans Finances. Nommer explicitement chaque indicateur pour lever la confusion actuelle entre « Profit » et résultat.
- **Exemple** : commande 500 ; achat 200 ; livraison 35 ; confirmation 5 ; publicité 60 → marge dashboard = 200. Avec commission acquise 15 et quote-part d'autres charges 40 → résultat opérationnel = 145.
- **Conséquences** : deux chiffres coexistent, désormais libellés sans ambiguïté ; aucun changement de définition imposé par surprise.
- **Choix à approuver** : (a) marge seule ; (b) résultat opérationnel dans le dashboard ; (c) **marge + renvoi explicite vers Finances [recommandé]**.

### B04 — Publicité (règle de repli)

- **Actuellement démontré, et c'est la divergence la plus lourde** :
  - cartes : après agrégation des boutiques, si la dépense réelle de la période est `> 0`, elle est utilisée **seule** ; sinon repli sur la somme des `ads_cost_allocated` de **toutes** les commandes de la période (aucun filtre `delivered`) ;
  - graphique publicité : repli **par bucket**, dès qu'un bucket ne contient aucune ligne `ad_spend_daily`, avec allocations limitées aux commandes `delivered` ;
  - graphique principal : publicité toujours issue des allocations livrées ;
  - Finances : arbitrage **par journée suivie**, une ligne à zéro prouvant que la journée est suivie.
- **Conséquence arithmétique** : la valeur affichée n'est **pas additive** entre jours, entre boutiques et entre périodes.
- **Exemple** : jour J1 suivi, dépense réelle 1 000 ; jour J2 non suivi, allocations livrées 300. Période J1+J2 : carte = 1 000 (réel > 0, allocations ignorées) ; graphique = 1 300 ; J2 seul : carte = 300. Somme des cartes journalières (1 300) ≠ carte de la période (1 000).
- **Recommandation** : adopter la règle Finances — journée suivie ⇒ `ad_spend_daily` fait foi, **même à 0** ; journée non suivie ⇒ repli sur les allocations des commandes de **cette journée** ; exposer `ads_daily_days`, `ads_fallback_days` et `ads_partial_days`. C'est la seule règle additive et elle est déjà opposable.
- **Conséquences** : les totaux publicitaires affichés peuvent **baisser** (fin du double comptage implicite) ; la page Publicité et Finances convergent ; un libellé « estimation par repli » devient nécessaire.
- **Choix à approuver** : (a) garder l'existant ; (b) **règle Finances par journée, avec indicateurs de couverture [recommandé]**.

### B05 — Cohérence cartes / graphiques

- **Actuellement démontré** : mêmes mots, définitions différentes (publicité, profit, filtres de statut, bornes de fin de période). Les écarts ne sont pas seulement des arrondis.
- **Recommandation** : une seule définition par grandeur pour cartes et séries, issue des composantes validées en B01 → B04. Les widgets spécialisés (produits, villes, agents, horaires) gardent leurs lecteurs.
- **Exemple** : avec la règle B04, période de 3 jours dont 1 non suivi : carte et courbe affichent tous deux 1 300 au lieu de 1 000 / 1 300.
- **Conséquences** : une seule valeur visible par grandeur et par période ; l'écart résiduel devient un défaut, non une tolérance.
- **Choix à approuver** : (a) oui, une définition unique **[recommandé]** ; (b) non, différences documentées et assumées.

### B06 — Fuseau métier

- **Actuellement démontré** : `getPeriodRange` (`R/lib/utils.ts`) construit les bornes dans le fuseau du **navigateur** ; la session SQL observée est en `UTC` ; Finances utilise `finance_business_timezone() = 'Africa/Casablanca'` ; `stores` ne possède **aucune colonne de fuseau** (§8, E06, E07).
- **Recommandation** : un fuseau métier explicite par boutique, valeur par défaut `Africa/Casablanca`, utilisé par le précalcul, les lecteurs et les bornes de période. L'historique reste attaché au fuseau en vigueur au moment du calcul, versionné dans la partition. Ne pas convertir rétroactivement les journées déjà validées sans décision explicite.
- **Exemple** : commande à 23:50 locale le 30/09 (22:50 UTC le 30/09 en heure d'été). Aujourd'hui : les bornes locales du navigateur classent juste, mais un navigateur réglé sur UTC classerait la commande au 30/09 également alors que la journée métier peut basculer.
- **Conséquences** : résultats stables quel que soit le navigateur ; changement de fuseau d'une boutique = expansion historique à planifier (décision à prendre au cas par cas).
- **Choix à approuver** : (a) `Africa/Casablanca` global ; (b) **fuseau par boutique, défaut Casablanca [recommandé]** ; (c) conserver le fuseau navigateur.

### B07 — Périodes et comparaisons

- **Actuellement démontré** : les périodes sont calculées côté navigateur, avec une borne de fin **exclusive** (`< p_end_date`) dans les RPC boutique ; le graphique élargit volontairement « aujourd'hui » à 7 jours et « hier » à 7 jours ; la comparaison portait sur la période précédente complète, avec un doublon évité localement quand elle est identique (modification concurrente, §8, E03).
- **Recommandation** : conserver les bornes exclusives et la logique de période précédente ; rendre le comparatif explicite en libellé (« vs période précédente complète »). Conserver l'élargissement de la courbe pour « aujourd'hui » / « hier » (lisibilité), en le documentant comme choix d'affichage et non comme KPI.
- **Exemple** : « mois » au 16/10 = 01/10 → 17/10 exclu (16 jours) comparé à 01/09 → 01/10 (30 jours). Sans mention, une baisse apparente peut n'être qu'un effet de durée.
- **Conséquences** : aucune rupture de continuité ; une source de confusion disparaît.
- **Choix à approuver** : (a) période précédente complète + libellé **[recommandé]** ; (b) durée écoulée équivalente ; (c) masquer le comparatif sur les périodes incomplètes.

### B08 — Périodes partielles

- **Actuellement démontré** : toutes les requêtes filtrent sur une date/heure, jamais sur une journée entière ; « aujourd'hui » et les périodes personnalisées peuvent donc couvrir des journées incomplètes. Aucun lecteur actuel ne distingue une journée partielle d'une journée complète.
- **Recommandation** : le précalcul porte sur des **journées métier complètes** ; pour une borne tombant en milieu de journée, utiliser le lecteur direct de bordure (borné à la période demandée) et signaler « journée en cours ». Ne jamais mélanger agrégat et direct sur la même journée en la présentant comme exacte.
- **Exemple** : à 11:00, « aujourd'hui » = 40 commandes réelles ; l'agrégat de la journée n'est pas comparable à la veille complète (120).
- **Conséquences** : un lecteur direct reste nécessaire pour la journée en cours ; sans lui, la carte du jour serait fausse jusqu'à minuit.
- **Choix à approuver** : (a) **agrégat + lecteur direct de bordure, mention « journée en cours » [recommandé]** ; (b) différer l'affichage de la journée en cours ; (c) agréger en continu la journée courante.

### B09 — Multi-devise

- **Actuellement démontré** : chaque boutique porte sa devise (`stores.currency`) et `ad_spend_daily` stocke déjà `spend_currency`, `currency_convert`, `spend_converted`. La table `exchange_rates` est rattachée à `owner_user_id` (pas à une boutique) avec `base_currency`, `target_currency`, `rate`, `rate_date`, `source_type`. En mode « Tous les magasins », l'agrégation actuelle **additionne les montants bruts** sans conversion.
- **Recommandation** : (1) par défaut, ne jamais additionner deux devises : afficher les totaux **par devise** ou choisir explicitement une devise de référence ; (2) si une consolidation est exigée, convertir avec un taux daté (`exchange_rates.rate_date` ≤ date de la journée) et **ne pas afficher** une journée sans taux, plutôt que d'en inventer un ; ne pas appliquer le taux du jour à l'historique.
- **Exemple** : boutique A 10 000 MAD, boutique B 2 000 EUR, taux retenu 1 EUR = 10,8 MAD → consolidé 31 600 MAD ; sans taux pour une journée, la consolidation est incomplète et doit être signalée. Aujourd'hui l'affichage donne « 12 000 », qui ne correspond à aucune devise.
- **Conséquences** : nécessite une devise de référence et un stockage soit par devise, soit avec la devise de taux ; la consolidation peut être indisponible certains jours.
- **Choix à approuver** : (a) **totaux par devise, aucune addition implicite [recommandé]** ; (b) consolidation avec devise de référence et taux daté, refus si taux manquant ; (c) laisser l'addition brute actuelle, documentée comme non fiable.

### B10 — Permissions et visibilité des coûts

- **Actuellement démontré** : `dashboard.view` est accordé à `owner`, `admin`, `accountant`, `marketer`, `viewer`. Les RPC dashboard vérifient seulement une **appartenance active**, pas une permission : un membre `confirmation`, `delivery` ou `stock_manager` peut appeler la RPC et lire CA, coût d'achat et marge, alors qu'il n'a pas `dashboard.view`. Les RPC Finances utilisent au contraire `can_view_store_finances()` (`owner`/`admin`/`accountant`). Les privilèges `EXECUTE` de plusieurs RPC dashboard sont ouverts à `PUBLIC`/`anon` : le corps refuse `anon` faute d'appartenance, mais la défense en profondeur manque.
- **Recommandation** : matrice explicite appliquée **en base** — commandes, volumes et CA : `owner`, `admin`, `accountant`, `viewer`, `marketer` ; coût d'achat, marge et publicité : `owner`, `admin`, `accountant` (+ `marketer` pour la seule publicité si confirmé). Révoquer `EXECUTE` à `anon`/`PUBLIC` sur les RPC dashboard et vérifier la permission en plus de l'appartenance.
- **Exemple** : un `viewer` voit 3 400 commandes et 1,2 M MAD de CA, mais ni le coût d'achat (620 000) ni la marge (180 000).
- **Conséquences** : certains rôles perdent des compteurs financiers visibles aujourd'hui ; le masquage doit être réel côté base, pas seulement dans l'interface.
- **Choix à approuver** : (a) **matrice ci-dessus [recommandé]** ; (b) tous les porteurs de `dashboard.view` voient tout, avec appartenance et révocations renforcées ; (c) autre répartition, à préciser rôle par rôle.

### B11 — Retours, commandes sans lignes et données estimées

- **Actuellement démontré** : seules les commandes `delivered` alimentent CA et coûts ; les retours (`returned_stocked`, `returned_not_stocked`) ne sont pas déduits ; une commande livrée sans lignes contribue 0 au CA et 0 au coût mais **augmente le dénominateur** du panier moyen (`revenue / delivered_count`) et du taux de livraison. Finances expose déjà `data_issues`, `estimated_orders` et `result_is_reliable` (dont écart lignes/total > 0,01 et coût produit nul avec CA > 0).
- **Recommandation** : reprendre les mêmes indicateurs de qualité dans le dashboard : compter les retours séparément sans les déduire du CA, exposer les commandes sans lignes et `data_issues`, et afficher « estimé » ou « à vérifier » au lieu d'un chiffre silencieusement faussé. Ne jamais compenser un retour en réduisant le CA de la période courante.
- **Exemple** : 10 commandes livrées dont 1 sans lignes, CA réel 9 000 → panier moyen affiché 900 au lieu de 1 000.
- **Conséquences** : libellés supplémentaires ; les chiffres ne changent pas, leur fiabilité devient visible.
- **Choix à approuver** : (a) **mêmes indicateurs de qualité que Finances [recommandé]** ; (b) chiffres seuls, sans indicateur ; (c) exclure du dénominateur les commandes sans lignes.

### B12 — Cible de fraîcheur (SLO)

- **Actuellement démontré** : aucun mécanisme de fraîcheur KPI n'existe ; le seul rafraîchissement périodique identifié est celui du suivi livraison, à **10 secondes** (`POLL_INTERVAL_MS = 10_000`, `R/components/dashboard/delivery-tracking-status.tsx`) ; un cron quotidien existe pour Facebook Ads. Aucune mesure de fraîcheur n'a été réalisée.
- **Recommandation** : un point de départ unique et mesurable — **le commit de la transaction métier dans JISRA** — jusqu'à l'affichage actualisé dans un onglet ouvert. Proposition : `p95 < 5 s`, `p99 < 15 s`, aucun dépassement > 60 s en fonctionnement normal ; au moins 1 000 événements représentatifs sur 7 jours consécutifs ; exclusions limitées aux incidents de plateforme déclarés. La latence d'ingestion externe (Meta, transporteur) est mesurée **séparément** et n'entre pas dans ce SLO.
- **Exemple** : sur 1 000 modifications, 950 actualisées en ≤ 4,2 s et 990 en ≤ 11 s → PASS ; p95 = 7 s → FAIL, arrêt et nouvelle décision produit, sans tolérance implicite.
- **Conséquences** : impose un ordonnanceur réellement réactif (voir §5 et L2) et interdit de présenter un polling de 10 s comme conforme.
- **Choix à approuver** : (a) **p95 < 5 s / p99 < 15 s / max normal 60 s, ≥ 1 000 événements sur 7 jours [recommandé]** ; (b) cible plus stricte ; (c) cible assouplie, chiffrée et justifiée.

### B13 — Budgets PostgreSQL (écritures et lectures)

- **Actuellement démontré** : chaque écriture de commande déclenche déjà plusieurs triggers (`set_orders_updated_at`, `trg_set_order_status_timestamps`, `trg_orders_set_profit_before_write`, `trg_handle_order_status_inventory`, `trg_allocate_ads_on_orders`…) ; `order_items` déclenche un recalcul financier de la commande ; `ad_spend_daily` porte **deux** triggers d'allocation déléguant au même calcul. Aucune mesure de charge de ces écritures n'est disponible, et l'audit précédent signale des incidents Supabase (dont des `5xx` Auth massifs) sans baseline comparable.
- **Recommandation** : rendre les budgets opposables **avant** L4/L5, sur un environnement isolé : surcoût médian d'écriture d'une commande et d'un lot d'import ≤ 15 % et p95 ≤ 25 % par rapport au même scénario sans invalidation ; aucun verrou dépassant 50 ms sur `orders`/`order_items`/`ad_spend_daily` ; backlog d'invalidation revenant à zéro en moins de 30 s après la fin d'un import ; aucune augmentation des `deadlock` ou `lock timeout`.
- **Exemple** : import de 500 commandes mesuré à 1,20 s avant, 1,32 s après (≈ +10 %) → PASS ; 1,70 s (≈ +42 %) → FAIL et arrêt, car H interdit un calcul lourd dans le trigger synchrone.
- **Conséquences** : impose de mesurer avant de généraliser les triggers d'invalidation ; peut conduire à regrouper les invalidations d'un import en une seule opération.
- **Choix à approuver** : (a) **budgets ci-dessus [recommandé]** ; (b) budgets plus stricts ; (c) budgets à fixer après une première mesure exploratoire (à autoriser explicitement).

### B14 — Couverture incomplète

- **Actuellement démontré** : aucun lecteur ne signale une journée non calculée. Une somme sur des journées absentes produit aujourd'hui un total **inférieur à la réalité, sans aucun signal**. Le dashboard n'expose pas non plus de date de fraîcheur.
- **Recommandation** : la réponse du lecteur porte une information de couverture (journées attendues, calculées, en attente) et une révision. Si une journée de la période est en attente : soit servir temporairement le lecteur direct **borné à la période demandée** avec la mention « en cours d'actualisation », soit refuser d'afficher un total présenté comme définitif. Ne jamais substituer un zéro à une journée inconnue.
- **Exemple** : période de 10 jours, 9 calculées, CA obtenu 8 600 ; le total réel est 9 400 → affichage « 8 600 (1 journée en cours d'actualisation) » après quelques secondes, et non « 8 600 » définitif.
- **Conséquences** : un état de couverture doit être stocké et lu ; le lecteur direct reste une dépendance de secours pendant la période de chauffe d'une journée.
- **Choix à approuver** : (a) **couverture exposée + lecteur direct borné pendant l'attente [recommandé]** ; (b) afficher uniquement les journées disponibles, avec mention explicite ; (c) bloquer l'affichage jusqu'à couverture complète.

---

## 5. Simplification des structures proposées

Les quatre structures du plan initial ont été réexaminées. **Résultat : trois structures suffisent**, la table de baux séparée étant inutile.

| Structure proposée au plan | Verdict | Justification |
|---|---|---|
| `dashboard_daily_metrics` | **Nécessaire** | Cœur du dispositif : partitions additives, versionnées, couverture, révision publiée. Sans elle, aucune lecture bornée n'est possible. |
| `dashboard_kpi_invalidation_events` | **Nécessaire, mais porte aussi le bail** | Le journal append-only évite le verrou de ligne partagé entre écritures concurrentes d'une même journée. C'est son avantage décisif : une table « journée sale » avec `UPSERT` unique sérialiserait toutes les écritures simultanées de la même boutique/journée jusqu'au commit. |
| `dashboard_kpi_rebuild_leases` | **Supprimée** | Le bail peut vivre **sur la ligne de journal** (`claimed_by`, `lease_expires_at`, `attempts`, `token`). Une ligne = un événement = un bail. Aucune garantie perdue : le fencing reste vérifié dans la transaction de publication. |
| `dashboard_kpi_store_state` | **Nécessaire, mais minimale** | 1 ligne par boutique : révision publiée, état de backfill, définition active, couverture. Une révision calculée par `max()` sur les partitions serait une lecture non atomique, incapable d'exprimer « couverture incomplète » ou « backfill en cours ». |

**Variante étudiée et écartée** : une seule table `dirty` avec compteur et bail intégré. Plus simple à lire, mais introduit un point de contention sur la journée chaude pendant les imports et les confirmations simultanées (H interdit d'ajouter du coût synchrone, et la protection par `FOR UPDATE` au commit prolongerait les transactions métier).

**Variante étudiée et écartée** : file externe (Redis, service de messages). Nouvelle dépendance, pas de rejeu durable garanti côté base, et perte de la garantie « l'invalidation est commitée avec l'écriture métier ».

**Arbitrage demandé (S01)** : approuver la réduction de 4 à **3 structures** (métriques + journal d'invalidation avec bail + état par boutique). Cette réduction ne change ni les garanties ni la matrice de validation ; elle remplace l'étape « claims/leases » du lot T4 par un claim sur le journal. En cas de constat inverse (contention mesurée sur le journal), la 4ᵉ structure sera réintroduite avec la mesure à l'appui.

---

## 6. Dispositif de validation

**État : les contrôles V01 → V22 sont `NOT RUN` pour cette architecture.** Aucun d'eux n'est un PASS.

| ID | Contrôle | PASS | FAIL / arrêt |
|---|---|---|---|
| V01 | Calculs unitaires des KPI sur cas approuvés | Résultats exacts ; ratios recalculés depuis les totaux | Écart de formule ou d'arrondi non approuvé |
| V02 | Direct vs agrégé | Comptages et décimales identiques, mêmes sources et bornes | Écart inexpliqué |
| V03 | Événements d'invalidation par mutation | Ensemble attendu de partitions | Partition absente |
| V04 | OLD/NEW (date, boutique, parent d'une ligne) | Ancienne **et** nouvelle partition corrigées | Agrégat d'origine conservé |
| V05 | Suppressions et cascades | Retour au résultat direct après suppression | Parent ou publicité oubliés |
| V06 | Publicité (jour suivi à 0, non suivi, sources mixtes, changement de granularité) | Conforme à B04 | Double comptage ou mauvais repli |
| V07 | Coûts manuels et commissions | Coût manuel conservé ; événements de commission corrects | Réécriture ou double charge |
| V08 | Fuseaux et bornes | Correct aux minuits, heures d'été, bornes exclusives | Dépendance involontaire au navigateur |
| V09 | Idempotence | 100 rejeux sans dérive numérique | Toute dérive |
| V10 | Concurrence | Deux workers + écriture pendant calcul : ni perte ni publication tardive | Publication obsolète |
| V11 | Reprise | Crash, bail expiré, réveil perdu récupérés seuls | Travail bloqué définitivement |
| V12 | Isolation des boutiques | Zéro ligne, montant ou événement non autorisé | Toute fuite |
| V13 | Rôles et révocation | RPC, REST et abonnement appliquent la matrice B10 | Accès conservé ou refus contraire |
| V14 | Couverture | Trou injecté détecté ; zéro jamais utilisé pour masquer l'inconnu | Faux état « complet » |
| V15 | Dashboard vivant | Changement externe visible sans rechargement ; reconnexion rattrapée | Rechargement nécessaire |
| V16 | Fraîcheur de bout en bout | SLO de B12 respecté, mesures corrélées | Dépassement critique ou mesure invérifiable |
| V17 | Lectures | Budgets de latence/charge respectés ; lecteur principal sur agrégats | Scan métier réintroduit ou saturation |
| V18 | Écritures | Budgets de B13 respectés sous mutations et imports | Contention, deadlock, dépassement |
| V19 | Finances (non-régression) | Contrat existant inchangé ; différences dashboard documentées | Changement financier implicite |
| V20 | Auth et cache | A→B, logout, retour arrière, expiration, changement de boutique sans fuite | Données privées résiduelles |
| V21 | Intégrations | Imports, Meta et livraison produisent les invalidations attendues | Voie d'écriture oubliée |
| V22 | Rollback et reprise | Retour direct puis rattrapage réussis sans perte | Retour impossible ou résultat faux |

**Jeu de données reproductible** : boutique vide et boutique active ; devises identiques puis différentes ; toutes les familles de statuts ; commande sans lignes ; coût manuel ; publicité suivie à zéro ; journées suivies/non suivies dans une même période ; publicité sans vente ; remises, port, autres dépenses ; date historique corrigée ; périodes aujourd'hui, hier, semaine, mois, année, toujours, personnalisée ; frontières du fuseau retenu.

**Format de rapport** : `run_id | test_id | SHA/diff | schema_hash | definition_version | environnement | dataset | scénario | attendu | observé | statut | preuve | cause_blocage`. Aucun secret, cookie, token ni donnée personnelle.

---

## 7. Risques et rollback

| Risque | Protection | Déclencheur de rollback |
|---|---|---|
| Résultat faux | Oracle direct + composantes séparées | Tout écart financier inexpliqué |
| Fuite multi-boutiques ou multi-rôles | Contrôles base, REST, RPC, abonnement, cache | Tout accès interdit |
| Événement perdu | Journal transactionnel, fencing, reprise indépendante | Invalidation absente ou acquittée à tort |
| Écritures ralenties | Trigger minimal, journal append-only, worker borné | Dépassement des budgets B13 |
| Worker en retard ou arrêté | Backlog observable, relance hors bande | Fraîcheur hors SLO B12 |
| Backfill trop lourd | Lots bornés, priorité au courant | Charge hors budget |
| Migration divergente | Inventaire et bootstrap isolé fidèle | Schéma inattendu |
| Session concurrente écrasée | Empreintes, périmètre explicite | Diff non attribuable |

**Ordre de retour arrière** : (1) rebasculer vers le lecteur direct **portant le même contrat** ; (2) désactiver l'actualisation KPI si elle boucle ou fuit ; (3) suspendre le worker ; (4) suspendre les nouveaux producteurs d'invalidation seulement si leur coût est la cause — en notant alors la plage à reconstruire ; (5) conserver sources et journal ; (6) migrations compensatoires après analyse, aucun `DROP` précipité ; (7) tester le rattrapage avant réactivation.

**Point contractuel** : si une définition financière a changé avec accord, revenir au frontend précédent réintroduirait l'ancienne définition. La voie de retour doit porter le contrat approuvé.

---

## 8. Registre des éléments déjà vérifiés

Ce registre évite de refaire les mêmes investigations. **Il ne dispense pas de revérifier un élément dont l'empreinte a changé.** Aucun élément de la colonne « statut » ne constitue un test de performance.

| ID | Élément | Statut | Réinspection nécessaire seulement si |
|---|---|---|---|
| E01 | Organisation Memory Bank et audits existants | Vérifié (lecture) | Documents modifiés |
| E02 | HEAD `1228e45eff17cc066000d838c31577c036eb3962`, branche `perf/login-dashboard-bootstrap`, fichiers modifiés | Vérifié | Nouvel état Git |
| E03 | Modification concurrente de `components/dashboard/kpi-cards.tsx` (CA sans second calcul, période précédente identique réutilisée) | Vérifié statiquement — **non validée fonctionnellement** | Hash du fichier modifié |
| E04 | Corps SQL des RPC principales (`rpc_dashboard_kpi_metrics` ×2 surcharges, `rpc_dashboard_revenue_chart` ×2, `rpc_dashboard_ads_cost_chart`) | Vérifié (catalogue) | `definition_hash` modifié |
| E05 | Contrat Finances (`rpc_finance_overview`, `finance_business_timezone`, `can_view_store_finances`) | Vérifié (catalogue + doc) | Contrat ou fonctions modifiés |
| E06 | Fuseaux : navigateur (frontend), `UTC` (session SQL observée), `Africa/Casablanca` (Finances) | Vérifié | Code ou configuration modifiés |
| E07 | `stores` sans colonne de fuseau ; `exchange_rates` portée par `owner_user_id` | Vérifié (catalogue) | Migration pertinente |
| E08 | Absence de table ou d'agrégat KPI dédié | Vérifié (catalogue) | Migration pertinente |
| E09 | Extensions : `plpgsql`, `pg_stat_statements`, `uuid-ossp`, `pgcrypto`, `supabase_vault` — **pas** `pg_cron`/`pg_net` ; `supabase_realtime` sans table publiée | Vérifié | Configuration modifiée |
| E10 | Écart migrations : **149 fichiers locaux** / **264 migrations** enregistrées en base ; dernière en base `20261014212643` | Vérifié | Inventaire modifié |
| E11 | Triggers d'allocation publicitaire (`trg_allocate_ad_spend`, `trg_allocate_ads_from_ad_spend`, `trg_allocate_ads_from_orders`) et triggers de commande/lignes | Vérifié (définitions) | Trigger ou fonction modifié |
| E12 | Performance et fraîcheur de l'architecture cible | **NOT RUN — aucune mesure** | À établir en T8 |
| E13 | Empreintes avant/après du lot L0 (§8.1) | Vérifié | Fichier documentaire modifié |

### 8.1 Empreintes avant / après — lot L0

| Fichier | Empreinte **avant** L0 | Empreinte **après** L0 |
|---|---|---|
| `memory-bank/activeContext.md` | `a52dec51b7b30d79e9326fb97a74b0358aad86d0` | `4d55fb1f39ca8a12089dcae3128e7800a7f57987` |
| `memory-bank/systemPatterns.md` | `2f2a4c41dbd5c1f7d2f7d6a8ce93c451e1041816` | `075096a3c4557728012c6293c8b31328c7bf788f` |
| `memory-bank/performance-progress.md` | `6363ff61eeba245795da2fc637d0b83fd702512f` | `3f2dc5b791b1dd8c663089307e8a480dac0257ad` |
| `memory-bank/dashboard-daily-kpis-architecture.md` | *(inexistant)* | **Volontairement non auto-référencé** : toute empreinte stockée dans ce document deviendrait obsolète dès l'écriture de la cellule qui la contient. L'empreinte est consignée dans le rapport de clôture de L0 (§9.1, « Preuve d'intégrité ») et recalculable par `git hash-object memory-bank/dashboard-daily-kpis-architecture.md`. Valeur relevée à l'état intermédiaire (409 lignes, avant §8 et §9) : `be1c33b31229f9ee1d3455baabea1ccf37bc276e` |
| `components/dashboard/kpi-cards.tsx` (session concurrente) | `ec438d99106dcafb75e77fa7d6099e706fbafa44` | `ec438d99106dcafb75e77fa7d6099e706fbafa44` — **inchangé par L0** |
| `lib/utils.ts` | `95d4ae5f2def865bfdb6c03c2f1146481352ca28` | inchangé par L0 |
| `lib/auth/permissions.ts` | `5351b4435c736de67eb9eb200b658f3a10381cd9` | inchangé par L0 |
| `supabase/migrations/` | 149 fichiers | inchangé par L0 |

Empreintes SQL de référence (MD5 de `pg_get_functiondef`) : `rpc_dashboard_kpi_metrics(p_store_id)` = `40cd8dd2eb6564c3af99b00262992a4f` ; `rpc_dashboard_revenue_chart(p_store_id)` = `c522646969fc306a0771a6b234dac25b` ; `rpc_dashboard_ads_cost_chart` = `f330ec082b062a12af1d5fb90eeff231` ; `rpc_finance_overview` = `65b099ee55b7aaa115dd544ce68fdee4` ; `rpc_finance_daily_series` = `f33bcf674c2a5771cf76eb7a5736fe74` ; `order_purchase_cost` = `0e383daa282b010a4af2cf1b21fb3757` ; `can_view_store_finances` = `624abdf7e427b118152f023769d8263d` ; `finance_business_timezone` = `f633590400eb6d602f994679ae24b234`.

### 8.2 Empreintes après L1 (contrôle de non-régression des audits)

| Fichier / objet | Empreinte après L1 | Comparaison |
|---|---|---|
| `memory-bank/activeContext.md` | `d8636edb9648099bdd519d891a128d4a36f1996b` | **modifié par L1** (statut du chantier) ; `--numstat` inchangé : 2/0 |
| `memory-bank/systemPatterns.md` | `075096a3c4557728012c6293c8b31328c7bf788f` | **inchangé depuis L0** |
| `memory-bank/performance-progress.md` | `3f2dc5b791b1dd8c663089307e8a480dac0257ad` | **inchangé depuis L0** |
| `components/dashboard/kpi-cards.tsx` (session concurrente) | `ec438d99106dcafb75e77fa7d6099e706fbafa44` | **inchangé** (aucune réécriture) |
| `lib/utils.ts` | `95d4ae5f2def865bfdb6c03c2f1146481352ca28` | **inchangé** |
| `lib/auth/permissions.ts` | `5351b4435c736de67eb9eb200b658f3a10381cd9` | **inchangé** |
| RPC dashboard / Finances / helpers | hashes E04 et E05 **identiques** à L0 | **aucun audit SQL à refaire** |
| `stores` | **toujours sans colonne de fuseau** ; `exchange_rates` toujours portée par `owner_user_id`, `rate_date` de type `date` | E07 confirmé |

**Nouveaux faits mesurés en lecture seule pendant L1** (aucune écriture) : 3 663 commandes ; familles affichées = 3 648 lignes ; **15 commandes non classées** (`refused` 2, `dl_no_answer` 1, `dl_pickup_pending` 11, `dl_client_interested` 1) ; **372 couples `(store, jour)` suivis** dans `ad_spend_daily` ; `orders_status_check` autorise 29 statuts dont 13 `dl_*` et `refused` ; `orders` ne porte **aucune** colonne d'encaissement (`payment_status` inexistante) — cohérent avec « livré ≠ encaissé » ; le total de commande est `orders.total_selling_price` (pas de `total_amount`).

### 8.3 Empreintes après T2.1 (contrôle de non-régression)

| Fichier / objet | Empreinte après T2.1 | Comparaison |
|---|---|---|
| `memory-bank/activeContext.md` | `3d2032851c073fecdd332f775c176bee2c5e59b5` | **modifié** (statut T2.1) ; `--numstat` inchangé 2/0 |
| `memory-bank/systemPatterns.md` | `075096a3c4557728012c6293c8b31328c7bf788f` | **inchangé depuis L0** |
| `memory-bank/performance-progress.md` | `3f2dc5b791b1dd8c663089307e8a480dac0257ad` | **inchangé depuis L0** |
| `components/dashboard/kpi-cards.tsx` (session concurrente) | `ec438d99106dcafb75e77fa7d6099e706fbafa44` | **inchangé** |
| `lib/utils.ts` / `lib/auth/permissions.ts` | `95d4ae5f…` / `5351b443…` | **inchangés** |
| RPC dashboard / Finances / helpers | hashes E04/E05 **identiques** à L0 | **aucun audit SQL repris** |
| Extensions base | `plpgsql`, `pg_stat_statements`, `uuid-ossp`, `pgcrypto`, `supabase_vault` — **ni `pg_net` ni `pg_cron`** | E09 **confirmé** après T2.1 |
| Objets SQL | **aucun objet créé, modifié ou supprimé** ; aucun fichier dans `supabase/migrations/` | confirmé par `git status` |

**Nouveaux faits mesurés pendant T2.1** (aucune écriture, aucune donnée personnelle) : fenêtre `pg_stat_statements` depuis le 13/03/2026 ; ≈ 32 100 appels RPC dashboard/Finances ; `deadlocks = 0` ; 397 944 fichiers temporaires cumulés ; `orders` 3 663 lignes vivantes / 423 mortes ; 264 enregistrements de migration en base contre 149 fichiers locaux.

### 8.4 Empreintes après T2.2 (contrôle de non-régression)

| Fichier / objet | Empreinte après T2.2 | Comparaison |
|---|---|---|
| `memory-bank/activeContext.md` | `6cd5663743d2feb56d223a29ede5c379ca21d3b4` | **modifié** (statut T2.2) ; `--numstat` inchangé 2/0 |
| `memory-bank/systemPatterns.md` | `075096a3c4557728012c6293c8b31328c7bf788f` | **inchangé depuis L0** |
| `memory-bank/performance-progress.md` | `3f2dc5b791b1dd8c663089307e8a480dac0257ad` | **inchangé depuis L0** |
| `components/dashboard/kpi-cards.tsx` (session concurrente) | `ec438d99106dcafb75e77fa7d6099e706fbafa44` | **inchangé** |
| `supabase/migrations/` | 149 fichiers, **aucun ajout** | confirmé par `git status` |
| Extensions base | `pg_net`/`pg_cron` **toujours non installés** (préchargés mais inactifs) ; aucun objet créé | confirmé par `pg_extension` |
| Artefact externe | `~/Documents/jisra-kpi-artifacts/T2.2-D1-CAPTURE.md` (104 lignes, 8 413 octets) | **hors dépôt**, aucune donnée métier, aucun secret |

**Empreinte de structure de production après T2.2** : `0721edb93bed11d0303820739cc61cc3` (5 095 objets) — **identique** à la mesure de T2.1, ce qui prouve qu'aucune structure n'a été modifiée pendant T2.1 et T2.2.

### 8.5 Empreintes après T2.3 (dépôt et artefacts hors dépôt)

| Fichier / objet | Empreinte après T2.3 | Comparaison |
|---|---|---|
| `memory-bank/activeContext.md` | `654a3f12766488ef2162015f73a4ccfd46da68d0` | **modifié** (statut T2.3) ; `--numstat` inchangé 2/0 |
| `memory-bank/systemPatterns.md` | `075096a3c4557728012c6293c8b31328c7bf788f` | **inchangé depuis L0** |
| `memory-bank/performance-progress.md` | `3f2dc5b791b1dd8c663089307e8a480dac0257ad` | **inchangé depuis L0** |
| `components/dashboard/kpi-cards.tsx` (session concurrente) | `ec438d99106dcafb75e77fa7d6099e706fbafa44` | **inchangé** |
| `supabase/migrations/` | 149 fichiers, **aucun ajout** | confirmé par `git status` |
| Objets SQL en production | **aucun objet créé/modifié/supprimé** ; `pg_net`/`pg_cron` toujours non installés | confirmé par catalogue |

**Artefacts de préparation T2.3 (hors dépôt, `~/Documents/jisra-kpi-artifacts/T2.3/`)** :

| Fichier | Empreinte |
|---|---|
| `sql/01_kpi_tables.sql` | `d5aa6ee19a2dc8f01ccec6eef544614096cf2cc2` |
| `sql/02_kpi_rebuild.sql` | `0ebc44910331a3f5bb699fdd7732bea3e2c23118` |
| `sql/03_kpi_wakeup.sql` | `c7257170912638614c280f8942f6593816ec0622` |
| `sql/04_kpi_hardening.sql` | `0c89f8fe231f7edbb8c337d0a9a45e71dddc420a` |
| `sql/05_backfill_and_health.sql` | `4115b7e6bd25c02133db8e31eb8ab2180657d23b` |
| `sql/06_baseline_generator.sql` | `fc27ff57330c9d359c7d0879b1e606dfb749ee4c` |
| `tools/inventory.json` | `d53b4819ea1123203197e216752884f313658afa` |
| `tools/static-check.mjs` | `9ce9390c63d15e697e4654cf7bbc1da985e8464e` |
| `protocols/measurement-protocol.md` | `1cc812cc1471764dc81ff43be8549adb3e38b5f9` |
| `runbook/progressive-execution-rollback.md` | `5180d36b175582be64366346c3d8b145b8b09ddf` |
| `README.md` | `c8ae330b5709265c8a5e9b59eef394d3f452d4cb` |
| `T2.2-D1-CAPTURE.md` (T2.2) | `6125781f2ea7341f2c6008097a0f8df811e19ea5` |

Aucun de ces fichiers n'est présent dans le dépôt (`git status --porcelain` : aucune entrée correspondante).




---

## 9. Journal d'exécution

### 9.1 L0 / JISRA-KPI-T0 — 16 octobre 2026 — documentation seule

**Agent :** Cline — **Branche :** `perf/login-dashboard-bootstrap` — **HEAD :** `1228e45eff17cc066000d838c31577c036eb3962`
**Environnement :** dépôt local ; Supabase consulté **en lecture seule** (catalogues uniquement).

#### Modifications réalisées

| Fichier | Nature |
|---|---|
| `memory-bank/dashboard-daily-kpis-architecture.md` | **Créé** : ADR-DASH-001, règles de suivi, lots L0 → L9, décisions B01 → B14, analyse de simplification, matrice V01 → V22, risques/rollback, registre de preuves, ce journal |
| `memory-bank/activeContext.md` | **+2 lignes** : renvoi vers le document de référence |
| `memory-bank/systemPatterns.md` | **+2 lignes** : le seuil 500k est remplacé par ADR-DASH-001 |
| `memory-bank/performance-progress.md` | **+10/−1 lignes** : section 9 de renvoi (chantier distinct) |

**Aucune autre modification.** `components/dashboard/kpi-cards.tsx` (session concurrente) et `tsconfig.tsbuildinfo` restent tels quels — empreinte identique.

#### Tests effectués

| Test | Méthode | Résultat observé | Statut |
|---|---|---|---|
| Contrôle du périmètre modifié | `git status --short` | 3 documentaires modifiés + 1 nouveau (`??`) ; `kpi-cards.tsx` et `tsconfig.tsbuildinfo` toujours modifiés par la session concurrente, **non touchés** | **PASS** |
| Empreintes avant/après | `git hash-object` | Consignées en §8.1 ; `kpi-cards.tsx` identique avant/après L0 | **PASS** |
| Contrôle des espaces parasites | `git diff --check` | Aucun défaut ; seul un avertissement `LF will be replaced by CRLF` (`core.autocrlf=true`) | **PASS** |
| Absence de secret dans le périmètre | Lecture du diff documentaire | Aucun secret, token, cookie ni donnée personnelle | **PASS** |
| Diffs réellement minimaux | `git diff --numstat memory-bank/` | `activeContext` 2/0, `systemPatterns` 2/0, `performance-progress` 10/1 | **PASS** |
| Aucun fichier applicatif ou SQL modifié par L0 | `git status` + empreintes | Confirmé | **PASS** |

#### Preuves

Empreintes §8.1 ; état Git ci-dessus ; diff des trois fichiers documentaires ; aucune entrée `??` autre que le nouveau document.
Le présent document n'est **pas** auto-référencé : son empreinte est fournie dans le rapport de clôture de L0 (valeur recalculable par `git hash-object memory-bank/dashboard-daily-kpis-architecture.md`).

#### Limitations et blocages

- Le document de référence est **non suivi par Git** : un nettoyage de la copie de travail le supprimerait avant tout ajout explicite. Aucun commit n'est autorisé à ce stade.
- Aucun test de code, de schéma ou de performance n'a été exécuté — aucun n'était requis par T0.
- L'écart migrations base/local (E10) **reste ouvert** et bloque L2/L3 ; il n'a pas été réparé (aucune migration autorisée).
- Le mécanisme d'exécution asynchrone réactif (< 5 s) **n'est pas démontré** : `pg_cron` et `pg_net` ne sont pas installés (E09). C'est le risque bloquant de L2.

#### Décision du lot

**L0 : VALIDATED (documentation).** Critères T0 satisfaits ; aucun critère critique en FAIL ou BLOCKED sur ce périmètre documentaire.
**L1 : PLANNED — en attente d'arbitrage B01 → B14 et S01.** Aucune exécution de L2 engagée.

#### Prochaine action

Arbitrage du propriétaire sur B01 → B14 et S01, puis rédaction du contrat `definition_version = 1` (T1). Aucun travail sur l'environnement, le schéma ou le worker sans autorisation explicite.


---

### 9.2 L1 / JISRA-KPI-T1 — 16 octobre 2026 — contrat versionné (documentation seule)

**Agent :** Cline — **HEAD :** `1228e45eff17cc066000d838c31577c036eb3962` — **Environnement :** dépôt local ; Supabase en **lecture seule** (catalogues et agrégats bornés uniquement).

#### Modifications réalisées

| Fichier | Nature |
|---|---|
| `memory-bank/dashboard-daily-kpis-architecture.md` | **§10** contrat `definition_version = 1` (conventions, compteurs, montants, ratios, publicité et écarts attendus, fuseau/périodes/journées en cours, devise, permissions, qualité, fraîcheur, budgets, couverture, 16 cas chiffrés) ; **§11** décisions bloquantes BL-1 → BL-7 et réserves ; mise à jour du statut, de §3.3 et de §4 |
| `memory-bank/activeContext.md` | **1 ligne modifiée** (`--numstat` 2/0, inchangé) : statut du chantier (L0 + L1, `NOT VALIDATED`, décisions bloquantes) |

**Aucune autre modification.** Aucune ligne de code, aucun SQL, aucune migration, aucune écriture Supabase, aucun push, aucun déploiement.

#### Tests effectués

| Contrôle | Méthode | Résultat observé | Statut |
|---|---|---|---|
| Non-régression des audits validés | `git hash-object` + MD5 des fonctions | Empreintes E04/E05/E06/E07 **identiques** à L0 → aucun audit repris | **PASS** |
| Périmètre | `git status --short` | 3 documentaires modifiés + 1 nouveau ; `kpi-cards.tsx` et `tsconfig.tsbuildinfo` **non touchés** | **PASS** |
| Diffs minimaux | `git diff --numstat memory-bank/` | 2/0, 2/0, 10/1 | **PASS** |
| Espaces parasites | `git diff --check` | Aucun défaut | **PASS** |
| Absence de secret | Lecture du diff | Aucun secret, token, cookie ni donnée personnelle | **PASS** |
| Complétude du contrat | Revue champ par champ (§10.0 → §10.11) | Tous les champs du futur lecteur ont source, formule, statut, période, fuseau, devise, permission et qualité | **PASS** |
| Cas chiffrés | §10.12 (C01 → C16) | Rédigés ; **non exécutés** | **NOT RUN** |
| Mesure des faits de qualité | 2 agrégats bornés en lecture seule | 3 663 commandes / 15 non classées (0,41 %) ; 372 couples `(store, jour)` suivis | **PASS** (constat, pas un test de performance) |
| Tests de code, schéma, performance | — | Aucun requis par T1 ; aucun exécuté | **NOT RUN** |

#### Preuves

Empreintes §8.2 ; état Git ; diff documentaire ; faits mesurés en lecture seule (§8.2).

#### Limitations et blocages

- Le contrat est **complet mais non approuvé** : BL-4 (permissions sur les coûts) et BL-5 (périodes provisoires, devise, fuseau) exigent une décision explicite du propriétaire.
- Aucune valeur de fraîcheur ni de performance n'est mesurable avant L2 (BL-1, BL-7).
- L'écart migrations 149/264 (BL-2) reste ouvert : il conditionne tout bootstrap isolé.
- Les 16 cas chiffrés ne pourront être exécutés qu'après création d'un environnement isolé (BL-3).

#### Décision du lot

**L1 : IMPLEMENTED (documentation) — NOT VALIDATED.** Le critère « 100 % des champs couverts » est satisfait ; le critère « zéro arbitrage critique non résolu » **ne l'est pas encore** (BL-1 → BL-7, dont BL-4/BL-5 soumis à validation).
**L2 : non entamé.** Aucune autorisation demandée ni présumée.

#### Prochaine action

Validation du contrat `definition_version = 1` et des décisions BL-1 → BL-7, puis exécution du premier lot technique proposé (baseline en lecture seule, voir T2.1 ci-dessous).

### 9.3 T2.1 — Baseline de lecture et inventaire des migrations — EXÉCUTÉ

**Statut : `IMPLEMENTED` (mesures réelles consignées).** Résultats complets en **§12**. En résumé :

- **Mesuré** : ≈ 32 100 appels RPC dashboard/Finances enregistrés (fenêtre depuis le 13/03/2026) ; moyennes **269–429 ms**, **maxima 7,4–7,8 s** ; `order_items` **parcourue en entier** (4 900 lignes) même pour 2 commandes → coût indépendant de la période ; planning jusqu'à **141 ms** ; `revenue_chart` a écrit **19 370 blocs temporaires**.
- **Réconcilié** : 136 fichiers locaux appariés sur 149 ; **13 sans contrepartie nommée** (dont 9 avec effet constaté, 1 divergence réelle : `drop_rapid_delivery_cities_custom`) ; **128 entrées en base sans fichier local**, dont 61 antérieures à l'historique local. **Aucune correction appliquée.**
- **Proposé** : BL-1 → BL-7 avec options, nature (produit/technique) et coût — §12.6.
- **Bloqué** : baseline d'**écriture** (exige un environnement isolé) ; mesure de fraîcheur (exige l'ordonnanceur et l'instrumentation).

**T2.2 non entamé.** Neuf décisions attendues : §12.7.

### 9.4 T2.1 — Journal détaillé (16 octobre 2026)

**Agent :** Cline — **HEAD :** `1228e45eff17cc066000d838c31577c036eb3962` — **Environnement :** dépôt local ; base de production **consultée en lecture seule** (catalogues, statistiques, agrégats bornés et `EXPLAIN ANALYZE` ponctuels).

#### Modifications réalisées

| Fichier | Nature |
|---|---|
| `memory-bank/dashboard-daily-kpis-architecture.md` | **§12** ajouté (baseline mesurée, plans, volumes, réconciliation 149 ↔ 264, propositions BL-1 → BL-7, 9 décisions attendues, statuts/DONE) ; mise à jour de l'en-tête, de §8.3 et de §9.3 |
| `memory-bank/activeContext.md` | **1 ligne modifiée** : statut T2.1, chiffres clés, décisions bloquantes |

**Aucune autre modification.** Aucun fichier de code, aucun SQL, aucune migration, aucun push, aucun déploiement.

#### Tests et mesures effectués

| Contrôle | Méthode | Résultat observé | Statut |
|---|---|---|---|
| Statistiques d'exécution réelles des lecteurs | `pg_stat_statements` (fenêtre depuis 13/03/2026) | ≈ 32 100 appels ; moyennes 269–429 ms ; max 7,4–7,8 s | **PASS** |
| Plan `kpi_metrics` — mois courant (2 commandes) | `EXPLAIN (ANALYZE, BUFFERS)` | Planning 141,5 ms / Exécution 138,4 ms ; `Seq Scan order_items` 4 900 lignes | **PASS** |
| Plan `kpi_metrics` — tout l'historique (2 000 commandes) | idem, garde d'accès incluse | Planning 35,1 ms / Exécution 179,4 ms ; 519 buffers | **PASS** |
| Plan `revenue_chart` (`bucketed`) | idem | Planning 3,8 ms / Exécution 1,7 ms (chaud) ; `Seq Scan order_items` 4 900 lignes | **PASS** |
| Plan `ads_cost_chart` — 31 buckets | idem | Planning 65,8 ms / Exécution 9,2 ms | **PASS** |
| Plan variante multi-boutiques (array) | idem | 1,6 ms (2 commandes) ; index scanné une fois par boutique | **PASS** (chemin non utilisé par le dashboard) |
| Contexte serveur | `pg_stat_database`, `pg_stat_user_tables` | `deadlocks = 0`, cache hit 100 %, 10 164 374 commits, 423 tuples morts sur `orders` | **PASS** |
| Réconciliation des migrations | appariement en base (version / nom / slug) | 136 fichiers appariés / 149 ; 13 sans contrepartie nommée ; 128 entrées base sans fichier local | **PASS** |
| Vérification d'effet des 13 fichiers non appariés | catalogues (`pg_indexes`, `pg_constraint`, `pg_proc`, `information_schema`) | 9 effets constatés ; 1 divergence réelle ; 3 non attribuables | **PASS** |
| Empreintes de non-régression | `git hash-object` + MD5 des fonctions | E04/E05 identiques ; `kpi-cards.tsx` inchangé | **PASS** |
| Périmètre Git, `diff --check`, absence de secret | `git status`, `git diff --check`, lecture du diff | 3 documentaires + 1 nouveau ; aucun défaut ; aucun secret | **PASS** |
| Baseline d'**écriture** (surcoût, contention, backlog) | — | Non réalisable sans environnement isolé | **BLOCKED** |
| Fraîcheur de bout en bout | — | Exige l'ordonnanceur et l'instrumentation (non autorisés) | **NOT RUN** |
| Appel RPC authentifié de bout en bout (réseau inclus) | — | Aucune trace navigateur disponible dans cette session | **NOT RUN** |

#### Preuves

Chiffres et plans consignés en §12.1 → §12.3 ; réconciliation en §12.5 ; empreintes en §8.3 ; état Git et numstat ci-dessus. Aucune donnée personnelle, aucun identifiant de client, aucun token.

#### Limitations et blocages

- Mesures obtenues sur le **SQL équivalent** avec un membre réel substitué à `auth.uid()`, pas par un appel HTTP authentifié : les temps sont des ordres de grandeur fiables, pas des mesures de bout en bout.
- Les lecteurs ont été mesurés **à froid puis à chaud** de façon non appariée (une seule passe par scénario) : aucune valeur de variabilité (p95/p99) n'est revendiquée pour les plans ; les percentiles cités viennent de `pg_stat_statements` (usage réel).
- La baseline d'écriture, la mesure de fraîcheur et la vérification réseau restent hors de portée tant que les décisions 1, 4 et 8 de §12.7 ne sont pas prises.

#### Décision du lot

**T2.1 : DONE** au sens des critères du plan (mesures effectuées, consignées, statuts réels déclarés ; les contrôles impossibles sont `BLOCKED` ou `NOT RUN`, jamais PASS).
**T2.2 et L3 : NOT STARTED** — aucune autorisation présumée.

#### Prochaine action

Obtenir les **9 décisions de §12.7** (mécanisme asynchrone, capture d'état D1, D2/D3, environnement isolé, BL-4, BL-6, BL-5, instrumentation, seuils B13), puis exécuter T2.2 sur le seul périmètre autorisé.

### 9.5 T2.2 — Journal (16 octobre 2026, après report de Docker/Supabase Local)

**Agent :** Cline — **HEAD :** `1228e45eff17cc066000d838c31577c036eb3962` — **Environnement :** dépôt local ; base de production **consultée en lecture seule** (catalogues, réglages, statistiques) ; **Docker non démarré**.

#### Décision appliquée

Le propriétaire **reporte** Docker et Supabase Local (A1). Les vérifications de la première passe (hôte, extensions disponibles, limites Vercel, limites `pg_net`, capture D1, coût de reconstruction d'une partition) sont **conservées**. Les analyses non destructives de `pg_net`/`pg_cron` et de la baseline SQL ont été **poursuivies**.

#### Modifications réalisées (documentation uniquement)

| Fichier | Nature |
|---|---|
| `memory-bank/dashboard-daily-kpis-architecture.md` | **§13** ajouté (faisabilité `pg_net`/`pg_cron`, hôte, baseline SQL, évaluation < 5 s, 5 exigences de conception, rapport PASS/FAIL/BLOCKED, critères et proposition T2.3) ; **§8.4** empreintes ; **§9.5** ce journal ; en-tête mis à jour |
| `memory-bank/activeContext.md` | **1 ligne modifiée** : ajout de T2.2 aux lots exécutés |
| `~/Documents/jisra-kpi-artifacts/T2.2-D1-CAPTURE.md` | **créé hors dépôt** (document demandé) : empreinte de structure, inventaire, dépendances, requête de vérification, **générabilité de la baseline** ; aucune donnée métier, aucun secret |

**Aucune autre modification.** Aucun fichier applicatif, aucun SQL, aucune migration, aucune installation, aucun push, aucun déploiement.

#### Contrôles effectués

| Contrôle | Méthode | Résultat | Statut |
|---|---|---|---|
| Disponibilité `pg_net` / `pg_cron` | `pg_available_extensions`, `shared_preload_libraries` | 0.20.0 / 1.6.4 disponibles **et déjà préchargés**, non installés | **PASS** |
| Limites `pg_net` | documentation officielle | post-commit, POST JSON, unlogged, 6 h, ≤ 200 req/s, beta | **PASS** |
| Limites `pg_cron` et cron Vercel | documentation officielle | `pg_cron` : dès la seconde ; **Vercel Hobby : journalier (±59 min)**, Pro : 1 min | **PASS** |
| Réglages serveur | `current_setting` | `pg_net.ttl` 6 h, `batch_size` 200, `cron.max_running_jobs` 32, `wal_level=logical`, PG 17.6, `max_connections=60` | **PASS** |
| Hôte (Docker/WSL/RAM/disque/ports) | CLI Docker, `wsl -l -v`, CIM/WMI, `Get-PSDrive`, `netstat` | daemon **arrêté** ; WSL2 Stopped ; **RAM libre 1,3 Go** ; **disque 3,3 Go libres** ; ports 54321–54327 et 3000 libres | **PASS** (constat) |
| Capture D1 | empreinte catalogue | `0721edb93bed11d0303820739cc61cc3` / 5 095 objets ; stockée hors dépôt | **PASS** |
| Générabilité de la baseline | analyse des générateurs DDL par classe d'objet | 100 % des objets `public` générables ; ordre établi ; 3 réserves | **PASS** |
| Dépendances hors `public` | `pg_constraint`, `pg_trigger`, `pg_policies` | 31 FK vers `auth.users` ; 2 triggers projet sur `auth.users` ; 7 triggers plateforme ; 4 buckets | **PASS** |
| Coût d'une partition (bornes sargables) | `EXPLAIN ANALYZE` | 84 + 62 + 3 buffers ; ~**30 ms** de travail utile (jour le plus chargé : 16 commandes) | **PASS** |
| Empreinte de structure inchangée | recalcul | identique à T2.1 → **aucune structure modifiée** | **PASS** |
| Périmètre Git, `diff --check`, secrets | `git status`, `git diff --check`, lecture du diff | 3 documentaires + 1 nouveau ; aucun défaut ; **aucun secret** | **PASS** |
| Supabase Local (A1) | mesures hôte | ressources insuffisantes, daemon arrêté, CLI absent | **BLOCKED** (reporté) |
| Activation `pg_net`/`pg_cron` | — | non autorisée | **BLOCKED** |
| Exécution D3 | — | non autorisée | **BLOCKED** |
| Baseline d'écriture (B13) | — | exige l'environnement isolé | **BLOCKED** |
| Fraîcheur de bout en bout | — | exige réveil + worker + instrumentation | **NOT RUN** |

#### Preuves

§13.1 → §13.7 ; empreintes §8.4 ; capture D1 hors dépôt ; état Git et numstat ci-dessus. Aucun secret, aucune donnée personnelle, aucun identifiant de client.

#### Limitations

- Le besoin exact de la pile Supabase Local (images, RAM, disque) **n'a pas été mesuré** : Docker n'a pas été démarré, conformément aux contraintes.
- Le cold start du worker, la latence de réveil `pg_net` et la latence de notification client restent **non mesurés** : ils dépendent d'une activation et d'un déploiement non autorisés.
- Les politiques RLS reconstruites depuis `pg_policies` devront être vérifiées par empreinte après application (D3).

#### Décision du lot

**T2.2 : DONE** au sens des critères retenus (analyses non destructives terminées, mesures consignées, statuts réels déclarés ; **aucun contrôle en FAIL**, trois `BLOCKED` structurels explicitement documentés).
**T2.3 : NOT STARTED** — critères de passage en §13.8.

#### Prochaine action

Décider l'environnement isolé (A2/A3, A1 reporté) et autoriser, ou non, l'activation de `pg_net` + `pg_cron` avec durcissement ; puis exécuter T2.3 selon §13.8.

### 9.6 T2.3 — Journal (16 octobre 2026) — préparation sans exécution

**Agent :** Cline — **HEAD :** `1228e45eff17cc066000d838c31577c036eb3962` — **Environnement :** dépôt local + base de production en **lecture seule** (inventaire) ; aucun serveur PostgreSQL d'exécution disponible.

#### Décisions appliquées

Docker/Supabase Local reportés ; A2/A3 non autorisés ; `pg_net`/`pg_cron` préparés mais **non activés** ; D3 généré **hors dépôt** (générateur prêt, exécution non réalisée) ; BL-7 conçu, non activé.

#### Modifications réalisées

| Emplacement | Nature |
|---|---|
| `~/Documents/jisra-kpi-artifacts/T2.3/` (**hors dépôt**) | 11 fichiers créés : 6 fichiers SQL de préparation, 2 outils (vérificateur + inventaire), 1 protocole de mesure, 1 runbook, 1 README |
| `memory-bank/dashboard-daily-kpis-architecture.md` | **§14** (livrables, décisions intégrées, tests statiques, coalescence, rapport PASS/FAIL/BLOCKED), **§8.5** (empreintes dépôt + artefacts), **§9.6** (ce journal), en-tête mis à jour |
| `memory-bank/activeContext.md` | **1 ligne modifiée** : ajout de T2.3 et de son statut réel |

**Aucun fichier du dépôt autre que documentaire.** Aucune RPC ni aucun trigger existant modifié. Aucune écriture Supabase, aucune extension activée, aucun push, aucun déploiement.

#### Tests réellement exécutés

| Test | Méthode | Résultat | Statut |
|---|---|---|---|
| Vérification statique des 6 fichiers SQL | `node tools/static-check.mjs` (12 contrôles) | **12/12 PASS**, code de sortie 0 | **PASS** |
| Détection de défauts réels par ce test | idem | 2 défauts identifiés (révocations manquantes ; faux positifs C11) puis **corrigés**, relance 12/12 | **PASS** |
| Inventaire réel de production | requêtes catalogue en lecture seule | colonnes/fonctions/triggers/tables relevés, consignés dans `tools/inventory.json` | **PASS** |
| Périmètre Git, `diff --check`, secrets | `git status`, `git diff --check`, lecture des diffs | 3 documentaires + 1 nouveau ; aucun défaut ; **aucun secret** | **PASS** |
| Structure de production inchangée | empreinte `0721edb9…` | **identique** à T2.1 et T2.2 | **PASS** |
| Validité syntaxique réelle des SQL | — | aucun serveur PostgreSQL disponible | **BLOCKED** |
| Comportement réel du réveil (coalescence) | — | exige l'activation de `pg_net` | **BLOCKED** |
| Concurrence / idempotence / fencing | — | exige un environnement isolé | **BLOCKED** |
| Surcharge d'écriture (B13) | — | exige un environnement isolé | **BLOCKED** |
| Fraîcheur de bout en bout | — | exige réveil + worker + instrumentation | **NOT RUN** |

**Artefact d'environnement local (honnêteté technique)** : exécuter le vérificateur avec une **redirection shell** vers un fichier produit `stdout is not a tty` et un code de sortie 1 sur ce poste Windows/Git Bash. Le script n'est pas en cause : exécuté en direct, ou via un process Node parent capturant sa sortie, il affiche **12/12 PASS** et sort en 0. La preuve retenue est l'exécution directe et l'exécution via `execSync`.

#### Preuves

§14.3 (12 contrôles), §14.5 (rapport), §8.5 (empreintes des 11 artefacts + du dépôt), sortie du vérificateur.

#### Décision du lot

**T2.3 : `IMPLEMENTED` — NON DONE.** 9 contrôles PASS, **aucun FAIL**, 5 `BLOCKED`, 1 `NOT RUN`. Conformément à la consigne, T2.3 n'est pas déclaré DONE tant que les tests dynamiques indispensables restent bloqués.

#### Prochaine action

Décider l'environnement isolé (A2/A3), autoriser l'activation de `pg_net` + `pg_cron` avec durcissement et BL-7, puis exécuter les étapes **E1 → E11** du runbook hors production, avec preuves. **T3 non entamé.**







## 10. Contrat métier — `definition_version = 1`

**Statut : IMPLEMENTED (documentation) — NOT VALIDATED.** Le contrat est rédigé et complet ; il attend l'approbation du propriétaire (§11). Aucune ligne de code, de SQL ou de schéma n'a été modifiée pour le produire.

Décisions intégrées : **B01=A, B02=B, B03=C, B04=B, B05=A, B07=A (provisoire), B08=A (adaptée), B09=A, B10=A (provisoire), B11=A, B12=A (adaptée), B13=C, B14=A**, et **S01** (trois structures).

### 10.0 Conventions obligatoires

| Règle | Valeur v1 |
|---|---|
| Partition d'agrégation | `(store_id, business_date)` + `definition_version` |
| `business_date` | jour local dérivé de `orders.order_date` dans le fuseau métier de la boutique |
| Fuseau métier | colonne dédiée par boutique, défaut `Africa/Casablanca` (B06=B) ; **valeur utilisée stockée dans chaque partition** |
| Bornes de période | `>= start` et `< end` (fin **exclusive**) ; `start`/`end` converties depuis le fuseau métier |
| Reconnaissance | `orders.order_date` (cohorte de commande, B02=B) ; mesures parallèles par `delivered_at` **stockées mais non publiées en v1** |
| Devise | `stores.currency` ; **aucun taux appliqué** dans la v1 (B09=A) |
| Précision | `numeric` intégral dans l'agrégat ; arrondi **à l'affichage seulement** |
| Statut d'un champ | **P** = publié (affiché), **C** = composante stockée (non affichée en v1), **N** = non stocké en v1, **Q** = qualité/couverture |
| Qualité | aucune correction automatique : les anomalies sont **comptées et exposées**, les montants restent inchangés (B11=A) |
| Permissions | matrice §10.7 ; contrôle **en base**, pas seulement dans l'interface (B10=A provisoire) |
| Non-additivité | les ratios et la publicité arbitrée ne sont **jamais** stockés comme valeur finale ; recalculés à la lecture depuis les composantes |

**Règle de non-régression de l'affichage** : la v1 doit servir, pour tous les indicateurs hors publicité, **exactement les valeurs actuelles**. Les seuls écarts autorisés sont ceux listés en §10.4 (B04=B).

### 10.1 Compteurs

Source : `public.orders` filtré par `(store_id, order_date)` dans la période.

| Champ | Formule v1 | Statut | Permission | Qualité / limite |
|---|---|---|---|---|
| `orders_count` | `count(*)` | **P** | volumes | identique à l'existant |
| `delivered_count` | `count(*) filter (status = 'delivered')` | **P** | volumes | identique |
| `cancelled_count` | `status = 'cancelled'` | **P** | volumes | identique |
| `returned_count` | `status in ('returned_stocked','returned_not_stocked')` | **P** | volumes | identique ; **jamais déduit du CA** |
| `pending_count` | `status in ('new','follow_up_1','follow_up_2','follow_up_3','follow_up_4','follow_up_5','no_answer','wrong_number','voicemail','confirmation_rejected')` | **P** | volumes | liste **exacte** de l'existant |
| `unclassified_count` | commandes hors de toutes les familles ci-dessus | **C** | volumes | voir constat ci-dessous |

**Constat mesuré (lecture seule, 16/10/2026)** : sur **3 663** commandes, les familles affichées couvrent 3 648 lignes ; **15 commandes (0,41 %)** ne sont dans **aucune** famille (`refused` 2, `dl_no_answer` 1, `dl_pickup_pending` 11, `dl_client_interested` 1). Ces statuts sont autorisés par `orders_status_check` (29 valeurs, dont 13 `dl_*` et `refused`) mais absents des filtres des lecteurs actuels. Conséquence : la somme des familles affichées **n'égale pas** le total des commandes. La v1 **ne modifie aucun compteur** : elle ajoute `unclassified_count` en composante et rend l'écart visible. L'affectation de ces statuts à une famille est une décision ouverte (BL-6).

**Statuts disponibles** (référence, `orders_status_check`) : `new`, `confirmation_rejected`, `follow_up_1..5`, `no_answer`, `wrong_number`, `voicemail`, `confirmed`, `picked_up`, `sent`, `delivered`, `cancelled`, `refused`, `returned_not_stocked`, `returned_stocked`, `dl_no_answer`, `dl_unreachable`, `dl_out_of_zone`, `dl_client_interested`, `dl_postponed`, `dl_address_change`, `dl_pickup_pending`, `dl_refund`, `dl_follow_up_request`, `dl_billing_error`, `dl_out_for_delivery`.

### 10.2 Montants et composantes

Toutes les composantes monétaires sont filtrées sur `status = 'delivered'` **sauf** mention contraire — c'est le comportement actuel.

| Champ | Source | Formule v1 | Statut |
|---|---|---|---|
| `revenue_items_gross` | `order_items` | `sum(quantity * unit_selling_price)` | **P** (publié sous le nom « CA ») |
| `discount_amount` | `orders.discount_amount` | `sum(coalesce(discount_amount,0))` | **C** |
| `delivery_charge_customer` | `orders.delivery_charge_to_customer` | `sum(coalesce(...,0))` | **C** |
| `revenue_net` | calculé | `revenue_items_gross − discount_amount + delivery_charge_customer` | **C** — non affiché en v1 (B01=A) |
| `purchase_cost` | `orders` + `order_items` | `sum(order_purchase_cost(buy_price_source, buy_price, cout_lignes))` | **P** |
| `delivery_fee_cost` | `orders.delivery_fee` | `sum(coalesce(delivery_fee,0))` | **P** |
| `confirmation_cost` | `orders.confirmation_cost_allocated` | `sum(coalesce(...,0))` | **P** |
| `ads_tracked` | `ad_spend_daily` | `sum(coalesce(spend_converted, spend, 0))` **des journées suivies** | **P** (voir §10.4) |
| `ads_fallback` | `orders.ads_cost_allocated` | `sum(coalesce(ads_cost_allocated,0))` des commandes **livrées** des journées **non suivies** | **P** (voir §10.4) |
| `ad_spend_contract` | calculé | `ads_tracked + ads_fallback` | **P** |
| `charges_excl_ads` | calculé | `purchase_cost + delivery_fee_cost + confirmation_cost` | **P** (carte « Charges ») |
| `contribution_margin` | calculé | `revenue_items_gross − purchase_cost − delivery_fee_cost − confirmation_cost − ad_spend_contract` | **P** (B03=C : marge partielle, **pas** le résultat opérationnel) |
| `revenue_items_gross_on_delivery` | `order_items` daté par `coalesce(delivered_at, order_date)` | idem | **C** (B02=B) |
| `purchase_cost_on_delivery`, `delivery_fee_cost_on_delivery`, `confirmation_cost_on_delivery` | idem | idem | **C** (B02=B) |
| `currency_code` | `stores.currency` | copié dans la partition | **C** |

**Interdits v1** : retirer la remise ou le port du CA publié ; inclure les `expenses` dans la marge ; ajouter les commissions acquises à la marge ; sommer des devises différentes (§10.6) ; stocker `contribution_margin`, `revenue_net` ou les ratios comme valeur de référence d'une période supérieure.

### 10.3 Ratios, indicateurs calculés et non-additivité

| Indicateur publié | Formule v1 (calculée à la lecture) | Permission | Écart avec l'existant |
|---|---|---|---|
| Panier moyen (AOV) | `revenue_items_gross / delivered_count` | volumes | inchangé (dénominateur = livrées) |
| Taux de livraison | `delivered_count / orders_count × 100` | volumes | inchangé |
| Charges | `charges_excl_ads` | coûts | inchangé (hors publicité) |
| Marge | `contribution_margin` | coûts | **change** uniquement via la publicité (§10.4) |
| Taux de marge | `contribution_margin / revenue_items_gross × 100` | coûts | idem |
| CPL | `ad_spend_contract / orders_count` | publicité | idem |
| CPA | `ad_spend_contract / delivered_count` | publicité | idem |
| ROAS | `revenue_items_gross / ad_spend_contract` (0 si dénominateur nul) | publicité | idem |

**Règle de non-additivité (contractuelle)** : aucun ratio, aucun `ad_spend_contract`, aucune marge n'est stocké comme montant de référence d'une période. Une période supérieure est toujours **recalculée depuis les composantes additives** :
`total(P) = Σ composantes(partition j)` puis ratios recalculés une seule fois sur ces totaux.

Corollaire mesurable : `Σ_journée(ratio) ≠ ratio(période)` est **normal et attendu** ; en revanche `Σ_journée(composante) = composante(période)` doit être **exactement vrai** (contrôle V02).

### 10.4 Publicité — contrat cible (B04=B) et écarts attendus

**Contrat cible, par boutique et par journée métier** :

1. Définition d'une **journée suivie** : au moins une ligne `ad_spend_daily` existe pour `(store_id, spend_date)` — **même si `spend = 0`** (la ligne prouve que la journée est suivie ; constat : 372 couples `(store, jour)` suivis dans la base observée).
2. Journée **suivie** ⇒ `ads_tracked` de cette journée = somme de `coalesce(spend_converted, spend, 0)` ; **les allocations `ads_cost_allocated` de cette journée sont ignorées** (pas de double comptage).
3. Journée **non suivie** ⇒ `ads_fallback` = somme des `ads_cost_allocated` des commandes **de cette journée** et **livrées** (`status = 'delivered'`) uniquement.
4. `ad_spend_contract(journée) = ads_tracked + ads_fallback` — **additif** par construction.
5. Une période = **somme des journées**, jamais un arbitrage sur le total de période.
6. Indicateurs de couverture publicitaire publiés : `ads_daily_days` (journées suivies), `ads_fallback_days` (journées en repli, avec au moins une allocation non nulle), `ads_partial_days` (journées suivies partiellement couvertes par la période demandée — leur montant est compté en journée entière et doit être signalé).

**Écarts attendus avec l'existant (documentés, non silencieux)** :

| Cas | Ancien affichage | Contrat v1 | Sens de l'écart |
|---|---|---|---|
| Journée suivie à 0 sur une période où une autre journée a un réel > 0 | Carte : 0 (allocations ignorées car réel total > 0) ; courbe pub : 0 (le bucket contient une ligne) | 0 | **aucun** |
| Journée suivie à 0 **sans** autre journée réelle, avec allocations sur cette journée | Carte : allocations comptées (repli global car réel total = 0) | 0 | **baisse** |
| Journée non suivie (allocations 300) dans une période ayant par ailleurs un réel 1 000 | Carte : 300 ignorés (réel total > 0) ; courbe pub : 300 comptés | 300 | **hausse** sur la carte, identique sur la courbe |
| Allocations portées par des commandes **non livrées** | Carte : incluses dans le repli global ; courbe pub : exclues | exclues | **baisse** |
| Granularité **mensuelle** de la courbe publicitaire | Arbitrage sur l'existence d'une ligne dans le **mois** (mélange journées suivies et non suivies) | Arbitrage **jour par jour**, puis somme | variable, non additif avant |
| Courbe « revenus/profit » (série `ads`) | `ads_cost_allocated` des commandes livrées uniquement | `ad_spend_contract` jour par jour | **hausse** si `ad_spend_daily` existe |
| Profit de la courbe | `items − achat − livraison − confirmation − allocations` | `contribution_margin` (même formule, publicité du contrat) | via la publicité seule |

**Ce qui ne change pas** : le CA, les compteurs, les coûts d'achat, la livraison, la confirmation, les charges hors publicité, le panier moyen, le taux de livraison.

**Conséquence à valider** : les totaux publicitaires, la marge, le taux de marge, le CPL, le CPA et le ROAS **changeront** dès l'activation. C'est le seul changement d'affichage autorisé par la v1, et il doit être annoncé avant activation (L9).

### 10.5 Fuseau, périodes et journées en cours (B06=B, B07=A provisoire, B08=A adaptée)

**Fuseau (B06=B)** : chaque boutique porte un fuseau métier (défaut `Africa/Casablanca`, valeur actuelle de la fonction Finances `finance_business_timezone()`). `business_date = (order_date AT TIME ZONE tz)::date`. La valeur du fuseau utilisée est stockée dans la partition. Un changement de fuseau d'une boutique invalidera **l'historique complet** de cette boutique (voir BL-5) ; aucune conversion rétroactive n'est appliquée en v1.

**Périodes actuelles — comportement documenté, à ne pas modifier pendant L1** (`R/lib/utils.ts`, `getPeriodRange`) :

| Période | Bornes actuelles | Limite documentée |
|---|---|---|
| aujourd'hui | `[début du jour local, +1 j[` | journée en cours incomplète |
| hier | `[jour−1, jour du jour[` | — |
| semaine | lundi courant → demain | semaine incomplète |
| mois | 1er du mois → demain | mois incomplet |
| mois dernier | 1er du mois précédent → 1er du mois courant | — |
| trimestre / année | début trimestre/année → demain | incomplet |
| année dernière | 1er janv. N−1 → 1er janv. N | — |
| toujours | 01/01/2000 → demain | borne basse arbitraire |
| personnalisé | dates saisies, fin +1 j | si `start > end`, les bornes sont **inversées** |

**Comparaison** : l'existant compare à la **période précédente complète** (mois courant de 16 jours comparé à un mois de 30 jours). Ce choix est conservé en v1 **avec un libellé explicite** (« vs période précédente complète ») ; le passage à une durée écoulée équivalente est une décision ouverte (BL-5). Les variations ne portent que sur des grandeurs publiées.

**Élargissement de la courbe** : « aujourd'hui » et « hier » affichent volontairement 7 jours. Ce comportement est un **choix d'affichage**, pas un KPI ; il est conservé en v1 et documenté.

**Journées en cours (B08=A adaptée)** :
1. les agrégats couvrent des **journées métier complètes** ;
2. la journée en cours est **également agrégée** et **reconstruite à chaque changement** (elle reste donc fraîche, sans attendre minuit) ;
3. une lecture directe de bordure n'est autorisée que pour un **intervalle horaire réellement non couvert** par l'agrégation journalière (ex. période personnalisée finissant à 14:30) ;
4. règle anti-double-comptage : un intervalle est couvert **soit** par l'agrégat **soit** par le lecteur direct, jamais par les deux ; `total = agregat(journées couvertes) + direct(intervalle non couvert)` ;
5. l'affichage indique « partiel » avec la liste des journées/intervalle concernés.

### 10.6 Devise (B09=A)

- Le calcul et l'affichage restent dans **une seule devise par boutique** (`stores.currency`), sans conversion.
- En mode « Tous les magasins », les totaux sont **présentés par devise** ; il est **interdit** d'afficher une somme unique de devises différentes (l'existant affiche une somme brute : écart documenté, à corriger **avant** activation — voir BL-5).
- Une consolidation multidevise éventuelle (taux daté, refus si taux manquant) reste **hors périmètre v1** : `exchange_rates` est portée par `owner_user_id` avec `rate_date` de type `date`, et aucun taux par boutique n'existe aujourd'hui.
- Les montants publicitaires restent ceux de `spend_converted` déjà converti à l'ingestion : aucune reconversion n'est appliquée.

### 10.7 Permissions — matrice cible (B10=A provisoire)

**Règle** : l'appartenance active reste nécessaire ; une **permission** devient en plus obligatoire côté base. Aucun droit métier existant n'est supprimé implicitement : les rôles qui perdent un accès sur les coûts sont listés explicitement ci-dessous et doivent être **validés** avant toute migration (BL-4).

| Famille de données | Rôles cible | Situation actuelle |
|---|---|---|
| Commandes, volumes, statuts, taux de livraison | `owner`, `admin`, `accountant`, `marketer`, `viewer` | identique |
| CA, remise, port facturé, panier moyen | `owner`, `admin`, `accountant`, `marketer`, `viewer` | identique |
| Coût d'achat, livraison payée, confirmation, marge, taux de marge | `owner`, `admin`, `accountant` | **restreint** : aujourd'hui tout membre actif (y compris `viewer`, `marketer`, `confirmation`, `delivery`, `stock_manager`) peut lire ces valeurs via RPC |
| Publicité (dépense, CPL, CPA, ROAS, couverture) | `owner`, `admin`, `accountant` + `marketer` | à confirmer |
| Couverture, révision, erreurs d'agrégation | identiques aux données concernées | nouveauté |
| Écriture des agrégats, journal, baux, déclenchement worker | **aucun rôle client** ; service interne uniquement | nouveauté |

**Défenses en profondeur à ajouter** (aucune n'existe aujourd'hui) : révocation de `EXECUTE` à `PUBLIC`/`anon` sur les RPC dashboard ; vérification de permission en plus de l'appartenance ; RLS sur les nouvelles tables avec écriture interdite aux clients.

**Portée de la validation demandée** : la colonne « Rôles cible » pour les coûts/profits/publicité est une **proposition** ; elle retire des accès existants à `viewer` et `marketer`, ce qui est une décision produit, pas une évidence technique.

### 10.8 Qualité des données (B11=A)

Principe : **compter, exposer, ne jamais corriger les montants**. Les indicateurs suivants sont stockés par partition (statut **Q**) et publiés comme mention, sans modifier les valeurs financières.

| Indicateur | Définition v1 | Usage affiché |
|---|---|---|
| `orders_without_lines` | commande de la période sans aucune ligne `order_items` | mention « données incomplètes » |
| `delivered_without_lines` | idem, restreinte aux livrées | restriction du panier moyen |
| `line_vs_total_mismatch` | écart entre somme des lignes et `total_selling_price` > 0,01 | mention « à vérifier » |
| `zero_purchase_cost_with_revenue` | livrée avec CA > 0 et coût d'achat nul | mention « coût manquant » |
| `data_issues_count` | somme des anomalies ci-dessus (dédupliquée par commande) | mention « à vérifier » |
| `estimated_orders` | commandes dont une composante est incomplète (issues ouvertes) | mention « estimé » |
| `is_reliable` | `estimated_orders = 0 and data_issues_count = 0` | absence de mention |

**Règles fermes** :
- un `returned_*` **n'est jamais** déduit du CA de la période courante : il est compté dans `returned_count` ;
- une commande livrée sans lignes reste dans `delivered_count` (comportement actuel, donc AOV inchangé) ; l'anomalie est signalée, pas corrigée ;
- aucune écriture automatique dans `orders`, `order_items`, `ad_spend_daily` ou `expenses` n'est autorisée par ce chantier.

### 10.9 Fraîcheur — protocole de mesure (B12=A adaptée)

**Cible conservée** : `p95 < 5 s` du **commit de la modification métier dans JISRA** jusqu'à l'**affichage DOM** dans un onglet ouvert.

**Points de mesure** (horodatages corrélés, jamais mélangés) : `t0` commit métier → `t1` invalidation écrite (fin de transaction) → `t2` réveil/claim du worker → `t3` publication de la révision → `t4` réception de la révision par le client → `t5` rendu DOM (`performance.mark` temporaire, retiré après la mesure). Le détail `t1→t3` est mesuré en base ; `t4→t5` côté navigateur. La différence d'horloge entre les deux est enregistrée et signalée.

**Protocole réaliste (remplace l'exigence arbitraire de 1 000 événements en 7 jours)** :

| Élément | Valeur retenue |
|---|---|
| Source des événements | **trafic réel uniquement** (aucune injection artificielle en production) |
| Fenêtre cible | 14 jours consécutifs |
| Volume visé | **min(1 000, total réel observé)** avec un **plancher de 200 événements** |
| Si volume < plancher | prolongation jusqu'à 30 jours ; si le plancher reste inatteint, déclarer la limitation explicitement et rapporter la mesure comme **exploratoire** |
| Percentiles | `p50`, `p95`, `p99`, `max` — le `p99` est signalé comme **indicatif** en dessous de 300 événements (échantillon insuffisant pour être robuste) |
| Scénarios | vente manuelle, changement de statut, import CSV, resynchronisation Meta, suivi livraison : mesurés séparément ; un scénario < 30 événements est rapporté comme exploratoire, jamais comme PASS |
| Seuils | `p95 < 5 s` ; `p99 < 15 s` ; aucun dépassement > 60 s hors incident déclaré ; ≥ 90 % des fenêtres d'observation conformes |
| Exclusions | incidents de plateforme déclarés (Supabase, Vercel) uniquement, listés avec leur fenêtre horaire |
| Latence externe | Meta/transporteurs mesurée **à part** et exclue du SLO |

**Non mesurable aujourd'hui** : `t5` (rendu DOM) et `t2` (réveil) exigent l'instrumentation et l'ordonnanceur de L2 ; en l'absence de ces deux éléments, aucune valeur ne peut être annoncée. Aucun chiffre de fraîcheur n'est donc disponible à ce stade.

### 10.10 Budgets PostgreSQL (B13=C — baseline d'abord)

Aucun seuil définitif n'est fixé en v1. Les valeurs indicatives ci-dessous servent de **référence de discussion** et deviennent contractuelles seulement après la baseline de L2.

| Élément | Référence indicative (à confirmer) | Méthode |
|---|---|---|
| Surcoût d'écriture d'une commande | médiane ≤ 15 %, p95 ≤ 25 % | même scénario, avec et sans invalidation |
| Surcoût d'un lot d'import (100–500 commandes) | idem, sur la durée totale du lot | idem |
| Verrou sur `orders`/`order_items`/`ad_spend_daily` | < 50 ms | `pg_stat_activity`, journaux de verrou |
| Backlog d'invalidation après import | retour à 0 en < 30 s | compteur de journal |
| Deadlocks / `lock timeout` | aucune augmentation | `pg_stat_database` avant/après |

**Baseline obligatoire avant de figer un seuil** : chronométrage des RPC actuelles (froid/chaud, par période et par boutique), `EXPLAIN (ANALYZE, BUFFERS)` documenté, percentiles issus de `pg_stat_statements` (extension déjà présente), et coût d'écriture mesuré sur création unitaire et lot d'import. La baseline de lecture peut être réalisée en **lecture seule** ; la baseline d'écriture exige un **environnement isolé** (L2).

### 10.11 Couverture (B14=A)

La réponse du lecteur expose, par période demandée : `expected_days`, `computed_days`, `pending_days`, `partial_days`, `revision`, `definition_version`, `tz_used`, `currency_code`, `last_rebuild_at`.

**Règles** :
- une journée attendue et non calculée n'est **jamais** remplacée par un zéro ;
- si `pending_days > 0`, la période est signalée « en cours d'actualisation » et les journées concernées sont listées ;
- le lecteur direct borné peut compléter provisoirement l'affichage (§10.5, règle anti-double-comptage) ;
- une journée sans aucune commande ni publicité est une journée **calculée à zéro**, distincte d'une journée **absente** ; la distinction doit être prouvable (une partition existe ou non).

### 10.12 Cas chiffrés reproductibles

**Aucun de ces cas n'a été exécuté** (statut `NOT RUN`) : ils constituent la base des tests V01/V02/V06/V08/V19 en T3 et T8. Les valeurs « ancien » proviennent de la lecture des RPC actuelles (§8, E04), les valeurs « v1 » du contrat ci-dessus. Tous les montants sont en devise unique de la boutique.

| Cas | Entrée (jeu minimal) | Attendu « ancien » | Attendu v1 | Contrôle |
|---|---|---|---|---|
| C01 | 1 commande livrée, lignes 300 + 200, remise 50, port facturé 30 | CA 500 | CA **500** (inchangé) ; `revenue_net` **480** en composante | V01, B01 |
| C02 | J1 suivi `spend = 0`, allocations J1 = 300 ; J2 suivi `spend = 1000` | Carte période (réel 1 000 > 0) → 1 000 | 1 000 (J1 = 0 car suivi) | V06 |
| C03 | J1 suivi `spend = 0`, allocations 300 ; **aucune** autre journée suivie | Carte : repli global → 300 | **0** (journée suivie) | V06 |
| C04 | J1 suivi `spend = 1000` ; J2 non suivi, allocations livrées 300 | Carte 1 000 / courbe pub 1 300 | **1 300 partout** | V02, V06 |
| C05 | J2 non suivi : allocations livrées 300 **et** non livrées 120 | Carte 420 (aucun filtre statut) / courbe 300 | **300** | V06 |
| C06 | Bucket **mensuel** : J1 suivi 1 000, J2 non suivi 300 | Arbitrage mensuel → 1 000 (une ligne existe) | **1 300** (jour par jour) | V06 |
| C07 | Coût manuel : `buy_price = 400`, lignes = 350, `buy_price_source = 'manual'` | 400 | **400** | V07 |
| C08 | 10 livrées dont 1 sans lignes, CA 9 000 | AOV 900 | AOV **900** + `delivered_without_lines = 1` | V01, B11 |
| C09 | 10 livrées + 1 retour 500 | `delivered_count` 10, CA inchangé, retour compté | idem, `returned_count = 1` | V01, B11 |
| C10 | 1 commande `dl_out_for_delivery` dans la période | absente de toutes les familles | `unclassified_count = 1` ; familles inchangées | B11, BL-6 |
| C11 | Boutique A 10 000 MAD, boutique B 2 000 EUR, « Tous les magasins » | 12 000 (somme brute) | **deux totaux séparés** | V12, B09 |
| C12 | Commande passée 30/09 23:50 Casablanca (= 22:50 UTC) | classée selon le fuseau du navigateur | `business_date = 30/09` quelle que soit la machine | V08 |
| C13 | Journée en cours à 11:00 : 40 commandes, dont 12 confirmées après 10:50 | valeur recalculée à chaque requête | journée agrégée **reconstruite après chaque changement** ; `partial_days` signalé | V15, B08 |
| C14 | Période personnalisée 10/10 09:00 → 12/10 14:30 | direct uniquement | agrégat (10 et 11/10 complets) + direct (12/10 00:00→14:30), **sans double comptage** | V02, B08 |
| C15 | 9 journées calculées sur 10 attendues, CA partiel 8 600 (réel 9 400) | 8 600 affiché comme définitif | « 8 600 — 1 journée en cours d'actualisation » | V14, B14 |
| C16 | Rôle `viewer` interrogeant la RPC | CA, coût d'achat et marge lisibles | CA oui ; **coûts et marge refusés** (si BL-4 validé ainsi) | V13, B10 |

---

## 11. Décisions encore bloquantes et réserves

### 11.1 Décisions bloquantes pour la suite

| ID | Objet | Bloque | État |
|---|---|---|---|
| **BL-1** | Mécanisme d'exécution asynchrone réactif : `pg_cron` et `pg_net` **ne sont pas installés** ; aucun worker permanent n'existe. Sans décision d'infrastructure (extension, route worker protégée, service d'ordonnancement), la cible `p95 < 5 s` n'est pas atteignable et L2 ne peut pas démarrer. | L2, L4, L7 | **BLOQUANT** |
| **BL-2** | Écart migrations : **149 fichiers locaux** vs **264 migrations** enregistrées. Un bootstrap isolé fidèle et un versionnement propre exigent une réconciliation (audit de dérive, sans rejouer aveuglément). | L2, L3 | **BLOQUANT** |
| **BL-3** | Environnement isolé : création d'un projet/branche Supabase (ou acceptation explicite d'une autre méthode) et autorisation d'y écrire. Sans isolation, aucun test destructif ni mesure d'écriture n'est possible. | L2 → L8 | **BLOQUANT** |
| **BL-4** | Matrice de permissions cible (§10.7) : le retrait de la lecture des coûts et de la marge à `viewer`, `marketer`, `confirmation`, `delivery`, `stock_manager` est une **décision produit**. Aucune migration ne doit l'appliquer sans validation explicite. | L3, L7 | **BLOQUANT (validation explicite requise)** |
| **BL-5** | Réserves provisoires : (a) comparaison à la période précédente complète (B07=A provisoire) ; (b) changement de fuseau d'une boutique (invalidation historique complète) ; (c) présentation par devise en « Tous les magasins » à corriger avant activation ; (d) conservation de l'élargissement à 7 jours de la courbe. | L7, L9 | **À confirmer avant L7** |
| **BL-6** | Statuts hors familles (`refused`, `dl_*`) : **15 commandes sur 3 663 (0,41 %)** ne sont comptées dans aucune famille publiée. Les rattacher (à quelle famille ?) ou les laisser hors compteurs ? | affichage des compteurs | **À trancher (non bloquant pour L2/L3)** |
| **BL-7** | Instrumentation de fraîcheur (`t2` réveil, `t5` rendu DOM) : aucun mécanisme n'existe ; nécessaire pour produire une mesure SLO opposable. | T8 | **À autoriser en L2** |

### 11.2 Réserves inscrites au contrat

1. **B13=C** : les seuils de surcoût (15 %/25 %, verrou 50 ms, backlog 30 s) sont **indicatifs** ; ils ne deviennent contractuels qu'après la baseline, mesurée avec la même méthode.
2. **B12 adaptée** : le protocole de §10.9 remplace l'exigence de 1 000 événements en 7 jours ; en dessous de 300 événements le `p99` est **indicatif**, et tout scénario < 30 événements reste **exploratoire** — jamais PASS.
3. **B10 provisoire** : la matrice §10.7 est une proposition ; les accès des rôles non listés ne sont pas supprimés implicitement.
4. **S01** : l'architecture à trois structures est approuvée **sous réserve de preuve** en T4 — aucun événement perdu, aucun conflit de bail, aucune publication obsolète. En cas d'échec aux tests de concurrence (V09/V10/V11), une **structure dédiée aux baux** sera proposée avec la mesure à l'appui.
5. **Aucune correction financière automatique** : toute anomalie détectée est exposée, jamais réparée par ce chantier.

### 11.3 Couverture des exigences de L1

| Exigence | État |
|---|---|
| Contrat versionné `definition_version = 1` | **Fait** — §10 |
| Source, formule, statut, période, fuseau, devise, permission, qualité par indicateur | **Fait** — §10.0 → §10.11 |
| Cas chiffrés reproductibles | **Fait** — §10.12 (C01 → C16), **non exécutés** |
| Décisions approuvées et réserves intégrées | **Fait** — en-tête §10 et §11.2 |
| Décisions bloquantes identifiées | **Fait** — §11.1 (BL-1 → BL-7) |
| Aucun changement applicatif, SQL ou Supabase | **Respecté** |

---

## 12. T2.1 — Baseline de lecture et réconciliation des migrations

**Statut : `IMPLEMENTED` (mesures effectuées, consignées) — voir §12.9 pour les critères.**
Protocole : **lecture seule**, aucune écriture, aucune migration, aucun test de charge, aucun déploiement. Deux familles de mesures : (a) statistiques d'exécution réelles déjà accumulées par `pg_stat_statements` (aucune charge ajoutée) ; (b) plans d'exécution ponctuels `EXPLAIN (ANALYZE, BUFFERS)` — qui exécutent la requête une fois, sur une base de 3 663 commandes / 4 900 lignes de commande.

### 12.1 Baseline mesurée — lecteurs du dashboard et Finances

Source : `pg_stat_statements`, fenêtre **depuis le 13/03/2026 22:48 UTC** (heure de remise à zéro), base de production observée. Les temps sont des **temps d'exécution côté base** pour l'instruction PostgREST qui appelle la RPC : ils **incluent** le travail SQL et **excluent** le réseau client et le temps d'affichage. C'est la première mesure du « temps SQL » réelle pour ce projet.

| Lecteur | Appels | Moyenne | Maximum | Buffers |
|---|---:|---:|---:|---:|
| `rpc_dashboard_top_products` | 7 892 + 46 | 315,6 / 389,4 ms | **7 365,8 ms** | 13,19 M |
| `rpc_dashboard_kpi_metrics` (2 surcharges, plusieurs jeux de paramètres) | 5 309 + 1 721 + 37 + 26 + 22 + 9 = **7 124** | 268,8 ms (principal) | **7 474,2 ms** | 8,57 M |
| `rpc_dashboard_ads_cost_chart` | 4 990 + 13 = **5 003** | 295,5 ms | **7 248,4 ms** | 2,67 M |
| `rpc_dashboard_revenue_chart` | 2 789 + 817 + 7 + 5 = **3 618** | 398,4 ms | **7 844,5 ms** | 5,11 M |
| `rpc_dashboard_city_performance` | 2 477 + 937 + 7 = **3 421** | 129,8 ms | 4 240,1 ms | 1,47 M |
| `rpc_dashboard_confirmation_performance` | 1 644 + 1 221 + 840 + 7 = **3 712** | 8,9 ms | 1 329,4 ms | 66 k |
| `rpc_dashboard_order_time_performance` | **922** | 344,5 ms | 5 934,6 ms | 469 k |
| `rpc_finance_overview` | 61 + 18 + 16 + 10 = **105** | 429,1 ms | 3 115,9 ms | 242 k |
| `rpc_finance_daily_series` | **8** | 316,7 ms | 1 131,5 ms | 11 k |
| `rpc_finance_supplier_balances` | **123** | 149,2 ms | 945,4 ms | 79 k |
| `rpc_finance_agent_balances` | **76** | 279,0 ms | 1 381,7 ms | 91 k |
| `rpc_finance_supplier_purchases` | **48** | 58,1 ms | 650,8 ms | 33 k |

**Total : ≈ 32 100 appels enregistrés** sur la fenêtre. Aucune de ces entrées n'est un `SELECT` direct du navigateur : ce sont les appels RPC (donc les lecteurs du dashboard et de Finances).

Observations factuelles :
- la **moyenne** des lecteurs principaux est de **269 à 398 ms** ;
- les **maxima** atteignent **7,4 à 7,8 s** — soit **au-delà de la cible de 5 s** avant même toute latence réseau et avant tout affichage ;
- **19 370 blocs temporaires écrits sur disque** ont été enregistrés sur une variante de `rpc_dashboard_revenue_chart` (débordement mémoire) ;
- `rpc_dashboard_confirmation_performance` est le seul lecteur rapide (≤ 30 ms) ;
- Finances reste peu appelée (105 appels d'`overview`) mais avec une moyenne de 429 ms, la plus élevée des lecteurs.

### 12.2 Plans d'exécution mesurés (lecture seule, `EXPLAIN ANALYZE`)

| Scénario | Planning | Exécution | Fait marquant |
|---|---:|---:|---|
| `kpi_metrics` équivalent — boutique `mroki`, **octobre 2026** (2 commandes) | **141,5 ms** | **138,4 ms** | `Seq Scan on order_items` **4 900 lignes** / 130 buffers ; `Planning Time` ≈ temps d'exécution |
| `kpi_metrics` équivalent — boutique `mroki`, **tout l'historique** avec garde d'accès | 35,1 ms | **179,4 ms** | 2 000 commandes ; `Index Scan idx_orders_store` 124 ms ; `Seq Scan order_items` 4 900 lignes ; 519 buffers |
| `revenue_chart` (partie `bucketed`) — `mroki`, octobre | 3,8 ms | 1,7 ms (cache chaud) | même `Seq Scan order_items` 4 900 lignes ; **91 ms à froid** sur le premier passage |
| `ads_cost_chart` — `mroki`, octobre, granularité jour (31 buckets) | 65,8 ms | 9,2 ms | `generate_series` + 2 index range scans ; le planning domine |
| Variante multi-boutiques (array, 4 boutiques accessibles, octobre) | 4,3 ms | 1,6 ms | `Index Scan idx_orders_store_date` évalué **4 fois** (une par boutique) ; chemin **non utilisé** par le dashboard (le frontend boucle) |

**Conclusion technique majeure** : le coût des lecteurs est **indépendant de la période demandée**. La table `order_items` est **parcourue intégralement** (4 900 lignes) même pour 2 commandes, parce que l'agrégat par commande est construit avant d'être restreint. Le coût croît donc avec le **volume total de la base**, pas avec la période affichée : c'est exactement le point que l'architecture précalculée doit supprimer.
Second fait : sur `kpi_metrics`, le **planning (141 ms) coûte autant que l'exécution (138 ms)**.

### 12.3 Volume de données et contexte serveur (pour cadrer la baseline)

| Élément | Valeur mesurée |
|---|---|
| Commandes | **3 663** (7 boutiques ; `mroki` 2 000 dont 1 289 livrées) |
| Lignes de commande | **4 900** |
| Boutiques | 7 (une seule devise observée : MAD) |
| Boutiques avec publicité | 3 — 190, 181 et 1 journées suivies ; total 61 959,93 + 73 440,56 |
| `ad_spend_daily` | 372 couples `(store, jour)` |
| Membres | 12 lignes `store_members` |
| Statistiques base | `deadlocks = 0`, cache hit **100 %**, 10 164 374 transactions validées, 397 944 fichiers temporaires cumulés (1,46 TB historiques — indicateur de pression disque global, pas imputable au dashboard seul) |
| Table `orders` | 3 663 lignes vivantes / **423 mortes (≈ 10 % de bloat)**, dernier `autoanalyze` 14/10/2026 |

### 12.4 Ce que la baseline démontre — et ce qu'elle ne démontre pas

**Démontré (mesuré) :**
1. Le coût des lecteurs est **déjà proche ou au-delà de la cible de 5 s dans les queues hautes**, côté base uniquement (maxima mesurés 7,4–7,8 s ; moyennes 269–429 ms).
2. Ce coût est **indépendant de la période affichée** : `order_items` est parcourue en entier à chaque appel (preuve : 4 900 lignes scannées pour 2 commandes).
3. Le **planning** peut coûter autant que l'exécution (141 ms vs 138 ms sur `kpi_metrics`).
4. Les appels sont **massifs** : ≈ 32 100 RPC dashboard/Finances enregistrées, dont 7 892 pour `top_products` seul ; `revenue_chart` a écrit **19 370 blocs temporaires** sur disque.
5. L'infrastructure base est **saine** : `deadlocks = 0`, cache hit 100 %, 0,4 % de rollbacks.
6. Le multi-boutiques aggrave par **multiplication d'appels** (une RPC par widget et par boutique), pas par une requête unique plus lourde.

**Non démontré (à ne pas présenter comme acquis) :**
- Le **temps réseau** et le **temps d'affichage** (aucune trace navigateur) ; le total perçu par l'utilisateur n'est donc pas mesuré.
- Le **coût d'écriture** d'une invalidation (aucune mesure possible sans environnement isolé).
- Le **gain** de l'architecture cible (rien n'existe encore).
- La charge **sous concurrence** (aucun test de charge, volontairement).
- La reproduction exacte des appels RPC authentifiés : les plans ont été obtenus sur le **SQL équivalent** avec un membre réel substitué à `auth.uid()`, pas par un appel HTTP authentifié. Les valeurs de temps restent valides comme ordre de grandeur, pas comme mesure d'un appel de bout en bout.

### 12.5 Réconciliation des migrations — 149 fichiers locaux ↔ 264 enregistrements en base

Méthode : appariement en base (aucune correction, aucun déplacement de fichier), croisant **version**, **nom** et **effet constaté dans le catalogue**. Résultat :

| Catégorie | Nombre | Détail |
|---|---:|---|
| Fichiers locaux **appariés exactement** (fichier `AAAAMMJJHHMMSS_slug.sql` ↔ même version en base) | **51 / 76** | format long |
| Fichiers locaux appariés par **nom préfixé** (le nom en base contient la version logique du fichier) | **20 / 76** | ex. base `20260928123632 > 20260928010000_invoicing_schema` |
| Fichiers locaux appariés par **slug avec identifiant d'application différent** | **4 / 76** | `invoicing_total_ttc_fix`, `order_total_rounding_items_sync`, `ameex_webhook_tracking`, `member_status_policies_and_remove_member` |
| Fichiers courts (`AAAAMMJJ_slug.sql`) appariés par date + nom | **41 / 73** | |
| Fichiers courts appariés par **slug seul** | **20 / 73** | la version en base est le moment d'application, le nom contient la date du fichier |
| **Fichiers locaux sans contrepartie nommée en base** | **13 / 149** | liste ci-dessous |
| **Enregistrements en base sans fichier local homonyme** | **128 / 264** | dont **61 antérieures au 21/04/2026**, avant le début de l'historique local |

**Constat 1 — les 13 fichiers locaux sans contrepartie nommée** (effet vérifié dans le catalogue pour 9 d'entre eux, aucun objet modifié) :

| Fichier local | Effet constaté en base | Conclusion |
|---|---|---|
| `20260426_exchange_rates_unique_idx` | index unique `exchange_rates_unique_idx` **présent** | appliqué, non tracé |
| `20260430_fix_stores_store_members_rls` | 7 politiques sur `store_members` | appliqué, non tracé |
| `20260430_handle_new_user_meta` | trigger `on_auth_user_created:handle_new_user` **présent** | appliqué, non tracé |
| `20260430_orders_rls_store_scope` | 4 politiques sur `orders` | appliqué, non tracé |
| `20260430_rpc_dashboard_auth_guard` | garde `store_members` **présente** dans les corps des RPC (E04) | appliqué, non tracé |
| `20260519_optimize_dashboard_performance` | `idx_orders_store_date` **présent** | appliqué, non tracé |
| `20260523_product_variant_id_order_items` | colonne `order_items.product_variant_id` **présente** | appliqué, non tracé |
| `20260618_sendit_tables` | table `sendit_configs` (+ index) **présente** | appliqué, non tracé |
| `20260622_digylog_orders_columns` | `orders.digylog_tracking` **présente** (une seule colonne) | appliqué **possiblement partiellement** |
| `20260611_drop_rapid_delivery_cities_custom` | table `rapid_delivery_cities_custom` **encore présente** | **divergence réelle** : soit non appliqué, soit recréée ensuite |
| `20260611_repair_missing_delivery_companies` | 11 lignes `delivery_companies` | effet plausible, **non attribuable** |
| `20261007_seed_rushliv_delivery_rates` | 4 047 `delivery_rates`, 7 `pricing_groups`, 3 `delivery_shops` | seeds présents, **non attribuables** |
| `20261014220000_delivery_tracking_integrity_fixes` | fonctions `claim_`, `finish_`, `reserve_`, `retry_`, `mark_`, `release_`, `bump_delivery_tracking_revision`, `delivery_tracking_coverage` **présentes** | effet présent ; **consolidation** d'une partie des 21 migrations du 14/10 (déviation déjà documentée) |

**Constat 2 — 128 enregistrements en base sans fichier local** : 61 antérieurs au 21/04/2026 (l'historique local commence à `20260421_…`), les autres correspondant à des migrations appliquées sous un **double identifiant** (horodatage d'application ≠ nom de fichier) et au groupe `delivery_tracking` du 14/10/2026 (21 migrations en base, dont 7 consolidées en 1 fichier local).

**Conséquence directe pour L2/L3** : un environnement neuf **ne peut pas être reconstruit** à partir de `supabase/migrations/` seul. Toute migration future doit donc **s'appuyer sur l'état réel observé**, jamais sur un rejeu complet des 149 fichiers. C'est le fondement de la proposition BL-2.

**Ce qui n'a pas été fait** : aucun fichier renommé, aucun `db push`, aucune écriture dans `supabase_migrations`, aucun objet modifié.

### 12.6 Propositions de résolution — BL-1 à BL-7

Chaque proposition indique sa **nature** : `T` = technique (exécutable une fois autorisé), `P` = produit (votre décision), `C` = coût/engagement.

#### BL-1 — Mécanisme d'exécution asynchrone (bloque L2, L4, L7)

| Option | Description | Nature | Avantage | Limite |
|---|---|---|---|---|
| **P1 (recommandée)** | Réveil immédiat : trigger `AFTER INSERT` sur le journal → `pg_net` appelle une route Next.js protégée (`/api/kpi/rebuild`) qui traite un lot borné ; **reprise** par un cron chaque minute (filet de sécurité) | `T` + `C` (activer `pg_net` et `pg_cron`) | Fraîcheur sub-seconde côté réveil ; reprise indépendante | `pg_net` peut échouer silencieusement → le cron de reprise est **obligatoire**, pas optionnel |
| P2 | Worker permanent externe consommant la file | `T` + `C` | Contrôle total, mesure fine | Infrastructure à maintenir, coût mensuel, nouvelle dépendance |
| P3 | Recalcul synchrone de la journée courante dans le trigger | `T` | Aucun ordonnanceur | **Contredit la règle H** et aggrave les écritures ; **déconseillée** |

**Vérification préalable (T2.2, lecture seule)** : disponibilité et coût de `pg_net`/`pg_cron` sur le plan actuel ; latence réelle d'un réveil ; comportement en cas d'échec. **Aucune extension ne sera activée sans votre accord.**

#### BL-2 — Réconciliation des migrations (bloque L2, L3)

| Option | Description | Nature | Remarque |
|---|---|---|---|
| **D1 (recommandée, lecture seule)** | Capturer l'état réel (`supabase migration list`, `pg_dump --schema-only` vers un fichier **hors dépôt**) comme référence opposable | `T` | Aucune écriture en base ; rend la dérive complète visible |
| D2 | Geler l'historique antérieur au 21/04/2026 (61 entrées) et ne réconcilier que le delta postérieur | `P` | Réduit le travail, laisse un historique non reproductible |
| **D3 (après D1 et votre accord)** | Produire une **migration de référence** (`baseline`) décrivant l'état actuel, point de départ des environnements neufs ; les 149 fichiers restent l'historique documentaire | `T` + `P` | Seule voie vers un bootstrap isolé fiable ; **crée un fichier de migration → autorisation explicite requise** |

**Divergences à traiter séparément (aucune correction automatique)** : `drop_rapid_delivery_cities_custom` (table toujours présente), `digylog_orders_columns` (une seule colonne constatée), `repair_missing_delivery_companies` et `seed_rushliv_delivery_rates` (effet non attribuable).

#### BL-3 — Environnement isolé (bloque L2 → L8)

| Option | Description | Nature | Coût | Usage |
|---|---|---|---|---|
| **A1 (recommandée pour les tests destructifs)** | Supabase local via CLI + Docker (`supabase start`) : base jetable | `T` | Gratuit | concurrence, idempotence, écritures, reprise — **exige** D1/D3 |
| A2 | **Branche** Supabase (schéma copié, sans données de production) | `T` + `C` | Facturé à l'heure | tests proches de la production, données synthétiques |
| A3 | Second projet Supabase dédié | `T` + `C` | Offre gratuite possible | équivalent A2, schéma à reconstruire entièrement |

**Point dur** : A2 et A3 exigent aussi un schéma reproductible (BL-2). Choisir l'environnement **avant** de résoudre BL-2 produirait un environnement non conforme. La faisabilité de A1 (Docker présent sur ce poste) est une action technique de T2.2.

#### BL-4 — Permissions (validation explicite requise avant toute migration)

**État actuel conservé comme référence documentaire** (aucun droit retiré, aucune modification) :

| Famille | Autorisation observée aujourd'hui | Mécanisme |
|---|---|---|
| Commandes, volumes, CA, coûts, marge, publicité | **tout membre actif** (y compris `viewer`, `marketer`, `confirmation`, `delivery`, `stock_manager`) | garde `store_members` dans les RPC `SECURITY DEFINER` |
| Idem via RPC **non** `SECURITY DEFINER` (`ads_cost_chart`, `city_performance`, `confirmation_performance`) | tout membre actif | RLS `orders` / `ad_spend_daily` (statut actif) |
| Accès à la page `/dashboard` | `owner`, `admin`, `accountant`, `marketer`, `viewer` | `dashboard.view` (UI + middleware) |
| Finances | `owner`, `admin`, `accountant` | `can_view_store_finances()` |

**Écart constaté, non corrigé** : un membre `confirmation`, `delivery` ou `stock_manager` **n'a pas** `dashboard.view` mais **peut appeler directement** les RPC dashboard et lire CA, coûts et marge.

**Proposition (à approuver)** : conserver strictement l'état actuel en v1 ; n'ajouter que la **révocation `anon`/`PUBLIC`** et la vérification de permission ; appliquer une restriction des coûts **seulement après** décision produit. Options : (a) statu quo documenté ; (b) coûts/marge réservés à `owner`/`admin`/`accountant` ; (c) idem en laissant `marketer` accéder à la publicité seule.

#### BL-5 — Réserves provisoires (à confirmer avant L7)

| Réserve | Proposition |
|---|---|
| Comparaison à la période précédente complète (B07) | conserver + libellé explicite ; la durée écoulée équivalente serait un changement d'affichage à valider séparément |
| Changement de fuseau d'une boutique | invalidation complète de l'historique de cette boutique, **déclenchée manuellement** (jamais automatique) |
| Devise en « Tous les magasins » | afficher **par devise** ; corriger la somme brute avant activation |
| Courbe élargie à 7 jours (« aujourd'hui »/« hier ») | conservée, documentée comme choix d'affichage |

#### BL-6 — Statuts hors familles (proposition, sans modification d'affichage)

Constat : **15 commandes sur 3 663 (0,41 %)** hors de toutes les familles publiées. Proposition respectant la signification métier :

| Statut | Signification | Rattachement proposé |
|---|---|---|
| `refused` | client refuse le colis à la livraison | `delivery_failed_count` ; **jamais** « livrée », **jamais** déduit du CA |
| `dl_no_answer`, `dl_unreachable`, `dl_out_of_zone` | échec de livraison (absent, injoignable, hors zone) | `delivery_failed_count` |
| `dl_pickup_pending`, `dl_out_for_delivery` | colis en cours (ramassage / en tournée) | `in_transit_count` (avec `picked_up`, `sent`) |
| `dl_postponed`, `dl_address_change`, `dl_client_interested`, `dl_follow_up_request` | à retraiter / action commerciale | `pending_followup_count` — **distinct** des statuts de confirmation |
| `dl_refund`, `dl_billing_error` | incident logistique/financier | `incident_count` |

**Option A (recommandée pour la v1)** : ne rien réaffecter ; exposer `unclassified_count` et la liste des statuts concernés. **Option B** : publier les quatre familles ci-dessus avec l'invariant contrôlé `Σ familles = orders_count`. Aucune n'est appliquée sans votre accord.

#### BL-7 — Instrumentation de fraîcheur (nécessaire en T8)

Journaliser `t0` (commit, `clock_timestamp()` dans le trigger), `t1` (fin de transaction), `t2` (claim), `t3` (publication) ; mesurer `t4`/`t5` côté navigateur par `performance.mark` **temporaire**, désactivé après mesure. Aucune donnée personnelle. À autoriser dès L2 pour que la mesure existe en T8.

### 12.7 Décisions nécessitant votre accord

| # | Décision attendue | Nature | Pourquoi elle bloque |
|---|---|---|---|
| 1 | Autoriser la **vérification** de `pg_net`/`pg_cron` (disponibilité, coût) et choisir le mécanisme BL-1 (P1/P2/P3) | technique + coût | Sans ordonnanceur, la cible de fraîcheur est inatteignable et L4 ne peut pas démarrer |
| 2 | Autoriser **D1** (capture de l'état réel, lecture seule, fichier hors dépôt) | technique | Préalable à toute conception fiable du schéma |
| 3 | Choisir **D2 ou D3** pour l'historique (geler / produire une migration de référence) | produit + technique | D3 crée un fichier de migration : votre accord est requis |
| 4 | Choisir l'**environnement isolé** A1 (Docker local), A2 (branche payante), A3 (projet dédié) | technique + coût | Aucun test destructif, d'écriture ou de concurrence sans isolation |
| 5 | Trancher **BL-4** : statu quo (a), restriction coûts (b), restriction + `marketer` publicité (c) | produit | Change les droits réels de rôles existants |
| 6 | Trancher **BL-6** : Option A (statu quo + écart visible) ou Option B (familles explicites) | produit | Change les compteurs affichés |
| 7 | Confirmer les 4 **réserves BL-5** | produit | Conditionne l'affichage final |
| 8 | Autoriser **BL-7** (instrumentation de fraîcheur) | technique | Sans elle, aucun SLO opposable n'est mesurable |
| 9 | Fixer les **seuils définitifs de B13** | produit | La baseline d'écriture exige l'environnement isolé (décision 4) |

### 12.8 Statuts et conditions de DONE de T2.1

| Contrôle | Statut |
|---|---|
| Baseline de lecture mesurée et consignée (temps, appels, plans, buffers) | **PASS** |
| Réconciliation 149 ↔ 264 effectuée sans correction | **PASS** |
| Divergences distinguées (appliqué non tracé / non attribuable / divergence réelle) | **PASS** |
| Empreintes des audits inchangées → aucun audit repris | **PASS** |
| Propositions BL-1 → BL-7 documentées (produit vs technique) | **PASS** |
| Aucune écriture, aucune migration, aucun push, aucun déploiement | **PASS** |
| Baseline d'**écriture** (coût d'une invalidation, contention, backlog) | **BLOCKED** — exige un environnement isolé (décisions 4 et 9) |
| Mesure de fraîcheur de bout en bout | **NOT RUN** — exige l'ordonnanceur (décision 1) et l'instrumentation (décision 8) |
| Vérification d'appels RPC **authentifiés** de bout en bout, réseau inclus | **NOT RUN** — aucune trace navigateur disponible |

**DONE de T2.1** = baseline de lecture + réconciliation + propositions consignées, avec les trois contrôles ci-dessus explicitement `BLOCKED` ou `NOT RUN` (jamais présentés comme PASS).
**T2.2 (isolation et ordonnanceur) : non entamé** — ne le sera pas sans les décisions 1 à 4.

---

## 13. T2.2 — Faisabilité technique et préparation de l'environnement

**Statut : `IMPLEMENTED` (analyses non destructives terminées) — voir §13.7.**
**Décision du propriétaire (16/10/2026)** : Docker et Supabase Local (A1) sont **reportés**. Les vérifications déjà réalisées sont conservées ; seules les analyses non destructives de `pg_net`/`pg_cron` et de la baseline SQL ont été poursuivies.

**Périmètre respecté** : aucune installation, aucune activation d'extension, aucune migration, aucune restauration, aucune écriture Supabase, aucun déploiement, aucun changement applicatif.

### 13.1 `pg_net` — disponibilité et limites (mesuré)

| Élément | Constat |
|---|---|
| Disponibilité | `pg_net` **0.20.0** disponible (17 versions), **non installé** |
| Préchargement | `shared_preload_libraries` contient **déjà** `pg_net` et `pg_cron` → l'activation se limite à `CREATE EXTENSION` (**aucun redémarrage requis**) |
| Réglages présents | `pg_net.ttl = 6 hours`, `pg_net.batch_size = 200`, `cron.max_running_jobs = 32` |
| Comportement (doc officielle) | requête **démarrée après le commit** ; **POST JSON uniquement** ; tables **unlogged** (perte en cas d'arrêt brutal) ; réponses conservées **6 h** ; viser **≤ 200 requêtes/seconde** ; une seule base |
| Statut produit | extension **encore en beta** : signatures susceptibles de changer |
| Sécurité | le schéma `net` accorde `USAGE` à `PUBLIC` → `anon`/`authenticated` héritent d'accès directs sur `net.http_request_queue` et `net._http_response` (non exposés via l'API Data, mais **durcissement obligatoire** : révocation, ou création dans `extensions`) |

**Conséquence de conception (mesurée)** : un réveil déclenché **par ligne** dépasserait le plafond de 200 requêtes/s lors d'un import (500 commandes = 500 requêtes). Le réveil doit donc être **groupé par transaction** : trigger de contrainte **différé** (`CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED`) ou coalescence via le journal d'invalidation. Ce point devient une **exigence de conception**, pas une option.

### 13.2 `pg_cron` — disponibilité et rôle de reprise

| Élément | Constat |
|---|---|
| Disponibilité | `pg_cron` **1.6.4**, **non installé** ; préchargé dans `shared_preload_libraries` |
| Cadence possible (doc Supabase) | **de chaque seconde à une fois par an** ; ≤ 8 jobs concurrents recommandés ; ≤ 10 min par job |
| Exécution | SQL ou fonction **en local (zéro réseau)** ; peut aussi faire un HTTP via `pg_net` ; historique dans `cron.job_run_details` |
| Rôle dans BL-1 | **mécanisme de reprise indépendant** recommandé : un job toutes les N secondes peut traiter le backlog **sans dépendre du réveil HTTP** ni du plan Vercel |

**Limites du cron Vercel comme reprise (doc officielle)** : plan **Hobby = une fois par jour** (précision ±59 min ; une expression plus fréquente **échoue au déploiement**) ; plan **Pro = une fois par minute**. Un cron Vercel **ne peut donc pas** servir de reprise rapide sur Hobby, et reste à la minute sur Pro. Le seul mécanisme de reprise compatible avec la cible est `pg_cron` (activation requise = décision) ou un déclencheur de rattrapage à l'ouverture du dashboard.

### 13.3 Hôte et environnement local (mesuré, Docker reporté)

| Contrôle | Valeur mesurée |
|---|---|
| Node / npm | v24.12.0 / 11.6.2 |
| Docker CLI | présent (28.0.1) ; **service `com.docker.service` : Stopped** ; WSL2 présent, distribution `docker-desktop` **Stopped** |
| Mémoire | **15,6 Go** au total, **1,3 Go libres** |
| Disque | **C: 3,3 Go libres** sur 237,8 Go (aucun autre volume) |
| Ports 54321–54327 / 3000 | **libres** (aucun écoute) |
| CLI Supabase / `psql` / `pg_dump` | **absents du PATH** → Supabase Local nécessiterait en plus `supabase init` (création de `supabase/config.toml`) = **modification du dépôt** |
| Processus les plus consommateurs | navigateurs (~2,1 Go) et VS Code (~1,4 Go) |

**Verdict A1** : **BLOCKED** en l'état — espace disque (3,3 Go) et mémoire libre (1,3 Go) très en dessous du besoin d'une pile Supabase Local, service Docker arrêté, CLI absent. *Le besoin exact de la pile (images + runtime) n'a pas été mesuré sur ce poste : Docker n'a pas été démarré.*

### 13.4 Baseline SQL — faisabilité vérifiée (lecture seule)

Capture D1 réalisée et **stockée hors dépôt** : `~/Documents/jisra-kpi-artifacts/T2.2-D1-CAPTURE.md` (structure seule, **aucune donnée métier, aucun secret**).

| Élément | Mesure |
|---|---|
| Empreinte de structure de production | `0721edb93bed11d0303820739cc61cc3` sur **5 095** objets |
| Objets `public` | 95 tables (RLS **95/95**), 2 vues, 1 séquence, 144 fonctions, 61 triggers, **219 politiques**, 341 index, 450 contraintes (199 FK, 95 PK, 38 UNIQUE, 118 CHECK) |
| Générabilité | **100 %** des objets `public` disposent d'un générateur de DDL (`pg_get_constraintdef/indexdef/functiondef/triggerdef/viewdef`, `pg_policies`, `information_schema`) |
| Ordre d'application | `extensions` → tables → PK/UNIQUE/CHECK → FK → index → vues → fonctions → triggers → politiques → GRANT → commentaires → triggers `auth.users` → buckets `storage` |
| Dépendances bloquantes | **31** FK vers `auth.users` ; **2** triggers du projet sur `auth.users` (`handle_new_user` **sans `search_path`**, `assign_free_plan_on_signup`) ; 211 politiques appelant une fonction ; 47 fonctions référencées par triggers |
| Hors schéma `public` | 7 triggers plateforme (4 `storage`, 2 `auth.users`, 1 `realtime`) ; 15 politiques `storage` ; 4 buckets (données d'environnement, à recréer) |
| Publication `supabase_realtime` | **aucune table publiée** |

**Verdict** : une baseline **compatible Supabase Local est réalisable** en générant le DDL depuis les catalogues, **sans restauration ni `pg_dump`**. Trois réserves : (1) les politiques RLS sont reconstruites depuis du texte (vérification obligatoire par empreinte après application) ; (2) `storage` (buckets + politiques) est traité séparément ; (3) l'écart 149 ↔ 264 reste ouvert : la baseline décrit **l'état réel**, elle ne répare pas l'historique.

**Fait de sécurité mesuré (hors périmètre actuel, à ne pas corriger ici)** : 144 fonctions `public` exécutables par `PUBLIC`, 84 avec ACL `anon`, 89 `SECURITY DEFINER` dont **5 sans `search_path`** — état actuel conservé conformément à BL-4.

### 13.5 Évaluation de la cible « < 5 s » avec P1 (bornes mesurées)

| Étape | Coût mesuré / estimé | Source |
|---|---|---|
| Rebuild d'une partition (jour × boutique), bornes **sargables** (fuseau appliqué aux bornes, pas à la colonne) | accès mesurés : 84 + 62 + 3 buffers ; **~30 ms** de travail utile sur le plus gros jour observé (16 commandes, 29 lignes) | `EXPLAIN ANALYZE` §12/T2.2 |
| Rebuild d'une partition avec filtre de fuseau **non sargable** | 440 buffers, 1 984 lignes rejetées → **5× plus de travail** | idem — exigence de conception |
| Réveil `pg_net` | démarrage **après commit**, asynchrone | doc officielle |
| Worker (fonction serverless) | **cold start** non mesuré (estimation 0,3–1 s) ; traitement du lot borné ≈ quelques dizaines de ms | à mesurer en T2.3 |
| Notification client + rendu DOM | non mesuré (Realtime/SSE ≈ 0,1–0,5 s estimé) | à mesurer en T2.3 |

**Conclusion bornée** : le travail **SQL** est compatible avec la cible (≪ 1 s par partition, 460 partitions historiques au total, médiane 8 commandes/jour). Le risque de dépassement des 5 s réside dans la **chaîne de réveil** (cold start, perte de réveil, files d'attente), pas dans le calcul. **Aucune valeur de fraîcheur n'est mesurée : la cible n'est ni confirmée ni infirmée à ce stade.**

**Limites d'un cron de reprise à une minute** : il borne le retard à ~1 min (Pro) — largement au-delà de 5 s ; sur **Hobby il n'existe pas** (quotidien, ±59 min). Il ne peut donc **pas** être le garant du SLO, seulement un filet.

### 13.6 Exigences de conception issues de T2.2

1. **Réveil groupé par transaction** (trigger de contrainte différé ou coalescence) — sinon dépassement du plafond `pg_net` de 200 req/s à l'import.
2. **Bornes de fuseau sargables** dans toutes les requêtes d'agrégation (`order_date >= borne_utc AND < borne_utc2`), jamais de conversion appliquée à la colonne.
3. **Durcissement `net`** si `pg_net` est activé (révocation `PUBLIC`/`anon`/`authenticated`, ou installation dans `extensions`).
4. **Reprise par `pg_cron`** (activation = décision) ou rattrapage à l'ouverture du dashboard ; le cron Vercel n'est pas un mécanisme de reprise acceptable.
5. **Secret du réveil** : la route appelée par `pg_net` doit être protégée ; le secret devra être stocké côté base (le dépôt n'en contient aucun aujourd'hui : `CRON_SECRET` est **absent** de `.env.local`).

### 13.7 Rapport PASS / FAIL / BLOCKED

| # | Contrôle | Méthode | Résultat | Statut |
|---|---|---|---|---|
| 1 | Disponibilité de `pg_net` | `pg_available_extension(s[versions])` | 0.20.0 disponible, **non installé**, préchargé | **PASS** |
| 2 | Disponibilité de `pg_cron` | idem | 1.6.4 disponible, **non installé**, préchargé | **PASS** |
| 3 | Limites techniques `pg_net` | doc officielle | post-commit, POST JSON, unlogged, 6 h, ≤ 200 req/s, beta | **PASS** |
| 4 | Cadences et limites `pg_cron` | doc officielle | de chaque seconde à 1×/an ; ≤ 8 jobs ; ≤ 10 min | **PASS** |
| 5 | Limites du cron Vercel (reprise) | doc officielle | Hobby = 1×/jour (±59 min) ; Pro = 1 min → **insuffisant pour le SLO** | **PASS** |
| 6 | Réglages d'environnement pertinents | `current_setting` | `pg_net.ttl` 6 h, `batch_size` 200, `cron.max_running_jobs` 32, `wal_level=logical` | **PASS** |
| 7 | Hôte — client Docker / WSL2 | `docker --version`, `wsl -l -v`, service | CLI présent ; **daemon arrêté** ; WSL2 `docker-desktop` Stopped | **PASS** (constat) |
| 8 | Hôte — ressources | CIM/WMI, `Get-PSDrive` | RAM **1,3 Go libres** ; disque **3,3 Go libres** | **PASS** (constat) |
| 9 | Ports nécessaires | `netstat` | 54321–54327 et 3000 **libres** | **PASS** |
| 10 | D1 — capture de structure | empreinte catalogue | `0721edb93bed11d0303820739cc61cc3` / 5 095 objets, **stockée hors dépôt**, sans secret ni donnée métier | **PASS** |
| 11 | Générabilité de la baseline SQL | analyse catalogues | **100 %** des objets `public` ont un générateur de DDL ; ordre établi ; 3 réserves documentées | **PASS** |
| 12 | Évaluation de la cible < 5 s | mesures `EXPLAIN ANALYZE` + doc | travail SQL compatible ; **risque concentré sur la chaîne de réveil, non mesuré** | **PASS** (analyse bornée) |
| 13 | Baseline d'**écriture** (B13) | — | exige un environnement isolé, **reporté** | **BLOCKED** |
| 14 | Fraîcheur réelle de bout en bout | — | exige réveil + worker + instrumentation (non autorisés) | **NOT RUN** |
| 15 | Supabase Local (A1) | mesures hôte | ressources insuffisantes, daemon arrêté, CLI absent | **BLOCKED** (reporté par décision) |
| 16 | Activation de `pg_net`/`pg_cron` | — | **interdite** à ce stade (aucune autorisation) | **BLOCKED** |
| 17 | Exécution de D3 (baseline) | — | stratégie retenue, **exécution non autorisée** | **BLOCKED** |

**Aucun contrôle en FAIL.** Trois blocages structurels : isolation (A1/Docker reporté), activation d'extensions, exécution de D3.

### 13.8 Critères de passage à T2.3 et proposition opérationnelle

**Critères de passage (tous requis)**
1. Décision explicite sur l'environnement isolé : A2 (branche Supabase) ou A3 (projet dédié), **A1 étant reporté** — sans lui, B13 et les tests d'écriture restent impossibles.
2. Autorisation d'**activer `pg_net` et `pg_cron`** (les deux, ou aucune : cf. §13.6-4), avec durcissement `net` inclus dans le même lot.
3. Autorisation d'exécuter **D3** (génération de la baseline depuis les catalogues) sur l'environnement isolé, jamais sur la production.
4. Autorisation de **BL-7** (instrumentation) pour que les mesures de T8 existent.
5. Confirmation que les 5 exigences de conception de §13.6 sont intégrées au cahier des charges de L3/L4.

**Proposition opérationnelle pour T2.3 — « socle d'exécution asynchrone à blanc »**
Contenu proposé, **aucune écriture en production** :
1. **T2.3.a — Activation et durcissement des extensions** (environnement isolé) : `pg_net` dans `extensions`, révocation `PUBLIC`/`anon`/`authenticated` sur `net`, `pg_cron`, job de reprise à cadence de test ; mesure de fiabilité du réveil (taux d'échec, latence post-commit).
2. **T2.3.b — Prototype de réveil groupé par transaction** : trigger de contrainte différé minimal (une ligne de journal, un appel HTTP par transaction), mesure du nombre de requêtes émises lors d'un import de 500 lignes (objectif : 1, pas 500).
3. **T2.3.c — Worker à blanc** : route protégée qui consomme le journal **sans** écrire d'agrégat (comptage et chronométrage uniquement) ; mesure du cold start et du budget `commit → claim`.
4. **T2.3.d — Baseline d'écriture (B13)** : coût d'une création de commande et d'un import, avec et sans invalidation → permet enfin de fixer les seuils définitifs (décision 9 de §12.7).
5. **T2.3.e — Instrumentation BL-7** : journalisation `t0`/`t1`/`t2`/`t3` et marks navigateur temporaires.

**Livrable attendu de T2.3** : mesures de réveil (taux d'échec, latence), de cold start, de budget `commit → claim`, et première baseline d'écriture — c'est-à-dire les éléments manquants pour statuer sur la cible de 5 s et fixer B13.

---

## 14. T2.3 — Préparation technique sans exécution SQL

**Statut : `IMPLEMENTED` (fichiers de préparation produits, tests statiques **12/12 PASS**) — tests dynamiques `BLOCKED`. T2.3 N'EST PAS DONE** (§14.5).

**Décisions appliquées** : Docker/Supabase Local reportés (A1) ; A2/A3 non autorisés ; `pg_net`/`pg_cron` : préparation autorisée, **activation interdite** ; D3 : génération autorisée **hors dépôt**, restauration interdite ; BL-7 : conception autorisée, activation interdite.

**Périmètre respecté** : aucune écriture Supabase, aucune activation d'extension, aucune migration, aucune restauration, aucun push, aucun déploiement, **aucune modification des RPC ni des triggers existants**. Tous les livrables sont **hors dépôt**, dans `~/Documents/jisra-kpi-artifacts/T2.3/`.

### 14.1 Livrables

| Fichier | Rôle |
|---|---|
| `sql/01_kpi_tables.sql` | Trois structures approuvées (S01) : `dashboard_daily_metrics`, `dashboard_kpi_invalidation`, `dashboard_kpi_store_state` + RLS sans politique + révocations clients |
| `sql/02_kpi_rebuild.sql` | Invalidation `AFTER ROW` (journalisation seule, aucun calcul), agrégat par partition avec **bornes sargables**, claim `SKIP LOCKED`, reconstruction + publication **atomique** avec fencing (`KPI_LEASE_LOST`), verrou consultatif par partition, reprise avec backoff |
| `sql/03_kpi_wakeup.sql` | **Réveil groupé** : trigger `AFTER INSERT` sur le journal → garde par boutique (`FOR UPDATE SKIP LOCKED`, 1 envoi max / 500 ms) → `net.http_post` post-commit ; options de reprise (cron local, rattrapage) |
| `sql/04_kpi_hardening.sql` | Durcissement : schéma `net` révoqué (`PUBLIC`/`anon`/`authenticated`), 10 fonctions KPI réservées à `service_role`, tables internes fermées |
| `sql/05_backfill_and_health.sql` | Backfill par lots, `dashboard_kpi_coverage` (couverture), vue `dashboard_kpi_health` (file, baux, erreurs) |
| `sql/06_baseline_generator.sql` | **D3** : générateur de baseline en lecture seule (empreinte, manifeste par table, DDL par catégorie, ordre d'application imposé) |
| `tools/static-check.mjs` + `tools/inventory.json` | Vérificateur statique exécutable (12 contrôles) + inventaire réel de production (relevé lecture seule) |
| `protocols/measurement-protocol.md` | Protocole de mesure fraîcheur (`t0`→`t5`) et surcharge PostgreSQL (lectures et écritures) |
| `runbook/progressive-execution-rollback.md` | 15 étapes E1→E15, préconditions bloquantes, rollback ordonné, reprise après incident |

### 14.2 Décisions métier intégrées (`definition_version = 1`)

- CA brut conservé ; remise, port facturé et CA net stockés en **composantes** (B01=A).
- Reconnaissance par `order_date`, montants parallèles par date de livraison stockés et **non publiés** (B02=B).
- Marge contributive (jamais le résultat opérationnel de Finances) ; **aucune** référence à `expenses` (B03=C).
- Publicité **par journée suivie**, allocations de repli limitées aux commandes livrées de cette journée ; `ads_daily_rows` prouve le suivi (B04=B).
- Fuseau par boutique dans `dashboard_kpi_store_state` : **aucune colonne ajoutée à `stores`** (B06=B) → aucune table existante altérée.
- Qualité comptée et exposée (`orders_without_lines`, `delivered_without_lines`, `line_vs_total_mismatch`, `zero_purchase_with_revenue`, `data_issues_count`) ; `refused` et `dl_*` comptés dans `refused_count`/`unclassified_count` (B11=A, BL-6 option A).
- Devise unique par boutique, aucune conversion (B09=A).
- Permissions métier actuelles conservées ; seuls les objets **nouveaux** et le schéma `net` sont durcis (BL-4).

### 14.3 Tests statiques réellement exécutés

Commande : `node ~/Documents/jisra-kpi-artifacts/T2.3/tools/static-check.mjs` → **12/12 PASS, code de sortie 0** (6 fichiers SQL analysés).

| Contrôle | Objet | Résultat |
|---|---|---|
| C01 | équilibre des délimiteurs `$function$`/`$$` | PASS (20 / 6) |
| C02 | aucune création/suppression visant un objet préexistant | PASS |
| C03 | tout `SECURITY DEFINER` fixe `search_path` | PASS |
| C04 | aucun `alter/drop/truncate/delete` sur les tables métier existantes | PASS |
| C05 | 3 tables créées, RLS activée, accès clients révoqués | PASS |
| C06 | schéma `net` durci + **10** fonctions nouvelles révoquées | PASS |
| C07 | réveil groupé par boutique (`skip locked`), pas de réseau dans le trigger d'invalidation | PASS |
| C08 | contrat v1 : filtres, bornes exclusives, fuseau sargable, pas d'`expenses`, coût manuel, upsert par partition | PASS |
| C09 | bail, fencing, verrou de partition, acquittement borné par `seq` | PASS |
| C10 | reprise planifiée + couverture + surveillance | PASS |
| C11 | toutes les colonnes référencées couvertes par l'inventaire réel | PASS |
| C12 | générateur D3 en lecture seule, aucun secret en clair | PASS |

**Deux défauts réels détectés par le test et corrigés** (preuve de valeur du contrôle) :
1. `dashboard_kpi_backfill_enqueue` et `dashboard_kpi_coverage` créées **sans révocation** → révocations et `grant service_role` ajoutés à `04_kpi_hardening.sql`.
2. C11 produisait des faux positifs sur les **alias de colonnes calculées** et sur les catalogues système → portée limitée aux fichiers manipulant les tables métier (02, 03) et alias calculés explicités.

**Ce que ces tests ne prouvent pas** : la validité syntaxique PostgreSQL, le comportement réel du trigger de réveil, l'absence de contention, l'exactitude des agrégats. Ce sont des **contrôles textuels**, pas des tests d'exécution.

### 14.4 Coalescence des réveils — conception vérifiée statiquement

**Problème mesuré (T2.2)** : `pg_net` plafonne à **200 requêtes/s** ; un import de 500 commandes avec un réveil **par ligne** produirait 500 requêtes ⇒ dépassement.

**Conception retenue** (encodée dans `03_kpi_wakeup.sql`, contrôlée par C07) :

1. le réveil est branché sur le **journal d'invalidation** (`AFTER INSERT`), pas sur les tables métier : la boutique est connue (`NEW.store_id`) sans verrou global ;
2. une **garde temporelle par boutique** (`dashboard_kpi_store_state.last_wakeup_sent_at`) limite à **1 envoi par 500 ms** ;
3. la garde utilise `FOR UPDATE SKIP LOCKED` : si un réveil est déjà en cours pour cette boutique, la transaction **n'attend pas** et n'envoie rien — aucun blocage des transactions métier, contrairement à un `UPDATE` conditionnel classique ;
4. l'appel `net.http_post` est **asynchrone et démarré après le commit** (comportement documenté de `pg_net`) : le temps d'écriture métier n'inclut aucun appel réseau ;
5. l'URL de réveil est lue depuis un réglage (`app.kpi_wakeup_url`) et le secret depuis le **Vault** : rien dans le dépôt, et **aucun appel** tant que l'URL n'est pas posée ;
6. la **reprise est indépendante** : le job `pg_cron` appelle `dashboard_kpi_resume()` en SQL local, sans dépendre du réveil HTTP ni du cron Vercel.

**Plafond théorique** : 1 envoi / 500 ms / boutique ⇒ **≤ 2 req/s par boutique** (≈ 14 req/s pour 7 boutiques), très en dessous du plafond de 200 req/s.

**Non vérifié (BLOCKED)** : le comportement effectif du trigger différé/garde (test « 500 lignes ⇒ combien de requêtes ? ») exige une base où créer l'objet : impossible sans environnement isolé.

### 14.5 Rapport PASS / FAIL / BLOCKED — et statut réel de T2.3

| # | Contrôle | Statut |
|---|---|---|
| 1 | Migrations préparées pour les trois structures, sans exécution | **PASS** |
| 2 | Fonctions d'invalidation et de reconstruction préparées | **PASS** |
| 3 | Coalescence des réveils conçue et vérifiée statiquement | **PASS** (statique) |
| 4 | Durcissement `pg_net` + fonctions nouvelles préparé | **PASS** |
| 5 | Reprise indépendante préparée (SQL local + surveillance) | **PASS** |
| 6 | Protocole fraîcheur et surcharge PostgreSQL préparé | **PASS** |
| 7 | Dépendances Auth / Storage / migrations vérifiées | **PASS** (T2.2 + §14.1) |
| 8 | Procédure progressive et rollback produites | **PASS** |
| 9 | Tests statiques exécutés | **PASS** — 12/12, défauts corrigés |
| 10 | Validité syntaxique réelle des fichiers SQL | **BLOCKED** — exige un serveur PostgreSQL |
| 11 | Comportement réel du réveil (500 lignes ⇒ 1 appel) | **BLOCKED** — exige l'activation `pg_net` |
| 12 | Concurrence, idempotence, fencing réels | **BLOCKED** — exige un environnement isolé |
| 13 | Surcharge d'écriture (B13) mesurée | **BLOCKED** — exige un environnement isolé |
| 14 | Fraîcheur de bout en bout mesurée | **NOT RUN** — exige réveil + worker + instrumentation |
| 15 | Génération complète de la baseline D3 (exécution) | **BLOCKED** — exige un opérateur avec client SQL |

**Décision :** T2.3 est **`IMPLEMENTED`**, avec **9 PASS**, **aucun FAIL**, **5 contrôles BLOCKED** et **1 NOT RUN**. Conformément à la consigne reçue, **T2.3 n'est PAS déclaré DONE** : les tests dynamiques indispensables restent bloqués par l'absence d'environnement isolé et par l'interdiction d'activer les extensions.

**Ce qui reste à faire pour lever le blocage** : (1) choisir A2 ou A3 ; (2) autoriser l'activation `pg_net` + `pg_cron` avec durcissement ; (3) autoriser BL-7 ; puis exécuter les étapes **E1 → E11** du runbook sur cet environnement, avec preuves.

---

## 15. T2.3 V2 — Correction des 15 défauts de l'audit indépendant

**Statut : `IMPLEMENTED` (artefacts corrigés hors dépôt) — vérification statique **18/18 PASS** avec **4 self-tests de mutation** — tests dynamiques `BLOCKED` — **NON DONE**.**

**Décisions appliquées** : conclusions de l'audit validées par le propriétaire ; correction autorisée **hors dépôt** uniquement. Docker/Supabase Local reportés ; aucune installation d'environnement de test.

**Périmètre respecté** : aucune exécution SQL, aucune activation d'extension, aucune migration, aucune restauration, aucun push, aucun déploiement, **aucune modification des RPC ni des triggers existants**. Dépôt inchangé (`kpi-cards.tsx` = `ec438d99…`, HEAD = `1228e45`).

**Emplacement** : `~/Documents/jisra-kpi-artifacts/T2.3/v2/` — la **V1 est conservée** pour traçabilité et **ne doit pas être exécutée**.

### 15.1 Corrections apportées (détail et tests : `AUDIT-FIX-MATRIX.md`)

| Réf. | Défaut V1 | Correction V2 | Contrôle |
|---|---|---|---|
| C01 | Modifications ordinaires non invalidées | Filtre `v_relevant` (`IS DISTINCT FROM` sur 12 colonnes) | **K13**, **K18/M1** |
| C02 | Publicité : `NEW` au lieu de `OLD`, `DELETE` ignoré | `NEW` sauf DELETE / `OLD` sauf INSERT, sur les 3 tables | **K13** |
| C03 | Acquittement d'un événement non traité | Claim retournant **jeton + liste exacte de `seq`** ; acquittement nominatif + `KPI_ACK_MISMATCH` | **K09**, **K18/M2** |
| C04 | Fencing et révision non fiables | `claim_token uuid`, fencing sur tout le lot, `clock_timestamp()`, `publish_counter + 1` | **K09**, **K18/M4** |
| C05 | Baseline D3 incomplète / moins sûre | Quotage, séquences/identity, **RLS restituée**, ACL tables/fonctions, multi-passes, vérifs V1→V6 | **K12** |
| M01 | Coalescence d'import non garantie | Coalescence **par transaction** : trigger différé + drapeaux `app.kpi_dirty`/`app.kpi_wakeup_sent` + garde 2 s | **K07**, **K18/M3** |
| M02 | Échec de réveil pouvant faire échouer la vente | Secret **obligatoire**, URL en réglage, `EXCEPTION WHEN OTHERS` | **K07** |
| M03 | Cadences invalides, lots surdimensionnés, pause inopérante | `'2 seconds'`, claim borné en partitions, sous-blocs, backoff sous jeton, pause appliquée | **K10**, **K15** |
| M04 | Axe livraison non invalidé | Colonne **`axis`** en clé + invalidation des 2 axes (`NEW` et `OLD`) | **K08**, **K13** |
| M05 | Divergences financières/qualité | `numeric` **sans typmod**, `ads_fallback_effective`, `refused` explicite, `unclassified` = `dl_*`, `revenue_estimated`, qualité | **K08** |
| M06 | Couverture/pause non conformes | `coverage(store, from, to)` : attendus en fuseau boutique, `computed`/`dirty`/`pending` | **K10** |
| M07 | Ordre et droits non atomiques | Fichiers séparés, droits dans le même lot que chaque fonction, `search_path = public, pg_temp`, séquence fermée | **K03**, **K05**, **K06**, **K16** |
| M08 | Mesure de fraîcheur non valide | `announced_at` supprimé, `clock_timestamp()`, **commit inféré**, échecs non exclus, B13 après baseline | **K17** |
| M09 | SLO et reprise non garantis | Réveil optionnel / reprise autoritative, limites documentées, **aucune borne absolue promise** | **K15** + doc |
| M10 | Rollback pouvant supprimer les preuves | Arrêt ordonné, **journal conservé**, contrat du lecteur de retour, interdits | **K17** |

### 15.2 Vérification renforcée

Commande : `node ~/Documents/jisra-kpi-artifacts/T2.3/v2/tools/static-check.mjs` → **18/18 PASS**, code de sortie **0**.

| Contrôle | Objet |
|---|---|
| K01–K06 | délimiteurs, aucun objet préexistant, `search_path`, tables métier intactes, tables internes fermées, droits de chaque fonction |
| K07–K10 | réveil coalescé/authentifié/isolé · contrat v1 · jeton + fencing + acquittement nominatif + compteur monotone · reprise/couverture/pause |
| K11–K12 | colonnes couvertes par l'inventaire · générateur D3 complet |
| **K13/K14** | invalidation **réellement fonctionnelle** · **self-test de mutation** : une invalidation neutralisée doit faire échouer l'analyse |
| **K18** | **4 mutants** (invalidation neutralisée, acquittement non nominatif, coalescence supprimée, `greatest` réintroduit) : tous **détectés** |
| K15–K17 | cadence `'2 seconds'` · activation des triggers séparée · runbook et protocole conformes |

**Améliorations du vérificateur** : commentaires SQL **retirés** avant analyse (fin des faux PASS) ; analyse des **corps de fonctions** ; **self-test de mutation** intégré. Deux faux positifs réels ont été détectés et corrigés pendant la conversion (colonne omise de l'inventaire ; cadence citée dans un commentaire).

### 15.3 Blocages, statut et interdiction d'exécution

**Aucun FAIL.** Contrôles **BLOCKED** : syntaxe PostgreSQL réelle · coalescence mesurée (T-A→T-E) · concurrence/idempotence/crash (E10, E12) · baseline D3 appliquée · surcharge d'écriture (B13) · fraîcheur (E13). **NOT RUN** : transport de révision jusqu'au DOM (lot T7).

**Décision** : T2.3 V2 est **`IMPLEMENTED`**, **PASS(S)** sur les 15 corrections, **NON DONE**. **Aucune exécution n'est autorisée** : un **audit indépendant en mode PLAN** doit précéder toute activation ; la V1 ne doit pas être exécutée.

**Prochaine action (attente d'autorisation)** : audit indépendant de la V2, puis décision sur l'environnement isolé (A2/A3) et sur l'activation `pg_net`/`pg_cron`.

---

## 16. T2.3 V3 — Corrections issues de l'audit V2

**Statut : `IMPLEMENTED` (hors dépôt `T2.3/v3/`) — vérification statique **24/24 PASS**, **6 self-tests de mutation** + **3 tests de mutation externes** — tests dynamiques `BLOCKED` — NON DONE.**

**Périmètre** : aucune exécution SQL, aucune activation, aucun déploiement, aucune modification des RPC/triggers existants ; dépôt inchangé (`kpi-cards.tsx` = `ec438d99…`, HEAD = `1228e45`). V1 et V2 conservées, **non exécutables**.

### 16.1 Corrections apportées après l'audit V2

| Défaut V2 | Correction V3 | Contrôle |
|---|---|---|
| **V2-C1** perte d'invalidation (déduplication inter-transactions) | `dashboard_kpi_note` insère **toujours** ; seule déduplication conservée : **locale à la transaction** (GUC `app.kpi_noted_<hash>`, `is_local=true`) | **K11** + mutants M3/M4 |
| **V2-C2** D3 incorrect (`a.grantable`, format GRANT, PUBLIC omis) | `is_grantable`, `GRANT EXECUTE ON FUNCTION … TO`, `PUBLIC` (grantee=0) restitué, séquences IDENTITY exclues, passes exécutables, pseudo-code supprimé, correction `search_path` **hors baseline** | **K25** |
| **V2-C3** droits non atomiques | runbook impose `psql --single-transaction` ; droits après chaque fonction ; **seuls** `resume`, `coverage`, `backfill_enqueue` exposés | **K20**, **K26** |
| **V2-M1** partage de partition entre workers | **claim exclusif** : `pg_try_advisory_xact_lock` (sans attente) + `continue` ; capture de toute la partition ; bail remplacé par simple **backoff consultatif** | **K12**, **K19** |
| **V2-M2** verrous sur tout le lot | lots bornés (≤ 50, défaut 5), partition traitée en une transaction, backoff propriétaire | **K08** |
| **V2-M3** pause partielle / backfill absent | pause appliquée au claim ; `dashboard_kpi_backfill_enqueue` fourni (plage bornée + `coverage_from/to`) | **K24** |
| **V2-M4** repli livraison absent | `delivered_at IS NULL ⇒ order_date` dans l'agrégat **et** dans NEW/OLD | **K22** |
| **V2-M5** statuts non conformes | `refused` non classée ; `coalesce(status,'')` ; funnels `confirmed_like`/`sent_like` alignés sur l'existant | **K23** |
| **V2-M6** faux état complet | `coverage(store, from, to)` sur **calendrier explicite** ; `missing_days` distinct de `computed`/`dirty` | **K24** |
| **V2-M7** coalescence ambiguë | contrat : **1 envoi/transaction**, endpoint **global**, **seuil anti-rafale**, plus de `app.kpi_dirty` ni de verrou de garde | **K21** + mutant M6 |
| **V2-M8** erreurs de réveil | HTTPS + hôte autorisé + secret **obligatoires** ; `request_id` conservé ; statuts HTTP suivis hors trigger | **K21** |
| **V2-M9** activation incohérente | `05` (invalidations) et **`05b`** (réveil) séparés ; `06` documenté `'2 seconds'` | **K15**, **K14** |
| **V2-M10** instrumentation | deux méthodes de commit (`track_commit_timestamp` ou inférence) ; `claimed_at`/`processed_at` **conservés** ; plus de « ~30 ms » ; échecs non exclus | **K16** |
| **V2-M11** rollback | **coupe-circuit** (révocation `resume`/`backfill_enqueue`, `unschedule`, `drop trigger`) ; journal conservé ; `missing_days` consigné | **K26** |

### 16.2 Preuves de non-complaisance du vérificateur

| Mutation (externe, hors du self-test) | Résultat observé |
|---|---|
| Helper `dashboard_kpi_note` neutralisé | **EXIT=1**, K11 : `insertion absente`, `helper neutralisé` |
| `RETURN NULL` ajouté avant la première branche du trigger | **EXIT=1**, K10 : `retour anticipé avant toute journalisation` |
| Déduplication inter-transactions réintroduite | **EXIT=1**, K11 : `déduplication inter-transactions détectée` |

Ces trois mutants **passaient** le vérificateur V2 (18/18). Le vérificateur V3 les rejette.

### 16.3 Limites assumées de la V3

- `resume` conserve ses verrous pendant tout son appel : lots bornés, durée à mesurer (E5/E10) ;
- un import en N transactions peut produire N mises en file avant que le backlog ne dépasse le seuil : **aucune garantie « 1 appel » n'est revendiquée** ;
- la déduplication locale utilise des GUC manipulables par un rôle écrivant déjà en base (au pire un doublon, jamais une perte) ;
- `t5` (DOM) reste hors périmètre (lot T7).

**Aucune de ces limites ne peut provoquer une perte d'invalidation ni une écriture métier erronée.**

### 16.4 Prochaine étape exécutable

1. Décision **A2/A3** (environnement isolé) — sans elle, aucun test dynamique.
2. Autorisation d'activer `pg_net` + `pg_cron` avec durcissement `net`.
3. Exécution E1→E13 du runbook V3, chaque unité en `--single-transaction`, avec preuves par étape.

---

## 17. T2.3 V4 — Corrections issues de la vérification de la V3

**Statut : `IMPLEMENTED` (hors dépôt `T2.3/v4/`) — **26/26 contrôles PASS**, **9 self-tests de mutation**, **4 mutations externes détectées** — tests dynamiques `BLOCKED` — NON DONE.**

**Déclencheur** : la vérification de la V3 a montré que les « 24/24 PASS » ne couvraient pas plusieurs défauts réels. Corrections apportées :

| Réf. | Défaut V3 constaté | Correction V4 | Preuve |
|---|---|---|---|
| **V4-01** | `hashtextextended()` (bigint) affecté à `v_locked int` : échec possible à l'exécution, sur le chemin critique du verrou | `v_lock_key bigint` + `v_owned int` séparés | **K19** + mutation externe `intlock` ⇒ FAIL |
| **V4-02** | Hôte validé par `position(v_host in v_url)` : un domaine malveillant contenant le nom autorisé recevait le secret | `regexp_match` strict (HTTPS, sans userinfo, hôte **exact**, port optionnel) | **K21** + mutation externe `host` ⇒ FAIL |
| **V4-03** | Déduplication par GUC `app.kpi_noted_*` : contournable par prépositionnement ⇒ **perte d'invalidation** | **Aucune déduplication** : insertion inconditionnelle, aucun état de session | **K11**, **K28** + mutation externe `session` ⇒ FAIL |
| **V4-04** | Journal sans rétention | `dashboard_kpi_purge_processed` : uniquement `processed_at is not null`, lots bornés | **K27** + mutation externe `purge` ⇒ FAIL |
| **V4-05** | D3 annonçait les ACL de séquences/schémas/défauts sans les générer | sections 12b/12c/12d (`sequences`, `schemas`, `pg_default_acl`) | **K25** |

**Conséquences assumées** : un import de N lignes produit N événements (traités en un lot par partition, puis purgés) ; volume à mesurer en E5. Aucune perte possible. `t5` (DOM) hors périmètre.

**Ce qui reste BLOCKED** : exécution SQL réelle, concurrence/deadlocks, trigger différé, `pg_cron`, `pg_net`, montants réels, fraîcheur `p95`.

**Verdict** : le socle **statique** de T2.3 est stabilisé (aucun FAIL connu, 9 mutations rejetées, 4 mutations externes rejetées). **T2.3 reste NON DONE** tant que les tests dynamiques n'ont pas été exécutés sur un environnement isolé.

---

## 18. T2.3 V5 — Corrections issues de la vérification de la V4

**Statut : `IMPLEMENTED` (hors dépôt `T2.3/v5/`) — **28/28 contrôles PASS**, **11 self-tests**, **5 mutations externes rejetées** — tests dynamiques `BLOCKED` — NON DONE.**

| Réf. | Défaut V4 | Correction V5 | Preuve |
|---|---|---|---|
| **V5-01** | URL, hôte et seuil lus dans des **réglages de session** ⇒ un rôle client pouvait détourner le secret | Table `dashboard_kpi_wakeup_config` (RLS sans politique, révoquée aux clients), lue par le trigger `SECURITY DEFINER` ; interrupteur `enabled` | **K30** + mutant externe `session` ⇒ EXIT=1 |
| **V5-02** | `PUBLIC` rendu via `%I` ⇒ identifiant `"public"` au lieu du pseudo-rôle | `%s` + normalisation `grantee = 0 / 'PUBLIC'` | **K29** + mutant externe `public` ⇒ EXIT=1 |
| **V5-03** | Privilèges par défaut **globaux** rabattus sur `public` | `defaclnamespace = 0` ⇒ forme sans `IN SCHEMA` | **K29** |
| **V5-04** | Passe 2 non rejouable ; matviews traitées comme des vues | `drop … if exists` systématique ; procédure sans boucle | **K29** + mutant externe `policy` ⇒ EXIT=1 |
| **V5-05** | GUC `app.kpi_dirty` mort ; « aucune perte possible » non démontré | drapeau supprimé ; formulation corrigée en « conçu pour empêcher la perte, **non démontré** » | **K28** |

**Ce qui reste BLOCKED** : exécution SQL, concurrence, deadlocks, trigger différé, `pg_cron`, `pg_net`, montants réels, fraîcheur p95 — donc **toujours NON DONE**.

**Prochaine étape** : audit indépendant de la V5, puis décision d'environnement isolé (A2/A3) et autorisation `pg_net`/`pg_cron` pour exécuter le runbook E1→E13.

---

## 19. R-BL4 — sécurisation des RPC Dashboard legacy (Test uniquement)

**Statut au 18/10/2026 : PASS sur Test, non déployé en Production.** Migration Test
`20261018213537_dashboard_legacy_financial_permissions` : signatures publiques conservées,
calculs existants déplacés sans modification dans des implémentations internes révoquées aux
clients, champs financiers masqués à `NULL` pour `marketer`/`viewer`, accès intégral conservé
pour owner/admin/accountant, sélection multiboutiques mixte commercialisée sans somme
financière. `PUBLIC`/`anon` révoqués ; `authenticated` conservé sur les wrappers uniquement.

Frontend legacy : cartes Charges/Profit affichent « Non autorisé », séries Achat/Profit et
tri Profit masqués sans transformer `NULL` en zéro. Vérifié par SQL simulé, REST réel,
TypeScript, builds flag OFF/ON et navigateur local. Production inchangée. Le rollback sûr
consiste à conserver les wrappers de sécurité et revenir uniquement sur l'UI ; ne jamais
renommer directement les implémentations internes vers les signatures publiques.

---

## 20. tzdata Africa/Casablanca — diagnostic et calendrier métier (18/10/2026)

**Statut : Test PASS ; Production NO-GO jusqu'à mise à jour officielle.** Aucune modification
Production, aucun changement de `TimeZone` global, aucune définition financière modifiée.

### 20.1 Cause

Les deux bases sont en `TimeZone = UTC`. Test applique tzdata **≥ 2026c** ; Production est
antérieure à 2026c. La règle IANA 2026c (`africa`, publiée le 08/07/2026) indique :

- `Morocco moves to permanent +00 on 2026-09-20` ;
- `1:00 Morocco %z 2026 Sep 20 2:00` puis `0:00 - %z`.

Transition effective : **2026-09-20 01:00 UTC** (02:00 locale +01 → 01:00 locale +00).
Preuves : Test `2026-09-20 01:00Z → 01:00` locale ; Production `→ 02:00` ; Test
`America/Edmonton = -06` au 01/12/2026 (règle 2026c) contre `-07` en Production ; Test
`Africa/El_Aaiun = +00` contre `+01`. **Test est correct, Production est obsolète.**

### 20.2 Frontend

Nouveau module `lib/dashboard/business-time.ts` :

- journées calculées dans `Africa/Casablanca`, jamais dans le fuseau navigateur ;
- table de transitions **épinglée sur tzdata 2026e** pour Casablanca (2018→2026), donc
  indépendante de l'ICU du navigateur ;
- `businessRange` (lecteur V5) et `legacyBusinessRange` (RPC legacy) ;
- `businessRangeToInstants` pour les `timestamptz` legacy ;
- libellés de jours formatés en UTC à partir de `YYYY-MM-DD`.

Composants Dashboard migrés : cartes KPI, revenue chart, ads cost chart, top produits,
dernières activités, villes, confirmation, performance horaire, profit. Les composants
Finance conservent `getPeriodRange` (périmètre distinct).

### 20.3 Preuves

- `businessRange` identique sous New York, Paris, Tokyo et Casablanca.
- Payloads navigateur capturés (CDP) identiques dans les quatre fuseaux :
  `reader` 2026-10-18→19 ; legacy `2026-10-18T00:00Z→2026-10-19T00:00Z` ;
  « en attente de ramassage » ISO, sans date localisée.
- Reconstruction forcée Test sur 4 journées frontières (20/09, 21/09, 30/09, 18/10) :
  `pending=0`, `processed_at` mis à jour, **0 écart** commande.
- Réconciliation Test : **613 partitions commande** (01/08→18/10) = 0 écart ;
  **5 partitions livraison réelles** = 0 écart ; 113 partitions sur 20/09→18/10 = 0 écart.
- Trigger : `00:30Z` et `23:30Z` du 20/09 → journée métier 20/09 ; `00:30Z` du 21/09 → 21/09.
- Builds flag OFF/ON, TypeScript et smoke admin/viewer PASS.

### 20.4 Marqueur de version des règles (étude, non implémenté)

`tz_used = 'Africa/Casablanca'` ne distingue pas la version des règles : une partition
calculée avant une mise à jour tzdata reste considérée compatible. Options étudiées :

1. colonne `tz_rules_version` (ex. `2026e`) dans les partitions et `store_state`, comparée
   par le lecteur (`incompatible`) et par le worker ;
2. époque globale `tz_epoch` dans une table de configuration, incluse dans la clé de
   compatibilité et dans la révision publiée ;
3. reconstruction systématique sur changement d'époque.

Recommandation : option 1, avec migration et reconstruction complète lors de chaque
changement de règles. **Non implémenté** : contrat, coût de stockage et procédure de
reconstruction à approuver.

### 20.5 Production

Demande Supabase Support à envoyer (aucune opération déclenchée) : actualiser tzdata du
projet `attvfeoqgbxsnnsllatt` vers **≥ 2026c**, avec vérification des conversions
`2026-09-20 01:00Z`, Casablanca/El_Aaiun et Edmonton. Tant que ce n'est pas fait, V5 reste
désactivé en Production.

---

## 21. B13 — optimisation des écritures (18/10/2026)

**Statut : `IMPLEMENTED` sur Test ; verdict strict `FAIL` sur le p95.** Aucune modification
Production, aucun trigger métier modifié, définitions financières inchangées.

### 21.1 Corrections appliquées

| Migration / changement | Effet |
|---|---|
| `20261018230000_b13_invalidation_hot_path` | insertion groupée, `ON CONFLICT`, réutilisation OLD/NEW |
| `20261018230500_b13_statement_insert` | INSERT `orders` par statement avec table de transition |
| `20261018231000_b13_revert_item_statement` | retour au ligne pour `order_items`/`ad_spend_daily` |
| `20261018231500_b13_order_flag_cache` | drapeau transactionnel par commande |
| `20261018232000_b13_preinsert_flag` | marquage **BEFORE INSERT** avant les triggers métier |
| `20261018232500_b13_final_state` | cache de fuseau, fonctions finales et triggers finaux (état reproductible) |
| `b13_simplify_insert_stmt` (Test) | deux `SELECT` sans `DISTINCT`/`LATERAL` |
| `dashboard_kpi_store_tz_cached` (Test) | cache transactionnel du fuseau par boutique |

Le réveil HTTP désactivé coûte **0,08 ms médian** : laissé inchangé. La déduplication
transactionnelle est conservée par `(store_id, business_date, note_tx)` + `ON CONFLICT`.

### 21.2 Résultats

Avant (100 paires création, 20 import) :

| Scénario | Médiane | p95 |
|---|---:|---:|
| Création complète | **+20,38 %** | **+8,20 %** |
| Import 200 | **+33,60 %** | **+55,81 %** |

Après, campagnes consolidées de même configuration (300 paires création, 50 import) :

| Scénario | Médiane | p95 |
|---|---:|---:|
| Création complète | **+16,96 %** | **+61,77 %** |
| Import 200 | **+5,59 %** | **+53,75 %** |

Meilleure campagne finale (100 paires création, 20 import) : création **15,65 % / 55,19 %** ;
import **5,55 % / 20,32 %**. Les médianes import passent, la création reste à la limite ;
les p95 restent dominés par la variabilité des triggers métier.

### 21.3 Coûts non réductibles identifiés

Mesures `EXPLAIN (ANALYZE)` : `trg_order_items_recalc_order_financials` **225–292 ms / 200
lignes**, `trg_order_items_sync_order_total` **176–217 ms / 200**, allocation publicitaire
**25–27 ms / 200**, automatisation dépenses **23–33 ms / 200**. Coût KPI isolé : trigger
statement `orders` **18,9 ms / 200**, trigger ligne `order_items` avec drapeaux
**6,6 ms / 200**, insertion directe d'une invalidation **0,086 ms**.

Les p95 élevés proviennent de ces triggers métier et de la variabilité de l'environnement,
pas des invalidations KPI. Les réduire exigerait de modifier des triggers métier, interdit.

### 21.4 Vérifications

- Concurrence : 2 transactions → 2 invalidations distinctes, aucune perte.
- Rollback : invalidation visible dans la transaction puis **0** après rollback.
- Savepoint : drapeau et cache annulés par `ROLLBACK TO SAVEPOINT` ; update financier
  postérieur réinvalidé (`2026-10-05`, `orders:UPDATE:order`).
- Update financier dans la même transaction, dédupliqué : agrégat final `remise 7`,
  `CA 100`, `achat 10`, identique au calcul direct.
- Changements statut/date/boutique/montant : anciennes et nouvelles journées invalidées.
- Import 200 + 400 lignes : **1 ligne d'invalidation** par journée.
- Fraîcheur SQL d'un événement : **1 851 ms** `occurred_at → processed_at` (borne haute).
- `pending = 0` après nettoyage ; triggers restaurés ; réveil toujours désactivé.
- Données de benchmark 2035 supprimées ; historique Test préservé.

**Verdict : B13 FAIL au sens strict (p95), avec médiane import PASS et création à la limite.**
Arbitrage nécessaire : soit accepter des p95 dominés par les triggers métier, soit autoriser
un lot séparé sur ces triggers — hors périmètre B13.
























