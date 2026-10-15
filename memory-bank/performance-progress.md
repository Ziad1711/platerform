# JISRA — Performance Optimization Progress

**Projet :** Jisra  
**Document :** Suivi permanent des optimisations de performance  
**Dernière mise à jour initiale :** 15 octobre 2026  
**Source de référence :** `memory-bank/performance-optimization-plan.md`

## 1. Objectif

Ce document constitue la source de référence pour connaître l'avancement réel du chantier d'optimisation des performances de Jisra.

Il doit permettre à tout agent IA de reprendre le travail sans recommencer les audits, perdre les décisions précédentes ou exécuter deux fois les mêmes modifications.

**Règle fondamentale : une modification implémentée n'est pas automatiquement une modification validée ou déployée.**

## 2. Règles de suivi

Pour chaque lot, distinguer obligatoirement :

- **PLANNED :** travail prévu mais non commencé.
- **IMPLEMENTED :** modifications présentes dans le code.
- **TESTED :** tests exécutés, avec résultats documentés.
- **VALIDATED :** critères d'acceptation satisfaits et approbation humaine obtenue lorsqu'elle est requise.
- **DEPLOYED :** version effectivement déployée et identifiée par son commit.
- **BLOCKED :** obstacle empêchant la poursuite du lot.

Un lot peut avoir plusieurs états distincts : par exemple `IMPLEMENTED`, mais `NOT VALIDATED` et `NOT DEPLOYED`.

Ne jamais déclarer un test réussi sans preuve ou résultat effectivement observé.

## 3. Historique du chantier original

### Chantier 1 — Déblocage des pages publiques

**Statut connu :** IMPLEMENTED — validation complète et déploiement à confirmer.

**Commit identifié :** `b9c4b31`

Travaux connus :
- Séparation des providers privés et des pages marketing.
- Retrait du chargement bloquant des boutiques sur les pages publiques.
- Allègement du parcours anonyme.

**À confirmer :**
- Tests fonctionnels et mesures sur une version identifiée.
- État réel du déploiement.
- Absence de régression des pages publiques.

### Chantier 2 — Lot 1 : Authentification, cookies et cache

**Statut connu :** IMPLEMENTED — validation complète et déploiement à confirmer.

**Commits identifiés :**
- `58273fe`
- `3331402`
- `0743350`
- `725a6e6`
- `faf345b`
- `4e4aa61`

Travaux connus :
- Isolation des caches privés.
- Gestion des erreurs Auth.
- Propagation des cookies.
- Protection contre les callbacks tardifs et requêtes obsolètes.

**À confirmer :**
- Tests complets des sessions.
- Tests de changement de compte.
- Comportement lors d'une panne Supabase.
- Validation du SHA réellement déployé.

### Chantier 2 — Lot 2 : Dashboard Bootstrap

**Statut connu :** IMPLEMENTED LOCALLY — NOT VALIDATED — NOT DEPLOYED CONFIRMED.

Travaux présents dans l'audit :
- Bootstrap serveur des boutiques et permissions.
- Hydratation initiale du StoreProvider.
- Mutualisation de certaines lectures Auth.
- Isolation des caches par identité et session.
- Gestion des erreurs de lecture des accès.
- Sélection de boutique validée.

**Points restant à valider :**
- Compilation et build sur l'état exact du travail.
- Scénarios d'authentification.
- Séparation multi-tenant.
- Révocation des accès et changements de rôle.
- Absence de requêtes redondantes.
- Comportement sous panne réseau.
- Performance avant/après.

**Attention :** plusieurs modifications locales ne sont pas encore commitées, selon l'audit initial.

## 4. Lots opérationnels issus du dernier audit

Ces lots constituent une séquence de validation et d'optimisation complémentaire.

**Ne pas confondre cette numérotation avec celle du chantier original.**

| Lot opérationnel | Objectif | Statut initial |
|---|---|---|
| Lot 0 | Figer le dépôt et établir la baseline | PLANNED |
| Lot 1 | Valider le bootstrap existant | PLANNED |
| Lot 2 | Mutualiser les lectures de facturation | PLANNED — CONDITIONNEL |
| Lot 3 | Paralléliser les périodes KPI | PLANNED — CONDITIONNEL |
| Lot 4 | Corriger la période initiale du dashboard | PLANNED — CONDITIONNEL |

**Lots actuellement autorisés pour préparation et exécution contrôlée : Lot 0 et Lot 1 uniquement.**

Les Lots 2, 3 et 4 nécessitent une nouvelle décision après analyse des résultats.

## 5. Incident Supabase — Contexte de performance

**Date :** 15 octobre 2026.

