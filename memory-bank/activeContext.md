# Active Context

## Current Status
Project is in **Phase 1 (MVP)** with basic infrastructure complete.

## Recently Completed
- ✅ Custom Site API v1 : API publique POST /api/public/v1/orders pour importer les commandes depuis un site e-commerce propriétaire
- ✅ Tables Supabase : public_api_keys, public_order_ingestion_logs, public_order_idempotency + colonne external_order_id sur orders
- ✅ RLS configurée pour toutes les nouvelles tables (store_members)
- ✅ Seed provider "custom-site" dans integration_providers
- ✅ lib/integrations/custom-api/ : auth.ts (génération/validation clé API), idempotency.ts, ingest-order.ts (mapping payload → orders + order_items)
- ✅ Routes API : POST /api/public/v1/orders (endpoint public), GET/POST /api/integrations/custom-site/keys, DELETE /api/integrations/custom-site/keys/[keyId]
- ✅ Composant UI custom-site-keys.tsx avec génération, copie, révélation, révocation de clés + documentation rapide intégrée
- ✅ Composants shadcn/ui installés (button, card, badge, alert-dialog)
- ✅ Migrations sauvegardées localement (20260523_custom_site_api_v1.sql, 20260523_seed_custom_site_provider.sql)
- ✅ Project initialization with Next.js 15

