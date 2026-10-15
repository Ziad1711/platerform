# Audit Jisra — Dashboard Bootstrap et chargement initial

**Recommandation : ne pas ajouter immédiatement une nouvelle optimisation du bootstrap.** Une implémentation importante existe déjà localement, sans être commitée. La priorité est d’identifier la version déployée et de mesurer le fonctionnement après restauration de Supabase.

Aucun fichier modifié, aucune migration, aucun build ni test de charge exécuté pendant cet audit.

---

## Partie 1 — État réel du projet

### 1.1 Git : trois états à distinguer

| État | Constat vérifié |
|---|---|
| `main` / référence locale `origin/main` | Commit `4a420b6` : Vercel Web Analytics |
| `perf/public-pages-unblock` | Commit `b9c4b31`, également présent dans la référence distante locale |
| Branche courante `perf/login-dashboard-bootstrap` | Commit `4e4aa61`, sans branche distante correspondante affichée |
| Arbre de travail | Nombreuses modifications applicatives et quatre nouveaux fichiers de bootstrap/sélection non suivis |
| Version déployée | **Non établie** |

Les références distantes sont celles présentes localement : aucun `fetch` n’a été effectué. Leur fraîcheur n’est donc pas garantie.

**Point important :** un changement de `components/marketing/pricing/pricing-card.tsx` est apparu entre deux relevés Git, sans intervention de ma part. Le dépôt semble avoir été modifié parallèlement à l’audit. Il faut figer le périmètre avant tout checkpoint.

### 1.2 Optimisations commit verifiées

Les commits suivants existent sur la branche courante, mais pas dans le `main` local :

- `b9c4b31` : providers privés sortis des pages publiques.
- `58273fe` : frontière d’identité et cache privé.
- `3331402` : distinction panne Auth / session invalide.
- `0743350` : propagation cumulative des cookies du middleware.
- `725a6e6`, `faf345b`, `4e4aa61` : isolation du cache, annulations, callbacks tardifs et protections Auth.

Leur présence dans Git **ne prouve ni leur déploiement, ni leur validation fonctionnelle complète**.

### 1.3 Bootstrap déjà implémenté dans les modifications locales

Chemins absolus vérifiés :

| Fichier | Fonctionnement constaté |
|---|---|
| `c:/Users/HP-EXE/Documents/erp ecom/platerform/app/(app)/layout.tsx` | Vérifie l’identité puis attend `buildAppBootstrap()` |
| `c:/Users/HP-EXE/Documents/erp ecom/platerform/lib/auth/store-bootstrap.server.ts` | Prépare boutiques, rôles, référence de session et sélection |
| `c:/Users/HP-EXE/Documents/erp ecom/platerform/lib/auth/store-access.ts` | Lecture groupée `store_members` + `stores`, filtrée utilisateur et statut actif |
| `c:/Users/HP-EXE/Documents/erp ecom/platerform/lib/auth/store-bootstrap.ts` | Contrats du bootstrap et normalisation des rôles |
| `c:/Users/HP-EXE/Documents/erp ecom/platerform/lib/store-selection.ts` | Préférence versionnée, liée à l’utilisateur, validée contre les boutiques accessibles |
| `c:/Users/HP-EXE/Documents/erp ecom/platerform/lib/store-context.tsx` | Hydratation via `initialData`, sans refetch au montage ; revalidation au focus/reconnexion |
| `c:/Users/HP-EXE/Documents/erp ecom/platerform/lib/auth/use-permissions.ts` | Permissions dérivées du contexte ; suppression de la requête dédiée |
| `c:/Users/HP-EXE/Documents/erp ecom/platerform/lib/supabase/server.ts` | Mutualisation RSC du client et du résultat Auth avec `React.cache()` |
| `c:/Users/HP-EXE/Documents/erp ecom/platerform/components/providers.tsx` | Cache privé par utilisateur/session, contrôle de correspondance avec le bootstrap |
| `c:/Users/HP-EXE/Documents/erp ecom/platerform/app/(app)/layout-client.tsx` | Ancienne attente `mounted` supprimée |

Ces éléments sont **implémentés localement, mais non validés ici à l’exécution**.

