-- ============================================================================
-- 03b — Registre d'idempotence v2 (états, bail, jeton de tentative, compteurs)
-- PROPOSITION — ne pas exécuter sans docs/assistant/sql/RUNBOOK.md
--
-- Remplace 03_assistant_idempotency_guard (conservé pour historique seulement).
-- Rejouable : oui (create table/column if not exists, drop function if exists
-- avant chaque création — indispensable car le type de retour change).
-- Prérequis : 01 → 02.
--
-- Contrat consommé par lib/assistant/idempotency.ts :
--   begin(p_request_id, p_store_id, p_thread_id, p_fingerprint)
--     -> (state, attempt_token, thread_id, assistant_message_id, credit_status)
--   bind(p_request_id, p_attempt_token, p_thread_id) -> void
--   complete(p_user_id, p_request_id, p_attempt_token, p_assistant_message_id,
--            p_credit_status, p_credits_consumed, p_credits_charged) -> void
--   fail(p_request_id, p_attempt_token, p_reason) -> void
--   reserve(p_request_id, p_attempt_token, p_credits) -> void
--   release(p_request_id, p_attempt_token) -> void
--
-- Colonnes de crédits, sémantique stricte :
--   credits_reserved : estimation informative de la tentative (JAMAIS un
--                      verrou de solde, jamais le montant débité) ;
--   credits_consumed : consommation RÉELLE calculée sur les tokens ;
--   credits_charged  : montant RÉELLEMENT débité (0 si non facturé).
--
-- ## Ordre de verrouillage (global, aucune exception)
--   1. profiles (FOR KEY SHARE)   2. stores (FOR KEY SHARE)
--   3. chat_threads (FOR UPDATE)  4. assistant_requests (FOR UPDATE)
--   5. ai_credit_wallets (FOR UPDATE, via sync_ai_credit_wallet_for_plan)
--   6. écritures (chat_messages, ai_usage)
-- `reserve`/`release`/`fail` s'arrêtent à l'étape 4 : ils n'ajoutent jamais de
-- verrou antérieur et ne peuvent donc pas fermer de cycle. Toute nouvelle
-- fonction doit respecter cet ordre, sinon un cycle conversation ↔ registre
-- (suppression de conversation, cascades) devient possible.
--
-- ## Horloge des baux
--   `now()` est l'heure de DÉBUT de transaction : inutilisable pour un bail
--   quand un appel attend un verrou. Tous les baux utilisent
--   `clock_timestamp()` et sont évalués APRÈS acquisition des verrous.
--   Frontière unique : bail valide si `lease_until > clock_timestamp()`.
-- ============================================================================
begin;


