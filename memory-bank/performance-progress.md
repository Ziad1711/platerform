# JISRA — Performance Optimization Progress

**Projet :** Jisra  
**Document :** Suivi permanent des optimisations de performance  
**Dernière mise à jour initiale :** 15 octobre 2026  
**Dernière mise à jour :** 16 octobre 2026 — déploiement contrôlé, Phases 1–2 : candidat `ee79b3b` confirmé, copie propre, 2 cibles de rollback READY, bundle vérifié (aucune URL factice, bon projet Supabase, **aucun secret serveur côté client**) ; **build Production local impossible** (20 variables `sensitive` illisibles ⇒ `[SENSITIVE]` ⇒ `ERR_INVALID_URL`) ⇒ route révisée `vercel deploy --prod --skip-domain` ; **arrêté avant publication**. Voir §7
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
| Lot 0 | Figer le dépôt et établir la baseline | CHECKPOINT FAIT — BASELINE INFRA ÉTABLIE — SHA DÉPLOYÉ NON ÉTABLI ⇒ NON VALIDÉ |
| Lot 1 | Valider le bootstrap existant | TESTS TECHNIQUES PASSÉS — SCOPES FONCTIONNELS NON EXÉCUTÉS ⇒ NEEDS HUMAN REVIEW |
| Lot 2 | Mutualiser les lectures de facturation | PLANNED — CONDITIONNEL |
| Lot 3 | Paralléliser les périodes KPI | PLANNED — CONDITIONNEL |
| Lot 4 | Corriger la période initiale du dashboard | PLANNED — CONDITIONNEL |

**Lots actuellement autorisés pour préparation et exécution contrôlée : Lot 0 et Lot 1 uniquement.**

> **Exécutés le 16 octobre 2026 (voir §7).** Le Lot 3 reste bloqué sur des prérequis non satisfaits : la version déployée n'est pas identifiée et aucune mesure navigateur (`T_data`, `N_supabase`) n'existe. Aucun lot n'est `VALIDATED` ni `DEPLOYED`.

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

### Exécution — 2026-10-15 23:35 → 23:58 UTC (16 octobre 2026, 00:35 → 00:58 locale)

**Agent :** Cline
**Branche :** `perf/login-dashboard-bootstrap`
**Commit initial :** `4e4aa617494b0607d3edda159b0dbb8c845959e9`
**Lot :** Lot opérationnel 0 (figer le périmètre + baseline) puis Lot opérationnel 1 (valider le bootstrap existant)
**Environnement :** Local (dépôt Windows, build de production sur le port 3000) + Supabase production observé en lecture seule (journaux de logs). Aucun déploiement, aucune écriture.

#### État réellement atteint

- **Lot 0 : PARTIELLEMENT ATTEINT.** Périmètre figé et checkpoint créé ; baseline *infrastructure* établie et reproduite ; **critère d'acceptation non satisfait** : la version déployée sur Vercel reste **non identifiée**, donc aucune capture ne peut porter de SHA déployé.
- **Lot 1 : TESTS TECHNIQUES PASSÉS, VALIDATION FONCTIONNELLE NON ATTEINTE.** `tsc` et `build` OK, comportement anonyme observé ; les scénarios d'identité, de rôles et multi-boutiques **n'ont pas été exécutés** (session authentifiée et navigateur indisponibles) ⇒ `NEEDS HUMAN REVIEW`.
- Aucun lot n'est déclaré `VALIDATED` ni `DEPLOYED`.

#### Modifications réalisées

Aucune modification de code applicatif. Aucune réécriture du bootstrap.

| Chemin | Nature |
|---|---|
| — | Aucun fichier applicatif modifié |
| `memory-bank/performance-progress.md` | Mise à jour du suivi (ce document) |

Classification du périmètre appliquée au checkpoint (18 fichiers) : `app/(app)/layout.tsx`, `app/(app)/layout-client.tsx`, `components/providers.tsx`, `components/auth/auth-form.tsx`, `components/dashboard/{onboarding-modal,store-selector,delivery-tracking-status}.tsx`, `components/settings/{stores,team}-section.tsx`, `lib/auth/use-permissions.ts`, `lib/auth/store-{access,bootstrap,bootstrap.server}.ts`, `lib/store-selection.ts`, `lib/store-context.tsx`, `lib/supabase/server.ts`, `memory-bank/performance-{optimization-plan,progress}.md`.

Exclus volontairement (non écrasés, laissés dans l'arbre de travail) : `components/marketing/pricing/pricing-card.tsx` (changement marketing étranger, apparu pendant l'audit), `tsconfig.tsbuildinfo` et `next-env.d.ts` (générés), `nul` (artefact 0 octet).

#### Tests effectués

| Test | Méthode | Résultat observé | Statut |
|---|---|---|---|
| Vérification TypeScript | `npx tsc --noEmit --incremental false --pretty false` | code de sortie 0, 0 ligne de sortie | PASS |
| Build de production | `npm run build` | « ✓ Compiled successfully in 16.8s », « Finished TypeScript in 15.7s », 150 pages générées, table des routes complète, `.next/BUILD_ID = iRvTJPPq-PiZ0xzrRN97K`, 0 erreur | PASS |
| Avertissements de build | lecture du journal de build | 2 avertissements Next.js uniquement : convention `middleware` dépréciée (→ `proxy`), et runtime edge désactivant la génération statique d'une page | PASS (sans impact) |
| Démarrage de la version construite | `npm run start` (port 3000) | « ✓ Ready in 300ms », écoute sur `0.0.0.0:3000` (PID 37160) | PASS |
| Pages publiques anonymes | `curl` : `/`, `/login`, `/signup` | HTTP 200 ; 0,132 s / 0,126 s / 0,025 s | PASS |
| Routes protégées anonymes | `curl` : `/dashboard`, `/settings`, `/sales` | HTTP 307 → `location: /login` ; 0,035 s / 0,025 s / 0,039 s | PASS |
| Journal serveur local | lecture du journal de `next start` | aucune erreur applicative | PASS |
| Trafic Supabase des tests anonymes | `edge_logs` filtrés par IP d'émission locale (`cf_connecting_ip = 41.251.25.43`) | **0 requête** : aucune vérification Auth, aucune lecture REST déclenchée | PASS |

| Traces bootstrap — Auth RSC partagée | lecture de `lib/supabase/server.ts`, `app/(app)/layout.tsx`, `app/(app)/dashboard/page.tsx` | `getServerUserResult = cache(resolveServerUserResult)` et `getRequestClient = cache(createClient)` ; layout **et** page appellent la même fonction mémoïsée | PASS (statique) |
| Traces bootstrap — lecture groupée des accès | lecture de `lib/auth/store-access.ts` | une seule requête `store_members` + `stores!inner`, filtrée `user_id` / `status = 'active'` ; repli en deux lectures **uniquement** si `PGRST200`/`PGRST201` | PASS (statique) |
| Traces bootstrap — pas de relecture au montage | lecture de `lib/store-context.tsx` | `initialData` + `initialDataUpdatedAt` issus du bootstrap, `refetchOnMount: false`, `staleTime: 0`, `retry: false`, revalidation focus/reconnexion conservée | PASS (statique) |
| Traces bootstrap — permissions sans requête dédiée | lecture de `lib/auth/use-permissions.ts` + inventaire des 15 appels | rôle dérivé de `accessibleStores` ; aucune requête dans le hook | PASS (statique) |
| Scénarios d'identité (0 / 1 / plusieurs boutiques, invité, préférence invalide) | — | non exécutable sans session authentifiée | BLOCKED |
| Authentification (login A → B, refresh, session expirée, logout) | — | non exécutable sans comptes de test | BLOCKED |
| Multi-tenant et rôles (révocation, rétrogradation) | — | non exécutable sans comptes de test | BLOCKED |
| Pannes simulées (Auth, lecture des accès, stockage navigateur) | — | exige une preview isolée et DevTools | BLOCKED |
| Captures navigateur (`T_login`, `T_auth`, `T_shell`, `T_data`, `N_supabase`) | — | aucun navigateur instrumenté dans cette session | BLOCKED |

#### Métriques

| Métrique | Avant | Après | Conclusion |
|---|---|---|---|
| T_login | Non mesuré | Non mesuré | Navigateur indisponible |
| T_auth | Non mesuré | Non mesuré | Dépend d'une session authentifiée |
| T_shell | Non mesuré | Non mesuré | Idem |
| T_data | Non mesuré | Non mesuré | Idem |
| N_supabase (navigateur) | Non mesuré | Non mesuré | Idem |
| Erreurs 5xx | Incident du 15/10 : 96 à 413 5xx/h sur `/auth/v1/*` (18 h → 20 h UTC) | **0 5xx** sur `edge_logs` à partir de 22:10 UTC, 23:00 → 23:55 incluses | Infrastructure saine et stable après restauration |

