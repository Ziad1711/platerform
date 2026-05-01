
## Variables d'environnement importantes

- `INTEGRATIONS_ENCRYPTION_KEY` : clé base64 de 32 octets utilisée pour chiffrer les tokens d'intégration (ex: Rapid Delivery).
- Génération rapide : `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
documentation.md

SQL migration (variants produits) — à exécuter dans Supabase SQL Editor / MCP

```sql
begin;

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  name text not null,
  sku text not null,
  selling_price numeric(12,2) not null default 0,
  purchase_cost numeric(12,2) not null default 0,
  option_values jsonb not null default '{}'::jsonb,
  unique (product_id, sku)
);

alter table public.product_variants
  add column if not exists option_values jsonb not null default '{}'::jsonb;

alter table public.product_variants
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_product_variants_store_product
  on public.product_variants (store_id, product_id);

alter table public.inventory_movements
  add column if not exists product_variant_id uuid null references public.product_variants(id) on delete set null;

create index if not exists idx_inventory_movements_variant
  on public.inventory_movements (product_variant_id);

alter table public.order_items
  add column if not exists product_variant_id uuid null references public.product_variants(id) on delete set null;

create index if not exists idx_order_items_variant
  on public.order_items (product_variant_id);

commit;
```

Table profiles
Id
first_name
last_name
full_name
main_currency
created_at
Updated_at



Très important :
profiles.id = auth.users.id
Pourquoi main_currency?
Pour calculer :
total revenue de tous les stores
et convertir automatiquement les devises.
Relation
profiles.id → stores.owner_user_id
profiles.id → exchange_rates.owner_user_id


Table store_members
Id
created_at
store_id
user_id
role
Role
exemples :
owner
admin
staff
confirmation_agent
Donc les agents de confirmation peuvent se connecter et changer le statut des commandes.


Table confirmation_agents
Id
created_at
member_id
store_id
name
language
commission_per_order


Exemple
name = Sara
language = FR
commission_per_order = 2 dh



Table Orders
id
store_id
created_at
updated_at
order_date
customer_name
phone
status
total_selling_price
delivery_fee
ads_cost_allocated
confirmation_cost_allocated
confirmation_agent_id
delivery_company_id
tracking_number
external_delivery_id
delivery_status
sent_at
delivered_at
returned_at
last_delivery_sync_at




Table delivery_companies
id
store_id
name
api_provider
is_active
created_at


Table Order_items
id
store_id
order_id
product_id
quantity
unit_selling_price
unit_purchase_cost_snapshot
Item_type
updated_at


Pourquoi order_items ?
orders = informations générales de la commande
 order_items = produits contenus dans la commande
Item_type

Valeurs possibles dans item_type
Par exemple :
main → produit principal
upsell → upsell
cross_sell → cross sell
bundle → pack
gift → cadeau




Table Products

Id
created_at
store_id
name
sku
default_selling_price
default_purchase_cost
Updated_at








Table suppliers
id
store_id
created_at
name
phone
notes



Table Inventory_movements

Id
created_at
store_id
Product_id
supplier_id
invoice_number
movement_type
quantity
unit_cost
total_cost
source_type
source_id

movement_type
in → entrée stock
out → sortie stock
adjustment → correction inventaire (si par exemple stock système 50 et stock réel 47 on ajoute on ligne de stock -3 avec movement_type adjustement)
source_type
Permet de savoir d’où vient le mouvement :
purchase
order
return
adjustment
source_id
ID de la source :
order_id
purchase_id
etc.
Exemple
Achat fournisseur (100 pièces)
movement_type = in
quantity = 100
source_type = purchase
Commande livrée (1 pièce vendue)
movement_type = out
quantity = 1
source_type = order
source_id = order_id

Stock actuel
Le stock d’un produit :
SUM(in) - SUM(out)


Table supplier_ledger

id
store_id
Supplier_id
created_at
entry_type
amount
entry_date
reference_type
Note

entry_type
debit → vous devez au fournisseur
credit → vous avez payé le fournisseur
reference_type
Indique le type d’opération.
Exemple :
purchase
payment
adjustment




Table Ad_spend_daily
Id
created_at
store_id
spend_date
platform
campaign_name
amount




Table expense_categories

id
store_id
name
Type
Exemples
salary
packaging
rent
tool
delivery_extra
other



Table expenses
id
Store_id
created_at
expense_date
category_id
amount
note


Table stores

Id
owner_user_id
created_at
name
category
currency
country
updated_at


Table exchange_rates

Id
Owner_user_id
created_at
base_currency
target_currency
rate
rate_date
source_type
Updated_at
source_type
Pour savoir d’où vient le taux :
manual
System_default (pour tout le monde)

Table plans

id
name
order_limit
ai_credits_monthly
stores_limit
delivery_integrations_limit
confirmation_agents_limit
ads_automation_enabled
api_access_enabled
price
Created_at

Exemple
Free
Pro
Ultimate

Cette table ne change presque jamais

Table Subscriptions
id
user_id
Plan_id
created_at
amount_paid
currency
status
started_at
Expires_at
coupon_id
Updated_at
status
active
cancelled
expired
trial



Table coupons
Id
created_at
code
discount_type
discount_value
max_uses
used_count
Expires_at

discount_type
percentage
fixed







IA
Table chat_threads
id
user_id
store_id
title
created_at
updated_at

Table chat_messages
id
thread_id
role
content
credits_used
created_at
role :
user
assistant
system
Table ai_credit_wallets
Comme les crédits sont liés au compte :
id
user_id
monthly_credits
credits_used
reset_date
created_at
updated_at
Table ai_usage
Pour tracer chaque consommation :
id
user_id
store_id
thread_id
feature
credits_used
created_at
feature :
chatbot
report
analysis


Règle simple pour dashboard

< 500k orders → SQL direct
> 500k orders → metrics table (il faut créer une table didiée pour matrics qui calcule les kpi’s pour chaque store)

Consigne

Architecture base de données
Utiliser une structure normalisée avec tables séparées (orders, order_items, products, inventory_movements, expenses, etc.).
Toutes les tables métier doivent contenir store_id pour supporter le multi-store.
Utiliser UUID comme clé primaire.
Ajouter systématiquement created_at et updated_at.


Performance
Ajouter des index sur les colonnes critiques :
(store_id, date)
order_id
product_id
status
Toujours filtrer par store_id dans les requêtes.

Architecture base de données
Utiliser une structure normalisée avec tables séparées (orders, order_items, products, inventory_movements, expenses, etc.).


Toutes les tables métier doivent contenir store_id pour supporter le multi-store.


Utiliser UUID comme clé primaire.


Ajouter systématiquement created_at et updated_at.



Performance
Ajouter des index sur les colonnes critiques :


(store_id, date)


order_id


product_id


status


Toujours filtrer par store_id dans les requêtes.
Calcul des KPI
Les KPI (revenu, profit, coût ads, etc.) doivent être calculés par requêtes SQL agrégées (SUM, COUNT).


Utiliser le minimum de requêtes possible pour le dashboard.


SQL migration — Paramètres utilisateur (profil + facturation + avatars)

```sql
begin;