Le bootstrap contient notamment :

- une borne de 12 secondes pour la lecture des accès ;
- aucun retry implicite pour cette lecture ;
- un repli PostgREST réservé aux erreurs de relation ;
- un état d’erreur distinct d’une liste de boutiques vide ;
- une purge des caches lors d’un changement confirmé de rôle ou d’accès.

### 1.4 Architecture réelle

```text
Accès /dashboard
  → Middleware
      → getUser()
      → lecture du rôle si cookie de boutique
  → Rendu serveur
      → getServerUserResult()
          mutualisé entre layout et page dans le code local
      → buildAppBootstrap()
          → référence de session
          → boutiques + rôles
          → sélection validée
  → AppProviders
      → frontière utilisateur/session
      → QueryClient privé
      → StoreProvider hydraté
  → Montage des composants
      → requêtes KPI, graphiques, commandes, facturation, profils
      → appels secondaires onboarding et suivi livraison
```

Les deux contrôles Auth **middleware et rendu serveur ne sont pas mutualisés** par `React.cache()`. Il ne faut toutefois pas en supprimer un sans analyser sa responsabilité.

### 1.5 Memory Bank et sécurité

Les sept fichiers du Memory Bank ont été consultés. Certaines descriptions sont périmées :

- Next.js annoncé en `15.1.6`, installé en `16.2.4` ;
- React installé en `19.2.4` ;
- Supabase JS installé en `2.99.1` ;
- le diagramme historique décrit davantage de chargement serveur des widgets que le code réel ;
- le Memory Bank n’établit pas la validation du bootstrap local actuel.

Inspection limitée de la base connectée :

- RLS activée sur `orders`, `profiles`, `store_members`, `stores` ;
- clé étrangère `store_members.store_id → stores.id` présente.

**Cela ne constitue pas un audit exhaustif des politiques ni une preuve d’absence de fuite multi-tenant.**

---

## Partie 2 — Baseline de performance

### 2.1 Mesures réellement observées

Une lecture des logs existants a été effectuée, sans déclencher de requêtes métier.

Sur la fenêtre explicite du **15 octobre 2026, 00:00–24:00 UTC**, les requêtes Auth `/user` et `/token` présentent notamment :

| Heure UTC | Requêtes | HTTP 5xx |
|---|---:|---:|
| 18 h | 98 | 95 |
| 19 h | 196 | 195 |
| 20 h | 413 | 410 |
| 21 h | 143 | 6 |
| 22 h | 51 | 5 |
| 23 h | 8 | 0 |

**Conclusion limitée : une forte dégradation Auth est démontrée dans cette fenêtre.** Les huit requêtes sans 5xx à 23 h ne suffisent pas à établir une baseline stable après restauration.

Les agrégats exploratoires disponibles montrent également des erreurs et de fortes valeurs `response.origin_time` sur plusieurs routes. Ils mélangent des utilisateurs, scénarios et périodes : je ne les présente pas comme des temps de chargement du dashboard.