**Baseline infrastructure** (lecture seule, source `edge_logs`, fenêtre réellement disponible : 2026-10-14 23:37:39 → 2026-10-15 23:55:54 UTC). Reproduction de la méthode du plan (chemins `/auth/v1/*` et code HTTP) :

| Heure UTC (15/10) | Requêtes totales | dont `/auth/v1/*` | 5xx Auth | 5xx toutes routes |
|---|---:|---:|---:|---:|
| 18 h | 177 | 100 | 96 | 128 |
| 19 h | 308 | 196 | 195 | 260 |
| 20 h | 541 | 416 | 413 | 505 |
| 21 h | 1 430 | 162 | 14 | 61 |
| 22 h | 786 | 51 | 5 | 8 |
| 23 h | 184 | 12 | 0 | 0 |

Cette agrégation reproduit la table du plan (§2.1) aux écarts d'ingestion près : la méthode de capture de la baseline est donc confirmée. Le détail à 10 minutes situe la fin de la dégradation entre 21:30 et 21:40 UTC, puis des tranches propres (0 5xx) de 22:10 à 23:55 UTC. Codes d'erreur `auth_logs` sur la fenêtre : `request_timeout` 21 (max 28 890 ms), `refresh_token_not_found` 11, `unexpected_failure` 2, `session_not_found` 1, `conflict` 1, `invalid_credentials` 1.

**Piège d'unité relevé :** le champ `duration` de `auth_logs` est exprimé en **nanosecondes** ; toute lecture en millisecondes sans division par 10⁶ surestime d'un facteur 1 000.

**Références de latence côté Supabase** (fenêtre 21:00 UTC → fin, toutes routes et tous utilisateurs confondus, valeurs `response.origin_time` telles que rapportées ; **non comparables** à un temps de chargement de dashboard) : `rpc_dashboard_top_products` 93 appels, `rpc_dashboard_kpi_metrics` 59, `rpc_billing_status` 53 (2 écarts 5xx, fenêtre chevauchant la fin de l'incident), `store_members` 205, `/auth/v1/user` 175.

#### Sécurité et régressions

- Aucune donnée ni permission modifiée ; aucune politique RLS, aucun RPC et aucun index touchés.
- Les routes protégées restent inaccessibles sans session (`307` → `/login`) : le refus serveur est inchangé.
- Les tests anonymes locaux **ne génèrent aucun appel Supabase** : le parcours public ne reçoit aucune vérification supplémentaire.
- Aucun défaut d'isolation multi-tenant n'a été recherché ni démontré dans cette exécution (scénarios `BLOCKED`).
- Les modifications étrangères du dépôt n'ont été ni écrasées ni indexées.

#### Git et déploiement

**Commit créé :** `e049d96` — « chore(perf): checkpoint du bootstrap dashboard et de la selection de boutique » (18 fichiers, +2 326 / −240) ; mise à jour du suivi documentaire dans un second commit local
**Push :** Non
**Merge :** Non
**Déploiement :** Aucun

Empreinte de l'arbre de travail relevée avant et après le relevé, identique (`a592f4e66c2aeda96819bb6611cd1a1b3dda6234`) : aucune modification concurrente pendant l'opération. `git diff --check` ne signale aucune erreur d'espace, uniquement des avertissements `LF → CRLF` sans impact.

#### Limitations et blocages

1. **Version déployée sur Vercel non identifiable.** Le rattachement local existe (`.vercel/project.json` : `prj_h26koUauo1YWLE1a4dPs9LAiUr5l`, `team_z5xI8PExqzr3TirSUSQwpQ8H`, projet `platerform`), mais la CLI `vercel` n'est pas installée (`npx` s'arrête faute de paquet) et aucun jeton `VERCEL_TOKEN` n'est exposé dans la session. Aucune comparaison déployé/local n'a donc pu être établie.
2. **Aucun navigateur instrumenté** : pas de DevTools, pas de trace Performance, pas de capture réseau. Les métriques `T_*` et `N_supabase` restent non mesurées.
3. **Aucune session authentifiée** : les scénarios d'identité, de rôles, de multi-tenant et de pannes restent non exécutés.
4. Les journaux Supabase sont disponibles sur environ 24 heures et présentent un décalage d'ingestion de plusieurs minutes.
5. Les deux 5xx `504` observés sur `/rest/v1/store_members` (18:58 et 19:00 UTC) proviennent d'appels `curl` directs d'un audit antérieur (IP `196.127.37.123`), **hors** fenêtre saine et **sans lien** avec les tests de cette exécution.
6. Un serveur `chrome-devtools-mcp` (headless, isolé) tourne sur la machine, mais **aucun outil de navigateur n'est exposé** dans cette session : les captures restent impossibles côté agent. L'exposition de cet outil lèverait le blocage n° 2 sans modifier l'application.

#### Décision

**Lot 0 : PARTIELLEMENT ATTEINT — non validé au sens strict** (checkpoint conforme et baseline infrastructure établie, mais aucune capture ne porte de SHA déployé).
**Lot 1 : TESTS TECHNIQUES PASSÉS — VALIDATION FONCTIONNELLE NON ATTEINTE — `NEEDS HUMAN REVIEW`.**
**Aucun `VALIDATED`, aucun `DEPLOYED`.**

#### Prochaine action

Ne pas engager les Lots 2, 3 ou 4. Deux interventions humaines sont requises :
1. fournir le **SHA réellement déployé** (tableau de bord Vercel, ou `vercel ls` / `vercel inspect` avec un jeton) afin de rattacher les futurs relevés à une version identifiée ;
2. fournir un **compte de test non sensible** (idéalement deux comptes et une boutique) ainsi qu'une **preview isolée**, pour exécuter les scénarios d'identité, de rôles et de changement de boutique.

### Phase préparatoire — clôture des Lots 0 et 1 — 2026-10-16 00:00 → 00:15 UTC (01:00 → 01:15 locale)

**Agent :** Cline
**Branche :** `perf/login-dashboard-bootstrap`
**Commit initial :** `644af0a96cbc61d5f52e1440d56d6b5304e557fe`
**Lot :** préparation de la clôture des Lots opérationnels 0 et 1 (aucun test authentifié, aucun déploiement, aucune donnée modifiée)
**Environnement :** poste local + lecture seule des métadonnées Vercel/Supabase. Aucune exécution applicative, aucun appel métier.

#### Objet

Vérifier les prérequis de la clôture avant toute validation : configuration des environnements, existence d'un Supabase réellement isolé, outils navigateur disponibles, prérequis des tests F01 → F15.

#### Constats vérifiés — environnements

| # | Constat | Portée |
|---|---|---|
| 1 | Un seul fichier d'environnement présent : `.env.local` (26 variables, **noms relevés, valeurs non reproduites**). Aucun `.env`, `.env.test`, `.env.preview`, `.env.staging`, `.env.example` | Aucune configuration de test versionnée ou locale disponible |
| 2 | `NEXT_PUBLIC_SUPABASE_URL` local = projet `attvfeoqgbxsnnsllatt`, **identique au projet de production** déjà observé dans les journaux | **L'environnement local n'est pas isolé** : toute validation authentifiée locale lirait et écrirait la production |
| 3 | `.env.local` contient `SUPABASE_SERVICE_ROLE_KEY`, `INTEGRATIONS_ENCRYPTION_KEY` et plusieurs secrets d'intégration (YouCan, Facebook, Lightfunnels, IA) | Une exécution locale authentifiée disposerait d'un accès privilégié à la production |
| 4 | Aucune stack Supabase locale : `supabase/` ne contient que `migrations/`, **pas de `config.toml`** | Le lancement d'une base locale n'est pas préparé |
| 5 | `.gitignore` ligne 3 ignore `.env.local` | Aucun secret d'environnement suivi par Git (aucune fuite par le dépôt) |
| 6 | Périmètre des variables Vercel (Preview vs Production) **non vérifié volontairement** : la lecture des valeurs n'entre pas dans la consigne « sans révéler de secrets » | À confirmer par l'utilisateur |

#### Constats vérifiés — outils navigateur et interception

| # | Constat | Conséquence |
|---|---|---|
| 7 | Aucun outil E2E installé : ni `playwright`, ni `puppeteer`, ni `cypress`, ni `selenium`, aucun binaire correspondant dans `node_modules/.bin` | Aucune capture automatisable en local |
| 8 | Un serveur `chrome-devtools-mcp@1.11.0 --headless --isolated` est en cours d'exécution, mais **aucun outil navigateur n'est exposé** dans ma session ; aucune configuration MCP dans le dépôt (`.mcp.json` et `.vscode/` absents) | La configuration est côté client : l'exposition de l'outil dépend de l'utilisateur |
| 9 | `docker` et `python` disponibles ; `mitmproxy` absent | L'interception réseau du rendu serveur (F12/F13 côté RSC) exigerait une installation ou un conteneur, donc une autorisation explicite |

#### Constats vérifiés — dépôt (changements concurrents, hors périmètre)