Constats :
- Projet Supabase devenu `Unhealthy`.
- PostgreSQL, Auth, PostgREST et Storage affectés.
- CPU initialement proche de 92 %.
- Erreurs HTTP 503/504 et timeouts PostgreSQL.
- Redémarrage de la base puis intervention de redémarrage du projet.
- Service rétabli et amélioration importante des performances rapportée.

**Cause racine : NON CONFIRMÉE.**

Conséquences pour le chantier :
- Les anciennes mesures de lenteur peuvent être contaminées par l'incident.
- Une nouvelle baseline saine est nécessaire.
- Ne pas attribuer automatiquement les anciennes lenteurs au code.
- Ne pas surcharger Supabase avec des tests intensifs.
- Ne pas modifier les RPC, les index ou les politiques RLS sans justification technique.

## 6. Prochaine exécution autorisée

**Séquence : Lots opérationnels 0 et 1 du fichier `performance-optimization-plan.md`.**

Objectifs :
1. Identifier l'état Git et les modifications locales.
2. Identifier le déploiement Vercel actif.
3. Sécuriser le travail existant avec un checkpoint ciblé.
4. Établir une baseline de performance saine.
5. Valider le bootstrap existant.
6. Exécuter les tests techniques et fonctionnels réalisables.
7. Documenter les tests nécessitant une intervention humaine.
8. Présenter les résultats avant toute nouvelle optimisation.

**Interdictions :**
- Aucun merge vers `main`.
- Aucun push distant.
- Aucun déploiement en production.
- Aucune migration Supabase.
- Aucune modification des politiques RLS.
- Aucune suppression de données.
- Aucune exécution anticipée des Lots 2, 3 ou 4.

Toute opération non prévue présentant un risque doit recevoir une autorisation humaine.

## 7. Journal d'exécution

Chaque nouvelle exécution doit ajouter une entrée selon ce modèle.

### Exécution — [DATE / HEURE UTC]

**Agent :** [Nom]  
**Branche :** [Branche exacte]  
**Commit initial :** [SHA]  
**Lot :** [Identifiant et nom]  
**Environnement :** [Local / Preview / Production observée]

#### Modifications réalisées

[Chemins exacts, nature de chaque modification et justification.]

#### Tests effectués

| Test | Méthode | Résultat observé | Statut |
|---|---|---|---|
| À renseigner | À renseigner | À renseigner | PASS / FAIL / BLOCKED |

#### Métriques

| Métrique | Avant | Après | Conclusion |
|---|---|---|---|
| T_login | Non mesuré | Non mesuré | À déterminer |
| T_auth | Non mesuré | Non mesuré | À déterminer |
| T_shell | Non mesuré | Non mesuré | À déterminer |
| T_data | Non mesuré | Non mesuré | À déterminer |
| N_supabase | Non mesuré | Non mesuré | À déterminer |
| Erreurs 5xx | Non mesuré | Non mesuré | À déterminer |

Ne jamais remplacer « Non mesuré » par un chiffre estimé.

#### Sécurité et régressions

[Résultats des tests multi-tenant, Auth, rôles, permissions, sessions et changement de boutique.]

#### Git et déploiement

**Commit créé :** [SHA ou Aucun]  
**Push :** [Oui / Non]  
**Merge :** [Oui / Non]  
**Déploiement :** [Environnement et SHA, ou Aucun]

#### Limitations et blocages

[Tests non exécutables, accès manquants, incidents, incertitudes.]

#### Décision

[VALIDATED / NOT VALIDATED / BLOCKED / NEEDS HUMAN REVIEW]

#### Prochaine action

[Action autorisée, sans anticipation du lot suivant.]

## 8. Règles permanentes pour les agents IA

Avant toute tâche de performance :

1. Lire `performance-optimization-plan.md`.
2. Lire `performance-progress.md`.
3. Consulter le Memory Bank et l'état réel du dépôt.
4. Identifier le prochain lot autorisé.
5. Vérifier si le travail a déjà été implémenté.
6. Respecter exactement le périmètre du lot.
7. Expliquer comment chaque opération sera réalisée.
8. Exécuter les tests et documenter leurs résultats.
9. Mettre à jour ce document à la fin de l'exécution.
10. Demander une validation humaine avant de passer au lot suivant si elle est requise.

**Ne pas confondre :**
- Code écrit et code testé.
- Build réussi et fonctionnalité validée.
- Commit local et déploiement.
- Réduction de requêtes et amélioration réellement mesurée.
- Incident infrastructure et défaut applicatif.

**Principe directeur : sécurité, stabilité, preuves, performance.**