-- 1) Extensions utiles
create extension if not exists pgcrypto;

-- 2) Colonnes profil utilisateur
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists address text;
alter table public.profiles add column if not exists company text;
alter table public.profiles add column if not exists job_title text;
alter table public.profiles add column if not exists city text;
alter table public.profiles add column if not exists country text;
alter table public.profiles add column if not exists language text default 'fr';
alter table public.profiles add column if not exists timezone text default 'Africa/Casablanca';

-- 3) Facturation utilisateur
create table if not exists public.billing_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  address text,
  city text,
  country text,
  vat_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create table if not exists public.billing_invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  invoice_number text,
  invoice_url text,
  amount numeric(12,2),
  currency text default 'MAD',
  status text,
  period_start date,
  period_end date,
  created_at timestamptz not null default now()
);

create index if not exists idx_billing_profiles_user on public.billing_profiles(user_id);
create index if not exists idx_billing_invoices_user_created on public.billing_invoices(user_id, created_at desc);

-- 4) RLS
alter table public.billing_profiles enable row level security;
alter table public.billing_invoices enable row level security;

drop policy if exists "billing_profiles_select_own" on public.billing_profiles;
create policy "billing_profiles_select_own"
on public.billing_profiles for select
using (auth.uid() = user_id);

drop policy if exists "billing_profiles_upsert_own" on public.billing_profiles;
create policy "billing_profiles_upsert_own"
on public.billing_profiles for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "billing_invoices_select_own" on public.billing_invoices;
create policy "billing_invoices_select_own"
on public.billing_invoices for select
using (auth.uid() = user_id);

-- 5) Storage bucket avatars
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatars_select_public" on storage.objects;
create policy "avatars_select_public"
on storage.objects for select
using (bucket_id = 'avatars');

drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own"
on storage.objects for insert
with check (
  bucket_id = 'avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own"
on storage.objects for update
using (
  bucket_id = 'avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
)
with check (
  bucket_id = 'avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own"
on storage.objects for delete
using (
  bucket_id = 'avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
);

commit;
```















