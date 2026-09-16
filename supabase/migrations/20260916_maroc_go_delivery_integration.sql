-- ============================================================
-- Maroc Go Delivery : provider + tables dédiées + colonnes orders
-- Même API que Rapid Delivery, endpoint différent.
-- ============================================================

-- 1. Provider
insert into public.integration_providers (
  slug,
  name,
  description,
  category,
  logo_url,
  is_active,
  created_at,
  rating_avg,
  total_reviews
)
values (
  'maroc-go-delivery',
  'Maroc Go Delivery',
  'Intégration Maroc Go Delivery pour synchroniser shops, villes, états et colis.',
  'delivery',
  'https://www.marocgodelivery.com/favicon.ico',
  true,
  now(),
  5,
  0
)
on conflict (slug) do update
set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  logo_url = excluded.logo_url,
  is_active = excluded.is_active,
  rating_avg = excluded.rating_avg,
  total_reviews = excluded.total_reviews;

-- 2. Configs (miroir de rapid_delivery_configs)
create table if not exists public.maroc_go_delivery_configs (
  integration_id uuid primary key references public.integrations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  api_token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  parcel_creation_mode text not null default 'manual'
    check (parcel_creation_mode = any (array['disabled', 'manual', 'auto'])),
  default_shop_key integer,
  default_article_name text not null default 'Colis e-commerce',
  auto_change_status_to_picked_up boolean not null default false,
  enable_city_normalization boolean not null default true
);

alter table public.maroc_go_delivery_configs enable row level security;

drop policy if exists maroc_go_delivery_configs_select on public.maroc_go_delivery_configs;
create policy maroc_go_delivery_configs_select on public.maroc_go_delivery_configs
  for select using (user_id = auth.uid());

drop policy if exists maroc_go_delivery_configs_insert on public.maroc_go_delivery_configs;
create policy maroc_go_delivery_configs_insert on public.maroc_go_delivery_configs
  for insert with check (user_id = auth.uid());

drop policy if exists maroc_go_delivery_configs_update on public.maroc_go_delivery_configs;
create policy maroc_go_delivery_configs_update on public.maroc_go_delivery_configs
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 3. Aliases de villes (miroir de rapid_delivery_city_aliases, accès service_role uniquement)
create table if not exists public.maroc_go_delivery_city_aliases (
  id uuid primary key default gen_random_uuid(),
  alias text not null unique,
  canonical_city_name text not null,
  city_key integer not null,
  learned_from_order_id uuid references public.orders(id) on delete set null,
  learned_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  usage_count integer not null default 1,
  confidence_score numeric not null default 0.95,
  source text not null default 'ai_learned',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_maroc_go_delivery_city_aliases_city_key
  on public.maroc_go_delivery_city_aliases (city_key);

alter table public.maroc_go_delivery_city_aliases enable row level security;

-- 4. Colonnes orders (isolation totale vs Rapid Delivery)
alter table public.orders
  add column if not exists maroc_go_delivery_parcel_key text,
  add column if not exists maroc_go_delivery_voucher_key text;

create index if not exists orders_maroc_go_parcel_key_idx
  on public.orders(maroc_go_delivery_parcel_key);

create index if not exists orders_store_maroc_go_voucher_key_idx
  on public.orders(store_id, maroc_go_delivery_voucher_key);
