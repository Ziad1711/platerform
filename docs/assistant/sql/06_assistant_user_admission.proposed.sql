-- ============================================================================
-- ============================================================================
-- 06 — Admission distribuée par compte (PROPOSITION — NE PAS EXÉCUTER ICI)
--
-- Objectif : borner le nombre de requêtes assistant simultanées d'un même
-- compte, y compris entre plusieurs instances Vercel. Le limiteur applicatif
-- (`lib/assistant/rate-limit.ts`) ne couvre qu'un processus.
--
-- Contrat consommé par `lib/assistant/engine/admission.ts` :
--   rpc_assistant_assert_user_admission(p_user_id uuid, p_max_inflight integer)
--   -> void ; lève `ASSISTANT_CONCURRENT_LIMIT` si aucun créneau n'est libre.
--
-- Différence avec un simple comptage : l'appel INSÈRE un créneau unique. Deux
-- admissions simultanées ne peuvent pas se croiser, car la contrainte d'unicité
-- (user_id, slot) tranche. Un comptage suivi d'un autre comptage laissait passer
-- deux requêtes (course démontrée à l'audit).
--
-- Le créneau expire de lui-même (2 minutes) ; une libération explicite est
-- prévue pour rendre le créneau dès la fin de la requête.
--
-- Prérequis : aucun autre paquet (table dédiée).
-- Activation : ASSISTANT_DISTRIBUTED_ADMISSION=enabled, APRÈS validation
--   isolée et ajout de la libération effective dans la route.
-- Rollback : désactiver le drapeau, puis `drop table public.assistant_admissions`.
-- ============================================================================
begin;

create table if not exists public.assistant_admissions (
  user_id     uuid        not null references public.profiles (id) on delete cascade,
  slot        integer     not null default 1 check (slot between 1 and 8),
  lease_until timestamptz not null,
  created_at  timestamptz not null default clock_timestamp(),
  primary key (user_id, slot)
);

alter table public.assistant_admissions enable row level security;
revoke all on public.assistant_admissions from public, anon, authenticated;

create or replace function public.rpc_assistant_assert_user_admission(
  p_user_id uuid,
  p_max_inflight integer default 1
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_max integer := greatest(1, least(coalesce(p_max_inflight, 1), 8));
  v_now timestamptz := clock_timestamp();
  v_slot integer;
begin
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;

  -- Purge des créneaux expirés du compte : aucune contrainte externe requise.
  delete from public.assistant_admissions a
   where a.user_id = p_user_id
     and a.lease_until <= v_now;

  for v_slot in 1..v_max loop
    begin
      insert into public.assistant_admissions (user_id, slot, lease_until)
      values (p_user_id, v_slot, v_now + interval '2 minutes');
      return;
    exception
      when unique_violation then
        continue;
    end;
  end loop;

  raise exception 'ASSISTANT_CONCURRENT_LIMIT' using errcode = 'P0001';
end;
$$;

create or replace function public.rpc_assistant_release_user_admission(
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;
  delete from public.assistant_admissions a where a.user_id = p_user_id;
end;
$$;

revoke all on function public.rpc_assistant_assert_user_admission(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.rpc_assistant_release_user_admission(uuid)
  from public, anon, authenticated;
grant execute on function public.rpc_assistant_assert_user_admission(uuid, integer)
  to service_role;
grant execute on function public.rpc_assistant_release_user_admission(uuid)
  to service_role;

commit;

-- Contrôles après application (lecture seule) :
--   select has_function_privilege('authenticated',
--     'public.rpc_assistant_assert_user_admission(uuid,integer)', 'EXECUTE'); -- false
--   select has_function_privilege('service_role',
--     'public.rpc_assistant_assert_user_admission(uuid,integer)', 'EXECUTE'); -- true
--
-- Conditions d'activation (NON satisfaites à ce jour) :
--   1. migration appliquée sur un environnement isolé et validée ;
--   2. libération appelée dans la route après finalisation ;
--   3. test de concurrence : deux appels simultanés ⇒ une seule admission.
