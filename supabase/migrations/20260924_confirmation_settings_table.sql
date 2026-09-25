-- ============================================================
-- Module Confirmation des commandes
-- 1) Paramètres de confirmation par store
-- 2) Colonnes opérationnelles sur orders (compteur d'appels, rappel, motif)
-- 3) Journal immuable des actions de confirmation
-- 4) Action atomique unique (pas de réponse / reporter / annuler / confirmer)
-- 5) Durcissement des politiques RLS trop permissives sur orders
-- ============================================================

-- ---------- 1. Paramètres de confirmation par store ----------

create table if not exists public.confirmation_settings (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  max_attempts integer not null default 6,
  auto_cancel_on_max_attempts boolean not null default true,
  require_cancellation_reason boolean not null default true,
  require_callback_datetime boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint confirmation_settings_store_unique unique (store_id),
  constraint confirmation_settings_max_attempts_check check (max_attempts between 1 and 20)
);

comment on table public.confirmation_settings is
  'Réglages du module de confirmation, un enregistrement par store.';
comment on column public.confirmation_settings.max_attempts is
  'Nombre maximal d''appels sans réponse avant décision finale. Défaut : 6.';
comment on column public.confirmation_settings.auto_cancel_on_max_attempts is
  'Si vrai, la commande est automatiquement annulée quand le nombre maximal d''appels est atteint.';

alter table public.confirmation_settings enable row level security;

drop policy if exists confirmation_settings_select_store_members on public.confirmation_settings;
create policy confirmation_settings_select_store_members
on public.confirmation_settings for select
using (
  exists (
    select 1 from public.store_members sm
    where sm.store_id = confirmation_settings.store_id
      and sm.user_id = auth.uid()
  )
  or exists (
    select 1 from public.stores s
    where s.id = confirmation_settings.store_id
      and s.owner_user_id = auth.uid()
  )
);

drop policy if exists confirmation_settings_write_owner_admin on public.confirmation_settings;
create policy confirmation_settings_write_owner_admin
on public.confirmation_settings for all
using (
  exists (
    select 1 from public.store_members sm
    where sm.store_id = confirmation_settings.store_id
      and sm.user_id = auth.uid()
      and sm.role in ('owner', 'admin')
  )
  or exists (
    select 1 from public.stores s
    where s.id = confirmation_settings.store_id
      and s.owner_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.store_members sm
    where sm.store_id = confirmation_settings.store_id
      and sm.user_id = auth.uid()
      and sm.role in ('owner', 'admin')
  )
  or exists (
    select 1 from public.stores s
    where s.id = confirmation_settings.store_id
      and s.owner_user_id = auth.uid()
  )
);
