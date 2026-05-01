# System Patterns

## Architecture Overview

### High-Level Structure
```
Frontend (Next.js) ↔ Supabase (Database + Auth + Storage) ↔ External APIs (Delivery, etc.)
```

### Multi-Tenant Architecture
- **Tenant Isolation**: Every business table includes `store_id`
- **User-Store Relationship**: `profiles.id → stores.owner_user_id`
- **Team Access**: `store_members` table manages user roles per store
- **Data Security**: Row Level Security (RLS) policies enforce store_id filtering

## Key Technical Decisions

### 1. Database Design

#### Normalization Strategy
- Separate tables for each entity (orders, products, inventory, expenses)
- Junction tables for many-to-many relationships
- UUID primary keys throughout
- Timestamps (created_at, updated_at) on all tables

#### Critical Tables
- **profiles**: User account info, main currency for cross-store reporting
- **stores**: Individual store configuration
- **store_members**: User roles within stores (owner, admin, staff, confirmation_agent)
- **orders**: Order header information
- **order_items**: Line items with product details and item_type (main, upsell, cross_sell, bundle, gift)
- **products**: Product master data
- **product_variants**: SKU-level variants with option_values (JSONB)
- **inventory_movements**: Stock tracking (in/out/adjustment)
- **supplier_ledger**: Supplier payment tracking (debit/credit)
- **ad_spend_daily**: Daily advertising costs by platform
- **expenses**: Operational expenses by category

#### Performance Indexes
```sql
-- Critical indexes for query performance
(store_id, date)          -- Time-series queries
(store_id, product_id)    -- Product lookups
(store_id, order_id)      -- Order details
status                     -- Order filtering
```

### 2. Component Architecture

#### Directory Structure
```
/app                      # Next.js App Router pages
  /dashboard             # Protected dashboard pages
  layout.tsx             # Root layout
  page.tsx               # Landing/auth page
  
/components
  /auth                  # Authentication UI
  /dashboard             # Dashboard-specific components
  /ui                    # shadcn/ui base components
  providers.tsx          # React Query, context providers
  
/lib
  /supabase
    client.ts            # Browser client
    server.ts            # Server client
  utils.ts               # Utility functions
  
/services                # Business logic layer
/hooks                   # Custom React hooks
/types                   # TypeScript type definitions
```

#### Component Patterns
- **Server Components**: Default for data fetching
- **Client Components**: Interactive features, forms, state management
- **Composition**: Small, focused components (200-300 lines max)
- **Reusability**: Shared components in /components/ui

### 3. Data Flow Patterns

#### KPI Calculation Strategy
```
< 500k orders:  Direct SQL aggregation (SUM, COUNT)
> 500k orders:  Pre-calculated metrics table
```

#### Advertising Cost Strategy
```
Source primaire (opérations futures)   = ad_spend_daily
Source fallback (historique CSV)       = orders.ads_cost_allocated
```

- `ad_spend_daily` reste la source de vérité pour les dépenses publicitaires réelles par jour.
- `orders.ads_cost_allocated` est utilisé pour l'historique importé quand les anciennes données n'ont pas encore d'entrées dans `ad_spend_daily`.
- Le dashboard marketing utilise une logique de fallback: si `ad_spend_daily` est vide sur une période/bucket, il bascule sur la somme de `orders.ads_cost_allocated`.
- L'allocation automatique est gérée côté base par `allocate_ads_cost_for_day(p_store_id, p_day)` et le trigger `trg_allocate_ads_on_orders`.
- La fonction d'allocation a été ajustée pour **ne pas écraser** les coûts importés depuis CSV quand aucune ligne n'existe dans `ad_spend_daily` pour le jour concerné.
- La RPC `rpc_dashboard_ads_cost_chart` a été ajustée pour afficher une courbe marketing même avec des données historiques importées seulement dans `orders.ads_cost_allocated`.
- La carte KPI marketing "Dépense publicitaire" applique aussi le même fallback dans `components/dashboard/kpi-cards.tsx`.

#### Rapid Delivery City Normalization Strategy
```text
raw city
  -> exact match on Rapid Delivery city repositories
  -> learned alias cache (`rapid_delivery_city_aliases`)
  -> common deterministic aliases (latin + arabe)
  -> DeepSeek strict selection from repository list
  -> fallback to raw city without blocking order creation
```

- La normalisation ville s’appuie d’abord sur `rapid_delivery_cities_standard`; si cette table est vide, fallback automatique vers `rapid_delivery_cities`.
- Les aliases sont stockés dans `rapid_delivery_city_aliases` avec `canonical_city_name`, `city_key`, `usage_count`, `source`.
- Les aliases historiques avec `city_key = 0` sont réparés à la lecture en retrouvant la vraie clé depuis le référentiel Rapid Delivery chargé.
- La création manuelle et l’import CSV respectent `rapid_delivery_configs.enable_city_normalization`; si le flag est désactivé, aucun appel API de normalisation n’est fait.
- En cas d’échec DeepSeek ou erreur interne, l’API `/api/orders/normalize-city` renvoie HTTP 200 avec fallback pour ne pas bloquer la création de commande.
- Un endpoint applicatif `app/api/integrations/rapid-delivery/aliases/route.ts` expose GET/POST/DELETE pour la gestion manuelle des aliases.
- Quand une ville est résolue pour une commande, la clé Rapid Delivery est maintenant persistée dans `orders.rapid_delivery_city_key` pour réutilisation lors de la création automatique du colis.

