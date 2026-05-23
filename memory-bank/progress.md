# Progress

## What Works

### ✅ Infrastructure (Phase 1 - Complete)
- [x] Next.js 15 project initialized with TypeScript
- [x] Tailwind CSS configured and working
- [x] shadcn/ui components installed and integrated
- [x] Supabase project connected
- [x] Environment variables configured (.env.local)

### ✅ Authentication System
- [x] Supabase Auth integration
- [x] Login page with email/password
- [x] Registration page
- [x] Dedicated professional signup page `/signup`
- [x] Session management (SSR-compatible)
- [x] Middleware for route protection
- [x] Automatic redirect to dashboard after login
- [x] Logout functionality
- [x] First-store onboarding modal after account creation/login when user has no store

### ✅ Layout & Navigation
- [x] Root layout with providers
- [x] Dashboard layout with sidebar
- [x] Sidebar navigation with icons
- [x] Responsive mobile menu
- [x] Navigation items for all planned sections:
  - Dashboard (home)
  - Ventes (sales)
  - Produits (products)
  - Stock (inventory)
  - Fournisseurs (suppliers)
  - Publicité (advertising)
  - Dépenses (expenses)
  - Livraison (delivery)
  - Personnel (staff)
  - Abonnement (subscription)
  - Assistant IA (AI assistant)
  - Paramètres (settings)

### ✅ Dashboard (Fonctionnel avec données réelles)
- [x] Dashboard page created
- [x] KPI cards connectés aux fonctions RPC (`rpc_dashboard_kpi_metrics`)
- [x] Revenue chart avec données réelles (`rpc_dashboard_revenue_chart`)
- [x] Ads cost chart avec données réelles (`rpc_dashboard_ads_cost_chart`)
- [x] Profit chart avec données réelles
- [x] Top products section
- [x] Recent orders section
- [x] Date range filter UI
- [x] Marketing section fallback for historical ads data
- [x] City performance chart
- [x] Confirmation performance chart

### ✅ Database Schema
- [x] Complete schema designed and documented
- [x] All tables defined with relationships
- [x] Multi-tenant structure (store_id)
- [x] RLS policies planned
- [x] Index strategy defined
- [x] Product variants migration SQL ready
- [x] User settings migration SQL ready

### ✅ Documentation
- [x] README with project overview
- [x] Technical documentation (documentation.md)
- [x] Database schema documented
- [x] Memory bank initialized

### ✅ Team & Role Management
- [x] `store_members` extended: `status`, `invited_email`, `invited_by`, `accepted_at`, `updated_at`
- [x] `team_invitations` + `team_invitation_assignments` tables
- [x] 8 roles: owner, admin, confirmation, delivery, stock_manager, accountant, marketer, viewer
- [x] `ROLE_PERMISSIONS` matrix + `usePermissions` hook + `requirePermission` server guard
- [x] Sidebar filtered by `MENU_PERMISSIONS`
- [x] Middleware permission guards (cookie `current-store-id` + active membership check)
- [x] Invitation modal with multi-store role selection
- [x] Email invitation via Supabase + public acceptance page `/invite/[token]`
- [x] RPCs: `accept_team_invitation`, `delete_store`, `change_member_role`, `remove_member`, `get_my_stores`
- [x] Store CRUD in Settings (`stores-section.tsx`)
- [x] Team section in Settings (`team-section.tsx`) with members, pending invites, role change, remove, revoke