- ✅ Supabase configuration and connection
- ✅ Authentication system (login/register)
- ✅ Base layout with sidebar navigation
- ✅ Basic dashboard structure
- ✅ Database schema design documented
- ✅ Correction de l'import historique `ads_cost_allocated` depuis CSV
- ✅ Protection de l'allocation auto pour préserver les coûts historiques importés
- ✅ Fallback marketing dashboard: `ad_spend_daily` → `orders.ads_cost_allocated`
- ✅ Intégration Rapid Delivery ajoutée: connexion token API, sync shops/villes, création colis et suivi depuis Ventes
- ✅ Correction du flux d'intégration: séparation claire YouCan / Rapid Delivery + erreurs Rapid Delivery plus explicites
- ✅ Normalisation intelligente des villes commandes (cache aliases + fallback DeepSeek + apprentissage progressif)
- ✅ Auto-création de colis Rapid Delivery quand une commande passe au statut "confirmed" selon la société de livraison/config
- ✅ Section Paramètres Rapid Delivery ajoutée dans Paramètres + page Livraison de base ajoutée
- ✅ Durcissement de la normalisation ville Rapid Delivery: fallback 200 côté API, logs serveur détaillés, respect du flag `enable_city_normalization`, endpoint manuel d'aliases
- ✅ Correction de l'initialisation des référentiels Rapid Delivery à la connexion + fallback de lecture `rapid_delivery_cities_standard` → `rapid_delivery_cities`
- ✅ Support des alias multilingues (latin + arabe) pour villes fréquentes comme Casablanca / Marrakech
- ✅ Réparation automatique de `city_key` depuis les référentiels Rapid Delivery quand un alias historique contient `0`
- ✅ Nouveau flux d'intégration Rapid Delivery en cours d'adoption: validation token dédiée, chiffrement AES-256-GCM du token, tables génériques `delivery_*`, pricing groups `default/custom_<integration_id>`, états globaux, wizard frontend avec mapping shop ↔ store, connexion globale par utilisateur (plus dépendante du store sélectionné)
- ✅ Correction du faux message générique "Connexion Rapid Delivery impossible.": handlers `connect/validate` loggent désormais l'erreur brute et exposent aussi `details/hint` des erreurs Supabase; migration générique `delivery_*` appliquée en base et seed `rapid-delivery` ajouté/aligné
- ✅ Correction de l'erreur `there is no unique or exclusion constraint matching the ON CONFLICT specification` pendant le mapping shops Rapid Delivery: le legacy upsert `rapid_delivery_configs` utilisait `onConflict: 'store_id'` alors que la vraie contrainte unique est `PRIMARY KEY (integration_id)`; alignement sur `integration_id` + écriture d'une seule config legacy avec le premier store mappé
- ✅ Nouveau flux colis/bon Rapid Delivery commencé: colonnes `orders.rapid_delivery_city_key`, `orders.rapid_delivery_parcel_key`, `orders.rapid_delivery_voucher_key`; auto-création colis à `confirmed`; endpoint de création de bon de ramassage; page Livraison enrichie avec colis confirmés sélectionnables et liste des bons créés
- ✅ Correction de la persistance `rapid_delivery_city_key` à la création manuelle/import/webhook: le front ventes et `youcan-sync` injectent désormais aussi la key ville dans `orders`; ajout d'un trigger DB de secours pour remplir automatiquement `rapid_delivery_city_key` sur exact match référentiel
- ✅ Correction de l'auto-création colis sur `confirmed` quand la société de livraison Rapid n'a pas `api_provider='rapid-delivery'` ou quand `rapid_delivery_configs.default_shop_key` est vide: fallback sur le nom transporteur + lookup `delivery_shops.external_shop_id`
- ✅ Correction de la création du bon de ramassage Rapid Delivery: fallback shop depuis `delivery_shops.external_shop_id` si `rapid_delivery_configs.default_shop_key` est vide, sélection par défaut de tous les colis dans la page Livraison, et page dédiée d'impression/téléchargement du bon
- ✅ Ajustement sémantique du bon de ramassage: la création du voucher ne marque plus la commande comme `picked_up`; elle reste `status='confirmed'` avec `delivery_status='pickup_pending'`, et la contrainte SQL `orders_delivery_status_check` accepte désormais `pickup_pending`
- ✅ Ajout du téléchargement des étiquettes Rapid Delivery (`v3` par défaut) depuis la liste des bons via `/api/integrations/rapid-delivery/vouchers/[key]/labels`
- ✅ Démarrage de l'intégration Facebook Ads MVP: migration Supabase `20260426_facebook_ads_mvp.sql`, nouvelles tables `facebook_*`, support devise convertie dans `ad_spend_daily`, endpoints OAuth/campaign mapping/manual sync, et modal frontend de connexion/mapping Facebook Ads
- ✅ Correction Facebook Ads MVP: migration `ad_spend_daily` effectivement appliquée en base après déduplication legacy, ajout du fetch Insights Facebook, traitement réel des jobs `facebook_sync_jobs`, insertion/update des dépenses dans `ad_spend_daily`
- ✅ Refonte de la page Paramètres: sections Informations personnelles, Sécurité, Préférences, Taux de change, Blacklist configuration
- ✅ Nouvelles routes settings ajoutées: `/api/settings/profile`, `/api/settings/preferences`, `/api/settings/security/reset-password`, `/api/settings/blacklist-rule`, `/api/settings/exchange-rates`
- ✅ Migration Supabase appliquée pour `profiles.preferred_currency` et `blacklist_rules.is_enabled`
- ✅ Support du mode recovery sur la page login pour finaliser la mise à jour du mot de passe après email Supabase
- ✅ Paramètres rendus globaux côté utilisateur: suppression du filtre store dans la page Paramètres, taux de change enregistrés sans `storeId`, et règle blacklist propagée à tous les stores accessibles de l'utilisateur
- ✅ Nouveau funnel d'inscription professionnel: page `/signup` dédiée avec prénom/nom/email/mot de passe, lien marketing mis à jour, et redirection post-signup vers dashboard
- ✅ Onboarding business post-auth ajouté: modal bloquant dans l'app si aucun store n'existe encore, avec création guidée du business/store/devise/pays/fuseau
- ✅ Nouvelles routes `/api/geo` et `/api/stores` ajoutées pour préremplissage local et création du premier store + sync profile
- ✅ Bouton "+ Ajouter un store" dans le store-selector avec modal inspiré de l'onboarding
- ✅ Correction auto-select écrasant le mode "Tous les stores" → garde `hasAutoSelectedDefault`
- ✅ Centralisation `accessibleStores` via `store_members` dans le contexte
- ✅ Pages métier (products, stock, expenses, suppliers, recent-orders) filtrées par `accessibleStoreIds`
- ✅ Composants dashboard RPC (kpi-cards, revenue-chart, ads-cost-chart, profit-chart, top-products, city-performance, confirmation-performance) filtrés par `accessibleStoreIds`
- ✅ Page sales/page.tsx filtrée par `accessibleStoreIds` pour la requête orders
- ✅ Migration SQL `20260430_rpc_dashboard_auth_guard.sql` pour renforcer les RPC avec `auth.uid()` guard