#### Rapid Delivery Parcel / Voucher Flow
```text
status -> confirmed
  -> normalisation ville / persistance rapid_delivery_city_key
  -> auto-create parcel Rapid Delivery
  -> persist tracking_number + rapid_delivery_parcel_key

page Livraison
  -> liste commandes status=confirmed avec rapid_delivery_parcel_key et sans rapid_delivery_voucher_key
  -> create voucher
  -> update orders to picked_up + rapid_delivery_voucher_key
```

- `orders.rapid_delivery_parcel_key` mémorise la key colis Rapid Delivery en plus de `tracking_number` pour clarifier le domaine livraison.
- `orders.rapid_delivery_voucher_key` mémorise la key du bon de ramassage et sert à exclure les colis déjà regroupés.
- Le bon de ramassage utilise toujours `rapid_delivery_configs.default_shop_key`, qui correspond à l’ID shop **Rapid Delivery** externe, pas à un `store_id` SaaS.
- La création d’un bon fait passer les commandes de `confirmed` à `picked_up` côté ERP.
- Les mappings externes restent centralisés dans `rapid_delivery_entity_mappings` avec `entity_type = 'parcel' | 'voucher'`.

#### Stock Calculation
```sql
Current Stock = SUM(movements WHERE type='in') - SUM(movements WHERE type='out')
```

#### Profit Calculation
```
Order Profit = 
  (unit_selling_price × quantity) 
  - (unit_purchase_cost × quantity)
  - ads_cost_allocated
  - confirmation_cost_allocated
  - delivery_fee
```

### 4. Authentication & Authorization

#### Authentication Flow
1. User signs up/logs in via Supabase Auth
2. Profile created automatically (trigger)
3. Session stored in cookies (SSR-compatible)
4. Middleware checks auth on protected routes
5. Redirect to /dashboard if authenticated

#### Initial Onboarding Flow
```text
/signup
  -> Supabase auth.signUp with first_name / last_name / full_name metadata
  -> fallback upsert in profiles
  -> redirect /dashboard?onboarding=1

app layout load
  -> client checks if authenticated user has at least one store
  -> if none: blocking onboarding modal
  -> GET /api/geo for country/currency/timezone defaults
  -> POST /api/stores to create first store and update profile
```

- Le premier store est créé via route applicative `/api/stores` afin de centraliser la création `stores` + synchronisation `profiles`.
- Le modal d'onboarding vit dans `app/(app)/layout.tsx` pour couvrir tout l'espace applicatif protégé.
- Le sélecteur de store choisit automatiquement le premier store disponible si aucun `currentStoreId` n'est encore sélectionné.

#### Authorization Levels
- **Owner**: Full access to owned stores
- **Admin**: Store management, no billing access
- **Staff**: Operational tasks only
- **Confirmation Agent**: Order status updates only

#### RLS Policy Pattern
```sql
-- Example: Orders table
CREATE POLICY "orders_select_own_store"
ON orders FOR SELECT
USING (
  store_id IN (
    SELECT store_id FROM store_members 
    WHERE user_id = auth.uid()
  )
);
```

## Design Patterns in Use

### 1. Repository Pattern
Services layer abstracts database operations:
```typescript
// /services/orders.ts
export async function getOrdersByStore(storeId: string) {
  // Supabase query logic
}
```

### 2. Provider Pattern
React Context for global state:
```typescript
// /components/providers.tsx
<QueryClientProvider>
  <StoreProvider>
    {children}
  </StoreProvider>
</QueryClientProvider>
```

### 3. Factory Pattern
Supabase client creation:
```typescript
// Different clients for server/client contexts
createServerClient()
createBrowserClient()
```

### 4. Observer Pattern
React Query for cache invalidation and real-time updates

## Component Relationships

### Dashboard Flow
```
DashboardPage (Server Component)
  ├─ DashboardHeader (Client - store selector)
  ├─ KPICards (Server - fetches metrics)
  ├─ RevenueChart (Client - interactive chart)
  ├─ TopProducts (Server - fetches data)
  └─ RecentOrders (Server - fetches data)
```

### Order Management Flow
```
OrdersPage
  ├─ OrderFilters (Client - status, date range)
  ├─ OrderTable (Client - sorting, pagination)
  │   └─ OrderRow (Client - expand details)
  └─ CreateOrderDialog (Client - form)
```

## Critical Implementation Paths

### 1. Order Creation Path
```
User Input → Validation (Zod) → Service Layer → Supabase Insert → 
Inventory Movement (trigger) → Cache Invalidation → UI Update
```

### 2. Dashboard Load Path
```
Page Load → Server Component → Parallel Queries (KPIs, Chart Data, Products, Orders) → 
Render → Hydrate Client Components → Interactive
```

### 3. Store Switching Path
```
User Selects Store → Update Context → Invalidate All Queries → 
Refetch with New store_id → Update UI
```

## Integration Points

### Supabase Integration
- **Auth**: User authentication and session management
- **Database**: PostgreSQL with RLS
- **Storage**: Avatar uploads (bucket: 'avatars')
- **Realtime**: (Future) Live order updates

### External APIs (Planned)
- **Delivery Companies**: Tracking sync via api_provider field
- **Payment Gateways**: Subscription billing
- **AI Service**: Assistant chatbot backend

## Error Handling Strategy

### Validation Layer
- Zod schemas for all inputs
- Type-safe forms with validation feedback

### Service Layer
- Try-catch blocks for async operations
- Structured error responses
- Logging for debugging

### UI Layer
- Error boundaries for component failures
- Toast notifications for user feedback
- Fallback UI for loading/error states