### ✅ Custom Site API (Site Web Personnalisé)
- [x] Tables Supabase : `public_api_keys`, `public_order_ingestion_logs`, `public_order_idempotency`
- [x] Colonne `external_order_id` sur `orders`
- [x] RLS configurée pour toutes les nouvelles tables
- [x] Seed provider "custom-site" dans `integration_providers`
- [x] `lib/integrations/custom-api/auth.ts` : génération/validation clé API (format `jsk_<random hex>`)
- [x] `lib/integrations/custom-api/idempotency.ts` : idempotence via hash du payload
- [x] `lib/integrations/custom-api/ingest-order.ts` : mapping payload → orders + order_items avec rollback
- [x] `app/api/public/v1/orders/route.ts` : endpoint public POST avec auth Bearer
- [x] `app/api/integrations/custom-site/keys/route.ts` : GET (lister) + POST (générer clé)
- [x] `app/api/integrations/custom-site/keys/[keyId]/route.ts` : DELETE (révoquer clé)
- [x] Composant UI `custom-site-keys.tsx` avec génération, copie, révélation, révocation + documentation
- [x] Composants shadcn/ui installés (button, card, badge, alert-dialog)
- [x] Migrations sauvegardées localement

## What's Left to Build

### 🔄 Phase 2 (In Progress)

#### Store Management (High Priority)
- [x] Create stores table in Supabase
- [x] Create store_members table
- [x] Implement store context provider
- [x] Build store selector component in header
- [x] Add initial "Create Store" flow via onboarding modal
- [x] Implement active store persistence (localStorage + DB)

#### Dashboard with Real Data (High Priority)
- [x] Create Supabase queries for KPIs:
  - [x] Total orders count
  - [x] Total revenue (sum of order totals)
  - [x] Total costs (ads + confirmation + delivery + purchase)
  - [x] Net profit calculation
  - [x] Profit margin percentage
  - [x] Average order value
- [x] Implement date range filtering
- [x] Build revenue evolution chart with real data
- [x] Query top performing products
- [x] Query recent orders
- [x] Add loading states
- [x] Add error handling
- [x] Implement React Query caching

#### Sales/Orders Page (High Priority)
- [x] Create orders table in Supabase
- [x] Create order_items table
- [x] Build orders list view with filters
- [x] Implement order creation form
- [x] Add order details view
- [x] Implement order status updates
- [x] Add order search functionality
- [x] Implement pagination

#### Products Page (High Priority)
- [x] Create products table in Supabase
- [x] Build products list view
- [x] Implement product creation form
- [x] Add product editing
- [x] Implement product search
- [x] Add product image upload
- [x] Basic inventory display

### 📋 Phase 3 (Planned)

#### Inventory Management
- [ ] Create inventory_movements table
- [x] Build stock tracking interface
- [x] Implement stock adjustments
- [ ] Add low stock alerts
- [ ] Create stock history view
- [ ] Implement product variants UI

#### Supplier Management
- [x] Create suppliers table
- [x] Create supplier_ledger table
- [x] Build suppliers list
- [x] Implement supplier creation
- [x] Add purchase recording
- [x] Build payment tracking
- [x] Create supplier balance view

#### Expense Tracking
- [x] Create expense_categories table
- [x] Create expenses table
- [x] Build expense entry form
- [x] Implement expense categories management
- [x] Add expense reporting
- [x] Create expense analytics

#### Advertising Tracking
- [x] Create ad_spend_daily table
- [x] Build ad spend entry form
- [x] Implement platform selection
- [x] Add campaign tracking
- [x] Create ad spend analytics
- [x] Build ROI calculations
- [x] Preserve imported historical `ads_cost_allocated` when no daily ad spend exists
- [x] Add dashboard fallback from `ad_spend_daily` to `orders.ads_cost_allocated`
- [x] Ajouter la base Facebook Ads MVP: migration SQL `ad_spend_daily` (spend/spend_converted/devise/product), tables `facebook_*`, OAuth backend, listing ad accounts/campaigns, mapping campagne→produit, job manuel de sync
- [x] Corriger Facebook Ads MVP pour que le sync manuel traite réellement les jobs et écrive les dépenses dans `ad_spend_daily`

### 📋 Phase 4 (Future)

#### AI Assistant
- [ ] Create chat_threads table
- [ ] Create chat_messages table
- [ ] Create ai_credit_wallets table
- [ ] Create ai_usage table
- [ ] Integrate AI backend service
- [ ] Build chat interface
- [ ] Implement credit system
- [ ] Add context-aware responses