## Current Focus
Intégration OZONE Express terminée :
- ✅ Client API OZONE (lib/integrations/ozone.ts) avec création colis, tracking, BL
- ✅ Adapter OZONE (lib/integrations/delivery/ozone-adapter.ts) pour le service delivery générique
- ✅ Wizard connexion OZONE (components/dashboard/integrations/ozone-connect-wizard.tsx)
- ✅ Routes API OZONE : connect, disconnect, parcels/create, vouchers/create, parcels/sync-all
- ✅ Auto-création colis OZONE (lib/integrations/ozone-auto.ts) lors du passage au statut `confirmed`
- ✅ Auto-création branchée dans orders/status/route.ts (api_provider === 'ozone')
- ✅ Page Ventes (sales/page.tsx) : création colis OZONE + BL
- ✅ Page Livraison (delivery/page.tsx) : onglet OZONE avec colis/BL
- ✅ Page Intégrations (integrations/page.tsx) : carte OZONE dans la grille
- ✅ Migration DB : colonnes ozone_city_key, ozone_parcel_key, ozone_voucher_key sur orders
- ✅ Seed provider "ozone" dans integration_providers
- ✅ City normalizer supporte ozone_city_key
- ✅ Delivery fee resolver supporte OZONE
- ✅ Parcel/voucher services delivery génériques supportent OZONE
- ✅ Tracking service delivery générique supporte OZONE
- ✅ Delivery provider factory supporte OZONE
- ✅ Delivery provider logs supportent OZONE
- ✅ Rapid Delivery adapter mis à jour pour compatibilité
- ✅ Vérification TypeScript : aucune erreur

## Next Immediate Steps

### 1. Dashboard & Analytics (Priority: High)
- ✅ KPI cards connectées aux fonctions RPC réelles
- ✅ Revenue chart avec données réelles
- ✅ Ads cost chart avec données réelles
- ✅ Profit chart avec données réelles
- ✅ City performance, confirmation performance, top products
- ✅ Date range filtering fonctionnel
- ✅ Fallback `ad_spend_daily` → `orders.ads_cost_allocated` pour l'historique

### 2. Facebook Ads Integration (Priority: High)
- ✅ OAuth Facebook avec échange short-lived → long-lived token
- ✅ Chiffrement AES-256-GCM des tokens
- ✅ Listing des ad accounts et campagnes
- ✅ Mapping campagne → produit
- ✅ Sync automatique des dépenses via worker `processFacebookSyncJob()`
- ✅ Saisie manuelle du taux de change dans le wizard (5 étapes)
- ✅ Conversion automatique des devises via `exchange_rates`
- ✅ Répartition automatique des coûts pub sur `orders.ads_cost_allocated`
- ✅ Dashboard KPI et charts corrigés (3 fonctions RPC)

### 3. Store Management (Priority: Medium)
- ✅ Store selector avec bouton "+ Ajouter un store"
- ✅ Modal d'onboarding pour création de store
- ✅ Contexte store centralisé avec `accessibleStores` via `store_members`
- ✅ Mode "Tous les stores" (currentStoreId === null) supporté

### 4. Core Pages (Priority: Medium)
- ✅ Sales/Orders page avec CRUD operations et filtrage multi-tenant
- ✅ Products page avec filtrage multi-tenant
- ✅ Stock page avec filtrage multi-tenant
- ✅ Expenses page avec filtrage multi-tenant
- ✅ Suppliers page avec filtrage multi-tenant

## Active Decisions

### Architecture Decisions
- **File Size Limit**: Maximum 200-300 lines per file
- **Separation of Concerns**: Strict UI/logic separation
- **Component Strategy**: Reusable components in /components
- **Service Layer**: Business logic in /services
- **Type Safety**: Strict TypeScript with Zod validation

### Database Strategy
- **Multi-tenant**: All tables include store_id
- **Performance**: Index on (store_id, date) for time-series queries
- **Scalability**: Direct SQL for < 500k orders, metrics table for > 500k
- **Audit Trail**: created_at and updated_at on all tables
- **Ads Data Model**: `ad_spend_daily` = source primaire, `orders.ads_cost_allocated` = fallback historique/import
- **Security**: RPC dashboard renforcés avec `auth.uid()` guard via `store_members`

