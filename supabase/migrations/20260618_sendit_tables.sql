-- ============================================================
-- Sendit : configuration et colonnes commandes
-- ============================================================

create table if not exists public.sendit_configs (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.integrations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  parcel_creation_mode text not null default 'auto' check (parcel_creation_mode in ('auto', 'manual', 'disabled')),
  pickup_district_id text null,
  default_packaging_id integer null,
  default_allow_open boolean not null default true,
  default_allow_try boolean not null default true,
  default_products_from_stock boolean not null default false,
  default_option_exchange boolean not null default false,
  default_delivery_exchange_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists sendit_configs_store_idx on public.sendit_configs(store_id);
create unique index if not exists sendit_configs_integration_idx on public.sendit_configs(integration_id);

alter table public.orders
  add column if not exists sendit_district_id text null,
  add column if not exists sendit_parcel_code text null,
  add column if not exists sendit_label_url text null;

create index if not exists orders_sendit_parcel_code_idx
  on public.orders(store_id, sendit_parcel_code)
  where sendit_parcel_code is not null;

alter table public.sendit_configs enable row level security;

drop policy if exists sendit_configs_select on public.sendit_configs;
create policy sendit_configs_select on public.sendit_configs
  for select using (
    store_id in (select store_id from public.store_members where user_id = auth.uid())
  );

drop policy if exists sendit_configs_manage on public.sendit_configs;
create policy sendit_configs_manage on public.sendit_configs
  for all using (
    store_id in (select store_id from public.store_members where user_id = auth.uid())
  ) with check (
    store_id in (select store_id from public.store_members where user_id = auth.uid())
  );

update public.integration_providers
set name = 'Sendit', category = coalesce(category, 'delivery'), is_active = true
where id = '5998e563-96ed-47cc-881a-43f41827f858'::uuid or slug = 'sendit';
