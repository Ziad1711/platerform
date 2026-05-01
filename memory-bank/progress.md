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

## What's Left to Build

### 🔄 Phase 2 (In Progress)

#### Store Management (High Priority)
- [ ] Create stores table in Supabase
- [ ] Create store_members table
- [ ] Implement store context provider
- [ ] Build store selector component in header
- [x] Add initial "Create Store" flow via onboarding modal
- [ ] Implement active store persistence (localStorage + DB)

#### Dashboard with Real Data (High Priority)
- [ ] Create Supabase queries for KPIs:
  - [ ] Total orders count
  - [ ] Total revenue (sum of order totals)
  - [ ] Total costs (ads + confirmation + delivery + purchase)
  - [ ] Net profit calculation
  - [ ] Profit margin percentage
  - [ ] Average order value
- [ ] Implement date range filtering
- [ ] Build revenue evolution chart with real data
- [ ] Query top performing products
- [ ] Query recent orders
- [ ] Add loading states
- [ ] Add error handling
- [ ] Implement React Query caching

#### Sales/Orders Page (High Priority)
- [ ] Create orders table in Supabase
- [ ] Create order_items table
- [ ] Build orders list view with filters
- [ ] Implement order creation form
- [ ] Add order details view
- [ ] Implement order status updates
- [ ] Add order search functionality
- [ ] Implement pagination

#### Products Page (High Priority)
- [ ] Create products table in Supabase
- [ ] Build products list view
- [ ] Implement product creation form
- [ ] Add product editing
- [ ] Implement product search
- [ ] Add product image upload
- [ ] Basic inventory display

### 📋 Phase 3 (Planned)

#### Inventory Management
- [ ] Create inventory_movements table
- [ ] Build stock tracking interface
- [ ] Implement stock adjustments
- [ ] Add low stock alerts
- [ ] Create stock history view
- [ ] Implement product variants UI

#### Supplier Management
- [ ] Create suppliers table
- [ ] Create supplier_ledger table
- [ ] Build suppliers list
- [ ] Implement supplier creation
- [ ] Add purchase recording
- [ ] Build payment tracking
- [ ] Create supplier balance view

#### Expense Tracking
- [ ] Create expense_categories table
- [ ] Create expenses table
- [ ] Build expense entry form
- [ ] Implement expense categories management
- [ ] Add expense reporting
- [ ] Create expense analytics

#### Advertising Tracking
- [x] Create ad_spend_daily table
- [ ] Build ad spend entry form
- [ ] Implement platform selection
- [ ] Add campaign tracking
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
- [ ] Create delivery_companies table
- [ ] Build delivery company management
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
- [ ] Build team invitation system
- [ ] Implement role management
- [ ] Add confirmation agent tracking
- [ ] Build commission calculations
- [ ] Create staff performance reports

## Current Status Summary

**Phase 1**: ✅ Complete (100%)
- Project foundation solid
- Authentication working
- Basic UI structure in place

**Phase 2**: 🔄 In Progress (0%)
- Next focus: Store management
- Then: Dashboard with real data
- Then: Core CRUD pages

**Overall Progress**: ~15% complete
- Foundation: Strong
- Core features: Not started
- Advanced features: Planned

## Known Issues

### Critical
- No store selection implemented (blocks all multi-tenant features)
- Dashboard showing mock data (not connected to Supabase)
- No actual database tables created yet (only schema designed)

### Medium
- No error boundaries implemented
- No loading states on pages
- No form validation feedback
- Missing toast notifications
- Build global bloqué par une erreur hors scope Rapid Delivery sur `/dashboard/fournisseurs` (`useSearchParams()` sans suspense boundary)

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
