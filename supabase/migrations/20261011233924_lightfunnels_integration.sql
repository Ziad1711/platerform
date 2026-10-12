-- ============================================================
-- Lightfunnels : provider + liaisons de boutiques + mappings + import atomique
--
-- Sources :
--   - OAuth2 v3 (form-urlencoded, access token 2 h, refresh rotatif) :
--     https://developer.lightfunnels.com/authentication
--   - webhooks `lightfunnels-hmac` (HMAC-SHA256 base64 du corps JSON) :
--     https://developer.lightfunnels.com/webhooks
--   - pagination par curseur (first / after / pageInfo.endCursor) :
--     https://developer.lightfunnels.com/pagination
--   - commande : total / subtotal / shipping / currency / items (VariantSnapshot sans
--     champ `quantity` : un snapshot = une unité) / account_id / store_id :
--     https://developer.lightfunnels.com/orders/types
--
-- Périmètre : commandes entrantes uniquement (lecture Lightfunnels -> Jisra).
-- Aucune écriture vers Lightfunnels, aucune modification de statut métier automatique.
-- ============================================================

begin;

-- ---------- 1. Provider ----------
insert into public.integration_providers (
  slug, name, description, category, logo_url, is_active, created_at, rating_avg, total_reviews
)
values (
  'lightfunnels',
  'Lightfunnels',
  'Importez automatiquement les commandes de vos boutiques Lightfunnels dans Jisra.',
  'ecommerce',
  'https://app.lightfunnels.com/favicon.ico',
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

-- ---------- 2. Liaisons boutiques Lightfunnels <-> stores Jisra ----------
-- Une installation OAuth par utilisateur (`integrations.store_id` reste NULL) et une
-- liaison explicite par boutique distante : les commandes Lightfunnels portent
-- `account_id` + `store_id`, la liaison est donc obligatoire pour router sans ambiguïté.
create table if not exists public.lightfunnels_store_bindings (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.integrations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  lightfunnels_store_id text not null,
  lightfunnels_store_name text,
  lightfunnels_account_id text,
  webhook_order_confirmed_id text,
  webhook_target_url text,
  import_cursor text,
  has_more boolean not null default true,
  last_import_at timestamptz,
  last_import_scanned integer not null default 0,
  last_import_imported integer not null default 0,
  last_import_skipped integer not null default 0,
  last_import_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (integration_id, lightfunnels_store_id)
);

create index if not exists idx_lightfunnels_bindings_store
  on public.lightfunnels_store_bindings (store_id);

create index if not exists idx_lightfunnels_bindings_integration
  on public.lightfunnels_store_bindings (integration_id);


-- ---------- 3. Mappings entités distantes <-> entités internes ----------
-- Miroir de `youcan_entity_mappings` : une seule table pour les trois types d'entités
-- (commandes, produits, variantes), ce qui garde une seule source d'idempotence.
create table if not exists public.lightfunnels_entity_mappings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  integration_id uuid not null references public.integrations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  entity_type text not null check (entity_type in ('order', 'product', 'variant')),
  lightfunnels_id text not null,
  internal_id uuid not null,
  payload jsonb,
  external_financial_status text,
  external_fulfillment_status text,
  external_cancelled_at timestamptz,
  -- `false` = le total source n'a pas pu être reproduit (taxes/frais absents du modèle
  -- Jisra) : la divergence est visible pour être traitée, jamais silencieuse.
  total_reconciled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (integration_id, entity_type, lightfunnels_id)
);

create index if not exists idx_lightfunnels_mappings_lookup
  on public.lightfunnels_entity_mappings (integration_id, entity_type, lightfunnels_id);

create index if not exists idx_lightfunnels_mappings_store
  on public.lightfunnels_entity_mappings (store_id, entity_type);

-- ---------- 4. Contrôle d'appartenance du store (défense en profondeur) ----------
-- Les politiques RLS de ces deux tables sont scopées par `user_id` (comme YouCan) :
-- ce garde-fou empêche qu'une ligne référence le store d'un autre utilisateur.
create or replace function public.lightfunnels_assert_store_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  -- `service_role` (webhook) n'a pas de session utilisateur : la propriété est vérifiée
  -- en amont par la RPC, qui résout elle-même l'utilisateur de l'intégration.
  if current_user <> 'service_role' and new.user_id <> auth.uid() then
    raise exception 'FORBIDDEN_USER' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.store_members sm
    where sm.store_id = new.store_id
      and sm.user_id = new.user_id
      and sm.status = 'active'
  ) and not exists (
    select 1 from public.stores s
    where s.id = new.store_id
      and s.owner_user_id = new.user_id
  ) then
    raise exception 'FORBIDDEN_STORE' using errcode = 'P0001';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_lightfunnels_bindings_store_access on public.lightfunnels_store_bindings;
create trigger trg_lightfunnels_bindings_store_access
before insert or update on public.lightfunnels_store_bindings
for each row execute function public.lightfunnels_assert_store_access();

drop trigger if exists trg_lightfunnels_mappings_store_access on public.lightfunnels_entity_mappings;
create trigger trg_lightfunnels_mappings_store_access
before insert or update on public.lightfunnels_entity_mappings
for each row execute function public.lightfunnels_assert_store_access();

-- ---------- 5. RLS ----------
alter table public.lightfunnels_store_bindings enable row level security;
alter table public.lightfunnels_entity_mappings enable row level security;

drop policy if exists lightfunnels_bindings_select on public.lightfunnels_store_bindings;
create policy lightfunnels_bindings_select on public.lightfunnels_store_bindings
  for select using (user_id = auth.uid());

drop policy if exists lightfunnels_bindings_insert on public.lightfunnels_store_bindings;
create policy lightfunnels_bindings_insert on public.lightfunnels_store_bindings
  for insert with check (user_id = auth.uid());

drop policy if exists lightfunnels_bindings_update on public.lightfunnels_store_bindings;
create policy lightfunnels_bindings_update on public.lightfunnels_store_bindings
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists lightfunnels_bindings_delete on public.lightfunnels_store_bindings;
create policy lightfunnels_bindings_delete on public.lightfunnels_store_bindings
  for delete using (user_id = auth.uid());

drop policy if exists lightfunnels_mappings_select on public.lightfunnels_entity_mappings;
create policy lightfunnels_mappings_select on public.lightfunnels_entity_mappings
  for select using (user_id = auth.uid());

drop policy if exists lightfunnels_mappings_insert on public.lightfunnels_entity_mappings;
create policy lightfunnels_mappings_insert on public.lightfunnels_entity_mappings
  for insert with check (user_id = auth.uid());

drop policy if exists lightfunnels_mappings_update on public.lightfunnels_entity_mappings;
create policy lightfunnels_mappings_update on public.lightfunnels_entity_mappings
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

commit;

