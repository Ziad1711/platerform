# Correctifs de latence et de rechargement des magasins

**Statut :** préparé, **non publié**. Aucun déploiement Vercel effectué.

## 1. Contenu

| Fichier | Changement |
|---|---|
| `lib/dashboard/analytics-cache.ts` (nouveau) | Fraîcheur analytique 60 s, seuil d'alerte magasins 120 s, liste des préfixes de cache, `invalidateDashboardAnalytics()` |
| `components/providers.tsx` | `MutationCache` : toute mutation réussie invalide les agrégats du dashboard |
| `lib/store-context.tsx` | Erreur de revalidation classée transitoire/définitive ; bandeau affiché si l'erreur est définitive **ou** si l'instantané a plus de 120 s |
| `components/dashboard/{kpi-cards,revenue-chart,top-products,ads-cost-chart,city-performance}.tsx` | `staleTime: DASHBOARD_ANALYTICS_STALE_MS` sur les requêtes analytiques |

Ce qui n'est **pas** modifié : contrôles d'authentification, permissions, appartenance aux magasins,
requêtes de rollout, lecteur KPI V5, calculs financiers, SQL Production.

## 2. Contrôles avant publication (locaux)

```bash
node_modules/.bin/tsc --noEmit --pretty false   # attendu : exit 0, 0 erreur
npx next build                                  # attendu : ✓ compiled successfully
```

Vérifications de périmètre :

- `dashboard-kpi-rollout` et `dashboard-kpi-reader` **hors** des préfixes invalidés ;
- `refetchOnWindowFocus` reste actif sur `accessible-stores` ;
- aucune requête d'accès/identité n'a de `staleTime`.

## 3. Publication (manuelle, hors de portée de cette mission)

1. Pousser la branche (action humaine autorisée) → Vercel crée une **preview**.
2. Sur la preview, avec un compte réel :
   - ouvrir `/dashboard`, noter le temps d'affichage complet ;
   - créer/modifier une commande, revenir au dashboard → les cartes doivent refléter le changement
     sans attendre 60 s (invalidation de mutation) ;
   - changer d'onglet puis revenir → **aucun** rechargement des 5 cartes avant 60 s ;
   - provoquer une coupure réseau (DevTools → Offline) 5 s puis revenir : **aucun bandeau**
     si l'instantané a moins de 120 s ; bandeau attendu sinon.
3. Promotion en production uniquement si les quatre points ci-dessus sont conformes.

## 4. Contrôles après publication

| Contrôle | Attendu |
|---|---|
| Cartes après mutation | Mise à jour immédiate (invalidation) |
| Retour d'onglet | Pas de refetch avant 60 s |
| Coude réseau < 120 s | Pas de bandeau |
| Bandeau « magasins » | Uniquement si erreur définitive ou > 120 s sans succès |
| Erreurs console | Aucune nouvelle erreur React Query |

Surveillance pendant 24 h : voir §6.

## 5. Rollback

Redéployer la version précédente depuis Vercel (Deployments → Promote).
Aucune migration, aucun état serveur : le retour est immédiat et sans conséquence sur les données.

## 6. Erreurs PostgREST — problème distinct, non corrigé par ce lot

Le frontend ne corrige **pas** les `Warp server error: Thread killed by timeout manager`
(457 occurrences / 6 h le 22/10, pics à 186 et 148 par heure, présents depuis la veille).

À surveiller après déploiement :

```sql
-- fréquence horaire des threads tués (source : logs PostgREST)
-- attendu : décroissance ou stabilité, pas d'augmentation
select toStartOfHour(timestamp) h, count(*)
from logs
where source = 'postgrest_logs'
  and position('Thread killed by timeout manager' in event_message) > 0
  and timestamp > now() - INTERVAL 24 HOUR
group by h order by h;
```

```sql
-- timeouts SQL (57014) : doivent rester exceptionnels
select count(*), min(timestamp), max(timestamp)
from logs
where source = 'postgres_logs'
  and log_attributes['parsed.sql_state_code'] = '57014'
  and timestamp > now() - INTERVAL 24 HOUR;
```

Si les `Thread killed` ne diminuent pas : ouvrir un incident Supabase (limites de pooler /
requêtes longues), indépendamment de KPI V5 et de ce lot.
