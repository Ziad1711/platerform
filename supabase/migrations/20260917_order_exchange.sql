-- ============================================================
-- Échange de colis (Rapid Delivery / Maroc Go Delivery)
-- Ces deux transporteurs n'exposent aucune API d'échange : la demande est
-- faite sur leur plateforme (colis livrés > 3 points > demande d'échange),
-- puis le nouvel ID de colis est rattaché ici à la commande d'origine.
-- ============================================================

alter table public.orders
  add column if not exists exchange_status text null,
  add column if not exists exchange_requested_at timestamptz null,
  add column if not exists exchange_linked_at timestamptz null,
  add column if not exists exchange_new_parcel_key text null,
  add column if not exists exchange_original_order_id uuid null references public.orders(id) on delete set null,
  add column if not exists exchange_replacement_order_id uuid null references public.orders(id) on delete set null;

alter table public.orders drop constraint if exists orders_exchange_status_check;

alter table public.orders
  add constraint orders_exchange_status_check
  check (
    exchange_status is null
    or exchange_status = any (array['requested'::text, 'linked'::text])
  );

-- requested : nouvel ID de colis enregistré, commande de remplacement pas encore créée
-- linked    : commande de remplacement créée et reliée à la commande d'origine
create index if not exists orders_exchange_status_idx
  on public.orders(exchange_status)
  where exchange_status is not null;

create index if not exists orders_exchange_original_order_idx
  on public.orders(exchange_original_order_id)
  where exchange_original_order_id is not null;

create index if not exists orders_exchange_replacement_order_idx
  on public.orders(exchange_replacement_order_id)
  where exchange_replacement_order_id is not null;

-- Une commande livrée engagée dans un échange doit continuer à être suivie :
-- le transporteur la fera passer sur l'état « Retour/Echange » (id 17).
create index if not exists orders_exchange_tracking_idx
  on public.orders(id, exchange_status)
  where exchange_status is not null;
