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
- [x] Server-side auth guard in `app/(app)/layout.tsx` (`getServerUser()` + `redirect('/login')`)
- [x] Server-side identity always verified by the Auth API: `getServerUser()` uses `getUser()`, then `getUser(access_token)` as fallback (`lib/supabase/server.ts`) — `getSession().user` (local cookie decode, unverified signature) is no longer trusted
- [x] Middleware permission guards for logged-in users (`isProtectedAppRoute` + `hasPermission`, redirect to `getFirstAllowedRoute`)
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

### ✅ Custom Site API v1 — Catalogue (Jisra → site client)
- [x] Colonne `scopes` sur `public_api_keys` (products:read, stock:read, orders:write) + contrainte + index GIN — migration `20260920_public_api_key_scopes.sql`
- [x] `lib/integrations/custom-api/auth.ts` : `normalizeScopes`, `hasScope`, `validateApiKey` retourne les périmètres (rétro-compatibilité : clés existantes = 3 droits)
- [x] `lib/integrations/custom-api/request-auth.ts` : `requirePublicApiAuth(request, scope)` (401/403 + codes MISSING_AUTHORIZATION, MISSING_SCOPE)
- [x] `lib/integrations/custom-api/catalog-stock.ts` : agrégation du stock (produit + variante) et règle shared/variant
- [x] `lib/integrations/custom-api/catalog.ts` : liste paginée (keyset `cursor`), filtre `updated_since`/`sku`, prix Jisra, URLs images Storage, `includes_stock` selon périmètre
- [x] `lib/integrations/custom-api/catalog-availability.ts` : vérification panier (existence, prix de référence, stock, motifs d'erreur)
- [x] `lib/integrations/custom-api/resolve-item-prices.ts` : complète les prix manquants et le total depuis Jisra (le prix envoyé reste prioritaire)
- [x] Endpoints : `GET /api/public/v1/catalog/products`, `GET /api/public/v1/catalog/products/[productId]`, `POST /api/public/v1/catalog/availability`
- [x] `POST /api/public/v1/orders` migré sur `requirePublicApiAuth(..., 'orders:write')`
- [x] Clés API : POST accepte `scopes`, GET retourne `scopes`, affichage des périmètres dans `custom-site-keys.tsx`
- [x] Page de documentation `/integrations/custom-site/docs` (vue d'ensemble, démarrage, auth, catalogue, disponibilité, commandes, erreurs, exemples Node/PHP, bonnes pratiques, webhooks à venir)
- [x] Liens vers la documentation complète depuis le modal « Site web personnalisé » et la carte `custom-site-api-docs.tsx`

### ✅ Custom Site API v1 — Durcissement (sécurité, prix, stock, doc publique)
- [x] Suppression de la politique anonyme `public_api_keys_select_key_hash_anon` + `revoke all on public_api_keys from anon`
- [x] `can_manage_store_integrations(store_id)` (owner/admin/marketer actifs) + 4 politiques RLS `%_managers` sur `public_api_keys`
- [x] `integrations.manage` exigé pour générer et révoquer une clé (403 `MISSING_PERMISSION`)
- [x] Sélecteur de droits (scopes) dans `custom-site-keys.tsx` + refus 400 `MISSING_SCOPES` si aucun droit sélectionné
- [x] `products.publication_status` (draft/active/archived) + index `(store_id, publication_status)` ; l'API n'expose que `active`
- [x] Trigger `trg_touch_product_from_variant` : une modification de variante met à jour `products.updated_at` (sync incrémentale fiable)
- [x] RPC `rpc_public_catalog_stock_snapshot` : agrégation du stock en SQL (repli Node conservé si RPC absente)
- [x] RPC `rpc_ingest_public_order` : création atomique commande + articles + réservation d'idempotence (accepted / duplicate / conflict)
- [x] Prix strict : les prix Jisra remplacent ceux envoyés par le site, écarts journalisés (`PRICE_MISMATCH`), total recalculé côté Jisra
- [x] Validation explicite des paramètres catalogue : 400 `INVALID_LIMIT`, `INVALID_CURSOR`, `INVALID_UPDATED_SINCE`
- [x] Correction du stock des produits sans variante dans `catalog-availability.ts`
- [x] Documentation publique déplacée de `/integrations/custom-site/docs` (protégée) vers `/documentation` (groupe `(documentation)`, page statique) + sitemap, robots, footer, redirection de l'ancienne URL
- [x] Refactor : `catalog-shared.ts`, `catalog-mapper.ts`, `order-items-pricing.ts`, `order-items-validation.ts` (suppression de `validate-items.ts` et `resolve-item-prices.ts`)
- [x] Vérifié en réel : 400 paramètres, 401 sans clé, 403 scopes, exclusion des produits `draft`, prix strict (600 au lieu de 2), `duplicate`, `IDEMPOTENCY_CONFLICT`, log `PRICE_MISMATCH`

### ✅ Custom Site API v1 — Validation, statut produit et documentation v2
- [x] UI statut de publication dans `/products` : sélecteur en création et édition, badge + select rapide par ligne, filtre « Tout statut / Publiés / Brouillons / Archivés », mutation `updatePublicationStatusMutation`
- [x] `components/dashboard/products/publication-status.tsx` : badge, select, normalisation et libellés FR
- [x] `lib/integrations/custom-api/schemas.ts` : schémas Zod (orderBodySchema, availabilityBodySchema) + `toValidationDetails`
- [x] Routes `/orders` et `/catalog/availability` : 400 `VALIDATION_ERROR` avec `details[{field,message}]`
- [x] `IDEMPOTENCY_CONFLICT` → HTTP 409
- [x] Politique stock « informative » (Option A) : aucune commande refusée pour cause de stock, commentée dans `ingest-order.ts` et documentée
- [x] Documentation déplacée dans `components/documentation/` (primitives, overview, catalog, orders, guides) + navigation verticale sticky, scroll-spy, menu mobile, badges méthode/statut, en-tête API v1 / Stable / URL de base
- [x] Vérifié en réel : 400 `VALIDATION_ERROR` (commande + disponibilité), commande quantité 999 acceptée, 409 conflit, 200 duplicata

### ✅ Custom Site API v1 — Catalogue P0 (galerie, promotions, catégories, slug)
- [x] Migration `supabase/migrations/20260922_catalog_p0_enrichment.sql` : tables `product_categories` et `product_images` (RLS + privilèges + index uniques image principale produit/variante), colonnes `products.slug/short_description/description/old_price/category_id/sort_order`, `product_variants.old_price/is_default/sort_order`
- [x] `public.slugify_text()` (sans extension `unaccent`) + `public.validate_product_image_scope()` (cohérence store/produit/variante) + `public.touch_product_from_image()` (`products.updated_at` sur changement d'image)
- [x] Backfill : slugs générés pour les 49 produits existants, galerie créée depuis `products.image_url` (49 images, aucune perte)
- [x] `lib/products/slug.ts` : `slugify`, `buildUniqueProductSlug`, `buildUniqueCategorySlug` (suffixes -2, -3… sur collision)
- [x] `lib/products/product-images.ts` : validation (JPEG/PNG/WebP ≤ 5 Mo), upload versionné, `syncProductImages` (une seule principale, suppression des fichiers Jisra uniquement), `saveGalleryImages` (rollback des uploads en cas d'erreur)
- [x] `lib/products/variant-sync.ts` : `old_price`, `is_default` (une seule par produit), `sort_order`, réassignation du défaut si supprimé
- [x] Dashboard Produits : `product-gallery-editor.tsx` (multi-upload, principale, alt, ordre, suppression), `category-select.tsx` (sélection + création rapide), `variant-editor.tsx` partagé (ancien prix, par défaut, ordre, photos de variante) utilisé en création, édition et gestion des variantes
- [x] API : `images[]` produit/variante, `variants[].image_url` (repli image produit), `slug`, `short_description`, `description`, `category`, `selling_price`, `old_price`, `is_default`, `sort_order`, filtres `slug`/`category_id`/`category_slug`, endpoints `GET /catalog/categories` et `/catalog/categories/{categoryId}`
- [x] Repli `is_default` : si aucune variante n'est marquée en base, la première (tri `sort_order`) l'est dans la réponse
- [x] YouCan : `compare_at_price` → `old_price`, description HTML → texte + résumé, galerie produit et image de variante importées de façon **additive** (aucune image locale supprimée), variante par défaut garantie (`ensureDefaultVariant`)
- [x] Documentation API mise à jour (nouveaux champs, catégories, filtres, note « old_price ≠ prix de commande », exemple Node image variante/promotion)
- [x] Vérifié en réel (clés temporaires créées puis supprimées) : 200 produits/détail/catégories, `category` + `images` + `is_default` conformes, 400 `INVALID_CATEGORY_ID`, 404 `CATEGORY_NOT_FOUND`, 403 `MISSING_SCOPE`, `includes_stock:false` sans `stock:read`, filtre `slug`/`category_slug` opérationnels
- [x] `npx tsc --noEmit` et `next build` : OK

### ✅ Custom Site API v1 — Correctifs Catalogue P0 (revue de code)
- [x] **Images de variantes rechargées** : la requête `product_images` renvoie `{ byProduct, byVariant }` (au lieu d'un seul groupe produit) — l'éditeur de variantes affiche désormais ses photos existantes et ne les supprime plus à l'enregistrement
- [x] **Nettoyage Storage fiable** : `productStoragePath` reconnaît les chemins relatifs `{store}/{product}/fichier.ext` (et non plus seulement les URLs publiques) ; un fichier encore référencé par une copie du produit n'est jamais supprimé
- [x] **Sauvegarde transactionnelle** : RPC `rpc_save_product_catalog(store, produit, variantes, images)` + `rpc_replace_product_images(...)` — produit, variantes et images écrits dans une seule transaction, identifiant produit généré avant l'upload, rollback des fichiers en cas d'échec
- [x] `lib/products/save-product-catalog.ts` : upload des fichiers → RPC → nettoyage des images retirées ; messages d'erreur FR (droits, catégorie, slug, produit introuvable)
- [x] Suppression (simple et multiple) : suppression des fichiers Storage après les lignes, sans toucher aux fichiers partagés
- [x] **Multi-store** : trigger `validate_product_category_store_trigger` (`PRODUCT_CATEGORY_STORE_MISMATCH`) ; la RPC vérifie aussi l'appartenance au store
- [x] **Permissions** : politique DELETE `product_images` alignée sur les rôles qui éditent le produit (owner/admin/staff)
- [x] **Backfill variante par défaut** : chaque produit à variantes possède exactement une variante `is_default`
- [x] Index ajoutés : `products(category_id)`, `product_images(store_id)`
- [x] YouCan : première image d'une variante marquée principale ; `old_price` renseigné aussi quand la variante est retrouvée par SKU ; payload partiel sans effet destructeur (`?` sur les clés produit/variante)
- [x] `lib/products/variant-sync.ts` supprimé (remplacé par la RPC transactionnelle)
- [x] Vérifié en réel (transactions annulées) : création produit + 2 variantes + images, payload partiel (slug/présence conservés), galerie vidée (`image_url` recalculé), catégorie d'un autre store refusée

### ✅ Module Finances v1 — Lot A (durcissement)
- [x] `delete_store` refuse la suppression d'un store possédant un historique financier (`supplier_purchases`, `supplier_payments`, `confirmation_agent_payments`) → erreur `STORE_HAS_FINANCIAL_HISTORY` — migration `20260926183753_finance_block_store_delete.sql`
- [x] Trigger `trg_stores_block_financial_history` (`BEFORE DELETE` sur `public.stores`, fonction `block_store_delete_with_financial_history()` en `SECURITY DEFINER` pour ne pas dépendre des droits/RLS de l'appelant) → la protection s'applique même en suppression directe ou via `service_role` — migration `20260926185429_20260926190008_finance_store_delete_trigger.sql`
- [x] `DELETE /api/stores/[id]` : RPC appelé via le **client lié à l'utilisateur** (`getServerClient`) car le contrôle propriétaire du RPC repose sur `auth.uid()` (l'appel en service-role ne pouvait pas le résoudre) ; mapping 403 / 409 / 500
- [x] `/finances` protégé côté serveur : helper `requireAnyPermission(permission)` (`lib/auth/require-permission.ts`, propriété via `stores.owner_user_id` ou appartenance active) ; UI interactive dans `components/dashboard/finance/finance-client.tsx`
- [x] Vérifié en base, transactions annulées (aucune donnée persistée) : suppression bloquée quand un achat fournisseur existe, suppression normale autorisée, propriétaire autorisé / non-propriétaire refusé ; `npx tsc --noEmit` sans erreur
- [ ] Lots C–E du plan finances (vue « À vérifier », rapprochement publicité/dépenses, alignement dashboard) — cf. `memory-bank/finance-module-plan.md`

### ✅ Module Finances v1 — Lot B (contrat de calcul du résultat opérationnel)
- [x] Publicité : arbitrage **par jour** — journée suivie par `ad_spend_daily` (même si le montant vaut 0), sinon repli sur `orders.ads_cost_allocated` **de cette journée** (fini le repli sur le total de période) — migration `20260926191350_finance_pnl_contract.sql`
- [x] Commandes livrées sans `order_items` : CA repris de `total_selling_price` dans `revenue_estimated`, comptées dans `estimated_orders`, résultat marqué non fiable (`result_is_reliable = false`) au lieu d'un CA perdu
- [x] Composantes exposées : `revenue_reliable` / `revenue_estimated`, `ad_spend_daily` / `ads_from_orders` (+ jours suivis / jours en repli), `ads_expense_overlap` (charges de catégorie « ads » toujours comptées dans Autres charges mais signalées : risque de double comptage)
- [x] UI `components/dashboard/finance/pnl-overview.tsx` : sous-ligne par composante, badges « Estimé » / « À vérifier », colonne **Fiabilité** en mode « Tous les stores »
- [x] Vérifié en base (transactions annulées) : ziilart 61 598,93 (suivi quotidien) + 706,15 (repli sur 41 jours non suivis) = 62 305,08 ; CA estimé 767 sur 3 commandes → non fiable ; période janv. 2025 recalculée indépendamment (2 351,70 et 44 livrées) ; magasin sans suivi quotidien = repli total ; magasin hors droits = 0 ligne ; `npx tsc --noEmit` OK

### ✅ Module Finances v1 — Lot B (suite) : fuseau d'affaires & privilèges
- [x] **Fuseau d'affaires explicite** : `public.finance_business_timezone()` = `Africa/Casablanca` (fonction interne, `search_path` épinglé, appel unique pour toutes les clés de journée) — migrations `20260926192926_finance_pnl_timezone.sql` et `20260926193328_finance_timezone_search_path.sql`
- [x] **Correction d'un double comptage réel** : les clés de journée de l'arbitrage publicitaire étaient calculées en UTC alors que l'interface envoie des bornes locales → une commande passée entre 00:00 et 01:00 (heure marocaine) tombait dans la journée UTC précédente et son `ads_cost_allocated` était recompté en repli. Mesuré puis corrigé : repli total 706,15 → 141,37 MAD sur le store principal (`ziilart`), soit **564,78 MAD de publicité comptée deux fois en moins** (1 commande en repli au lieu de 8)
- [x] **Règle des journées coupées** : `ad_spend_daily` étant une donnée de journée entière, la fenêtre publicitaire (suivi **et** repli) est élargie aux journées locales complètes touchées par la période ; aucune asymétrie en bord de période, aucun prorata silencieux
- [x] Nouvelle colonne `ads_partial_days` : nombre de journées suivies seulement partiellement couvertes par la période (comptées en entier) — signalée sous la ligne Publicité dans `pnl-overview.tsx`
- [x] **Privilèges** : `anon` retiré nommément de toutes les fonctions du module (`rpc_finance_*`, `rpc_record_*`, `can_view_store_finances`, `can_record_store_payments`) — migration `20260926192933_finance_rpc_grants.sql`. Les privilèges par défaut du schéma `public` accordent EXECUTE à `anon`/`authenticated`/`service_role` à chaque création de fonction : un `revoke ... from public` seul ne suffit pas
- [x] Vérifié en base : RPC appelée sous JWT simulé (propriétaire du store) — période alignée 10/06→20/06 (3 274,80 · 10 jours · 0 jour partiel), période débutant à 12:00 (même montant, `ads_partial_days = 1`), bornes décalées UTC (11 jours, 2 partiels) ; ACL `anon` absente partout ; garde `can_view_store_finances` toujours active (0 ligne sans JWT) ; `npx tsc --noEmit` OK

### ✅ Module Finances v1 — Phase 3 (actions de paiement dans l'UI existante)
- [x] **Personnel `/staff`** : nouveau bloc « Règlements des agents de confirmation » — colonnes *Acquis / Versé / Restant* par agent (`rpc_finance_agent_balances`), ligne *Total*, historique des 10 derniers versements (`confirmation_agent_payments`, protégé par la RLS `can_view_store_finances`) et bouton « Enregistrer un versement » → `components/dashboard/staff/confirmation-agents-payments.tsx`
- [x] **Fournisseurs `/suppliers`** : colonnes *Dû / Payé / Restant* par fournisseur (`rpc_finance_supplier_balances`), détail par achat dépliable (*dû − payé = reste* facture par facture, `rpc_finance_supplier_purchases`) → `components/dashboard/finance/supplier-purchases-detail.tsx`, et actions « Achat » / « Payer » réutilisant `SupplierPurchaseDialog` / `SupplierPaymentDialog`
- [x] **Store explicite obligatoire** : aucun bouton de paiement en mode « Tous les stores » (`canRecordPayment = finance.payments && currentStoreId`) ; colonnes financières, détail et actions réservés à `finance.view` (les autres rôles gardent la colonne Actions inchangée)
- [x] Vérifié en base sous JWT simulé (transaction annulée) — **agents** : 2 commandes à 100 → versements 50 (30+20) puis 40 → *acquis 200 · versé 90 · restant 110*, détail par commande 30 + 80 = 110, trop-versé bloqué (`ALLOCATION_EXCEEDS_REMAINING`) ; **fournisseurs** : achats 1 000 + 500 → paiements 400 (300+100) puis 200 → *dû 1 500 · payé 600 · restant 900*, détail par facture 500 + 400 = 900, trop-payé bloqué
- [x] `npx tsc --noEmit` et `next build` sans erreur ; serveur de dev relancé sur `localhost:3000`
- [ ] **BLOQUÉ** — les **avances fournisseur ne sont pas représentables** : `rpc_record_supplier_payment` impose `somme(imputations) = montant` (`ALLOCATION_TOTAL_MISMATCH`, dernière définition `20260926182058:268`, aucune redéfinition postérieure), donc aucune colonne « Avances » n'a été affichée et le cas limite §8.4 du plan reste ouvert. Décision de gestion requise avant toute écriture
- [x] ~~`rpc_finance_agent_balances` / `rpc_finance_supplier_balances` sans contrôle de rôle ni de statut~~ — **constat périmé, vérifié en base** : ces RPC (`20260926180201:37,78`) appellent `public.can_view_store_finances(store_id)`, helper qui exige `status = 'active'` **et** `role in ('owner','admin','accountant')` (`20260926174248:6–19`). La garde en base n'est donc **pas** plus permissive que l'UI ; `20260926192933_finance_rpc_grants.sql` ne fait que retirer `anon` (aucun corps de fonction réécrit)



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
- [x] Édition complète produit + variantes dans un seul modal "Modifier"
- [x] Mutation unifiée updateProductWithVariantsMutation (update produit + delete/insert variantes)
- [x] Préchargement des variantes dans le modal d'édition
- [x] Suppression du bouton "Gérer variantes" redondant du menu actions
- [x] Invalidations cache complètes (products, product-variants-by-product, inventory-movements)

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
- [x] Ajouter les deux modes Facebook Ads (Simple sans produit / Par produit) avec la liaison multi-store `facebook_ad_account_store_configs` et `facebook_campaign_mappings.product_id` nullable
- [x] Extraire le worker de sync dans `lib/integrations/facebook-ads-sync.ts`, ajouter la pagination Meta Insights et la dé-duplication par campagne/jour
- [x] Ajouter la synchronisation automatique quotidienne Vercel (`/api/cron/facebook-ads-sync` + `vercel.json`)
- [x] Auditer et durcir le flux Facebook Ads: isolation multi-store, RLS/CSRF, jobs atomiques, multi-devise, déduplication sûre et validation des mappings
- [x] Finaliser la stratégie de fraîcheur Facebook Ads: synchronisation nocturne jusqu’à hier, correction glissante sur 7 jours et information client en cas de dépense à zéro
- [x] Ajouter la saisie manuelle quotidienne des dépenses publicitaires avec modification/suppression, permissions et allocation automatique sur les commandes livrées
- [x] Corriger l’import CSV des ventes: choix global de la source (Ads / Organic / colonne), mapping et auto-détection des valeurs, suppression du fallback `organic`, validation bloquante
- [x] Ajouter la correction en masse de la source des ventes existantes (`/api/orders/bulk-source`) avec recalcul de l’allocation publicitaire
- [x] Accélérer l’import CSV: normalisation des villes uniques avec concurrence limitée
- [x] Unifier l’allocation publicitaire (trigger legacy aligné) et recalculer sur changement de `source`
- [x] Garantir la préservation des alias de villes (`ON DELETE SET NULL`) lors de la suppression des ventes
- [x] Ajouter l’import CSV des dépenses publicitaires sur la page Publicité (mode Simple date + dépense en devise du store, et mode Avancé avec les colonnes Ads Manager)
- [x] Extraire le parser CSV partagé dans `lib/imports/csv.ts` et remplacer les lignes internes (`__manual__`, `__csv__`) lors d’une synchronisation Meta finalisée

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
- Aucun blocage connu au 26/09/2026 : le build de production passe (`next build` OK, 137 pages) et le `PATCH /api/stores/[id]` est désormais contrôlé — cf. *Recently Resolved*.

### Medium
- **Devise des règlements figée à `MAD` par défaut (constat d'audit du 26/09/2026, latent)** : `rpc_record_agent_payment`, `rpc_record_supplier_payment` et `rpc_record_supplier_purchase` déclarent `p_currency text default 'MAD'`, et les colonnes `currency` de `confirmation_agent_payments` / `supplier_payments` / `supplier_purchases` valent `'MAD'` par défaut ; les dialogues de l'UI ne passent **jamais** `p_currency`. Les 9 stores sont aujourd'hui en MAD et les trois registres sont **vides** (0 ligne) : aucun montant erroné n'existe, mais un store non-MAD enregistrerait des règlements étiquetés MAD (interdiction §9 du plan Finances : ne jamais additionner des devises différentes). Correction possible : transmettre la devise du store depuis l'UI (`useStore()`) — **à valider avant écriture**, domaine financier
- **Déploiement Vercel non vérifiable depuis l'environnement local** : aucun jeton `VERCEL_*` disponible et l'API Vercel refuse l'accès à cette team ; `platerform.vercel.app` répond 200 mais le lien déploiement ↔ commit `e7c67a3` n'a pas pu être confirmé (à contrôler dans le dashboard Vercel)
- Next 16 signale que la convention `middleware.ts` est **dépréciée** au profit de `proxy` (avertissement de build, non bloquant) : migrer sans changer la logique (permissions des utilisateurs connectés uniquement, le blocage anonyme reste dans `app/(app)/layout.tsx`)
- Rendu SSR neutralisé par `StoreProvider` (`lib/store-context.tsx`) : tant que `localStorage` n'est pas lu côté client, le provider affiche un spinner à la place de `children`. Le HTML initial ne contient donc aucun contenu de page (spinner plein écran), sur toutes les routes y compris publiques → limite SEO et délai perçu. Corrections possibles : rendre le blocage client-only (skeleton non bloquant), ou sortir les pages publiques (`(marketing)`, `(documentation)`) du `StoreProvider`.
- `CRON_SECRET` doit être défini dans Vercel pour activer la synchronisation Facebook Ads automatique (sinon `/api/cron/facebook-ads-sync` répond 503)
- No error boundaries implemented
- No loading states on pages
- No form validation feedback
- Missing toast notifications

### Recently Resolved
- **Build global débloqué** : l'erreur Rapid Delivery (`useSearchParams()` sans boundary) bloquait le build ; la page `/suppliers` (ex-`/dashboard/fournisseurs`) encapsule maintenant son contenu dans un `<Suspense>` — `npm run build` passe, 137 pages générées, aucune erreur
- **`PATCH /api/stores/[id]` : contrôle d'accès ajouté** — la route écrivait via le client service-role après un simple `requireAuth()` : n'importe quel utilisateur connecté pouvait renommer un store étranger ou changer sa devise. `assertCanUpdateStore()` exige désormais le propriétaire (`stores.owner_user_id`) ou un membre **actif** dont le rôle porte `stores.update` (owner/admin) ; réponses 401 / 403 / 404. Le `DELETE` du même fichier appelle `delete_store` via le client lié à l'utilisateur (`auth.uid()`) et renvoie 409 `STORE_HAS_FINANCIAL_HISTORY`
- **Affichage des montants** : `formatCurrency()` passe de 0 à **2 décimales** (les centimes étaient masqués, incohérent avec les registres de paiement qui enregistrent des montants partiels)
- **Auth (identité serveur non vérifiée)** : quand `getUser()` échouait, `getServerUser()` renvoyait `getSession().user` — un simple décodage local du cookie, sans vérification de signature : un cookie forgé pouvait donc se faire passer pour une session dans `app/(app)/layout.tsx`, `dashboard`, `login` et `signup`. Le repli relit désormais uniquement le **jeton d'accès** et le soumet à l'API Auth (`getUser(access_token)`, `GET /user` en Bearer) : la confiance aveugle au cookie disparaît et le repli reste une seconde tentative **vérifiée** — sa justification d'origine (« incohérences de cookies SSR, notamment Safari ») n'est ni documentée ni reproduite, elle n'est donc plus présentée comme un correctif
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
