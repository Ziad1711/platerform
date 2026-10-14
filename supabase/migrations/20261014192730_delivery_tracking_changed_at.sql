-- ============================================================
-- Suivi livraison : etat consolide (claims, verrous, couverture).
--
-- ETAT APPLIQUE EN BASE (historique reel, 7 migrations) :
--   20261014190504  delivery_tracking_sync
--   20261014191604  delivery_tracking_sync_fix_claim_conflict
--   20261014192119  delivery_tracking_sync_fix_reconcile_no_starvation
--   20261014192557  delivery_tracking_locks
--   20261014192644  delivery_tracking_park_reason_and_coverage
--   20261014192705  delivery_tracking_claim_v4
--   20261014192730  delivery_tracking_changed_at
-- CORRECTIFS APPLIQUES ENSUITE (voir l'historique distant ; non repris
-- ci-dessous) : delivery_tracking_coverage_v2, delivery_tracking_finish_claim_rpc,
-- delivery_tracking_finish_without_claim.
--   * couverture v2 : classification EXCLUSIVE par commande
--     (excluded / untracked / active / unresolved / fresh / stale) — corrige le
--     faux « non resolu » d'une commande pourtant suivie avec succes ;
--   * RPC `finish_delivery_tracking_claim` : finalisation ATOMIQUE commande +
--     claim (version `updated_at`, source manuelle, dates jamais reecrites,
--     echange complete seulement s'il est encore actif, conflit explicite) ;
--   * mode sans claim pour le suivi manuel d'un seul colis depuis l'UI.
-- Ces fonctions sont les contrats reellement utilises par
-- `lib/integrations/delivery/*` : toute reinstallation doit les inclure.

--
-- DEVIATION ASSUMEE : ce fichier est la CONSOLIDATION des 7 migrations
-- ci-dessus (version = la derniere). Les 6 premieres ne sont pas
-- representees une a une, donc les couples version/nom locaux ne
-- correspondent pas 1:1 a l'historique distant. Consequence : `supabase db
-- push` est un no-op (la seule version locale existe deja en base), mais il
-- faut recreer les 6 fichiers manquants si l'invariant « local == distant »
-- doit etre retabli.
--
-- Ce que garantit ce module :
--  * une seule execution a la fois PAR COMPTE TRANSPORTEUR (bail SQL) ;
--  * un verrou par colis avec expiration recuperable apres crash ;
--  * une couverture comptee sur les COMMANDES eligibles (pas sur les claims),
--    donc « complet » n'est jamais annonce a tort ;
--  * un motif d'attente explicite : une correction manuelle ou un statut
--    illisible n'est jamais presente comme traite ;
--  * aucune lecture inter-store : chaque requete filtre store + transporteur ;
--  * privileges minimaux : `anon` et `authenticated` ne peuvent rien executer.
--
-- ACTIVATION DE L'ORDONNANCEUR (a faire APRES deploiement de la route) :
--   create extension if not exists pg_cron;
--   create extension if not exists pg_net with schema extensions;
--   select vault.create_secret('<CRON_SECRET>', 'delivery_tracking_cron_secret');
--   select cron.schedule('delivery-tracking-sync', '*/5 * * * *', $cron$
--     select net.http_get(
--       url := 'https://jisra.io/api/cron/delivery-tracking-sync',
--       headers := jsonb_build_object('Authorization',
--         'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
--                        where name = 'delivery_tracking_cron_secret'))
--     );
--   $cron$);
-- ============================================================

-- ------------------------------------------------------------
-- 1. Claims (un par commande suivie)
-- ------------------------------------------------------------
create table if not exists public.delivery_tracking_claims (
  order_id uuid primary key references public.orders(id) on delete cascade,
  store_id uuid not null,
  provider text not null,
  tracking_key text not null,
  locked_at timestamptz,
  locked_by text,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  last_synced_at timestamptz,
  last_outcome text,
  last_error text,
  park_reason text,
  updated_at timestamptz not null default now(),
  constraint delivery_tracking_claims_outcome_check
    check (last_outcome is null or last_outcome in ('applied','unchanged','skipped','failed')),
  constraint delivery_tracking_claims_attempts_check check (attempts >= 0),
  constraint delivery_tracking_claims_park_reason_check
    check (park_reason is null or park_reason in ('manual','terminal','unrecognized','stale'))
);

create index if not exists delivery_tracking_claims_queue_idx
  on public.delivery_tracking_claims (store_id, provider, next_attempt_at, last_synced_at);
create index if not exists delivery_tracking_claims_lease_idx
  on public.delivery_tracking_claims (locked_at) where locked_at is not null;
create index if not exists delivery_tracking_claims_park_idx
  on public.delivery_tracking_claims (store_id, provider, park_reason);

-- ------------------------------------------------------------
-- 2. Etat observable par (store, transporteur)
-- ------------------------------------------------------------
create table if not exists public.delivery_tracking_state (
  store_id uuid not null references public.stores(id) on delete cascade,
  provider text not null,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_complete_at timestamptz,
  last_changed_at timestamptz,
  last_outcome text,
  last_error text,
  processed integer not null default 0,
  changed integer not null default 0,
  skipped integer not null default 0,
  failed integer not null default 0,
  remaining integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (store_id, provider),
  constraint delivery_tracking_state_outcome_check
    check (last_outcome is null or last_outcome in ('complete','partial','failed'))
);

-- ------------------------------------------------------------
-- 3. Verrou par compte transporteur
-- ------------------------------------------------------------
create table if not exists public.delivery_tracking_locks (
  integration_id uuid primary key references public.integrations(id) on delete cascade,
  store_id uuid not null,
  provider text not null,
  locked_by text,
  locked_at timestamptz,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);


-- ------------------------------------------------------------
-- 4. RLS : lecture par les membres ACTIFS du store, ecriture service_role
-- ------------------------------------------------------------
alter table public.delivery_tracking_claims enable row level security;
alter table public.delivery_tracking_state enable row level security;
alter table public.delivery_tracking_locks enable row level security;

drop policy if exists delivery_tracking_claims_store_select on public.delivery_tracking_claims;
create policy delivery_tracking_claims_store_select
on public.delivery_tracking_claims for select
using (store_id in (
  select store_id from public.store_members where user_id = auth.uid() and status = 'active'
));

drop policy if exists delivery_tracking_claims_service_role on public.delivery_tracking_claims;
create policy delivery_tracking_claims_service_role
on public.delivery_tracking_claims for all to service_role using (true) with check (true);

drop policy if exists delivery_tracking_state_store_select on public.delivery_tracking_state;
create policy delivery_tracking_state_store_select
on public.delivery_tracking_state for select
using (store_id in (
  select store_id from public.store_members where user_id = auth.uid() and status = 'active'
));

drop policy if exists delivery_tracking_state_service_role on public.delivery_tracking_state;
create policy delivery_tracking_state_service_role
on public.delivery_tracking_state for all to service_role using (true) with check (true);

drop policy if exists delivery_tracking_locks_store_select on public.delivery_tracking_locks;
create policy delivery_tracking_locks_store_select
on public.delivery_tracking_locks for select
using (store_id in (
  select store_id from public.store_members where user_id = auth.uid() and status = 'active'
));

drop policy if exists delivery_tracking_locks_service_role on public.delivery_tracking_locks;
create policy delivery_tracking_locks_service_role
on public.delivery_tracking_locks for all to service_role using (true) with check (true);

-- ------------------------------------------------------------
-- 5. Bail par compte transporteur : acquisition / liberation atomiques
-- ------------------------------------------------------------
create or replace function public.acquire_delivery_tracking_lock(
  p_integration_id uuid,
  p_store_id uuid,
  p_provider text,
  p_worker text,
  p_ttl_seconds integer default 180
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ttl integer := greatest(30, least(coalesce(p_ttl_seconds, 180), 3600));
  v_rows integer := 0;
begin
  if p_integration_id is null then
    raise exception 'INTEGRATION_REQUIRED' using errcode = '22023';
  end if;

  insert into public.delivery_tracking_locks as l (
    integration_id, store_id, provider, locked_by, locked_at, expires_at, updated_at
  )
  values (
    p_integration_id, p_store_id, p_provider, p_worker, now(),
    now() + make_interval(secs => v_ttl), now()
  )
  on conflict (integration_id) do update
    set locked_by = excluded.locked_by,
        locked_at = now(),
        expires_at = excluded.expires_at,
        updated_at = now()
    where l.expires_at is null or l.expires_at <= now();

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

create or replace function public.release_delivery_tracking_lock(
  p_integration_id uuid,
  p_worker text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer := 0;
begin
  update public.delivery_tracking_locks
  set locked_by = null, locked_at = null, expires_at = now(), updated_at = now()
  where integration_id = p_integration_id and locked_by = p_worker;

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on function public.acquire_delivery_tracking_lock(uuid, uuid, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.acquire_delivery_tracking_lock(uuid, uuid, text, text, integer)
  to service_role;

revoke all on function public.release_delivery_tracking_lock(uuid, text)
  from public, anon, authenticated;
grant execute on function public.release_delivery_tracking_lock(uuid, text)
  to service_role;

-- ------------------------------------------------------------
-- 6. Couverture reelle : comptee sur les COMMANDES eligibles.
--    complete <=> pending = 0 (une erreur ne devient jamais « zero restant »).
-- ------------------------------------------------------------
create or replace function public.delivery_tracking_coverage(
  p_store_id uuid,
  p_provider text,
  p_tracking_column text,
  p_delivery_company_ids uuid[],
  p_excluded_statuses text[],
  p_exchange_active_statuses text[],
  p_fresh_seconds integer default 900,
  p_lease_seconds integer default 180
) returns table (
  eligible integer, noop integer, pending integer, ready integer, backoff integer,
  blocked integer, unrecognized integer, locked integer, never_synced integer,
  fresh integer, oldest_pending_synced_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed_columns text[] := array[
    'tracking_number','rapid_delivery_parcel_key','maroc_go_delivery_parcel_key',
    'rushliv_parcel_key','ameex_parcel_code','sendit_parcel_code',
    'forcelog_parcel_key','digylog_tracking'
  ];
  v_fresh integer := greatest(60, coalesce(p_fresh_seconds, 900));
  v_lease integer := greatest(30, least(coalesce(p_lease_seconds, 180), 1800));
begin
  if p_store_id is null then
    raise exception 'STORE_REQUIRED' using errcode = '22023';
  end if;
  if not (p_tracking_column = any(v_allowed_columns)) then
    raise exception 'INVALID_TRACKING_COLUMN' using errcode = '22023';
  end if;
  if p_delivery_company_ids is null or coalesce(array_length(p_delivery_company_ids, 1), 0) = 0 then
    return query select 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, null::timestamptz;
    return;
  end if;

  return query
  with eligible as (
    select o.id as order_id,
           btrim(coalesce(to_jsonb(o) ->> p_tracking_column, '')) as tracking_key
    from public.orders o
    where o.store_id = p_store_id
      and o.delivery_company_id = any(p_delivery_company_ids)
      and o.delivery_status_source is distinct from 'manual'
      and (
        not (coalesce(o.status, '') = any(coalesce(p_excluded_statuses, '{}'::text[])))
        or coalesce(o.exchange_status, '') = any(coalesce(p_exchange_active_statuses, '{}'::text[]))
        or (o.exchange_original_order_id is not null and o.status = 'confirmed')
      )
  ),
  joined as (
    select e.order_id, coalesce(c.attempts, 0) as attempts, c.next_attempt_at,
           c.locked_at, c.last_synced_at, c.park_reason
    from eligible e
    left join public.delivery_tracking_claims c
      on c.order_id = e.order_id and c.provider = p_provider
    where e.tracking_key <> ''
  ),
  classified as (
    select j.*,
           coalesce(j.park_reason in ('manual', 'terminal'), false) as is_noop,
           (j.park_reason is null or j.park_reason in ('unrecognized', 'stale')) as is_pending,
           (j.locked_at is not null and j.locked_at >= now() - make_interval(secs => v_lease)) as is_locked,
           (j.next_attempt_at is null or j.next_attempt_at <= now()) as is_due
    from joined j
  )
  select
    count(*)::integer,
    count(*) filter (where c.is_noop)::integer,
    count(*) filter (where c.is_pending)::integer,
    count(*) filter (where c.is_pending and c.is_due and not c.is_locked)::integer,
    count(*) filter (where c.is_pending and not c.is_due and c.attempts between 1 and 2)::integer,
    count(*) filter (where c.is_pending and c.attempts >= 3)::integer,
    count(*) filter (where c.park_reason = 'unrecognized')::integer,
    count(*) filter (where c.is_locked)::integer,
    count(*) filter (where c.last_synced_at is null)::integer,
    count(*) filter (
      where c.last_synced_at is not null
        and c.last_synced_at > now() - make_interval(secs => v_fresh)
    )::integer,
    min(c.last_synced_at) filter (where c.is_pending and c.is_due)
  from classified c;
end;
$$;

revoke all on function public.delivery_tracking_coverage(
  uuid, text, text, uuid[], text[], text[], integer, integer
) from public, anon, authenticated;
grant execute on function public.delivery_tracking_coverage(
  uuid, text, text, uuid[], text[], text[], integer, integer
) to service_role;


-- ------------------------------------------------------------
-- 7. Claim v4 : lot borne + ligne complete de la commande (dates metier et
--    version `updated_at` pour l'ecriture conditionnelle).
--    - `order_row` : to_jsonb(o), l'application dispose de la verite terrain ;
--    - `park_reason <> 'manual'` : une correction humaine n'est plus reprise ;
--    - pas de plafond d'essais : le rythme est pilote par `next_attempt_at`.
-- ------------------------------------------------------------
create or replace function public.claim_delivery_tracking_batch(
  p_store_id uuid,
  p_provider text,
  p_tracking_column text,
  p_delivery_company_ids uuid[],
  p_excluded_statuses text[],
  p_exchange_active_statuses text[],
  p_limit integer default 20,
  p_lease_seconds integer default 180,
  p_worker text default 'system'
) returns table (
  order_id uuid, store_id uuid, provider text, tracking_key text, status text,
  delivery_status text, delivery_status_source text, exchange_status text,
  exchange_original_order_id uuid, attempts integer, park_reason text,
  claimed_at timestamptz, order_row jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed_columns text[] := array[
    'tracking_number','rapid_delivery_parcel_key','maroc_go_delivery_parcel_key',
    'rushliv_parcel_key','ameex_parcel_code','sendit_parcel_code',
    'forcelog_parcel_key','digylog_tracking'
  ];
  v_scan_limit constant integer := 1000;
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 50));
  v_lease integer := greatest(30, least(coalesce(p_lease_seconds, 180), 1800));
begin
  if p_store_id is null then
    raise exception 'STORE_REQUIRED' using errcode = '22023';
  end if;
  if p_provider is null or btrim(p_provider) = '' then
    raise exception 'PROVIDER_REQUIRED' using errcode = '22023';
  end if;
  if not (p_tracking_column = any(v_allowed_columns)) then
    raise exception 'INVALID_TRACKING_COLUMN' using errcode = '22023';
  end if;
  if p_delivery_company_ids is null or coalesce(array_length(p_delivery_company_ids, 1), 0) = 0 then
    return;
  end if;

  insert into public.delivery_tracking_claims as c (order_id, store_id, provider, tracking_key)
  select src.id, src.store_id, p_provider, src.tracking_key
  from (
    select o.id, o.store_id,
           btrim(coalesce(to_jsonb(o) ->> p_tracking_column, '')) as tracking_key,
           o.last_delivery_sync_at, o.status, o.exchange_status,
           o.exchange_original_order_id, o.delivery_company_id
    from public.orders o
    where o.store_id = p_store_id
      and o.delivery_company_id = any(p_delivery_company_ids)
      and o.delivery_status_source is distinct from 'manual'
  ) src
  where src.tracking_key <> ''
    and (
      not (coalesce(src.status, '') = any(coalesce(p_excluded_statuses, '{}'::text[])))
      or coalesce(src.exchange_status, '') = any(coalesce(p_exchange_active_statuses, '{}'::text[]))
      or (src.exchange_original_order_id is not null and src.status = 'confirmed')
    )
    and (
      not exists (select 1 from public.delivery_tracking_claims k where k.order_id = src.id)
      or exists (
        select 1 from public.delivery_tracking_claims k
        where k.order_id = src.id and k.tracking_key is distinct from src.tracking_key
      )
    )
  order by src.last_delivery_sync_at asc nulls first, src.id asc
  limit v_scan_limit
  on conflict on constraint delivery_tracking_claims_pkey do update
    set store_id = excluded.store_id,
        provider = excluded.provider,
        tracking_key = excluded.tracking_key,
        attempts = 0,
        next_attempt_at = now(),
        park_reason = null,
        last_error = null,
        updated_at = now()
    where c.tracking_key is distinct from excluded.tracking_key;

  return query
  with picked as (
    select c.order_id as id
    from public.delivery_tracking_claims c
    join public.orders o on o.id = c.order_id
    where c.store_id = p_store_id
      and c.provider = p_provider
      and c.next_attempt_at <= now()
      and (c.locked_at is null or c.locked_at < now() - make_interval(secs => v_lease))
      and (c.park_reason is null or c.park_reason <> 'manual')
      and o.store_id = p_store_id
      and o.delivery_company_id = any(p_delivery_company_ids)
      and o.delivery_status_source is distinct from 'manual'
      and btrim(coalesce(to_jsonb(o) ->> p_tracking_column, '')) <> ''
      and (
        not (coalesce(o.status, '') = any(coalesce(p_excluded_statuses, '{}'::text[])))
        or coalesce(o.exchange_status, '') = any(coalesce(p_exchange_active_statuses, '{}'::text[]))
        or (o.exchange_original_order_id is not null and o.status = 'confirmed')
      )
    order by c.last_synced_at asc nulls first, c.next_attempt_at asc, c.order_id asc
    limit v_limit
    for update of c skip locked
  )
  update public.delivery_tracking_claims c
  set locked_at = now(), locked_by = p_worker, last_attempt_at = now(), updated_at = now()
  from picked, public.orders o
  where c.order_id = picked.id and o.id = c.order_id
  returning
    o.id, o.store_id, p_provider, c.tracking_key, o.status, o.delivery_status,
    o.delivery_status_source, o.exchange_status, o.exchange_original_order_id,
    c.attempts, c.park_reason, c.locked_at, to_jsonb(o);
end;
$$;

revoke all on function public.claim_delivery_tracking_batch(
  uuid, text, text, uuid[], text[], text[], integer, integer, text
) from public, anon, authenticated;
grant execute on function public.claim_delivery_tracking_batch(
  uuid, text, text, uuid[], text[], text[], integer, integer, text
) to service_role;

