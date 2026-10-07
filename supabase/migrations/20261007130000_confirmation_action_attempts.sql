-- ============================================================
-- Module Confirmation — état des tentatives de confirmation
-- ============================================================
-- Une confirmation pilotée en flux (SSE) peut être coupée côté réseau avant
-- d'avoir livré son verdict. Le seul statut de la commande ne suffit pas à
-- trancher : tant que la RPC transactionnelle n'a pas validé, la commande reste
-- « à confirmer » alors que la requête est bel et bien partie. On conserve donc,
-- par tentative, l'identifiant unique fourni par le client et son cycle de vie
-- (en cours / réussie / échouée), ce qui permet de distinguer « pas encore
-- confirmée » de « requête toujours en cours ».

create table if not exists public.confirmation_action_attempts (
  attempt_id uuid primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  actor_user_id uuid null,
  action text not null,
  state text not null default 'in_progress',
  error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint confirmation_action_attempts_state_check
    check (state = any (array['in_progress'::text, 'succeeded'::text, 'failed'::text]))
);

comment on table public.confirmation_action_attempts is
  'Cycle de vie d''une tentative d''action de confirmation, identifiée par le client : distingue une action encore en cours d''une action non appliquée après une coupure réseau.';

create index if not exists confirmation_action_attempts_order_idx
  on public.confirmation_action_attempts (order_id, created_at desc);

alter table public.confirmation_action_attempts enable row level security;

-- Lecture : membres du store pouvant voir la commande concernée. Aucune politique
-- d'écriture : les lignes sont créées et mises à jour par le client admin (service role).
drop policy if exists confirmation_action_attempts_select_store_members on public.confirmation_action_attempts;
create policy confirmation_action_attempts_select_store_members
on public.confirmation_action_attempts for select
using (
  public.can_view_all_store_orders(confirmation_action_attempts.store_id)
  or public.is_order_assigned_to_actor(confirmation_action_attempts.order_id)
);