Documentation de référence : [Supabase Reports](https://supabase.com/docs/guides/observability/reports).

### 2.2 Mesures non disponibles

| Mesure recherchée | État et raison |
|---|---|
| Ouverture du login | Non mesurée : aucune capture navigateur |
| Authentification utilisateur | Non mesurée sur un scénario identifié |
| Premier affichage du dashboard | Non mesuré |
| Premières données utiles | Non mesurées |
| Nombre exact de requêtes par ouverture | Non établi : dépend du déploiement, du compte, de la sélection et des revalidations |
| Temps frontend / hydratation | Non mesuré : pas de trace Performance |
| Temps SQL exact des RPC | Non mesuré : un temps HTTP Supabase n’est pas un temps SQL |
| Gain du bootstrap local | Non établi : pas de comparaison contrôlée |

Aucun outil Chrome DevTools, PageSpeed ou navigateur authentifié n’est exposé dans cette session. Le rattachement Vercel est présent, mais je n’ai pas d’accès permettant de certifier le SHA déployé.

### 2.3 Méthode de capture proposée

Sur une **preview isolée**, avec des comptes et données de validation :

1. Identifier le SHA, l’environnement Supabase, la région Vercel et l’heure UTC.
2. Chrome DevTools → Network : activer `Preserve log`.
3. Capturer séparément :
   - ouverture anonyme de `/login` ;
   - soumission du login jusqu’aux premiers KPI ;
   - ouverture directe de `/dashboard` avec session valide ;
   - navigation chaude ;
   - boutique unique puis « Tous les magasins ».
4. Enregistrer une trace Performance avec captures d’écran.
5. Faire trois passages manuels par scénario principal, sans concurrence ni boucle.
6. Comparer médiane et étendue ; ne pas annoncer de percentile fiable avec trois passages.

Repères :

- **T_login** : navigation → formulaire visible et utilisable.
- **T_auth** : soumission → réponse de connexion.
- **T_shell** : soumission → structure du dashboard visible.
- **T_data** : soumission → premiers KPI réels visibles.
- **N_supabase** : appels directs navigateur **et** appels serveur corrélés, comptés séparément.
- **N_5xx**, retries, annulations et revalidations.

Les captures exportées doivent être débarrassées des cookies, tokens, mots de passe, liens d’invitation et données personnelles.

### 2.4 Séparer réseau et frontend

- **Network** : attente, téléchargement, durée HTTP et initiateur.
- **Performance** : scripts, tâches longues, rendu, hydratation et instant d’affichage.
- **Vercel** : durée du rendu et des appels serveur, si les traces existent.
- **Supabase** : erreurs et temps d’origine sur la même fenêtre UTC.

Ne pas additionner des requêtes parallèles ni calculer « frontend = total − somme des requêtes ».

Si les traces serveur manquent, le détail Auth/bootstrap restera inconnu. Une instrumentation temporaire minimale pourra alors être proposée séparément, uniquement en preview, sans identifiants ni secrets.

---

## Partie 3 — Diagnostic classé

| Priorité | Constat démontré | Impact et limites |
|---|---|---|
| P0 | Baseline contaminée par un incident Auth | Empêche d’attribuer les anciennes lenteurs au code |
| P0 | Écart entre `main`, branche et modifications locales | Risque de comparer des versions différentes |
| P1 | Deux clés pour le même `rpc_billing_status` | Duplication logique certaine ; nombre de départs réseau à confirmer |
| P1 | KPI courant puis précédent exécutés en série | Dépendance bloquante certaine dans la fonction |
| P1 | KPI attendent aussi `rpc_dashboard_top_products` | Le premier affichage dépend de plusieurs réponses |
| P2 | Contexte initial `month`, filtre dashboard `today` appliqué par effet | Transition certaine ; double vague réseau possible, non mesurée |
| P2 | Même RPC top produits appelée dans KPI et widget | Chevauchement des lectures ; déduplication absente entre ces fonctions |
| P2 | Plusieurs lectures partielles de `profiles` | Fragmentation réelle, mais besoins et cycles différents |
| P2 | Onboarding : géolocalisation → finalisation profil → profil/invitation | Cascade réelle, y compris avant le test `hasStores` |
| P2 | Profil timezone avant le widget horaire | Cascade secondaire réelle, non bloquante pour les KPI |
| Surveillance | Suivi livraison peut invalider les données | Une nouvelle vague peut être légitime après changement réel |

Précisions :

- Les deux instances de `KpiCards` utilisent la même clé TanStack Query : **je ne les compte pas automatiquement comme deux chargements distincts**.
- Les lectures `store_members` du middleware et du bootstrap ont des responsabilités différentes.
- Aucun chargement infini n’a été reproduit.
- Aucun défaut d’isolation entre tenants n’a été démontré.
- L’onboarding vérifie les invitations avant de se fermer pour un compte ayant des boutiques : supprimer cette vérification changerait le comportement métier.

---

## Partie 4 — Prochaine étape recommandée

### Ordre recommandé

1. **Identifier et figer la version à mesurer.**
2. **Capturer une baseline saine après restauration.**
3. **Valider le bootstrap déjà écrit, sans le réécrire.**
4. Si les captures le justifient : mutualiser la facturation.
5. Ensuite seulement : raccourcir le chemin critique des KPI.
6. Corriger la période initiale uniquement si une double vague est observée.

### Comparaison des options

| Option | Décision |
|---|---|
| Réécrire le bootstrap | Rejetée : il existe déjà localement |
| Déployer immédiatement le travail local | Rejetée : trop de modifications non validées |
| Supprimer une vérification Auth | Non recommandée à ce stade |
| Changer RPC, index ou RLS | Non justifié par les preuves actuelles |
| Mesurer puis appliquer une petite correction | **Recommandée** |
| Ne rien modifier si les performances sont satisfaisantes | **Issue explicitement acceptable** |

L’objectif historique « dashboard < 2 s » du Memory Bank reste un objectif produit, pas un résultat observé ni un seuil interprétable sans préciser le scénario.

---

## Partie 5 — Lots directement exécutables

### Lot 0 — Figer le périmètre et établir la baseline

**Pourquoi / preuve**  
Le dépôt contient du travail non commité et a changé pendant l’audit. Le SHA déployé reste inconnu.

**Où**  
Dépôt `c:/Users/HP-EXE/Documents/erp ecom/platerform`, historique Git, déploiements Vercel, traces navigateur et Supabase.

**Comment**

1. Suspendre les modifications concurrentes pendant le relevé.
2. Relever :
   ```bash
   git status --short
   git rev-parse HEAD
   git --no-pager diff --stat
   git --no-pager diff --check
   ```
3. Identifier dans Vercel le SHA et l’environnement réellement déployés.
4. Séparer les fichiers bootstrap des changements marketing non liés.
5. Après accord sur le périmètre, créer un checkpoint Git avec **ajout explicite des seuls fichiers concernés**, y compris les quatre nouveaux fichiers.
6. Ne pas inclure `tsconfig.tsbuildinfo`, `nul` ou les modifications étrangères.
7. Mesurer la version déployée puis le candidat local dans des environnements comparables.

**Risques / dépendances**  
Checkpoint incomplet ; preview pointant vers la production ; mesures pendant une nouvelle dégradation.

**Vérification / acceptation**  
Chaque capture porte un SHA, un scénario, une fenêtre UTC et un environnement identifiés. Les erreurs infrastructure sont signalées, pas mélangées silencieusement à la baseline.

**Rollback**  
Aucun changement applicatif. Ne rien fusionner ni déployer.

---

### Lot 1 — Valider le bootstrap existant

**Pourquoi / preuve**  
Le code existe, mais sa compilation et ses scénarios sensibles n’ont pas été vérifiés pendant cet audit.

**Où**  
Les dix fichiers de bootstrap/providers du tableau §1.3, plus :

- `c:/Users/HP-EXE/Documents/erp ecom/platerform/middleware.ts`
- `c:/Users/HP-EXE/Documents/erp ecom/platerform/components/dashboard/onboarding-modal.tsx`
- `c:/Users/HP-EXE/Documents/erp ecom/platerform/components/dashboard/store-selector.tsx`

**Comment**

1. Ne pas réécrire ces fichiers.
2. Exécuter en ACT :
   ```bash
   npx tsc --noEmit --incremental false --pretty false
   npm run build
   ```
3. Vérifier les éventuels fichiers générés dans Git.
4. Utiliser une preview isolée ; en local, utiliser exclusivement le port 3000.
5. Confirmer dans les traces :
   - une résolution Auth RSC partagée layout/page ;
   - une lecture groupée des accès en succès normal ;
   - aucune relecture navigateur des accès au seul montage ;
   - aucune requête dédiée de `usePermissions`.
6. Ne corriger que les anomalies reproduites, par remplacement ciblé, dans des commits séparés.

**Scénarios avant/après**

- utilisateur sans boutique, une boutique, plusieurs boutiques ;
- invité avec et sans mot de passe ;
- préférence invalide ou appartenant à un autre compte ;
- logout, login A → B, nouvelle session du même utilisateur ;
- refresh token, session expirée ;
- changement de boutique et synchronisation entre onglets ;
- révocation de boutique et rétrogradation de rôle ;
- panne Auth et panne lecture des accès ;
- stockage navigateur indisponible.

Les blocages réseau simulés se font en preview, sans provoquer une panne Supabase. Attention : bloquer Supabase dans Chrome ne simule pas ses appels effectués depuis Vercel.

**Acceptation**

- aucune donnée du compte précédent affichée ;
- permissions et refus serveur inchangés ;
- erreur d’accès jamais transformée en onboarding ;
- pas de boucle Auth ou rechargement ;
- sélection toujours accessible à l’utilisateur ;
- gain déclaré uniquement si les traces le démontrent.

**Rollback**

Conserver le checkpoint intégral du travail initial. Toute correction ultérieure doit être un commit isolé, annulable avec `git revert <sha>`. Ne pas supprimer les nouveaux fichiers dont dépend le bootstrap.

---

### Lot 2 — Mutualiser la lecture de facturation

**Pourquoi / preuve**  
`Sidebar` et `QuotaAlertBar` appellent `rpc_billing_status` sous deux clés différentes.

**Où**

- `c:/Users/HP-EXE/Documents/erp ecom/platerform/components/dashboard/sidebar.tsx`
- `c:/Users/HP-EXE/Documents/erp ecom/platerform/components/dashboard/quota-alert-bar.tsx`
- `c:/Users/HP-EXE/Documents/erp ecom/platerform/app/(app)/subscription/page.tsx`

**Comment**

1. Confirmer deux appels dans la baseline.
2. Conserver la clé déjà partagée par quota et abonnement :
   `['billing-status-dashboard', userId]`.
3. Aligner la sidebar sur cette clé.
4. Conserver le payload complet en cache : pas de réduction propre à la sidebar dans le `queryFn`.
5. Vérifier la compatibilité des types et toutes les invalidations de ces clés.
6. Ne modifier ni RPC, ni permissions, ni politique de fraîcheur dans ce lot.

**Risques / dépendances**  
Deux fonctions alimentant une même clé avec des formes différentes ; invalidation oubliée.

**Vérification**

- ouverture du dashboard : une lecture concurrente partagée ;
- plan et quotas identiques ;
- navigation abonnement/dashboard ;
- invalidation après action de facturation ;
- logout et compte suivant.

**Acceptation**

Une requête initiale au lieu de deux dans le scénario confirmé, sans stale data supplémentaire ni changement fonctionnel. La réduction réseau peut être validée même si le gain visuel est trop faible pour être mesuré ; ne pas confondre les deux.

**Rollback**  
Commit isolé, puis `git revert <sha>`.

---

### Lot 3 — Paralléliser les deux périodes KPI, sous condition

**Pourquoi / preuve**  
Dans `fetchMetrics`, les requêtes d’une période sont parallèles, mais la période précédente ne commence qu’après la courante.

**Où**

`c:/Users/HP-EXE/Documents/erp ecom/platerform/components/dashboard/kpi-cards.tsx`, autour des appels de fin de `queryFn` à `fetchMetrics(periodRange)` et `fetchMetrics(previousRange)`.

**Comment**

1. Confirmer la cascade dans Network et son poids sur `T_data`.
2. Si la capacité Supabase et le nombre de boutiques le permettent, lancer ces deux opérations avec `Promise.all`.
3. Conserver calculs financiers, dates, filtres boutique, RPC et traitement d’erreur.
4. Ne pas retirer `topProductsResults` : sa réponse intervient actuellement dans le revenu.
5. Ne pas mutualiser top produits dans ce même lot.

**Risques / dépendances**  
Nombre total de requêtes inchangé mais concurrence accrue, particulièrement en mode multi-boutiques. Ce lot n’est pas indépendant de la capacité infrastructure.

**Vérification**

- mêmes KPI et variations sur les deux périodes ;
- mêmes résultats boutique unique/multi-boutiques ;
- nombre total de requêtes inchangé ;
- pas d’augmentation des 429/5xx ;
- comparer `T_data` et les durées RPC.

**Acceptation**

Gain de `T_data` supérieur à la variabilité observée, sans surcharge ni régression métier. Sinon, annuler : une cascade raccourcie dans le code n’est pas une optimisation réussie en soi.

**Rollback**  
Revert du commit de parallélisation.

---

### Lot 4 — Éviter la période transitoire, seulement si observée

**Pourquoi / preuve**  
Le provider commence sur `month`, puis le filtre applique `today` après montage. Les requêtes correspondantes restent à observer.

**Où**

- `c:/Users/HP-EXE/Documents/erp ecom/platerform/lib/store-context.tsx`
- `c:/Users/HP-EXE/Documents/erp ecom/platerform/components/dashboard/period-filter.tsx`
- `c:/Users/HP-EXE/Documents/erp ecom/platerform/app/(app)/dashboard/page.tsx`

**Comment**

1. Rechercher une vague mensuelle suivie d’une vague journalière à l’ouverture.
2. Si elle existe, initialiser la période sur `today` dès le premier rendu **pour l’entrée dashboard**.
3. Vérifier auparavant tous les consommateurs de la période globale.
4. Garder le comportement par défaut des autres pages.
5. Conserver l’application du défaut lors d’une navigation ultérieure vers le dashboard si nécessaire.
6. Ne pas généraliser arbitrairement `today` à toute l’application.

**Risques / dépendances**  
Régression des autres pages et navigation client conservant un ancien provider. La frontière exacte d’initialisation devra être arrêtée après inventaire des consommateurs, avant exécution de ce lot.

**Vérification / acceptation**

- aucune requête mensuelle transitoire sur une ouverture dashboard prévue sur aujourd’hui ;
- filtre et chiffres cohérents dès le premier affichage ;
- navigation vers les autres pages inchangée ;
- période personnalisée et changement de boutique fonctionnels.

**Rollback**  
Revert du seul commit d’initialisation de période.

---

## Partie 6 — Matrice de validation

| Action | Baseline | Implémentation | Test | Résultat attendu | Réussite | Rollback |
|---|---|---|---|---|---|---|
| Identifier la version | SHA déployé inconnu | Corréler Git/Vercel | Vérifier déploiement | Version certaine | Chaque capture rattachée à un SHA | Aucun déploiement |
| Valider bootstrap | Présent localement, non validé | Conserver et vérifier | Traces + scénarios identité | Hydratation sûre | Pas de lecture initiale d’accès inutile, aucune régression | Revert des corrections isolées |
| Facturation partagée | Deux clés constatées | Clé et payload communs | Network + quotas | Lecture partagée | 2 → 1 si confirmé avant | Revert |
| Périodes KPI parallèles | Cascade certaine | `Promise.all` ciblé | Traces + chiffres | Attente raccourcie | Gain mesuré, concurrence supportée | Revert |
| Période initiale | `month → today` certain | Initialisation adaptée à la route | Network + navigation | Une seule période chargée | Vague transitoire supprimée si présente | Revert |
| Ne pas modifier | Performance actuelle inconnue | Aucun changement | Baseline saine | Stabilité conservée | Aucun problème justifiant une intervention | Sans objet |

---

## Partie 7 — Stratégie ACT MODE et conditions d’arrêt

### Ordre exact

1. Figer le dépôt et exclure les changements concurrents.
2. Identifier le déploiement actif.
3. Créer le checkpoint ciblé du travail existant.
4. Capturer la baseline saine.
5. Valider le bootstrap local et la sécurité.
6. **Checkpoint humain : décider de conserver ou non ce candidat.**
7. Traiter éventuellement la facturation, dans un commit autonome.
8. Mesurer avant/après.
9. Traiter éventuellement les KPI.
10. Mesurer à nouveau, notamment en multi-boutiques.
11. Examiner la période initiale uniquement si la trace confirme le problème.
12. Aucun push, merge ou changement de production sans demande explicite.

### Arrêter si

- les versions comparées ne sont pas identifiées ;
- Supabase présente une nouvelle dégradation ;
- la preview peut écrire dans la production ;
- une permission ou un refus serveur change ;
- une donnée persiste après changement de compte ;
- les requêtes augmentent sans justification ;
- le gain reste inférieur à la variabilité ;
- les performances sont déjà satisfaisantes et aucun problème significatif n’est démontré.

**Décision proposée pour validation humaine : autoriser d’abord les lots 0 et 1 uniquement.** Les optimisations suivantes restent conditionnelles aux mesures. À ce stade, aucune preuve ne justifie une nouvelle réécriture du Dashboard Bootstrap.