-- ---------------------------------------------------------------------------
-- 1. Table du registre (+ mise à niveau d'une table issue de 03)
--
-- Conservation des preuves : `store_id` est NULLABLE et détaché
-- (`ON DELETE SET NULL`) à la suppression d'une boutique. Une cascade
-- supprimerait la mémoire d'idempotence (clé `(user_id, request_id)`) et la
-- trace des crédits consommés/débités de ces requêtes. Aucun débit
-- supplémentaire n'est possible en cas de détachement : `begin`, `reserve` et
-- `complete` refusent toute boutique inexistante (`FORBIDDEN_STORE`) et
-- `complete` refuse explicitement une ligne détachée.
-- ---------------------------------------------------------------------------
create table if not exists public.assistant_requests (
  user_id              uuid        not null references public.profiles(id) on delete cascade,
  request_id           text        not null check (char_length(request_id) between 8 and 100),
  store_id             uuid        references public.stores(id) on delete set null,
  thread_id            uuid        references public.chat_threads(id) on delete set null,
  fingerprint          text        not null check (char_length(fingerprint) = 64),
  state                text        not null default 'in_progress'
                                   check (state in ('in_progress','completed','failed')),
  attempt_token        uuid        not null default gen_random_uuid(),
  lease_until          timestamptz not null default (clock_timestamp() + interval '2 minutes'),
  assistant_message_id uuid        references public.chat_messages(id) on delete set null,
  credit_status        text        not null default 'not_charged'
                                   check (credit_status in ('charged','insufficient','failed','not_charged')),
  credits_reserved     integer     not null default 0 check (credits_reserved >= 0),
  credits_consumed     integer     not null default 0 check (credits_consumed >= 0),
  credits_charged      integer     not null default 0 check (credits_charged >= 0),
  last_error           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  primary key (user_id, request_id)
);

-- Mise à niveau idempotente d'une table créée par l'ancien 03.
alter table public.assistant_requests add column if not exists attempt_token uuid;
alter table public.assistant_requests add column if not exists credit_status text;
alter table public.assistant_requests add column if not exists credits_consumed integer;

update public.assistant_requests r
   set attempt_token = coalesce(r.attempt_token, gen_random_uuid()),
       credit_status = coalesce(r.credit_status, 'not_charged'),
       credits_consumed = coalesce(r.credits_consumed, 0)
 where r.attempt_token is null
    or r.credit_status is null
    or r.credits_consumed is null;

alter table public.assistant_requests alter column attempt_token set default gen_random_uuid();
alter table public.assistant_requests alter column attempt_token set not null;
alter table public.assistant_requests alter column credit_status set default 'not_charged';
alter table public.assistant_requests alter column credit_status set not null;
alter table public.assistant_requests alter column credits_consumed set default 0;
alter table public.assistant_requests alter column credits_consumed set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'assistant_requests_credits_consumed_check'
       and conrelid = 'public.assistant_requests'::regclass
  ) then
    alter table public.assistant_requests
      add constraint assistant_requests_credits_consumed_check
      check (credits_consumed >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'assistant_requests_credit_status_check'
       and conrelid = 'public.assistant_requests'::regclass
  ) then
    update public.assistant_requests
       set credit_status = 'not_charged'
     where credit_status not in ('charged','insufficient','failed','not_charged');
    alter table public.assistant_requests
      add constraint assistant_requests_credit_status_check
      check (credit_status in ('charged','insufficient','failed','not_charged'));
  end if;
end;
$$;

create index if not exists assistant_requests_lease_idx
  on public.assistant_requests (lease_until)
  where state = 'in_progress';
create index if not exists assistant_requests_thread_idx
  on public.assistant_requests (thread_id);

-- Mise à niveau d'une table déjà créée (03b antérieur ou 03) : le détachement
-- remplace la cascade, et la colonne devient nullable. Rejouable.
alter table public.assistant_requests alter column store_id drop not null;

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.assistant_requests'::regclass
       and contype = 'f'
       and conname = 'assistant_requests_store_id_fkey'
       and confdeltype <> 'n'
  ) then
    alter table public.assistant_requests drop constraint assistant_requests_store_id_fkey;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.assistant_requests'::regclass
       and contype = 'f'
       and conname = 'assistant_requests_store_id_fkey'
  ) then
    alter table public.assistant_requests
      add constraint assistant_requests_store_id_fkey
      foreign key (store_id) references public.stores(id) on delete set null;
  end if;
end;
$$;

alter table public.assistant_requests enable row level security;
revoke all on public.assistant_requests from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Helpers internes (verrouillage ordonné, bail)
-- ---------------------------------------------------------------------------
create or replace function public.assistant_lease_interval()
returns interval
language sql
immutable
set search_path = pg_temp
as $$
  select interval '2 minutes';
$$;

-- Verrouille l'identité AVANT toute autre ressource : rend l'ordre
-- profiles → stores → conversation → registre → portefeuille identique aux
-- cascades de suppression de compte/boutique.
create or replace function public.assistant_lock_identity(
  p_user_id uuid,
  p_store_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform 1 from public.profiles p where p.id = p_user_id for key share;
  if not found then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform 1 from public.stores s where s.id = p_store_id for key share;
  if not found then
    raise exception 'STORE_NOT_FOUND' using errcode = 'P0001';
  end if;
end;
$$;

-- Verrouille et rend la conversation ; propriétaire vérifié ici, boutique
-- vérifiée par l'appelant (message d'erreur distinct).
create or replace function public.assistant_lock_thread(
  p_thread_id uuid,
  p_user_id uuid
)
returns public.chat_threads
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_thread public.chat_threads;
begin
  if p_thread_id is null then
    raise exception 'THREAD_NOT_FOUND' using errcode = 'P0001';
  end if;

  select * into v_thread
    from public.chat_threads ct
   where ct.id = p_thread_id
   for update;

  if not found or v_thread.user_id is distinct from p_user_id then
    raise exception 'THREAD_NOT_FOUND' using errcode = 'P0001';
  end if;

  return v_thread;