### Marketing / Ads Decisions
- Les KPI marketing et la courbe ne doivent pas rester vides si l'historique a été importé seulement via CSV.
- Si `ad_spend_daily` contient des données, elles ont priorité.
- Si `ad_spend_daily` est vide sur une période, le dashboard utilise `orders.ads_cost_allocated`.
- L'import CSV peut alimenter `orders.ads_cost_allocated` sans être remis à zéro par l'allocation automatique quand aucune dépense journalière n'existe.
- Facebook Ads MVP: stockage par jour + campagne + produit avec conversion historique via `exchange_rates`; l'allocation `orders.ads_cost_allocated` reste pour l'instant journalière globale, mais somme désormais `spend_converted`.

### UI/UX Patterns
- French language throughout
- Moroccan Dirham (MAD) as default currency
- Mobile-first responsive design
- shadcn/ui components for consistency
- Lucide icons for visual elements
- Les funnels auth importants peuvent être séparés en pages dédiées (`/login`, `/signup`) pour une meilleure clarté UX
- Si aucun store n'existe pour l'utilisateur connecté, un onboarding modal bloquant est acceptable pour forcer la configuration initiale

## Important Patterns

### Data Fetching
- Use React Query for server state management
- Server Components for initial data load
- Client Components for interactive features
- Optimistic updates for better UX
- Mode "Tous les stores": itérer sur chaque storeId et appeler le RPC individuellement, puis agréger côté client
- Mode "Tous les stores" pour requêtes directes: utiliser `.in('store_id', accessibleStoreIds)`

### Authentication Flow
- Middleware protects dashboard routes
- Automatic redirect to /dashboard after login
- Session management via Supabase SSR
- RLS policies enforce data isolation
- Signup enrichi stocke `first_name`, `last_name`, `full_name` dans `auth metadata` puis upsert aussi `profiles` côté client en fallback

### Error Handling
- Zod for input validation
- Try-catch blocks for async operations
- User-friendly error messages in French
- Logging for debugging

## Known Issues
- Les requêtes d'import dans sales/page.tsx (importStoreProducts, importRapidDeliveryConfig, importConfirmationAgents, importDeliveryCompanies) utilisent encore currentStoreId uniquement - c'est intentionnel car l'import CSV nécessite un store spécifique