#### Subscription Management
- [ ] Create plans table
- [ ] Create subscriptions table
- [ ] Create coupons table
- [ ] Build plan selection UI
- [ ] Implement payment gateway
- [ ] Add subscription status tracking
- [ ] Build billing history

#### User Settings
- [ ] Create billing_profiles table
- [ ] Create billing_invoices table
- [x] Build profile settings page
- [ ] Implement avatar upload
- [ ] Add billing information form
- [ ] Create invoice history view
- [x] Implement language/timezone settings
- [x] Add preferred currency settings
- [x] Add manual exchange rates management UI/API
- [x] Add blacklist rule configuration UI/API
- [x] Add password reset initiation from settings
- [x] Retirer le filtre store de la page Paramètres et appliquer la configuration globalement au niveau utilisateur

#### Delivery Integration
- [x] Create delivery_companies table
- [x] Build delivery company management
- [x] Implement API integration Rapid Delivery (connect, sync référentiels, create parcel, track parcel)
- [x] Ajouter flux complet Rapid Delivery v2: validate token, mapping shops→stores, pricing groups génériques, delivery states, chiffrement token, wizard frontend, connexion globale user avec multi-stores
- [x] Corriger la confusion UI entre YouCan et Rapid Delivery sur la page Integrations
- [x] Normaliser intelligemment les villes des commandes avec aliases + DeepSeek + apprentissage
- [x] Durcir la normalisation ville Rapid Delivery (fallback non bloquant, logs, flag store-level, aliases manuels)
- [x] Corriger l’hydratation initiale des villes/shops Rapid Delivery dès la connexion
- [x] Ajouter support multilingue (ex. arabe) et réparation automatique de `city_key`
- [x] Déclencher la création automatique du colis Rapid Delivery au passage au statut confirmé
- [x] Ajouter paramètres Rapid Delivery dans Paramètres
- [x] Ajouter une base de page Livraison
- [x] Corriger le diagnostic de connexion Rapid Delivery pour afficher les erreurs Supabase réelles au lieu du fallback générique
- [x] Appliquer les tables génériques Rapid Delivery `delivery_*` en base (`pricing_groups`, `delivery_rates`, `delivery_states`, `delivery_shops`)
- [x] Garantir le seed du provider `rapid-delivery` via migration dédiée alignée au schéma réel de `integration_providers`
- [x] Corriger l’upsert legacy `rapid_delivery_configs` pour utiliser la vraie contrainte unique `integration_id` au lieu de `store_id`
- [x] Ajouter les colonnes `orders.rapid_delivery_city_key`, `orders.rapid_delivery_parcel_key`, `orders.rapid_delivery_voucher_key`
- [x] Persister la city key Rapid Delivery sur les commandes lors de la normalisation
- [x] Ajouter le flux de création de bon de ramassage Rapid Delivery depuis la page Livraison
- [x] Corriger la persistance de `rapid_delivery_city_key` sur création manuelle, import CSV et commandes YouCan
- [x] Ajouter un trigger DB de secours pour remplir `rapid_delivery_city_key` depuis `rapid_delivery_cities_standard`
- [x] Corriger l’auto-création de colis quand `api_provider` est vide ou que `default_shop_key` n’est pas encore renseigné
- [x] Corriger la création du bon de ramassage quand `default_shop_key` est vide
- [x] Sélectionner par défaut tous les colis confirmed dans la page Livraison
- [x] Ajouter l’impression/téléchargement des bons de ramassage Rapid Delivery
- [x] Autoriser `pickup_pending` dans `orders.delivery_status`
- [x] Garder la commande en `confirmed` après création du bon de ramassage (pas encore ramassée)
- [x] Ajouter le téléchargement des étiquettes Rapid Delivery (`v3`) depuis la liste des bons
- [x] Ajouter un diagnostic explicite de l’URL publique YouCan pour éviter les webhooks/callbacks cassés quand `YOUCAN_REDIRECT_URI` est invalide, localhost ou expiré
- [x] Ajouter l’auto-réparation du webhook YouCan `order.create` en cas de `429` (relecture des subscriptions, suppression des anciennes, recréation)
- [ ] Add tracking sync
- [ ] Build delivery status updates
- [ ] Create delivery analytics

