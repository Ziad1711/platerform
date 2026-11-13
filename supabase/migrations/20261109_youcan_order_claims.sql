-- Idempotence forte des commandes YouCan : réservation atomique avant création.
--
-- Objectif : empêcher deux webhooks simultanés (ou un rejeu immédiat) de créer
-- deux commandes pour le même `youcan_order_id`. La contrainte de clé primaire
-- fournit l'exclusion mutuelle sans dépendre d'une lecture préalable.
--
-- Cycle de vie :
--   1. rpc_claim_youcan_order    : 'claimed' (créer), 'in_progress' (autre exécution),
--                                  'already' (commande déjà créée) ;
--   2. rpc_finish_youcan_order_claim : mémorise l'identifiant interne (uniquement
--                                      pour le détenteur du jeton) ;
--   3. rpc_release_youcan_order_claim : libère la réservation en cas d'échec.
--
-- Aucune donnée métier n'est modifiée par cette migration.

create table if not exists public.youcan_order_claims (
  integration_id   uuid not null references public.integrations(id) on delete cascade,
  youcan_order_id  text not null,
  claim_token      uuid not null default gen_random_uuid(),
  claimed_at       timestamptz not null default now(),
  order_id         uuid,
  primary key (integration_id, youcan_order_id)
);

create index if not exists youcan_order_claims_claimed_at_idx
  on public.youcan_order_claims (claimed_at);

comment on table public.youcan_order_claims is
  'Réservations atomiques des imports de commandes YouCan (anti-doublon).';

alter table public.youcan_order_claims enable row level security;
revoke all on public.youcan_order_claims from anon, authenticated;

create or replace function public.rpc_claim_youcan_order(
  p_integration_id uuid,
  p_youcan_order_id text,
  p_stale_seconds integer default 120
)
returns table (state text, claim_token uuid, order_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token uuid := gen_random_uuid();
  v_row   public.youcan_order_claims;
begin
  if p_integration_id is null or coalesce(btrim(p_youcan_order_id), '') = '' then
    raise exception 'INVALID_CLAIM_ARGUMENTS';
  end if;

  insert into public.youcan_order_claims (integration_id, youcan_order_id, claim_token, claimed_at)
  values (p_integration_id, p_youcan_order_id, v_token, now())
  on conflict (integration_id, youcan_order_id) do nothing;

  if found then
    return query select 'claimed'::text, v_token, null::uuid;
    return;
  end if;

  select * into v_row
  from public.youcan_order_claims
  where integration_id = p_integration_id
    and youcan_order_id = p_youcan_order_id
  for update;

  if v_row.order_id is not null then
    return query select 'already'::text, v_row.claim_token, v_row.order_id;
    return;
  end if;

  -- Réservation orpheline (processus interrompu) : reprise après délai de grâce.
  if v_row.claimed_at < now() - make_interval(secs => greatest(p_stale_seconds, 30)) then
    update public.youcan_order_claims c
       set claim_token = v_token, claimed_at = now()
     where c.integration_id = p_integration_id
       and c.youcan_order_id = p_youcan_order_id;
    return query select 'claimed'::text, v_token, null::uuid;
    return;
  end if;

  return query select 'in_progress'::text, v_row.claim_token, null::uuid;
end;
$$;

create or replace function public.rpc_finish_youcan_order_claim(
  p_integration_id uuid,
  p_youcan_order_id text,
  p_token uuid,
  p_order_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  update public.youcan_order_claims c
     set order_id = p_order_id, claimed_at = now()
   where c.integration_id = p_integration_id
     and c.youcan_order_id = p_youcan_order_id
     and c.claim_token = p_token;

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function public.rpc_release_youcan_order_claim(
  p_integration_id uuid,
  p_youcan_order_id text,
  p_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.youcan_order_claims c
   where c.integration_id = p_integration_id
     and c.youcan_order_id = p_youcan_order_id
     and c.claim_token = p_token
     and c.order_id is null;

  get diagnostics v_deleted = row_count;
  return v_deleted = 1;
end;
$$;

revoke all on function public.rpc_claim_youcan_order(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.rpc_finish_youcan_order_claim(uuid, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.rpc_release_youcan_order_claim(uuid, text, uuid) from public, anon, authenticated;

grant execute on function public.rpc_claim_youcan_order(uuid, text, integer) to service_role;
grant execute on function public.rpc_finish_youcan_order_claim(uuid, text, uuid, uuid) to service_role;
grant execute on function public.rpc_release_youcan_order_claim(uuid, text, uuid) to service_role;