## Recent Technical Changes
- Mise à jour SQL de `allocate_ads_cost_for_day()` pour préserver les valeurs importées depuis CSV en absence de lignes `ad_spend_daily`.
- Mise à jour SQL de `rpc_dashboard_ads_cost_chart()` pour fallback vers la somme de `orders.ads_cost_allocated` par bucket.
- Mise à jour frontend de `components/dashboard/kpi-cards.tsx` pour que "Dépense publicitaire" utilise aussi ce fallback.
- Ajout des tables `rapid_delivery_cities_standard`, `rapid_delivery_cities_custom` et `rapid_delivery_city_aliases`.
- Ajout du service `lib/integrations/city-normalizer.ts` pour normaliser les villes à tous les points d'entrée importants.
- Intégration de la normalisation ville dans création manuelle des commandes, import CSV et sync YouCan.
- Ajout de la route `app/api/orders/status/route.ts` pour centraliser le changement de statut et l'auto-création du colis Rapid Delivery.
- Ajout d'une section `Rapid Delivery` dans `app/parametres/page.tsx` pour configurer mode auto/manual, shop par défaut, nom d'article par défaut et normalisation.
- Création de `app/dashboard/livraison/page.tsx` pour visualiser sociétés de livraison, tarifs standards/négociés et aliases appris.
- La route `app/api/orders/normalize-city/route.ts` ne bloque plus la création de commande en cas d'erreur interne: fallback HTTP 200 avec ville brute.
- La page `app/dashboard/ventes/page.tsx` ne déclenche plus la normalisation si `rapid_delivery_configs.enable_city_normalization = false` pour le store courant.
- Ajout de `app/api/integrations/rapid-delivery/aliases/route.ts` (GET/POST/DELETE) pour gérer les aliases manuels.
- La connexion Rapid Delivery hydrate désormais immédiatement les tables `rapid_delivery_cities_standard`, `rapid_delivery_cities` et `rapid_delivery_shops`.
- `lib/integrations/city-normalizer.ts` accepte désormais les caractères Unicode (dont arabe), supporte des alias fréquents (`casa`, `الدار البيضاء`, etc.) et répare `city_key` depuis le référentiel si nécessaire.
- Ajout d'une migration générique `supabase/migrations/20260421_rapid_delivery_generic_delivery.sql` pour `pricing_groups`, `delivery_rates`, `delivery_states`, `delivery_shops` avec RLS.
- Application effective en base de la migration générique `rapid_delivery_generic_delivery` après constat que les tables `pricing_groups`, `delivery_rates`, `delivery_states`, `delivery_shops` étaient absentes malgré le fichier local.
- Ajout de `supabase/migrations/20260421_rapid_delivery_provider_seed.sql` pour garantir/mettre à jour le provider `rapid-delivery` dans `integration_providers` selon le vrai schéma actuel.
- Correction de `lib/integrations/rapid-delivery-connect.ts`: l'upsert legacy `rapid_delivery_configs` cible désormais `integration_id` (contrainte réelle en base) au lieu de `store_id`, ce qui supprime l'erreur Postgres pendant l'étape "Fetching shops / Mapping shops...".
- Ajout de `supabase/migrations/20260421_rapid_delivery_orders_vouchers.sql` pour stocker `rapid_delivery_city_key`, `rapid_delivery_parcel_key`, `rapid_delivery_voucher_key` sur `orders` avec backfill depuis `tracking_number`.
- Ajout de `lib/integrations/rapid-delivery-auto.ts` pour isoler l'auto-création de colis Rapid Delivery lors du passage au statut `confirmed`.
- `lib/integrations/city-normalizer.ts` persiste maintenant aussi `orders.rapid_delivery_city_key` quand une ville est reconnue.
- Nouvelle route `app/api/integrations/rapid-delivery/vouchers/create/route.ts` pour créer un bon de ramassage depuis plusieurs commandes confirmées déjà colisées.
- `app/dashboard/livraison/page.tsx` affiche désormais les colis confirmés prêts pour bon + la liste des bons de ramassage déjà créés.
- `app/dashboard/ventes/page.tsx` persiste maintenant `rapid_delivery_city_key` lors de la création manuelle et pendant l'import CSV.
- `lib/integrations/youcan-sync.ts` persiste maintenant `rapid_delivery_city_key` lors de l'insert/update des commandes YouCan.
- `lib/integrations/youcan.ts` expose maintenant `resolveYouCanPublicBaseUrl()` pour centraliser la résolution de l'URL publique utilisée par callback/webhook YouCan et détecter les configurations localhost / invalides.
- `app/api/integrations/youcan/sync/route.ts` journalise désormais les warnings de base URL publique et renvoie aussi les warnings au frontend après l'import, pour diagnostiquer plus vite un webhook YouCan non reçu quand `YOUCAN_REDIRECT_URI` est expiré ou invalide.
- `lib/integrations/youcan.ts` expose maintenant aussi des helpers de gestion des resthooks YouCan (list/delete/target_url) pour réparer un abonnement `order.create` bloqué sur une ancienne URL.
- `app/api/integrations/youcan/sync/route.ts` tente désormais une auto-réparation quand YouCan répond `429`: lecture des subscriptions existantes, réutilisation si la `target_url` est déjà correcte, sinon suppression des anciens `order.create` puis recréation avec l'URL actuelle.
- Ajout de `supabase/migrations/20260422_rapid_delivery_order_city_trigger.sql` pour backfill exact-match + trigger `orders_set_rapid_delivery_city_key`.
- `lib/integrations/rapid-delivery-connect.ts` expose maintenant `resolveDefaultRapidDeliveryShopKey()` réutilisée par auto-colis et création de voucher.
- Nouvelle route `app/api/integrations/rapid-delivery/vouchers/[key]/route.ts` pour récupérer les détails d'un bon + colis associés.
- Nouvelle page `app/dashboard/livraison/vouchers/[key]/page.tsx` pour imprimer/télécharger un bon de ramassage via impression navigateur.
- `app/dashboard/livraison/page.tsx` sélectionne maintenant tous les colis confirmed par défaut et expose un lien "Télécharger" pour chaque bon.
- Ajout de `supabase/migrations/20260422_orders_delivery_status_pickup_pending.sql` pour autoriser `pickup_pending` dans `orders.delivery_status`.
- `app/api/integrations/rapid-delivery/vouchers/create/route.ts` ne force plus `status='picked_up'` ni `picked_up_at` à la création du bon; seul `delivery_status='pickup_pending'` est posé.
- Nouvelle route `app/api/integrations/rapid-delivery/vouchers/[key]/labels/route.ts` pour télécharger les étiquettes HTML Rapid Delivery en `v3`.
- `app/dashboard/livraison/page.tsx` affiche maintenant un bouton `Étiquettes` avant le bouton `Bon` sur chaque voucher.
- Ajout de `lib/security/crypto.ts` pour chiffrer/déchiffrer les tokens d'intégration avec AES-256-GCM via `INTEGRATIONS_ENCRYPTION_KEY`.
- Ajout de `lib/integrations/name-similarity.ts` et `lib/integrations/rapid-delivery-connect.ts` pour le matching shop/store et la logique de sync pricing default/custom.
- Nouvelle route `app/api/integrations/rapid-delivery/validate/route.ts` pour valider le token et récupérer shops + stores avant connexion finale.
- Refonte de `connect`, `sync`, `update-token`, `parcels/create`, `parcels/track` pour supporter token chiffré + nouvelles tables delivery génériques en gardant les tables legacy hydratées.
- Ajout du wizard frontend `components/dashboard/integrations/delivery-connect-wizard.tsx` et de `progress-steps.tsx`, branchés sur `app/dashboard/integrations/page.tsx` pour le flux en 4 étapes.
- Le flux de connexion Rapid Delivery est désormais global au user: plus de dépendance au `currentStoreId` pendant la connexion, et `rapid_delivery_configs` legacy est alimenté à partir des stores réellement mappés shop → store.
- **lib/store-context.tsx**: Centralisation de `accessibleStores` via `store_members`, expose `accessibleStoreIds`, `isStoresLoading`
- **components/dashboard/store-selector.tsx**: Bouton "+ Ajouter un store" + modal inspiré onboarding, invalidation query après création
- **components/dashboard/recent-orders.tsx**: Filtrage par `.in('store_id', accessibleStoreIds)` en mode global
- **app/(app)/products/page.tsx**: Filtrage par `accessibleStoreIds` en mode global
- **app/(app)/stock/page.tsx**: Même pattern que products
- **app/(app)/expenses/page.tsx**: Même pattern + boucle sur `targetStoreIds` pour RPC
- **app/(app)/suppliers/page.tsx**: Même pattern
- **components/dashboard/kpi-cards.tsx**: Agrégation multi-store via `Promise.all(storeIds.map(...))`
- **components/dashboard/revenue-chart.tsx**: Agrégation multi-store via Map par date
- **components/dashboard/ads-cost-chart.tsx**: Agrégation multi-store via Map par date
- **components/dashboard/profit-chart.tsx**: Agrégation multi-store via Map par date_key
- **components/dashboard/top-products.tsx**: Agrégation multi-store via Map par product id
- **components/dashboard/city-performance.tsx**: Agrégation multi-store via Map par city
- **components/dashboard/confirmation-performance.tsx**: Agrégation multi-store via Map par agent id
- **app/(app)/sales/page.tsx**: Filtrage orders par `.in('store_id', accessibleStoreIds)` en mode global
- **supabase/migrations/20260430_rpc_dashboard_auth_guard.sql**: Renforce tous les RPC dashboard avec `auth.uid()` guard via `store_members`

## Learnings

### What Works Well
- Next.js 15 App Router provides clean routing structure
- Supabase RLS handles multi-tenant security elegantly
- shadcn/ui components speed up UI development
- TypeScript catches errors early
- Le pattern d'agrégation multi-store côté client fonctionne bien pour les RPC dashboard

### What to Watch
- Keep components small and focused
- Avoid premature optimization
- Test RLS policies thoroughly
- Monitor query performance as data grows
- Ensure proper error boundaries
- En mode "Tous les stores", les requêtes RPC sont multipliées par le nombre de stores → surveiller les perfs

## Development Environment
- Node.js with npm
- Next.js dev server on localhost:3000
- Supabase project with connection via environment variables
- VS Code as primary editor
