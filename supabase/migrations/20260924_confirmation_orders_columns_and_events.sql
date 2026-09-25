-- ============================================================
-- Module Confirmation — colonnes opérationnelles + journal des actions
-- (partie 2/4 de la migration 20260924_confirmation_*)
-- ============================================================

-- ---------- 2. Colonnes opérationnelles sur orders ----------

alter table public.orders
  add column if not exists confirmation_attempt_count integer not null default 0,
  add column if not exists next_callback_at timestamptz null,
  add column if not exists confirmation_last_action_at timestamptz null,
  add column if not exists confirmation_last_actor_user_id uuid null,
  add column if not exists cancellation_reason_code text null,
  add column if not exists cancellation_note text null,
  add column if not exists follow_up_4_at timestamptz null,
  add column if not exists follow_up_5_at timestamptz null;

comment on column public.orders.confirmation_attempt_count is
  'Nombre d''appels sans réponse déjà enregistrés par le module de confirmation (0 = aucun appel).';
comment on column public.orders.next_callback_at is
  'Date et heure du prochain rappel programmé par l''agent (action Reporter). NULL = aucun rappel planifié.';

alter table public.orders drop constraint if exists orders_confirmation_attempt_count_check;
alter table public.orders
  add constraint orders_confirmation_attempt_count_check
  check (confirmation_attempt_count >= 0);

alter table public.orders drop constraint if exists orders_cancellation_reason_code_check;
alter table public.orders
  add constraint orders_cancellation_reason_code_check
  check (
    cancellation_reason_code is null
    or cancellation_reason_code = any (
      array[
        'not_interested'::text,
        'price_refused'::text,
        'wrong_number'::text,
        'duplicate_order'::text,
        'product_unavailable'::text,
        'order_error'::text,
        'bought_elsewhere'::text,
        'max_attempts_reached'::text,
        'other'::text
      ]
    )
  );

create index if not exists orders_confirmation_queue_idx
  on public.orders (store_id, status, order_date desc);

create index if not exists orders_next_callback_idx
  on public.orders (store_id, next_callback_at)
  where next_callback_at is not null;

create index if not exists orders_confirmation_attempts_idx
  on public.orders (store_id, confirmation_attempt_count);


-- ---------- 3. Journal immuable des actions de confirmation ----------

create table if not exists public.order_confirmation_events (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  actor_user_id uuid null,
  agent_id uuid null references public.confirmation_agents(id) on delete set null,
  event_type text not null,
  from_status text null,
  to_status text null,
  attempt_number integer null,
  callback_at timestamptz null,
  reason_code text null,
  note text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint order_confirmation_events_type_check check (
    event_type = any (
      array[
        'no_answer'::text,
        'postponed'::text,
        'confirmed'::text,
        'cancelled_manual'::text,
        'cancelled_max_attempts'::text,
        'customer_information_updated'::text,
        'status_corrected'::text,
        'parcel_creation_succeeded'::text,
        'parcel_creation_failed'::text
      ]
    )
  )
);

comment on table public.order_confirmation_events is
  'Journal immuable des actions de confirmation : qui a appelé, quand, combien de fois et pourquoi.';

create index if not exists order_confirmation_events_order_idx
  on public.order_confirmation_events (order_id, created_at desc);

create index if not exists order_confirmation_events_store_idx
  on public.order_confirmation_events (store_id, created_at desc);

create index if not exists order_confirmation_events_type_idx
  on public.order_confirmation_events (store_id, event_type);

alter table public.order_confirmation_events enable row level security;

-- Lecture : membres du store uniquement. Aucune politique d'écriture :
-- les événements sont insérés par la RPC (security definer) ou le client admin.
drop policy if exists order_confirmation_events_select_store_members on public.order_confirmation_events;
create policy order_confirmation_events_select_store_members
on public.order_confirmation_events for select
using (
  exists (
    select 1 from public.store_members sm
    where sm.store_id = order_confirmation_events.store_id
      and sm.user_id = auth.uid()
  )
  or exists (
    select 1 from public.stores s
    where s.id = order_confirmation_events.store_id
      and s.owner_user_id = auth.uid()
  )
);