#### Staff Management
- [ ] Create confirmation_agents table
- [x] Build team invitation system
- [x] Implement role management
- [ ] Add confirmation agent tracking
- [ ] Build commission calculations
- [ ] Create staff performance reports

## Current Status Summary

**Phase 1**: ✅ Complete (100%)
- Project foundation solid
- Authentication working
- Basic UI structure in place

**Phase 2**: 🔄 In Progress (~85%)
- Next focus: Store management
- Then: Dashboard with real data
- Then: Core CRUD pages

**Overall Progress**: ~60% complete
- Foundation: Strong
- Core features: Mostly built
- Advanced features: Planned

## Known Issues

### Critical
- Build global bloqué par une erreur hors scope Rapid Delivery sur `/dashboard/fournisseurs` (`useSearchParams()` sans suspense boundary)

### Medium
- No error boundaries implemented
- No loading states on pages
- No form validation feedback
- Missing toast notifications

### Recently Resolved
- Historical CSV ad costs were being reset by automatic allocation when `ad_spend_daily` had no rows for a day
- Marketing chart was empty when only `orders.ads_cost_allocated` was populated
- Marketing KPI "Dépense publicitaire" was empty for historical imported data
- La normalisation ville Rapid Delivery pouvait rester sur la ville brute quand `rapid_delivery_cities_standard` était vide
- La normalisation ne supportait pas certains alias arabes comme `الدار البيضاء`
- Certains aliases Rapid Delivery pouvaient conserver `city_key = 0` au lieu de la vraie clé référentiel
- Le message générique "Connexion Rapid Delivery impossible." masquait une vraie erreur Supabase car les `PostgrestError` n’étaient pas converties proprement
- L’étape de mapping shops Rapid Delivery échouait avec `there is no unique or exclusion constraint matching the ON CONFLICT specification` car `rapid_delivery_configs` n’a pas de contrainte unique sur `store_id`
- Des commandes pouvaient être créées avec `city` brute (`casablanca`) mais sans `rapid_delivery_city_key`, ce qui bloquait ensuite la création auto du colis au passage à `confirmed`
- **Fix 2025-05-14**: `Cannot read properties of undefined (reading 'map')` sur invitation modal — la route `/api/team/invitations` transforme désormais `team_invitation_assignments` en `assignments[]` attendu par le frontend
- **Fix 2025-05-14**: Les stores n'apparaissaient pas dans le modal d'invitation car `get_my_stores()` RPC utilise `auth.uid()` et la route `/api/stores/list` appelait `createAdminClient()` au lieu de `getServerClient()`

### Low
- No dark mode support
- No keyboard shortcuts
- No accessibility testing done
- No mobile testing done

## Evolution of Project Decisions

### Initial Decisions (Maintained)
- Next.js 15 with App Router ✅
- Supabase for backend ✅
- TypeScript for type safety ✅
- Tailwind + shadcn/ui for UI ✅
- French language interface ✅

### Adjusted Decisions
- Originally planned separate services folder → Will implement as needed
- Originally planned separate hooks folder → Will implement as needed
- File size limit enforced from start (200-300 lines)
- Marketing analytics now explicitly support a hybrid model: real daily spend first, imported allocated spend as fallback

### Pending Decisions
- AI backend service provider (OpenAI vs Anthropic vs local)
- Payment gateway selection (Stripe vs local Moroccan options)
- Delivery API integration approach (direct vs aggregator)
- Metrics table implementation timing (wait for data or implement early)
- Real-time features scope (which features need Supabase Realtime)

## Next Milestone
**Target**: Complete Phase 2 (Store Management + Dashboard + Core Pages)
**Estimated Effort**: 2-3 weeks of development
**Success Criteria**: 
- User can create and switch between stores
- Dashboard shows real data from Supabase
- User can create and manage orders and products
