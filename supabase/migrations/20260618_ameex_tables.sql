-- ============================================================
-- AMEEX : tables de configuration, aliases et colonnes orders
-- ============================================================

-- 1. ameex_configs : configuration AMEEX par store
create table if not exists public.ameex_configs (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.integrations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  business_id text null,
  parcel_creation_mode text not null default 'auto' check (parcel_creation_mode in ('auto', 'manual', 'disabled')),
  enable_city_normalization boolean not null default true,
  default_open boolean not null default true,
  default_try boolean not null default true,
  default_fragile boolean not null default false,
  default_replace boolean not null default true,
  default_parcel_type text not null default 'SIMPLE' check (default_parcel_type in ('SIMPLE', 'STOCK')),
  pickup_phone text null,
  pickup_city_key text null,
  pickup_city_name text null,
  pickup_address text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ameex_configs_store_idx
  on public.ameex_configs(store_id);

create unique index if not exists ameex_configs_integration_idx
  on public.ameex_configs(integration_id);

-- 2. ameex_city_aliases : alias de villes pour AMEEX
create table if not exists public.ameex_city_aliases (
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

-- 3. Colonnes specifiques AMEEX sur orders
alter table public.orders
  add column if not exists ameex_city_key text null,
  add column if not exists ameex_parcel_code text null,
  add column if not exists ameex_delivery_note_ref text null;

-- 4. Index
create index if not exists orders_ameex_parcel_code_idx
  on public.orders(store_id, ameex_parcel_code)
  where ameex_parcel_code is not null;

create index if not exists orders_ameex_delivery_note_ref_idx
  on public.orders(store_id, ameex_delivery_note_ref)
  where ameex_delivery_note_ref is not null;

-- 5. RLS
alter table public.ameex_configs enable row level security;
alter table public.ameex_city_aliases enable row level security;

drop policy if exists ameex_configs_select on public.ameex_configs;
create policy ameex_configs_select on public.ameex_configs
  for select using (
    store_id in (select store_id from public.store_members where user_id = auth.uid())
  );

drop policy if exists ameex_configs_manage on public.ameex_configs;
create policy ameex_configs_manage on public.ameex_configs
  for all using (
    store_id in (select store_id from public.store_members where user_id = auth.uid())
  ) with check (
    store_id in (select store_id from public.store_members where user_id = auth.uid())
  );

drop policy if exists ameex_city_aliases_select on public.ameex_city_aliases;
create policy ameex_city_aliases_select on public.ameex_city_aliases
  for select using (auth.uid() is not null);