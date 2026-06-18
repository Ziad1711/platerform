-- ============================================================
-- ForceLog : tables de configuration, aliases et colonnes orders
-- ============================================================

-- 1. forcelog_configs : configuration ForceLog par store
create table if not exists public.forcelog_configs (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.integrations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  parcel_creation_mode text not null default 'auto' check (parcel_creation_mode in ('auto', 'manual', 'disabled')),
  enable_city_normalization boolean not null default true,
  default_product_nature text null,
  default_can_open boolean not null default true,
  default_fragile boolean not null default false,
  default_carton text null,
  default_stock text null,
  pickup_phone text null,
  pickup_city_key text null,
  pickup_city_name text null,
  pickup_address text null,
  pickup_stickers boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists forcelog_configs_store_idx
  on public.forcelog_configs(store_id);

create unique index if not exists forcelog_configs_integration_idx
  on public.forcelog_configs(integration_id);

-- 2. forcelog_city_aliases : alias de villes pour ForceLog
create table if not exists public.forcelog_city_aliases (
  alias text primary key,
  canonical_city_name text not null,
  city_key text null,
  learned_from_order_id uuid null references public.orders(id) on delete set null,
  learned_at timestamptz null,
  last_used_at timestamptz null,
  usage_count integer not null default 1,
  source text not null default 'manual' check (source in ('manual', 'ai_learned', 'common_alias')),
  confidence_score numeric not null default 1.0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. Colonnes spécifiques ForceLog sur orders
alter table public.orders
  add column if not exists forcelog_city_key text null,
  add column if not exists forcelog_parcel_key text null,
  add column if not exists forcelog_pickup_key text null;

-- 4. Index
create index if not exists orders_forcelog_parcel_key_idx
  on public.orders(store_id, forcelog_parcel_key)
  where forcelog_parcel_key is not null;

create index if not exists orders_forcelog_pickup_key_idx
  on public.orders(store_id, forcelog_pickup_key)
  where forcelog_pickup_key is not null;

-- Index sur delivery_rates pour ForceLog si pas déjà présent
create index if not exists delivery_rates_provider_city_idx
  on public.delivery_rates(provider_id, external_city_key);

-- 5. RLS forcelog_city_aliases (lecture pour tous, écriture admin seulement)
alter table public.forcelog_configs enable row level security;
alter table public.forcelog_city_aliases enable row level security;

drop policy if exists forcelog_configs_select on public.forcelog_configs;
create policy forcelog_configs_select on public.forcelog_configs
  for select using (
    store_id in (select store_id from public.store_members where user_id = auth.uid())
  );

drop policy if exists forcelog_configs_manage on public.forcelog_configs;
create policy forcelog_configs_manage on public.forcelog_configs
  for all using (
    store_id in (select store_id from public.store_members where user_id = auth.uid())
  ) with check (
    store_id in (select store_id from public.store_members where user_id = auth.uid())
  );

drop policy if exists forcelog_city_aliases_select on public.forcelog_city_aliases;
create policy forcelog_city_aliases_select on public.forcelog_city_aliases
  for select using (auth.uid() is not null);