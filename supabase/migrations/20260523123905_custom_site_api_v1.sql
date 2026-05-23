begin;

-- 1) Ajout de external_order_id sur orders (unique par store)
alter table public.orders add column if not exists external_order_id text;
create index if not exists idx_orders_store_external_order_id on public.orders (store_id, external_order_id);

-- 2) Clés API pour site personnalisé
create table if not exists public.public_api_keys (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null default 'Clé API site web',
  key_prefix text not null,
  key_hash text not null unique,
  is_active boolean not null default true,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists idx_public_api_keys_store on public.public_api_keys (store_id);
create index if not exists idx_public_api_keys_key_hash on public.public_api_keys (key_hash);

-- 3) Journal d'ingestion des commandes API
create table if not exists public.public_order_ingestion_logs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  api_key_id uuid references public.public_api_keys(id) on delete set null,
  external_order_id text,
  status text not null check (status in ('accepted', 'rejected', 'duplicate', 'error')),
  error_code text,
  error_message text,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_ingestion_logs_store on public.public_order_ingestion_logs (store_id, created_at desc);

-- 4) Table d'idempotence
create table if not exists public.public_order_idempotency (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  api_key_id uuid references public.public_api_keys(id) on delete set null,
  idempotency_key text not null,
  payload_hash text not null,
  order_id uuid references public.orders(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (store_id, idempotency_key)
);

-- 5) RLS
alter table public.public_api_keys enable row level security;
alter table public.public_order_ingestion_logs enable row level security;
alter table public.public_order_idempotency enable row level security;

-- API keys: visible seulement par les membres du store
drop policy if exists "public_api_keys_select_store_members" on public.public_api_keys;
create policy "public_api_keys_select_store_members"
on public.public_api_keys for select
using (
  store_id in (
    select store_id from public.store_members where user_id = auth.uid()
  )
);

drop policy if exists "public_api_keys_insert_store_members" on public.public_api_keys;
create policy "public_api_keys_insert_store_members"
on public.public_api_keys for insert
with check (
  store_id in (
    select store_id from public.store_members where user_id = auth.uid()
  )
);

drop policy if exists "public_api_keys_update_store_members" on public.public_api_keys;
create policy "public_api_keys_update_store_members"
on public.public_api_keys for update
using (
  store_id in (
    select store_id from public.store_members where user_id = auth.uid()
  )
);

drop policy if exists "public_api_keys_delete_store_members" on public.public_api_keys;
create policy "public_api_keys_delete_store_members"
on public.public_api_keys for delete
using (
  store_id in (
    select store_id from public.store_members where user_id = auth.uid()
  )
);

-- Logs: visibles par les membres du store
drop policy if exists "ingestion_logs_select_store_members" on public.public_order_ingestion_logs;
create policy "ingestion_logs_select_store_members"
on public.public_order_ingestion_logs for select
using (
  store_id in (
    select store_id from public.store_members where user_id = auth.uid()
  )
);

-- Idempotency: visibles par les membres du store
drop policy if exists "idempotency_select_store_members" on public.public_order_idempotency;
create policy "idempotency_select_store_members"
on public.public_order_idempotency for select
using (
  store_id in (
    select store_id from public.store_members where user_id = auth.uid()
  )
);

commit;
