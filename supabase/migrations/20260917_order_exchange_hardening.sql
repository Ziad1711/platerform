-- ============================================================
-- Échange de colis : durcissement
-- 1. autorise source = 'exchange' pour la commande de remplacement
-- 2. ajoute les états completed / cancelled
-- 3. garantit un seul remplacement par origine et un seul usage du nouvel ID
-- ============================================================

alter table public.orders drop constraint if exists orders_source_check;

alter table public.orders
  add constraint orders_source_check
  check (
    source = any (array['organic'::text, 'ads'::text, 'recommendation'::text, 'exchange'::text])
  );

alter table public.orders drop constraint if exists orders_exchange_status_check;

alter table public.orders
  add constraint orders_exchange_status_check
  check (
    exchange_status is null
    or exchange_status = any (array['requested'::text, 'linked'::text, 'completed'::text, 'cancelled'::text])
  );

alter table public.orders
  add column if not exists exchange_completed_at timestamptz null;

-- Une seule commande de remplacement par commande d'origine : rend la
-- création idempotente même en cas de double clic ou de requêtes concurrentes.
create unique index if not exists orders_exchange_replacement_unique
  on public.orders(exchange_original_order_id)
  where exchange_original_order_id is not null;

-- Un nouvel ID de colis ne peut être rattaché qu'à un seul échange.
create unique index if not exists orders_exchange_new_parcel_key_unique
  on public.orders(exchange_new_parcel_key)
  where exchange_new_parcel_key is not null;
