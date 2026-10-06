-- ============================================================
-- AMEEX : configuration webhook + journal d'evenements de suivi
-- ============================================================

-- 1. Configuration webhook par store (secret stocke chiffre via encryptSecret)
alter table public.ameex_configs
  add column if not exists webhook_secret_encrypted text null,
  add column if not exists webhook_url text null,
  add column if not exists last_webhook_at timestamptz null;

-- 2. Journal des evenements webhook (diagnostic + idempotence)
create table if not exists public.ameex_webhook_events (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid null references public.integrations(id) on delete set null,
  store_id uuid null references public.stores(id) on delete cascade,
  order_id uuid null references public.orders(id) on delete set null,
  parcel_code text not null,
  statut text null,
  statut_s text null,
  status_date date null,
  event_key text null,
  outcome text not null,
  signature_present boolean not null default false,
  signature_valid boolean not null default false,
  error text null,
  received_at timestamptz not null default now(),
  processed_at timestamptz null
);

-- Index unique de deduplication : les lignes avec integration_id/event_key NULL
-- ne sont jamais bloquees (PostgreSQL considere chaque NULL comme distinct).
create unique index if not exists ameex_webhook_events_dedup_idx
  on public.ameex_webhook_events(integration_id, event_key);

create index if not exists ameex_webhook_events_parcel_idx
  on public.ameex_webhook_events(parcel_code, received_at desc);

create index if not exists ameex_webhook_events_store_idx
  on public.ameex_webhook_events(store_id, received_at desc);

-- 3. RLS
alter table public.ameex_webhook_events enable row level security;

drop policy if exists ameex_webhook_events_store_select on public.ameex_webhook_events;
create policy ameex_webhook_events_store_select
on public.ameex_webhook_events
for select
using (
  store_id in (
    select sm.store_id from public.store_members sm where sm.user_id = auth.uid()
  )
);
