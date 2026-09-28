-- ============================================================
-- 20260928010000 — Facturation : paramètres, factures, numérotation atomique
-- ------------------------------------------------------------
-- 1) store_invoice_settings : identité commerciale et règles de TVA du store
-- 2) invoice_counters       : compteur annuel par store (jamais exposé)
-- 3) invoices               : facture émise, immuable, snapshot vendeur/client
-- 4) invoice_items          : lignes figées (désignation, quantité, TVA)
-- 5) rpc_issue_invoice / rpc_cancel_invoice : émission et annulation atomiques
--
-- Règles retenues :
--   - une seule facture par commande (store_id, order_id) ;
--   - le numéro est attribué uniquement par rpc_issue_invoice (verrou de ligne) ;
--   - aucune écriture directe sur invoices/invoice_items : RPC exclusivement ;
--   - la suppression d'une commande ne supprime jamais sa facture
--     (order_id passe à null, les snapshots conservent la preuve).
-- ============================================================

-- ---------- Paramètres de facturation du store ----------
create table if not exists public.store_invoice_settings (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null unique references public.stores(id) on delete cascade,
  legal_name text not null default '',
  legal_form text,
  activity text,
  address text,
  city text,
  phone text,
  email text,
  website text,
  ice text,
  if_number text,
  rc_number text,
  tp_number text,
  vat_regime text not null default 'assujetti'
    check (vat_regime in ('assujetti', 'exonere', 'non_assujetti')),
  vat_rate numeric(5, 2) not null default 20
    check (vat_rate >= 0 and vat_rate <= 100),
  prices_include_vat boolean not null default true,
  delivery_taxable boolean not null default false,
  invoice_prefix text not null default 'FAC',
  bank_name text,
  bank_rib text,
  payment_terms text,
  legal_mentions text,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.store_invoice_settings is
  'Mentions légales et règles de TVA utilisées à l''émission des factures d''un store.';

drop trigger if exists set_store_invoice_settings_updated_at on public.store_invoice_settings;
create trigger set_store_invoice_settings_updated_at
  before update on public.store_invoice_settings
  for each row execute function public.handle_updated_at();

-- ---------- Compteur de numérotation (interne) ----------
create table if not exists public.invoice_counters (
  store_id uuid not null references public.stores(id) on delete cascade,
  period_year integer not null,
  last_number integer not null default 0,
  primary key (store_id, period_year)
);

comment on table public.invoice_counters is
  'Compteur de numérotation des factures, par store et par année. Manipulé uniquement par rpc_issue_invoice.';


-- ---------- Factures ----------
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  order_reference text,
  invoice_number text not null,
  invoice_year integer not null,
  sequence_number integer not null,
  status text not null default 'issued' check (status in ('issued', 'cancelled')),
  issue_date date not null default current_date,
  due_date date,
  currency text not null default 'MAD',
  template_version integer not null default 1,
  seller jsonb not null default '{}'::jsonb,
  buyer jsonb not null default '{}'::jsonb,
  payment jsonb not null default '{}'::jsonb,
  order_snapshot jsonb not null default '{}'::jsonb,
  vat_regime text not null default 'assujetti',
  vat_rate numeric(5, 2) not null default 0,
  prices_include_vat boolean not null default true,
  delivery_taxable boolean not null default false,
  items_ttc numeric(12, 2) not null default 0,
  discount_ttc numeric(12, 2) not null default 0,
  shipping_ttc numeric(12, 2) not null default 0,
  total_ht numeric(12, 2) not null default 0,
  total_vat numeric(12, 2) not null default 0,
  total_ttc numeric(12, 2) not null default 0,
  order_total_snapshot numeric(12, 2),
  notes text,
  issued_by uuid references auth.users(id),
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id),
  cancellation_reason text,
  created_at timestamptz not null default now(),
  constraint invoices_store_number_unique unique (store_id, invoice_number),
  constraint invoices_store_order_unique unique (store_id, order_id),
  constraint invoices_amounts_non_negative check (
    items_ttc >= 0 and discount_ttc >= 0 and shipping_ttc >= 0
    and total_ht >= 0 and total_vat >= 0 and total_ttc >= 0
  )
);

comment on table public.invoices is
  'Facture émise depuis une commande. Immuable : création et annulation uniquement via RPC.';

create index if not exists invoices_store_issue_date_idx
  on public.invoices (store_id, issue_date desc, created_at desc);
create index if not exists invoices_order_id_idx
  on public.invoices (order_id);

-- ---------- Lignes de facture ----------
create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  order_item_id uuid,
  product_id uuid,
  line_no integer not null,
  description text not null,
  quantity numeric(12, 2) not null check (quantity > 0),
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  line_gross_ttc numeric(12, 2) not null default 0,
  line_discount_ttc numeric(12, 2) not null default 0,
  line_net_ttc numeric(12, 2) not null default 0,
  line_ht numeric(12, 2) not null default 0,
  line_vat numeric(12, 2) not null default 0,
  vat_rate numeric(5, 2) not null default 0,
  created_at timestamptz not null default now(),
  constraint invoice_items_line_no_unique unique (invoice_id, line_no)
);

comment on table public.invoice_items is
  'Lignes figées d''une facture. Aucun lien fort vers order_items : la commande peut être supprimée.';

create index if not exists invoice_items_invoice_id_idx
  on public.invoice_items (invoice_id, line_no);

-- ---------- Périmètres d'accès ----------
create or replace function public.can_view_store_invoices(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.store_members sm
    where sm.store_id = p_store_id
      and sm.user_id = auth.uid()
      and sm.status = 'active'
      and sm.role in ('owner', 'admin', 'accountant', 'viewer')
  )
  or exists (
    select 1 from public.stores s
    where s.id = p_store_id and s.owner_user_id = auth.uid()
  );
$$;

comment on function public.can_view_store_invoices(uuid) is
  'Vrai si l''utilisateur peut consulter les factures du store : owner, admin, accountant, viewer actif.';

create or replace function public.can_issue_store_invoices(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.store_members sm
    where sm.store_id = p_store_id
      and sm.user_id = auth.uid()
      and sm.status = 'active'
      and sm.role in ('owner', 'admin')
  )
  or exists (
    select 1 from public.stores s
    where s.id = p_store_id and s.owner_user_id = auth.uid()
  );
$$;

comment on function public.can_issue_store_invoices(uuid) is
  'Vrai si l''utilisateur peut émettre une facture ou modifier les paramètres de facturation : owner ou admin actif.';
