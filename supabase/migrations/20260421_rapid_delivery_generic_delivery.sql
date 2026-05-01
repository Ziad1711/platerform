create extension if not exists pgcrypto;

create table if not exists public.pricing_groups (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.integration_providers(id) on delete cascade,
  user_id uuid null references auth.users(id) on delete cascade,
  integration_id uuid null references public.integrations(id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists pricing_groups_provider_name_unique
  on public.pricing_groups(provider_id, coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(integration_id, '00000000-0000-0000-0000-000000000000'::uuid), name);

create unique index if not exists pricing_groups_default_per_provider_unique
  on public.pricing_groups(provider_id)
  where user_id is null and integration_id is null and is_default = true;

create unique index if not exists pricing_groups_custom_per_integration_unique
  on public.pricing_groups(integration_id)
  where integration_id is not null;

create table if not exists public.delivery_rates (
  id uuid primary key default gen_random_uuid(),
  pricing_group_id uuid not null references public.pricing_groups(id) on delete cascade,
  provider_id uuid not null references public.integration_providers(id) on delete cascade,
  external_city_key bigint not null,
  city_name text not null,
  price numeric not null default 0,
  cost_refuse numeric not null default 0,
  cost_cancel numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists delivery_rates_group_city_unique
  on public.delivery_rates(pricing_group_id, external_city_key);

create index if not exists delivery_rates_provider_city_idx
  on public.delivery_rates(provider_id, external_city_key);

create table if not exists public.delivery_states (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.integration_providers(id) on delete cascade,
  external_state_id bigint not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists delivery_states_provider_state_unique
  on public.delivery_states(provider_id, external_state_id);

create table if not exists public.delivery_shops (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.integrations(id) on delete cascade,
  provider_id uuid not null references public.integration_providers(id) on delete cascade,
  external_shop_id bigint not null,
  external_name text not null,
  phone text null,
  allow_opening_parcels boolean not null default false,
  store_id uuid null references public.stores(id) on delete set null,
  pricing_group_id uuid null references public.pricing_groups(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists delivery_shops_integration_shop_unique
  on public.delivery_shops(integration_id, external_shop_id);

create index if not exists delivery_shops_integration_store_idx
  on public.delivery_shops(integration_id, store_id);

alter table public.pricing_groups enable row level security;
alter table public.delivery_rates enable row level security;
alter table public.delivery_states enable row level security;
alter table public.delivery_shops enable row level security;

drop policy if exists pricing_groups_select_owner on public.pricing_groups;
create policy pricing_groups_select_owner on public.pricing_groups
for select using (
  user_id is null
  or integration_id in (select id from public.integrations where user_id = auth.uid())
);

drop policy if exists pricing_groups_manage_owner on public.pricing_groups;
create policy pricing_groups_manage_owner on public.pricing_groups
for all using (
  integration_id in (select id from public.integrations where user_id = auth.uid())
) with check (
  integration_id in (select id from public.integrations where user_id = auth.uid())
);

drop policy if exists delivery_rates_select_authenticated on public.delivery_rates;
create policy delivery_rates_select_authenticated on public.delivery_rates
for select using (auth.uid() is not null);

drop policy if exists delivery_states_select_authenticated on public.delivery_states;
create policy delivery_states_select_authenticated on public.delivery_states
for select using (auth.uid() is not null);

drop policy if exists delivery_shops_owner on public.delivery_shops;
create policy delivery_shops_owner on public.delivery_shops
for all using (
  integration_id in (select id from public.integrations where user_id = auth.uid())
) with check (
  integration_id in (select id from public.integrations where user_id = auth.uid())
);