Depuis la vérification précédente, l'arbre de travail a de nouveau changé **sans intervention de l'agent** : `package.json` et `package-lock.json` modifiés (`lint` passe de `next lint` à `eslint .`, ajout de `eslint@^9.39.5` et `eslint-config-next@^16.2.4`), nouveaux fichiers `eslint.config.mjs`, `public/icons/icon-192.png` et `public/icons/icon-512.png`. S'y ajoutent `components/marketing/pricing/pricing-card.tsx`, `tsconfig.tsbuildinfo` et `nul`, déjà connus.

Aucun de ces fichiers n'appartient au périmètre perf : **aucun n'a été modifié, indexé ni inclus** dans le checkpoint `e049d96`. HEAD reste `644af0a` et les documents de suivi étaient identiques au commit avant cette mise à jour. **Conséquence : les mesures techniques précédentes (`tsc`, `build`) ne correspondent plus exactement à l'état courant de l'arbre** ; toute revalidation technique devra être relancée sur l'état figé au moment du test.

#### Prérequis F01 → F15 — état vérifié

**Contrôles d'accès identifiés (servent de critères PASS/FAIL exacts) :**

| Élément | Comportement vérifié dans le code | Conséquence pour les tests |
|---|---|---|
| `lib/auth/require-permission.ts` | `requireAuth()` → `UNAUTHORIZED` ; `requirePermission(storeId, perm)` → `UNAUTHORIZED` / `FORBIDDEN` ; `requireAnyPermission(perm)` (pages sans cookie de boutique) ; `getMemberRole` filtre `status = 'active'` | Le refus attendu dépend de l'endpoint : `UNAUTHORIZED`, `FORBIDDEN` ou erreur RPC |
| `GET /api/stores/list` | `requireAuth()` puis RPC `get_my_stores` | En F06, avec le compte B, la réponse **ne doit contenir que les boutiques de B** |
| `PATCH` / `DELETE /api/team/members/[storeId]/[userId]` | `requireAuth()` puis RPC `change_member_role` / `remove_member` ; toute erreur est convertie en **HTTP 500** avec message technique | En F06/F07, un refus d'autorisation est attendu sous forme **d'erreur RPC remontée en 500**, et non en 403 : le critère PASS est « aucune donnée ni effet sur la boutique étrangère », pas un code HTTP précis |
| `requireAnyPermission` | Utilisé pour les pages accessibles sans cookie de boutique (ex. `/finances`) : propriété du store ou permission sur une appartenance active | En F07, l'accès direct à `/finances` par un `viewer` doit être refusé côté serveur, pas seulement masqué dans le menu |

**État des prérequis :**

| Prérequis | État | Motif |
|---|---|---|
| Environnement Supabase isolé | **ABSENT** | Local = production (`attvfeoqgbxsnnsllatt`) ; pas de stack locale ; périmètre Preview Vercel non vérifié |
| Comptes synthétiques A0 / A1 / A2 / B / M / I± / O | **ABSENT** | Aucun compte de test fourni ou documenté |
| Données et KPI marqués par boutique | **ABSENT** | Aucune fixture identifiée |
| Navigateur instrumenté (DevTools ou outil exposé) | **ABSENT** | Aucun outil E2E installé ; aucun outil navigateur exposé dans la session |
| Interception réseau du serveur Next (F12/F13 côté RSC) | **ABSENT** | Aucun proxy installé ; `docker`/`python` présents mais non préparés |
| Baseline de production sans écriture | **NON RÉSOLU** | Le dashboard peut déclencher des écritures automatiques ; décision humaine requise |
| Corrections à apporter | **AUCUNE CONNUE** | Aucun défaut applicatif reproduit à ce stade |

**Conséquence : F01 → F15 restent BLOCKED.** Aucun test de ces scénarios ne peut être exécuté sans franchir au moins un des prérequis ci-dessus.

#### Exécutable immédiatement (sans production, sans compte, sans autorisation supplémentaire)