end;
$$;

revoke all on function public.assistant_lease_interval() from public, anon, authenticated;
revoke all on function public.assistant_lock_identity(uuid, uuid) from public, anon, authenticated;
revoke all on function public.assistant_lock_thread(uuid, uuid) from public, anon, authenticated;
grant execute on function public.assistant_lease_interval() to service_role;
grant execute on function public.assistant_lock_identity(uuid, uuid) to service_role;
grant execute on function public.assistant_lock_thread(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Retrait des signatures héritées (changement de type de retour/surcharge)
-- ---------------------------------------------------------------------------
drop function if exists public.rpc_assistant_begin_request(text, uuid, uuid, text);
drop function if exists public.rpc_assistant_bind_request_thread(text, uuid, uuid);
drop function if exists public.rpc_assistant_complete_request(text, uuid, integer);
drop function if exists public.rpc_assistant_complete_request(uuid, text, uuid, uuid, text);
drop function if exists public.rpc_assistant_fail_request(text, text);
drop function if exists public.rpc_assistant_fail_request(text, uuid, text);
drop function if exists public.rpc_assistant_reserve_credits(text, integer);
drop function if exists public.rpc_assistant_reserve_credits(text, uuid, integer);
drop function if exists public.rpc_assistant_release_credits(text);
drop function if exists public.rpc_assistant_release_credits(text, uuid);

-- ---------------------------------------------------------------------------
-- 4. begin — acquisition / reprise / rejeu
-- ---------------------------------------------------------------------------
create or replace function public.rpc_assistant_begin_request(
  p_request_id text,
  p_store_id uuid,
  p_thread_id uuid,
  p_fingerprint text
)
returns table (
  state text,
  attempt_token uuid,
  thread_id uuid,
  assistant_message_id uuid,
  credit_status text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_user uuid := auth.uid();
  v_row public.assistant_requests;
  v_thread public.chat_threads;
  v_inserted boolean := false;
  v_now timestamptz;
begin
  if v_user is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;
  if p_request_id is null
     or char_length(p_request_id) < 8
     or char_length(p_request_id) > 100 then
    raise exception 'INVALID_REQUEST_ID' using errcode = 'P0001';
  end if;
  if p_fingerprint is null or char_length(p_fingerprint) <> 64 then
    raise exception 'INVALID_FINGERPRINT' using errcode = 'P0001';
  end if;

  -- Ordre global : identité → conversation → registre.
  perform public.assistant_lock_identity(v_user, p_store_id);

  if not public.assistant_can_use_store(p_store_id, v_user) then
    raise exception 'FORBIDDEN_STORE' using errcode = 'P0001';
  end if;

  if p_thread_id is not null then
    v_thread := public.assistant_lock_thread(p_thread_id, v_user);
    if v_thread.store_id is distinct from p_store_id then
      raise exception 'THREAD_STORE_MISMATCH' using errcode = 'P0001';
    end if;
  end if;

  insert into public.assistant_requests (
    user_id, request_id, store_id, thread_id, fingerprint, lease_until
  )
  values (
    v_user, p_request_id, p_store_id, p_thread_id, p_fingerprint,
    clock_timestamp() + public.assistant_lease_interval()
  )
  on conflict (user_id, request_id) do nothing;

  v_inserted := found;

  select * into v_row
    from public.assistant_requests r
   where r.user_id = v_user and r.request_id = p_request_id
   for update;

  if not found then
    raise exception 'IDEMPOTENCY_LEASE_LOST' using errcode = 'P0001';
  end if;

  -- Conflit d'empreinte ou de périmètre : ce n'est pas un rejeu.
  -- Comparaison NULL-safe : une ligne détachée (boutique supprimée) est un
  -- conflit explicite, jamais un rejeu silencieux.
  if v_row.fingerprint <> p_fingerprint
     or v_row.store_id is distinct from p_store_id
     or (v_row.thread_id is not null
         and p_thread_id is not null
         and v_row.thread_id <> p_thread_id) then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
  end if;

  -- Rejeu d'une requête finalisée : aucune rotation de jeton, bail inchangé.
  if v_row.state = 'completed' then
    return query
      select 'completed'::text, v_row.attempt_token, v_row.thread_id,
             v_row.assistant_message_id, v_row.credit_status;
    return;
  end if;

  -- Bail évalué à l'horloge réelle, après acquisition du verrou registre.
  v_now := clock_timestamp();

  if not v_inserted and v_row.state = 'in_progress' and v_row.lease_until > v_now then
    raise exception 'IDEMPOTENCY_IN_PROGRESS' using errcode = 'P0001';
  end if;

  update public.assistant_requests r
     set state = 'in_progress',
         attempt_token = gen_random_uuid(),
         lease_until = v_now + public.assistant_lease_interval(),
         thread_id = coalesce(r.thread_id, p_thread_id),
         assistant_message_id = null,
         credit_status = 'not_charged',
         credits_reserved = 0,
         credits_consumed = 0,
         credits_charged = 0,
         last_error = null,
         updated_at = v_now
   where r.user_id = v_user and r.request_id = p_request_id
   returning * into v_row;

  return query
    select 'in_progress'::text, v_row.attempt_token, v_row.thread_id,
           v_row.assistant_message_id, v_row.credit_status;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. bind — liaison de la conversation créée après acquisition
-- ---------------------------------------------------------------------------
create or replace function public.rpc_assistant_bind_request_thread(
  p_request_id text,
  p_attempt_token uuid,
  p_thread_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_row public.assistant_requests;
  v_thread public.chat_threads;
  v_now timestamptz;
begin
  if v_user is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;
  if p_attempt_token is null then
    raise exception 'IDEMPOTENCY_TOKEN_MISMATCH' using errcode = 'P0001';
  end if;

  -- Lecture sans verrou uniquement pour connaître la boutique : l'ordre de
  -- verrouillage reste identité → conversation → registre.
  select * into v_row
    from public.assistant_requests r
   where r.user_id = v_user and r.request_id = p_request_id;

  if not found then
    raise exception 'IDEMPOTENCY_TOKEN_MISMATCH' using errcode = 'P0001';
  end if;

  perform public.assistant_lock_identity(v_user, v_row.store_id);

  v_thread := public.assistant_lock_thread(p_thread_id, v_user);
  if v_thread.store_id is distinct from v_row.store_id then
    raise exception 'THREAD_STORE_MISMATCH' using errcode = 'P0001';
  end if;

  select * into v_row
    from public.assistant_requests r
   where r.user_id = v_user and r.request_id = p_request_id
   for update;

  if not found
     or v_row.attempt_token is distinct from p_attempt_token
     or v_row.state <> 'in_progress' then
    raise exception 'IDEMPOTENCY_TOKEN_MISMATCH' using errcode = 'P0001';
  end if;

  v_now := clock_timestamp();

  if v_row.lease_until <= v_now then
    raise exception 'IDEMPOTENCY_LEASE_LOST' using errcode = 'P0001';
  end if;

  if v_row.thread_id is not null and v_row.thread_id <> p_thread_id then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
  end if;

  if not public.assistant_can_use_store(v_row.store_id, v_user) then
    raise exception 'FORBIDDEN_STORE' using errcode = 'P0001';
  end if;

  update public.assistant_requests r
     set thread_id = p_thread_id,
         updated_at = v_now
   where r.user_id = v_user
     and r.request_id = p_request_id
     and r.attempt_token = p_attempt_token
     and r.state = 'in_progress'
     and r.lease_until > v_now;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. complete — clôture nominale, réservée au backend (`service_role`)
--    Identité explicite, jeton, état, bail, conversation et message vérifiés.
-- ---------------------------------------------------------------------------
create or replace function public.rpc_assistant_complete_request(
  p_user_id uuid,
  p_request_id text,
  p_attempt_token uuid,
  p_assistant_message_id uuid,
  p_credit_status text,
  p_credits_consumed integer,
  p_credits_charged integer
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.assistant_requests;
  v_thread public.chat_threads;
  v_message public.chat_messages;
  v_consumed integer := greatest(0, coalesce(p_credits_consumed, 0));
  v_charged integer := greatest(0, coalesce(p_credits_charged, 0));
  v_now timestamptz;
begin
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;
  if p_credit_status not in ('charged','insufficient','failed','not_charged') then
    raise exception 'INVALID_CREDIT_STATUS' using errcode = 'P0001';
  end if;
  if p_attempt_token is null then
    raise exception 'IDEMPOTENCY_TOKEN_MISMATCH' using errcode = 'P0001';
  end if;
  if v_charged > v_consumed then
    raise exception 'INVALID_CREDITS' using errcode = 'P0001';
  end if;
  if p_credit_status = 'charged' and v_charged <> v_consumed then
    raise exception 'INVALID_CREDITS' using errcode = 'P0001';
  end if;
  if p_credit_status <> 'charged' and v_charged <> 0 then
    raise exception 'INVALID_CREDIT_STATUS' using errcode = 'P0001';
  end if;

  select * into v_row
    from public.assistant_requests r
   where r.user_id = p_user_id and r.request_id = p_request_id;

  if not found then
    raise exception 'IDEMPOTENCY_TOKEN_MISMATCH' using errcode = 'P0001';
  end if;

  -- Clôture déjà faite : opération idempotente, aucune valeur écrasée.
  if v_row.state = 'completed' then
    return;
  end if;
  if v_row.thread_id is null then
    raise exception 'THREAD_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Ligne détachée (boutique supprimée pendant la requête) : aucune clôture
  -- facturable n'est écrite sans boutique existante. Fermé, jamais rejoué.
  if v_row.store_id is null then
    raise exception 'IDEMPOTENCY_STORE_DETACHED' using errcode = 'P0001';
  end if;

  perform public.assistant_lock_identity(p_user_id, v_row.store_id);
  v_thread := public.assistant_lock_thread(v_row.thread_id, p_user_id);

  if v_thread.store_id is distinct from v_row.store_id then
    raise exception 'THREAD_STORE_MISMATCH' using errcode = 'P0001';
  end if;

  select * into v_row
    from public.assistant_requests r
   where r.user_id = p_user_id and r.request_id = p_request_id
   for update;

  if not found then
    raise exception 'IDEMPOTENCY_TOKEN_MISMATCH' using errcode = 'P0001';
  end if;
  if v_row.state = 'completed' then
    return;
  end if;
  if v_row.state <> 'in_progress' then
    raise exception 'IDEMPOTENCY_LEASE_LOST' using errcode = 'P0001';
  end if;
  if v_row.attempt_token <> p_attempt_token then
    raise exception 'IDEMPOTENCY_TOKEN_MISMATCH' using errcode = 'P0001';
  end if;

  v_now := clock_timestamp();

  if v_row.lease_until <= v_now then
    raise exception 'IDEMPOTENCY_LEASE_LOST' using errcode = 'P0001';
  end if;

  if not public.assistant_can_use_store(v_row.store_id, p_user_id) then
    raise exception 'FORBIDDEN_STORE' using errcode = 'P0001';
  end if;

  select * into v_message
    from public.chat_messages m
   where m.id = p_assistant_message_id
     and m.thread_id = v_row.thread_id
     and m.role = 'assistant';

  if not found then
    raise exception 'INVALID_ASSISTANT_MESSAGE' using errcode = 'P0001';
  end if;

  update public.assistant_requests r
     set state = 'completed',
         assistant_message_id = p_assistant_message_id,
         credit_status = p_credit_status,
         credits_consumed = v_consumed,
         credits_charged = v_charged,
         lease_until = v_now,
         updated_at = v_now,
         last_error = null
   where r.user_id = p_user_id
     and r.request_id = p_request_id
     and r.attempt_token = p_attempt_token
     and r.state = 'in_progress';

  if not found then
    raise exception 'IDEMPOTENCY_TOKEN_MISMATCH' using errcode = 'P0001';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. fail — abandon de la tentative (libère le bail, jamais une clôture)
-- ---------------------------------------------------------------------------
create or replace function public.rpc_assistant_fail_request(
  p_request_id text,
  p_attempt_token uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_row public.assistant_requests;
  v_now timestamptz;
begin
  if v_user is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;
  if p_attempt_token is null then
    raise exception 'IDEMPOTENCY_TOKEN_MISMATCH' using errcode = 'P0001';
  end if;

  select * into v_row
    from public.assistant_requests r
   where r.user_id = v_user and r.request_id = p_request_id
   for update;

  if not found then
    raise exception 'IDEMPOTENCY_TOKEN_MISMATCH' using errcode = 'P0001';
  end if;

  -- Une requête déjà finalisée ne se dégrade jamais en échec.
  if v_row.state = 'completed' then
    return;
  end if;
  if v_row.attempt_token <> p_attempt_token then
    raise exception 'IDEMPOTENCY_TOKEN_MISMATCH' using errcode = 'P0001';
  end if;

  v_now := clock_timestamp();

  update public.assistant_requests r
     set state = 'failed',
         lease_until = v_now,
         credits_reserved = 0,
         last_error = left(coalesce(p_reason, ''), 200),
         updated_at = v_now
   where r.user_id = v_user
     and r.request_id = p_request_id
     and r.attempt_token = p_attempt_token
     and r.state = 'in_progress';
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. reserve / release — estimation informative, jamais un verrou de solde
--    Le montant réellement débité est décidé par la finalisation (05b).
-- ---------------------------------------------------------------------------
create or replace function public.rpc_assistant_reserve_credits(
  p_request_id text,
  p_attempt_token uuid,
  p_credits integer
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_row public.assistant_requests;
  v_now timestamptz;
begin
  if v_user is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;
  if p_attempt_token is null then
    raise exception 'IDEMPOTENCY_TOKEN_MISMATCH' using errcode = 'P0001';
  end if;

  select * into v_row
    from public.assistant_requests r
   where r.user_id = v_user and r.request_id = p_request_id
   for update;

  if not found
     or v_row.attempt_token is distinct from p_attempt_token
     or v_row.state <> 'in_progress' then
    raise exception 'IDEMPOTENCY_TOKEN_MISMATCH' using errcode = 'P0001';
  end if;

  v_now := clock_timestamp();

  if v_row.lease_until <= v_now then
    raise exception 'IDEMPOTENCY_LEASE_LOST' using errcode = 'P0001';
  end if;

  if not public.assistant_can_use_store(v_row.store_id, v_user) then
    raise exception 'FORBIDDEN_STORE' using errcode = 'P0001';
  end if;

  update public.assistant_requests r
     set credits_reserved = greatest(0, coalesce(p_credits, 0)),
         updated_at = v_now
   where r.user_id = v_user
     and r.request_id = p_request_id
     and r.attempt_token = p_attempt_token
     and r.state = 'in_progress';
end;
$$;

create or replace function public.rpc_assistant_release_credits(
  p_request_id text,
  p_attempt_token uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_row public.assistant_requests;
begin
  if v_user is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;
  if p_attempt_token is null then
    raise exception 'IDEMPOTENCY_TOKEN_MISMATCH' using errcode = 'P0001';
  end if;

  select * into v_row
    from public.assistant_requests r
   where r.user_id = v_user and r.request_id = p_request_id
   for update;

  if not found then
    raise exception 'IDEMPOTENCY_TOKEN_MISMATCH' using errcode = 'P0001';
  end if;

  -- Jamais de réécriture d'une clôture (le débit enregistré reste la preuve).
  if v_row.state = 'completed' then
    return;
  end if;
  if v_row.attempt_token is distinct from p_attempt_token then
    raise exception 'IDEMPOTENCY_TOKEN_MISMATCH' using errcode = 'P0001';
  end if;

  update public.assistant_requests r
     set credits_reserved = 0,
         updated_at = clock_timestamp()
   where r.user_id = v_user
     and r.request_id = p_request_id
     and r.attempt_token = p_attempt_token
     and r.state = 'in_progress';
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Privilèges : aucune écriture fiable accordée à `authenticated`
-- ---------------------------------------------------------------------------
revoke all on function public.rpc_assistant_begin_request(text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.rpc_assistant_bind_request_thread(text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.rpc_assistant_complete_request(uuid, text, uuid, uuid, text, integer, integer) from public, anon, authenticated;
revoke all on function public.rpc_assistant_fail_request(text, uuid, text) from public, anon, authenticated;
revoke all on function public.rpc_assistant_reserve_credits(text, uuid, integer) from public, anon, authenticated;
revoke all on function public.rpc_assistant_release_credits(text, uuid) from public, anon, authenticated;

grant execute on function public.rpc_assistant_begin_request(text, uuid, uuid, text) to authenticated;
grant execute on function public.rpc_assistant_bind_request_thread(text, uuid, uuid) to authenticated;
grant execute on function public.rpc_assistant_fail_request(text, uuid, text) to authenticated;
grant execute on function public.rpc_assistant_reserve_credits(text, uuid, integer) to authenticated;
grant execute on function public.rpc_assistant_release_credits(text, uuid) to authenticated;
grant execute on function public.rpc_assistant_complete_request(uuid, text, uuid, uuid, text, integer, integer) to service_role;

commit;

-- ============================================================================
-- Contrôles après application (lecture seule)
--   select p.oid::regprocedure, pg_get_userbyid(p.proowner) as owner,
--          p.prosecdef, p.proacl
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname like 'rpc_assistant_%'
--    order by 1::text;
--   select has_function_privilege('authenticated',
--            'public.rpc_assistant_complete_request(uuid,text,uuid,uuid,text,integer,integer)',
--            'EXECUTE') as authenticated_can_complete;   -- attendu : false
--   select has_function_privilege('authenticated',
--            'public.rpc_assistant_begin_request(text,uuid,uuid,text)',
--            'EXECUTE') as authenticated_can_begin;      -- attendu : true
--   select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'rpc_assistant_complete_request';
--                                                      -- attendu : 1 (aucune surcharge)
--
-- Suivi des baux (à exécuter en exploitation, lecture seule) :
--   select state, count(*), min(lease_until), max(lease_until)
--     from public.assistant_requests group by state;
--   select user_id, request_id, lease_until, last_error
--     from public.assistant_requests
--    where state = 'in_progress' and lease_until < clock_timestamp()
--    order by lease_until limit 50;
--
-- Rollback 03b (ordre des dépendances) :
--   drop function if exists public.rpc_assistant_release_credits(text, uuid);
--   drop function if exists public.rpc_assistant_reserve_credits(text, uuid, integer);
--   drop function if exists public.rpc_assistant_fail_request(text, uuid, text);
--   drop function if exists public.rpc_assistant_complete_request(uuid, text, uuid, uuid, text, integer, integer);
--   drop function if exists public.rpc_assistant_bind_request_thread(text, uuid, uuid);
--   drop function if exists public.rpc_assistant_begin_request(text, uuid, uuid, text);
--   drop function if exists public.assistant_lock_thread(uuid, uuid);
--   drop function if exists public.assistant_lock_identity(uuid, uuid);
--   drop function if exists public.assistant_lease_interval();
--   -- La table n'est PAS supprimée : elle contient la preuve des requêtes
--   -- traitées. La conserver et désactiver le drapeau du registre.
-- ============================================================================