1. **Revalidation technique locale sur l'état figé** : `npx tsc --noEmit --incremental false --pretty false`, `npm run build`, puis démarrage sur le port 3000. Aucun appel Supabase n'est déclenché par ces étapes.
2. **Preuve que le parcours anonyme ne dépend pas de Supabase, sans toucher la production** : lancer le serveur local en surchargeant **uniquement pour ce processus** `NEXT_PUBLIC_SUPABASE_URL` vers une adresse injoignable (variable d'environnement en ligne de commande, **aucun fichier modifié**), puis vérifier que `/`, `/login`, `/signup` répondent 200 et que `/dashboard`, `/settings`, `/sales` répondent 307 vers `/login`. Si ces réponses restent identiques, la preuve est directe et ne dépend plus d'une inférence par IP.
3. **Relevés de métadonnées en lecture seule** : SHA de production via l'alias Vercel et santé Supabase, à refaire juste avant et juste après la future fenêtre de mesure.

#### Reste bloqué

- Baseline navigateur de production et comparaison R/C ;
- `T_login`, `T_auth`, `T_shell`, `T_data`, `N_supabase` ;
- F01 → F15 ;
- attribution exacte des appels Supabase serveur.

#### Interventions humaines nécessaires

1. **Confirmer le périmètre des variables Vercel** — commande sûre car elle n'affiche que les noms : `vercel env ls preview` et `vercel env ls production`. Je n'ai pas exécuté de lecture de valeurs, pour ne pas exposer de secret. Si Preview partage le Supabase de production, **aucune preview ne peut servir de banc de test**.
2. **Choisir la stratégie d'isolement** : (a) projet Supabase de test dédié, ou (b) stack Supabase locale (initialisation + Docker). Les deux créent un environnement et exigent ton autorisation explicite. Dans les deux cas : schéma et RLS identiques, **aucune donnée client**, aucun credential d'intégration réelle.
3. **Fournir les comptes synthétiques** dans cet environnement : A0 (zéro boutique), A1 (une boutique), A2 (deux boutiques), B (compte totalement distinct), M (membre rétrogradable puis révocable), O (administrateur de test), I− / I+ (invités sans et avec mot de passe).
4. **Exposer l'outil navigateur** (chrome-devtools-mcp est actif mais non exposé dans ma session), ou réaliser les captures DevTools toi-même.
5. **Trancher la baseline de production** : captures existantes d'un usage normal et autorisé, ou maintien du blocage sous la contrainte « aucune modification de production ».
6. **Autoriser, seulement si nécessaire, un outil d'interception réseau local** pour valider F12/F13 côté rendu serveur (aucun proxy installé actuellement).

#### Décision

**Phase préparatoire terminée. Lots 0 et 1 : toujours NON VALIDÉS, NON DÉPLOYÉS.** Aucun test F01 → F15 exécuté, aucun défaut applicatif reproduit, aucune correction nécessaire identifiée. Aucun push, aucun merge, aucun déploiement, aucune donnée modifiée.

#### Prochaine action

Aucune validation supplémentaire sans les décisions ci-dessus. Seules les trois actions de la section « Exécutable immédiatement » peuvent être menées sans nouvelle autorisation.

### Validation légère des Lots 0 et 1 — 2026-10-16 00:00 → 00:35 UTC (01:00 → 01:35 locale)

**Agent :** Cline
**Branche :** `perf/login-dashboard-bootstrap`
**Commit initial :** `0d72a806e16101513fd87a8b42aa8e54f5951ae3`
**Lot :** validations possibles des Lots 0 et 1 sans mettre en danger la production
**Environnement :** poste local ; build de validation à credentials neutralisés ; Supabase production lu en lecture seule ; **aucun test authentifié exécuté par l'agent**.

#### Méthode et état figé

Empreintes relevées au début : `git diff` → `2addd033e08b7a7a3ddf8225bd696334a9f67861`, `git status --porcelain` → `a6102f909ed67f22c33b17a7e2d598ffee8c2ea2`. Les huit fichiers du périmètre portent des empreintes identiques avant et après les tests (ex. `lib/auth/store-access.ts` = `2d90cd4e…`, `lib/store-context.tsx` = `25174985…`, `components/providers.tsx` = `ae5e72d4…`) : **aucun fichier applicatif modifié**.

Le seul changement apparu pendant la session est `next-env.d.ts`, réécrit par l'instance `next dev` en cours d'exécution. Aucun fichier n'a été créé ni modifié dans le dépôt par cette exécution ; le banc de tests a été écrit **hors dépôt** (`%TEMP%\jisra-mock\`).

#### Tests techniques

| Test | Méthode | Résultat observé | Preuve | Statut |
|---|---|---|---|---|
| TypeScript | `npx tsc --noEmit --incremental false --pretty false` sur l'état figé | code de sortie 0, 0 ligne de sortie | journal vide, code retour | **PASS** |
| ESLint — dépôt entier | `npx eslint . --no-cache` (première exécution : la config ESLint a été ajoutée par l'utilisateur pendant la session) | **937 problèmes : 831 erreurs, 106 avertissements** ; aucune correction appliquée | `/tmp/jisra-lint.log` | **FAIL de conformité globale — hors périmètre du lot** |
| ESLint — périmètre perf | même commande sur les 17 fichiers du bootstrap/providers | **35 problèmes : 24 erreurs, 11 avertissements** ; règles principales : `react-hooks/refs` 10, `react-hooks/set-state-in-effect` 6, `@typescript-eslint/no-unused-vars` 6, `no-explicit-any` 6, `react-hooks/exhaustive-deps` 4 | `/tmp/jisra-lint-perimetre.log` | **FAIL de conformité — anomalies à arbitrer, aucune correction** |
| Build de validation | `npm run build` avec `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9` et clés factices **pour ce seul processus** | compilation réussie en 20,1 s, table de routes complète (150 pages), **0 erreur**, 2 avertissements Next.js connus | `/tmp/jisra-build2.log` | **PASS** |
| Neutralisation effective du build | recherche de l'URL factice et de l'URL de production dans la sortie de build | URL factice **présente** dans `.next/server/chunks/ssr/*` ; URL de production présente uniquement dans le **cache `dev`** résiduel | inspection `.next` | **PASS** |

Le succès du build avec une URL Supabase injoignable démontre que **la compilation ne dépend pas d'un accès vivant à Supabase** : aucun appel de production n'est nécessaire pour construire l'application.

#### Tests automatisés avec mocks (aucune I/O réseau)

**Comment :** les trois modules réels (`lib/auth/store-access.ts`, `lib/auth/store-bootstrap.ts`, `lib/store-selection.ts`) ont été compilés en JavaScript dans un dossier temporaire, puis exercés par un faux client Supabase chaînable qui **enregistre les requêtes** au lieu de les émettre. Aucun accès réseau, aucune base, aucun crédential.

**Résultat réellement observé : 13/13 PASS** (`%TEMP%\jisra-mock\harness.cjs`, code de sortie 0).

| Cas | Attendu | Observé |
|---|---|---|
| T00 borne de lecture des accès | `STORE_ACCESS_TIMEOUT_MS` = 12 000 | conforme |
| T01 succès normal | **une seule** lecture groupée `store_members` + `stores!inner`, filtres `user_id` + `status = 'active'`, rôles normalisés, ordre stable par `created_at` puis `id` | conforme ; rôle inconnu → `null` (aucun droit) |
| T02 réponse malformée | erreur `STORE_ACCESS_MALFORMED_RESPONSE` | conforme — **jamais** un succès vide |
| T03 erreur non relationnelle | erreur propagée, **aucun repli** | conforme (1 seule lecture) |
| T04 erreur de relation `PGRST200` | repli en 2 lectures, filtres conservés, rôles appliqués | conforme (3 lectures, `.in('id', …)`) |
| T05 signal déjà annulé | `STORE_ACCESS_ABORTED` | conforme — **jamais** un succès vide |
| T06 identifiant absent | `STORE_ACCESS_MISSING_USER`, aucune lecture | conforme |
| T07 repli sans appartenance | liste vide légitime, pas de 3ᵉ lecture | conforme |
| T08 normalisation des rôles | valeur inconnue → aucun droit | conforme |
| T09 référence de session | `session_id` lu ; absence/illisible → `''` | conforme |
| T10 préférence persistée | version, structure, UUID et taille invalides rejetés sans exception | conforme (9 cas) |
| T11 sélection effective | une préférence **n'est jamais** une autorisation | conforme : boutique inaccessible et préférence d'un autre compte → repli |
| T12 carte d'accès | `id → rôle`, base de la détection de révocation | conforme |

**Ce que ces tests ne prouvent pas :** ni le comportement réel de React/Next (rendu RSC, hydratation, Strict Mode), ni les cookies et le renouvellement Auth, ni les politiques RLS, ni les permissions effectives. Ils valident la **logique** des modules, pas le système.

#### Tests HTTP anonymes (sans écriture Supabase)

**Comment :** requêtes `curl` **sans aucun cookie** sur l'instance Next déjà en écoute sur le port 3000 (instance `next dev` lancée par l'utilisateur, PID 668). Aucun compte, aucune session, aucune écriture.

| Requête | Résultat observé | Critère PASS | Statut |
|---|---|---|---|
| `GET /` | HTTP 200, 0,013 s | page publique servie sans erreur | **PASS** |
| `GET /login` | HTTP 200, 0,044 s | formulaire servi | **PASS** |
| `GET /signup` | HTTP 200, 0,042 s | page servie | **PASS** |
| `GET /dashboard` | **HTTP 307 → `location: /login`** | route privée inaccessible sans session | **PASS** |
| `GET /settings` | **HTTP 307** | idem | **PASS** |

**Limitations de ce premier passage :** l'instance utilisée était en **mode développement** (pas le build de production) et chargeait le `.env.local` réel (production). Les temps relevés sont des temps HTTP locaux, **pas** des `T_login`/`T_data`, et aucune attribution fiable « zéro appel Supabase » n'était possible, la même machine générant par ailleurs un trafic authentifié de production. Ce passage a donc été **complété par le test sur build neutralisé** (section « Test HTTP concluant »), qui apporte la preuve concluante.

#### Analyse des journaux (lecture seule)

| Mesure | Fenêtre UTC | Résultat observé |
|---|---|---|
| Santé Supabase, minute par minute | 2026-10-15 23:55 → 2026-10-16 00:23 | **0 erreur 5xx** sur toute la fenêtre ; pics légitimes (00:13-00:15 et 00:20) liés à un usage réel |
| Requêtes Auth `/auth/v1/*` | même fenêtre | 0 en dehors des minutes d'usage authentifié |
| Erreurs | même fenêtre | aucune 5xx, aucun 429 observé |

**Baseline infrastructure maintenue :** la plateforme est **saine** sur cette fenêtre, ce qui confirme que les observations de l'incident du 15/10 ne doivent pas être extrapolées.

#### Anomalies détectées

| # | Anomalie | Gravité | Preuve | Action |
|---|---|---|---|---|
| A1 | **La machine locale écrit dans la production.** Sur la seule minute 00:20 UTC, l'IP d'émission locale a généré un trafic complet de dashboard authentifié : `POST /rest/v1/profiles`, `POST /rest/v1/rpc/claim_delivery_tracking_batch`, `POST /rest/v1/rpc/reserve_delivery_tracking_slot`, `POST /rest/v1/rpc/release_delivery_tracking_lock`, `POST /rest/v1/delivery_tracking_state`, 17 × `/auth/v1/user`, 10 × `store_members`, 18 × `integrations`, RPC KPI et facturation | **élevée (risque opérationnel)** | journaux `edge_logs` filtrés par IP locale (41.251.25.43) | Confirme que **le développement local n'est pas isolé** et justifie de ne pas exécuter de scénarios destructifs (révocation, rôles, A→B) dans cet environnement. Aucune action de correction demandée dans ce lot |
| A2 | `react-hooks/refs` (10 erreurs) : lecture d'une ref pendant le rendu dans `lib/store-context.tsx` (~lignes 491-499) pour calculer `isRevoking`, puis rendu conditionnel d'un écran de chargement | **moyenne (à confirmer)** | ESLint périmètre ; lecture du code | **Non corrigé** (hors autorisation). Risque : la valeur lue au rendu n'est pas garantie par React (rendu concurrent) → l'écran de « révocation en cours » peut être manqué ou retardé. À reproduire en conditions réelles avant toute correction |
| A3 | `react-hooks/set-state-in-effect` (6), `no-unused-vars` (6), `no-explicit-any` (6), `exhaustive-deps` (4) dans le périmètre ; 937 problèmes au total dans le dépôt | **faible à moyenne (style/conformité)** | logs ESLint | Aucune correction. La config ESLint vient d'être ajoutée : ces constats sont majoritairement préexistants et couvrent tout le dépôt |
| A4 | `next-env.d.ts` réécrit automatiquement par l'instance `next dev` | informatif | `git status` | Aucune action ; fichier généré, déjà exclu du périmètre |

#### Test HTTP concluant sur build neutralisé (port 3000 réservé)

**Comment :** arrêt temporaire du `next dev` (PID 668) et d'un `next start` résiduel (PID 36748) — **autorisé par l'utilisateur** —, suppression du cache `.next` (artefact généré), puis `npm run build` et `npm run start` avec `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9` et clés factices **pour ces seuls processus** (aucun fichier modifié).

| Contrôle | Résultat observé | Statut |
|---|---|---|
| Build neutralisé | compilé en 13,9 s, table de routes complète, **0 erreur**, `.next/BUILD_ID = bfSQB47JhpVt3_FTi1hOB` | **PASS** |
| Neutralisation du bundle | **116 fichiers** contiennent l'URL factice, **0 fichier** contient l'URL de production dans `.next/server` + `.next/static` | **PASS** |
| `GET /` | HTTP 200, 0,129 s | **PASS** |
| `GET /login` | HTTP 200, 0,136 s | **PASS** |
| `GET /signup` | HTTP 200, 0,032 s | **PASS** |
| `GET /dashboard` | **HTTP 307 → `location: /login`** | **PASS** |
| `GET /settings`, `GET /sales` | HTTP 307 | **PASS** |
| Tentatives d'appel sortant | **0 occurrence** de `ECONNREFUSED`, `127.0.0.1:9` ou `error` dans le journal serveur | **PASS** |
| Contrôle croisé Supabase | **0 requête** depuis l'IP locale après 00:30 UTC (`edge_logs`) | **PASS** |

**Conclusion :** avec une URL Supabase **injoignable dès le build**, les pages publiques répondent correctement et les routes privées redirigent — **aucun appel Supabase n'est même tenté**. Le parcours anonyme/public est donc indépendant de Supabase. **Ceci ne valide aucun scénario authentifié.**

**Restauration de l'environnement :** serveur de validation arrêté, port 3000 libéré, **serveur de développement de l'utilisateur redémarré** (PID 36480, « Ready in 788ms », `.env.local` rechargé).

#### Inventaire ESLint du périmètre (détaillé — aucune correction)

24 erreurs / 11 avertissements :

- **16 erreurs React Hooks** (`react-hooks/refs`, `react-hooks/set-state-in-effect`) : `lib/store-context.tsx` 268, 288, 383, 491, 494 (×4), 496, 498, 501 ; `components/providers.tsx` 81, 328 ; `components/dashboard/store-selector.tsx` 111 ; `components/dashboard/delivery-tracking-status.tsx` 177 ; `components/auth/auth-form.tsx` 66.
- **6 erreurs `no-explicit-any`** : `onboarding-modal.tsx` 233, 270 ; `team-section.tsx` 63, 199 ; `middleware.ts` 69, 77.
- **1 erreur `react/no-unescaped-entities`** : `auth-form.tsx` 305.
- **1 erreur** de variable déclarée non utilisée : `delivery-tracking-status.tsx` 306.
- **11 avertissements** : variables non utilisées (`store-selector` 5, 6 ; `stores-section` 29, 30 ; `team-section` 37, 51), `react-hooks/exhaustive-deps` (`providers` 406 ; `store-context` 267 ×3), `no-img-element` (`stores-section` 123).

Ces règles proviennent de la configuration ESLint ajoutée **pendant** la session (937 problèmes au total dans le dépôt) : les constats sont donc largement transverses. **Aucune correction n'a été appliquée.**

#### Environnement de validation

Blocage précédent **levé** : le port 3000 et `.next` ont été réservés le temps du test, puis rendus à l'utilisateur. Le build de validation n'est plus sur disque (remplacé par les artefacts du serveur de développement redémarré) ; sa réussite est prouvée par son journal, son `BUILD_ID` et la vérification du bundle.

#### Métriques

| Métrique | Avant | Après | Conclusion |
|---|---|---|---|
| T_login | Non mesuré | Non mesuré | Aucun navigateur instrumenté |
| T_auth | Non mesuré | Non mesuré | Exige une session authentifiée |
| T_shell | Non mesuré | Non mesuré | Idem |
| T_data | Non mesuré | Non mesuré | Idem |
| N_supabase | Non mesuré | Non mesuré | Idem |
| Erreurs 5xx | 0 sur 23:55 → 00:23 UTC | 0 sur la même fenêtre | Infrastructure saine, aucun incident nouveau |

#### Git et déploiement

**Commit créé :** documentaire uniquement (suivi) — aucun commit applicatif
**Push :** Non
**Merge :** Non
**Déploiement :** Aucun
**Fichiers applicatifs modifiés :** aucun (empreintes du périmètre identiques avant/après)

#### Reste bloqué

- Attribution exacte `N_supabase` (navigateur et serveur) et mesures `T_*` : aucun navigateur instrumenté.
- Scénarios F01 → F15 : comptes synthétiques, environnement isolé et navigateur instrumenté absents (voir la phase préparatoire).
- Décision sur la conformité ESLint du périmètre (24 erreurs, inventaire détaillé ci-dessus) : corriger le code, ou acter que ces règles ne sont pas bloquantes — **aucune correction n'a été appliquée**.
- Vérification du périmètre des variables Vercel Preview/Production.
- Comportement réel en production : le candidat reste **non déployé**, donc non observé.

#### Décision

**Lots 0 et 1 : NON VALIDÉS** — les critères obligatoires de **mesure** et de **scénarios authentifiés** restent non satisfaits.

Validations désormais **acquises** (avec preuves) : état figé inchangé, TypeScript, build de production neutralisé, absence de dépendance du parcours anonyme à Supabase, logique des modules (13/13 mocks), infrastructure saine.
Validations **non acquises** : `T_*`, `N_supabase`, F01 → F15, conformité ESLint du périmètre.
**Aucun `DEPLOYED`.**

#### Prochaine action

Deux décisions humaines restent nécessaires :
1. **Conformité ESLint** : corriger les 24 erreurs du périmètre (dont 16 React Hooks, cluster `refs` de `lib/store-context.tsx`) ou les déclarer hors critères d'acceptation de ce lot ;
2. **Isolation** : sans projet Supabase dédié, F01 → F15 resteront `BLOCKED` — et **aucun test destructif ne doit être lancé sur l'environnement local, puisqu'il écrit dans la production** (anomalie A1).

Aucune correction applicative ne sera engagée sans autorisation. Les Lots 2, 3 et 4 restent non entamés.

### Finalisation pré-déploiement — 2026-10-16 00:35 → 01:05 UTC (01:35 → 02:05 locale)

**Agent :** Cline
**Branche :** `perf/login-dashboard-bootstrap`
**Commit initial :** `ee79b3b22bbaab4682a5ae5a690e6d41f362a6e0`
**Lot :** contrôles pré-déploiement des optimisations existantes (aucune réimplémentation, aucun déploiement)
**Environnement :** copie Git propre hors dépôt + Supabase et Vercel observés en lecture seule.

#### Candidat et copie propre

| Élément | Valeur |
|---|---|
| SHA candidat retenu | **`ee79b3b22bbaab4682a5ae5a690e6d41f362a6e0`** (HEAD) |
| Code applicatif | identique à `e049d96` (les 4 commits suivants sont documentaires) |
| Copie | worktree détaché `c:/Users/HP-EXE/Documents/erp ecom/jisra-deploy-candidate`, `git status` vide |
| Arbre local | **préservé** : carte marketing, `package.json`, `package-lock.json`, `eslint.config.mjs`, icônes PWA, `tsconfig.tsbuildinfo`, `nul` — inchangés |
| Identité des 17 fichiers du périmètre | **contenu identique** entre le SHA et l'arbre local (même hash Git, ex. `components/dashboard/delivery-tracking-status.tsx` = `5221d3e7…`) ; seule différence : fins de ligne (CRLF dans la copie), confirmée par `diff --strip-trailing-cr` → aucune différence |

#### Résultats vérifiés

| Contrôle | Méthode | Résultat observé | Statut |
|---|---|---|---|
| Dépendances du SHA | `npm ci` dans la copie (lockfile du SHA) | 207 paquets, `NPMCI_EXIT=0` — après **deux échecs `ENOTEMPTY`** (particularité Windows sur `node_modules` partiel), résolus en supprimant `node_modules` | **PASS** |
| TypeScript | `npx tsc --noEmit --incremental false --pretty false` dans la copie | `TSC_EXIT=0`, 0 ligne | **PASS** |
| Build | `npm run build` dans la copie, credentials **neutralisés** (`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9`) | compilé, table de routes complète, **0 erreur**, `.next/BUILD_ID = TdxPtacUTaiFxOFTge3To` | **PASS** |
| Neutralisation de l'artefact | recherche des URL dans la sortie du build de la copie | **116 fichiers** avec l'URL factice, **0 fichier** avec l'URL de production | **PASS** |
| ESLint (référence) | dans l'arbre local, 17 fichiers du périmètre | **35 problèmes : 24 erreurs, 11 avertissements** | **FAIL de conformité** |
| ESLint (copie) | même invocation `--config` avec chemins absolus hors projet | 17 problèmes : **0 erreur**, 17 avertissements | **ARTEFACT DE PORTÉE** — voir ci-dessous |
| Contrôle de l'artefact ESLint | même invocation `--config` sur les **fichiers locaux** | **35 problèmes : 24 erreurs** — identique à la référence | **PASS** (l'écart vient de la localisation des fichiers, hors périmètre de la config Next) |
| Banc de mocks n°1 | modules du **candidat** compilés puis exercés avec un faux client Supabase, sans I/O | **13/13 PASS**, `EXIT=0` | **PASS** |
| Banc de mocks n°2 | `lib/auth/permissions.ts` + `lib/auth/redirects.ts` du **candidat** | **10/10 PASS**, `EXIT=0` (anti-boucle de redirection, refus viewer/confirmation, redirections ouvertes neutralisées, `/welcome` jamais accordé sur demande ni après lecture ratée) | **PASS** |

**Conclusion ESLint :** le résultat applicable au candidat est bien **24 erreurs / 11 avertissements** ; le « 0 erreur » obtenu en lintant des fichiers hors projet ne doit pas être présenté comme une preuve, la localisation modifiant la portée de la configuration Next.

#### Classement des alertes React Hooks (16 erreurs) — aucune correction appliquée

| # | Emplacement | Nature | Classement et justification |
|---|---|---|---|
| H1 | `lib/store-context.tsx` 494-501 (lecture de `prevAccessRef.current` et `isRevoking`) | `react-hooks/refs` — ref lue **pendant le rendu** | **Risque réel mais non bloquant.** Violation de pureté du rendu : sous rendu concurrent, la valeur lue n'est pas garantie → l'écran « révocation en cours » peut être manqué ou retardé. **L'isolation ne dépend pas de ce drapeau** : dans le même rendu, `accessibleStores` et `effectiveSelection = reconcileSelection(selection, accessibleStores)` excluent déjà la boutique révoquée. Impact résiduel : affichage transitoire de données en cache, corrigé par la purge (`removeQueries`) et le remontage `accessVersion`. À corriger **après** déploiement |
| H2 | `lib/store-context.tsx` 268 (`latestStoresRef.current = accessibleStores`) | `react-hooks/refs` — écriture de ref pendant le rendu | **Risque faible.** Même classe de violation, mais la valeur ne sert qu'à **refuser** une sélection non confirmée ; une valeur d'un rendu non validé ne peut pas élargir les droits (RLS serveur reste l'autorité) |
| H3 | `components/providers.tsx` 328 (`applyIdentityRef.current = applyIdentity`) | `react-hooks/refs` | **Risque réel, non bloquant.** L'identité appliquée par la vérification de secours pourrait provenir d'un rendu non validé. Aucune fonctionnalité concurrente n'étant utilisée aujourd'hui, le comportement observé reste correct. À corriger après déploiement (déplacement en effet, avec retest du parcours A → B) |
| H4 | `lib/store-context.tsx` 286-289 (`setSelection(reconcileSelection(...))`) | `react-hooks/set-state-in-effect` | **Non bloquant — boucle exclue.** Vérifié dans le code : `reconcileSelection` **renvoie l'objet courant inchangé** quand rien ne change (mode `none` sans magasin, mode `store` encore autorisé, mode `all`) → `setSelection` avec la même référence déclenche un bail-out React ; sinon le résultat converge en un rendu |
| H5 | `lib/store-context.tsx` 364-391 (application d'une intention externe) | `react-hooks/set-state-in-effect` | **Non bloquant — boucle exclue.** Gardes explicites : retour si lecture en cours, en erreur, si aucun instantané confirmé, si aucune intention ; l'intention est consommée (`pendingSelectionRef = null`) avant l'incrément de `persistenceRevision` |
| H6 | `components/dashboard/delivery-tracking-status.tsx` 161-186 (réinitialisation à chaque changement de sélection) | `react-hooks/set-state-in-effect` | **Non bloquant.** Effet dépendant uniquement de `currentStoreId` → une exécution par changement. C'est le mécanisme d'isolation des états par sélection ; un rendu supplémentaire est attendu |
| H7 | `components/dashboard/store-selector.tsx` 107-112 (sélection différée après création) | `react-hooks/set-state-in-effect` | **Non bloquant.** Gardes `!pendingSelectId` et présence du magasin dans la liste confirmée ; l'état est remis à `null` → convergence immédiate |
| H8 | `components/auth/auth-form.tsx` 65-69 (`setMode`/`setError`/`setSuccess` sur `[defaultMode]`) | `react-hooks/set-state-in-effect` | **Non bloquant.** Synchronisation du formulaire avec le mode par défaut de la route ; une exécution par changement de `defaultMode`. Amélioration possible (état dérivé ou `key`), sans défaut fonctionnel constaté |
| H9 | `components/providers.tsx` 78-83 (`setTheme` depuis `localStorage`) | `react-hooks/set-state-in-effect` | **Non bloquant.** Hydratation unique du thème ; déclenche au plus un rendu supplémentaire |
| W1 | `components/providers.tsx` 406 (`applyIdentity` absent des dépendances) | `react-hooks/exhaustive-deps` (avertissement) | **Non bloquant — intentionnel** : l'effet utilise `applyIdentityRef` pour éviter de se réabonner à chaque rendu |
| W2 | `lib/store-context.tsx` 267 (×3) | `react-hooks/exhaustive-deps` (avertissements) | **Non bloquant.** Expression logique recréée uniquement quand les données changent (référence stable de React Query) ; impact limité à une réexécution d'effet |
| W3 | `onboarding-modal.tsx` 233, 270 ; `team-section.tsx` 63, 199 ; `middleware.ts` 69, 77 | `@typescript-eslint/no-explicit-any` (6 erreurs) | **Dette de typage, non bloquante** ; `middleware.ts` est toutefois sur le chemin des permissions |
| W4 | `auth-form.tsx` 305 ; `delivery-tracking-status.tsx` 306 ; variables non utilisées et `no-img-element` | règles diverses (1 erreur + 11 avertissements) | **Non bloquant** ; constats de propreté |

**Observation supplémentaire (hors périmètre, non corrigée) :** `components/providers.tsx` 42 appelle `createClient()` **pendant le rendu**, ce qui recrée un client Supabase à chaque rendu et fait de `supabase` une dépendance d'effet instable (`ThemeLoader`, 46-68). Cela peut produire des **relectures répétées de `theme_preference`** — point à rapprocher du constat P2 du plan (« plusieurs lectures partielles de `profiles` »), à traiter dans un lot ultérieur.

#### Vérification Vercel (lecture seule) — BLOCKED

| Tentative | Résultat |
|---|---|
| Outils Vercel (API) dans cette session | **Indisponibles** : l'outillage Vercel n'est plus exposé (réponse d'outil inexistant) |
| CLI Vercel locale | **Absente** (`which vercel` → introuvable ; installation `npx` impossible) |
| CLI alternatives globales | `bun`, `pnpm`, `claude-code`, `gemini-cli` présents ; aucune CLI Vercel |
| Observation HTTP publique | `https://jisra.io` → **HTTP 200**, `Server: Vercel`, `X-Vercel-Cache: HIT`, `Age: 93909` ; `https://www.jisra.io` → 308. **`X-Vercel-Id` contient l'horodatage de la requête, pas l'identifiant du déploiement** → n'identifie pas la version servie |

**Dernière identification certaine (session précédente, via l'API Vercel)** : alias `jisra.io` → déploiement **`dpl_HQDHrTUT4GmnsrDF3QhyBfFy67fY`**, `target: production`, région `iad1`, **SHA `4a420b6037b8d6d192ccbffc24fac6a5a0f95655`**, `readyState: READY`, protection SSO activée pour les previews.

**Conséquence :** la cible de rollback **reste à reconfirmer** auprès de Vercel avant publication. Je ne dispose d'aucun moyen, dans cette session, de certifier le déploiement actuellement servi ni son association au SHA stable.

#### Reste bloqué

- **Confirmation Vercel** : déploiement servi, disponibilité de la cible de rollback, périmètre des variables Preview/Production.
- **Tests manuels authentifiés (F01 → F15)** : aucun environnement isolé, donc risque réel d'écriture en production (anomalie A1 prouvée).
- **Mesures** `T_login`, `T_auth`, `T_shell`, `T_data`, `N_supabase` : aucun navigateur instrumenté → **aucun gain démontré**, ce qui reste acceptable séparément du déploiement fonctionnel.
- **ESLint** : 24 erreurs du périmètre, classées ci-dessus (aucune non bloquante au sens sécurité, mais H1 et H3 sont des risques réels à traiter après déploiement).

#### Décision

**NO-GO à cet instant**, pour deux motifs précis et non techniques :
1. la **cible de rollback n'est pas reconfirmée** (aucun accès Vercel dans cette session) ;
2. les **scénarios authentifiés critiques** (A → B, logout, sélection multi-boutiques, refus serveur) ne sont pas prouvés par des preuves reproductibles — seuls des tests manuels rapportés par l'utilisateur existent, sans couverture précisée.

**GO conditionnel** dès que : (a) le déploiement de production et la cible de rollback sont confirmés côté Vercel, (b) les scénarios manuels critiques sont exécutés **ou** l'acceptation du risque est explicite, (c) l'artefact est construit depuis le SHA candidat avec les variables de Production.

**Éléments déjà prêts** : code candidat identifié et isolé, dépendances installées depuis le lockfile du SHA, TypeScript PASS, build PASS sans aucune URL de production, artefact neutralisé vérifié, 23 tests automatisés PASS (13 + 10), aucune migration Supabase, aucune modification de RLS/permissions, aucun fichier applicatif modifié par les contrôles.

#### Procédure de publication et de rollback (à n'exécuter qu'après autorisation explicite)

1. **Vérifier** : `vercel ls` / tableau de bord → déploiement de production courant + SHA ; confirmer que `dpl_HQDHrTUT4GmnsrDF3QhyBfFy67fY` est toujours `READY`. Relever le déploiement stable comme **cible de rollback**.
2. **Préparer** : dans la copie propre `c:/Users/HP-EXE/Documents/erp ecom/jisra-deploy-candidate`, `git status` vide, `HEAD = ee79b3b`, `npm ci` déjà effectué.
3. **Construire** : déploiement Vercel ciblant **Production** depuis ce SHA, avec les variables de Production, **sans attribution immédiate des domaines** ; attendre `READY` et relever l'ID + le SHA.
4. **Contrôler** : confirmer que l'artefact ne contient aucune URL factice (aucun `127.0.0.1:9`, aucune clé de validation).
5. **Publier** : promotion du déploiement sur les domaines, puis vérifier `jisra.io`.
6. **Vérifier immédiatement** : `/`, `/login`, `/signup` en anonyme ; route privée anonyme → redirection ; connexion réelle, dashboard, sélection de boutique, actualisation, déconnexion ; surveillance des logs Vercel/Supabase (Auth, 5xx, 429, hausse inexpliquée des requêtes).
7. **Rollback** : **Instant Rollback** vers la cible relevée à l'étape 1, puis revérifier les domaines et les parcours public/privé. Ne pas promouvoir une preview construite avec d'autres variables : la promotion ne reconstruit pas le bundle. Le rollback n'annule pas les écritures métier effectuées après publication ; aucune migration n'étant incluse, aucun rollback SQL n'est requis.

#### Prochaine action

1. me confirmer l'accès Vercel (CLI ou tableau de bord) ou réaliser les trois relevés de l'étape 1 ;
2. préciser la couverture de tes tests manuels, puis exécuter les scénarios critiques sur **localhost** (jamais sur la production) ;
3. décider du traitement des alertes H1/H3 (après déploiement) et de la dette ESLint.

Aucune publication, promotion, migration ou correction ne sera effectuée sans autorisation explicite.

### Contrôles Vercel pré-publication — 2026-10-16 01:25 → 01:50 UTC (02:25 → 02:50 locale)

**Agent :** Cline
**Branche :** `perf/login-dashboard-bootstrap`
**Commit initial :** `2c8ab6adf9fd8c19dd86a4932e48f99ee5d5c948`
**Lot :** vérifications préalables à la publication (aucune publication, promotion, migration ou correction)
**Environnement :** API Vercel en lecture seule + dépôt local. Aucun secret affiché.

#### 1. Déploiement associé à jisra.io — établi

| Élément | Valeur vérifiée |
|---|---|
| Alias | `jisra.io`, `www.jisra.io`, `platerform.vercel.app` + URL projet |
| Déploiement | **`dpl_HQDHrTUT4GmnsrDF3QhyBfFy67fY`** |
| `readyState` / `target` / région | **READY** / **production** / `iad1` |
| SHA Git | **`4a420b6037b8d6d192ccbffc24fac6a5a0f95655`** (branche `main`) |
| Message | « feat(analytics): Vercel Web Analytics sans cookie… » |

À l'instant du relevé, **la production ne contient donc pas** le travail du candidat : elle correspond encore à l'état de `main`.

#### 2. Cible de rollback — disponible immédiatement

| Déploiement | SHA | État | `target` | Rollback |
|---|---|---|---|---|
| `dpl_HQDHrTUT4GmnsrDF3QhyBfFy67fY` | `4a420b6…` | READY | production | **`isRollbackCandidate: true`** |
| `dpl_WyrE2oQzgwU5eaQ4kvc3nikcMS1x` | `dc5cc6d…` | READY | production | **`isRollbackCandidate: true`** |

Deux déploiements de production `READY` sont éligibles au rollback : la version stable actuelle et la précédente. **Le retour arrière est donc immédiat** après publication d'un nouveau déploiement.

#### 3. Variables de production — vérifiées sans révélation de valeur

Toutes les valeurs sont revenues **chiffrées ou vides** (`decrypted: false`), aucune n'a été reproduite. `hiddenProductionEnvCount: 0` : aucune variable de production n'est masquée.

| Variable | Portées déclarées |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | preview + production |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | preview + production |
| `SUPABASE_SERVICE_ROLE_KEY` | preview + production |
| `INTEGRATIONS_ENCRYPTION_KEY` | preview + production |
| `CRON_SECRET` | production + preview |
| `NEXT_PUBLIC_SITE_URL` | production + preview |
| `LIGHTFUNNELS_CLIENT_ID` | **production uniquement** |
| `LIGHTFUNNELS_CLIENT_SECRET` | **production uniquement** |
| `LIGHTFUNNELS_REDIRECT_URI` | **production uniquement** |
| `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `FACEBOOK_REDIRECT_URI` | preview + production |
| `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY` | preview + production |
| `OPENAI_MODEL`, `OPENAI_API_KEY` | preview + production |
| `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL` | preview + production |
| `ASSISTANT_PROVIDER` | preview + production |
| `YOUCAN_CLIENT_ID`, `YOUCAN_CLIENT_SECRET`, `YOUCAN_REDIRECT_URI` | preview + production |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | preview + production |

**Deux conséquences majeures :**

1. **Aucune isolation entre preview et production** : `NEXT_PUBLIC_SUPABASE_URL`, la clé anonyme et **la clé `service_role`** sont partagées par `preview` et `production`. Une preview peut donc lire **et écrire** la base de production — cela confirme l'anomalie A1 et **interdit d'utiliser une preview comme banc de test**.
2. **La promotion d'une preview est dangereuse ici** : `LIGHTFUNNELS_*` n'existent **que** en production. Une preview est donc construite **sans** ces variables, et la promotion Vercel **ne reconstruit pas** le bundle : promouvoir une preview livrerait en production un artefact privé de la configuration Lightfunnels. **La route preview → promotion est écartée.**

#### 4. Périmètre du candidat — conforme

Delta complet `4a420b6` → `ee79b3b` : **22 fichiers** (16 modifiés, 4 ajoutés dans `lib/`, 2 documents ajoutés).

| Zone sensible | Fichiers modifiés |
|---|---|
| `supabase/` (migrations, RLS) | **0** |
| `.github/` | **0** |
| `vercel.json` (crons) | **0** |
| `next.config.*` | **0** |
| `package.json`, `package-lock.json` | **0** |
| `middleware.ts` | 1 (attendu : ce chantier) |

Aucune migration de base n'est donc requise, et les ajouts locaux non commités (ESLint, icônes PWA, carte marketing) **ne seront pas** dans l'artefact déployé.

**Compatibilité base :** `loadStoreAccess` s'appuie sur l'embarquement PostgREST `store_members` → `stores!inner`, qui dépend de la clé étrangère `store_members.store_id → stores.id` (vérifiée précédemment) ; un repli en deux lectures existe si PostgREST renvoie `PGRST200`/`PGRST201`.

#### 5. Procédure de publication retenue (à n'exécuter qu'après autorisation)

**Route retenue : build ciblé Production via la CLI Vercel, sans push ni merge.**

```bash
npm i -g vercel
vercel login                 # ou fournir VERCEL_TOKEN (accès au projet)
cd "c:/Users/HP-EXE/Documents/erp ecom/jisra-deploy-candidate"
git status --short           # DOIT être vide
git rev-parse HEAD           # DOIT être ee79b3b22bbaab4682a5ae5a690e6d41f362a6e0
grep -rl '127.0.0.1:9' .next 2>/dev/null || echo "aucune trace du build de validation"
vercel pull --yes --environment=production    # récupère le rattachement + les variables de PRODUCTION
vercel build --prod                           # l'artefact est construit avec les variables de Production
vercel deploy --prebuilt --prod --yes         # publication en production
```

**Routes écartées et pourquoi :**
- *Push → preview → promotion* : écartée. Les variables `LIGHTFUNNELS_*` sont **production uniquement** ; une preview serait construite sans elles et la promotion **ne reconstruit pas** l'artefact.
- *Merge dans `main` + push* : écartée (merge interdit sans autorisation) ; c'est pourtant ce qui déclencherait un build Production par Git.

**Contrôles avant publication** : rattachement au bon projet (`prj_h26koUauo1YWLE1a4dPs9LAiUr5l`), arbre vide, SHA exact, aucune trace d'URL factice, `vercel build --prod` confirmé avec les variables de Production.

**Rollback (immédiat) :**
```bash
vercel rollback                          # ou tableau de bord → Instant Rollback
```
Cible 1 : **`dpl_HQDHrTUT4GmnsrDF3QhyBfFy67fY`** (SHA `4a420b6`, READY, production).
Cible 2 : **`dpl_WyrE2oQzgwU5eaQ4kvc3nikcMS1x`** (SHA `dc5cc6d`, READY, production).
Puis revérifier `jisra.io` et les parcours public/privé. Le rollback n'annule pas les écritures métier effectuées après publication ; aucune migration n'étant incluse, aucun rollback SQL n'est nécessaire.

#### 6. Vérifications de sécurité et de session encore indispensables

| # | Vérification | Étapes | Attendu |
|---|---|---|---|
| M1 | Logout et retour arrière | Se déconnecter, puis bouton « Précédent » puis rouvrir directement `/dashboard` | Redirection `/login`, **aucun** contenu privé, aucune donnée en cache |
| M2 | Refus serveur pour rôle limité | Avec un compte `viewer`, ouvrir directement `/finances` (URL saisie) | Refus **côté serveur** (page inaccessible) ; pas seulement un menu masqué |
| M3 | Session et rafraîchissement | Recharger `/dashboard` plusieurs fois, attendre le renouvellement de jeton, puis naviguer | Aucune boucle de redirection, aucun rechargement en boucle, session conservée |
| M4 | Étanchéité en mode « Tous les magasins » | Comparer les chiffres d'une boutique précise puis de « Tous les magasins » | Chiffres cohérents avec la sélection ; aucune donnée d'une boutique non sélectionnée |
| M5 | **Non testable sans isolation** — révocation / rétrogradation / panne Auth | Exige une modification réelle de rôle et une panne simulée | À **accepter explicitement** ou à différer après publication sur un compte jetable |

Rappel : les tests manuels réussis (A → B et changement de boutique) portaient sur le contenu du candidat (fichiers identiques, vérifiés par empreinte), mais ils s'exécutaient en local **connecté à la base de production** — les écritures éventuelles sont donc réelles (anomalie A1).

#### Décision

**GO conditionnel.** Tous les prérequis d'infrastructure et d'artefact sont désormais satisfaits :

- déploiement de production et **deux cibles de rollback `READY`** identifiés ;
- aucune variable de production masquée ; périmètre des portées vérifié ;
- artefact candidat reconstruit depuis le lockfile du SHA : TypeScript, build et 23 tests automatisés **PASS**, sans aucune trace d'URL de production ;
- delta limité aux fichiers autorisés, **aucune** modification de migration, RLS, `vercel.json`, `next.config` ou dépendances ;
- **risque de promotion d'une preview identifié et écarté** de la procédure.

Restent à couvrir **avant la promotion** : M1, M2, M3 (et M4 recommandé) ; M5 doit être explicitement acceptée. La dette ESLint (24 erreurs classées, dont H1/H3 « risque réel non bloquant ») et **l'absence de gain de performance mesuré** restent documentées : le déploiement se justifie par les correctifs fonctionnels, pas par une performance démontrée.

#### Prochaine action

Exécuter M1, M2, M3 (+ M4) sur **localhost**, me communiquer les résultats, puis m'autoriser explicitement la publication. Aucune publication, promotion, migration ou correction ne sera effectuée avant cet accord.

### Déploiement contrôlé — Phases 1 et 2 — 2026-10-16 02:00 → 02:35 UTC (03:00 → 03:35 locale)

**Agent :** Cline
**Branche :** `perf/login-dashboard-bootstrap`
**Commit initial :** `a8e0bb4`
**Lot :** vérifications finales + préparation du build Production (arrêt avant publication)
**Environnement :** copie Git propre hors dépôt, CLI Vercel 64.3.1 authentifiée (`ziadzerouala11-8743`), API Vercel en lecture seule.

#### Phase 1 — Vérifications finales

| # | Contrôle | Résultat observé | Statut |
|---|---|---|---|
| 1 | SHA candidat | `ee79b3b22bbaab4682a5ae5a690e6d41f362a6e0` — conforme, 17 fichiers du périmètre aux empreintes attendues | **PASS** |
| 2 | Copie Git propre | `next-env.d.ts` (fichier **généré**) était modifié par les builds successifs ; restauré depuis le SHA → `git status` **vide** | **PASS** (après restauration d'un artefact généré) |
| 3 | Cible de rollback | `dpl_HQDHrTUT4GmnsrDF3QhyBfFy67fY` (SHA `4a420b6`) **READY / production** ; second candidat `dpl_WyrE2oQzgwU5eaQ4kvc3nikcMS1x` (SHA `dc5cc6d`) **READY / production** | **PASS** |
| 4 | Variables de production | 44 variables récupérées par `vercel pull` ; `hiddenProductionEnvCount: 0` ; **aucune valeur affichée** (type `sensitive` = non lisible) | **PASS** (noms et portées) |
| 5 | Risques résiduels documentés | M5 (révocation / rôle / panne Auth non testables sans isolation) et alertes ESLint H1/H3 (refs lues/écrites pendant le rendu) | **DOCUMENTÉ** |

#### Phase 2 — Préparation du build Production

**Tentative A — `vercel build --prod` (build local avec les variables de production) : ÉCHEC, cause racine identifiée.**

```
✓ Compiled successfully in 13.0s
Error: Failed to collect configuration for /_not-found
  [cause]: TypeError: Invalid URL { code: 'ERR_INVALID_URL', input: '[SENSITIVE]' }
BUILD_EXIT=1
```

Preuve de la cause, obtenue sans révéler de valeur :

- `vercel pull --environment=production` a écrit **20 variables secrètes sous la forme littérale `[SENSITIVE]` (11 caractères)** — y compris `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL` ;
- `vercel env run -e production` confirme : « **20 Secret values cannot be pulled from the `production` Environment. Define them in a local .env file.** » et les quatre clés testées reviennent **vides** (`length=0`).

**Conclusion :** l'échec provient du **caractère non lisible des variables de type `sensitive`** de Vercel, **pas du code candidat** — le même code compile et construit avec succès dès que l'URL factice est remplacée par une valeur valide (build neutralisé : `BUILD_EXIT=0`). **Un build Production local est donc impossible pour ce projet**, quelle que soit la méthode (`pull` comme `env run`).

**Tentative B — build de vérification (avec l'environnement local, qui pointe le projet Supabase de production `attvfeoqgbxsnnsllatt`) : SUCCÈS.**

| Contrôle | Résultat observé | Statut |
|---|---|---|
| Build | `BUILD_EXIT=0`, table de routes complète, **0 erreur**, `.next/BUILD_ID = qKct02MMHRJQI7vcWtIKM` | **PASS** |
| Aucune URL de validation | `127.0.0.1:9` **absent** de tout l'artefact | **PASS** |
| Bon projet Supabase | référence de production `attvfeoqgbxsnnsllatt` **présente** dans les assets client | **PASS** |
| Aucun secret serveur côté client | **17 valeurs serveur** testées : aucune présente dans `.next/static` | **PASS** |
| Noms de variables serveur côté client | 8 noms sensibles vérifiés (`SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `INTEGRATIONS_ENCRYPTION_KEY`, secrets YouCan/Facebook/Lightfunnels, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) : **aucun présent** | **PASS** |

*Cette vérification porte sur 69 fichiers client et 2 654 fichiers serveur. Elle prouve la propriété demandée (aucune fuite client, bon projet Supabase) sans jamais exposer de valeur secrète.*

**Hygiène appliquée :** `.env.local` (copié pour le contrôle) et `.vercel/.env.production.local` (qui contenait un jeton OIDC et 20 placeholders) **supprimés** de la copie ; fichiers générés restaurés ; `git status` **vide** ; `HEAD` toujours `ee79b3b`. Seuls `.vercel/project.json` et `.vercel/output/` subsistent (ignorés par Git, ligne 7 de `.gitignore`).

#### Phase 3 — Arrêt obligatoire (aucune publication)

**Procédure révisée** — la route `vercel deploy --prebuilt --prod` est **inutilisable** : elle exige un build local avec les variables de production, impossible ici (20 variables `sensitive` non lisibles, prouvé en Phase 2). La route retenue construit **sur l'infrastructure Vercel** avec les variables de production natives, **sans** modifier `jisra.io` :

```bash
cd "c:/Users/HP-EXE/Documents/erp ecom/jisra-deploy-candidate"
git status --short        # DOIT être vide
git rev-parse HEAD        # DOIT être ee79b3b22bbaab4682a5ae5a690e6d41f362a6e0
vercel deploy --prod --skip-domain        # build distant, variables de PRODUCTION, domaine NON modifié
# → relever l'ID et l'URL du déploiement créé, puis le contrôler avant mise en service
vercel promote <deployment-id-ou-url>     # attribue jisra.io à ce déploiement
```

Aucune preview n'intervient : le déploiement est ciblé **production**, donc construit avec les variables natives (une preview aurait été privée de `LIGHTFUNNELS_*`).

**Rollback (inchangé, immédiat) :** `vercel rollback` → `dpl_HQDHrTUT4GmnsrDF3QhyBfFy67fY` (SHA `4a420b6`) ; alternative `dpl_WyrE2oQzgwU5eaQ4kvc3nikcMS1x` (SHA `dc5cc6d`).

**État : arrêté avant publication. Aucun déploiement créé, aucun domaine modifié, aucun push, aucun merge, aucune correction.**

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