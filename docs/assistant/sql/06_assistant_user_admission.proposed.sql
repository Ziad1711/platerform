-- ============================================================================
-- 06 — Admission distribuée par compte (PROPOSITION — NE PAS EXÉCUTER ICI)
--
-- Objectif : borner le nombre de requêtes assistant simultanées d'un même
-- compte, y compris entre plusieurs instances Vercel. Le limiteur applicatif
-- (`lib/assistant/rate-limit.ts`) ne couvre qu'un processus.
--
-- Contrat consommé par `lib/assistant/engine/admission.ts` :
--   rpc_assistant_assert_user_admission(p_user_id uuid, p_max_inflight integer)
--   -> void ; lève `ASSISTANT_CONCURRENT_LIMIT` si le plafond est atteint.
--
-- Réutilise `public.assistant_requests` (registre d'idempotence) : une requête
-- est « en vol » tant que son bail est valide. Aucun nouvel état, aucune
-- nouvelle table, aucune duplication de la logique de bail.
--
-- Prérequis : 03b appliqué (table, bail, `assistant_lease_interval`).
-- Activation : ASSISTANT_DISTRIBUTED_ADMISSION=enabled côté serveur.
-- Rollback : drop function + désactiver le drapeau AVANT le drop.
-- ============================================================================
begin;

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
  v_max integer := greatest(1, coalesce(p_max_inflight, 1));
  v_now timestamptz := clock_timestamp();
  v_inflight integer;
begin
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;

  -- Verrou d'identité : sérialise deux admissions du même compte.
  perform public.assistant_lock_identity(p_user_id, null);

  select count(*)
    into v_inflight
    from public.assistant_requests r
   where r.user_id = p_user_id
     and r.state = 'in_progress'
     and r.lease_until > v_now;

  if v_inflight >= v_max then
    raise exception 'ASSISTANT_CONCURRENT_LIMIT' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.rpc_assistant_assert_user_admission(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.rpc_assistant_assert_user_admission(uuid, integer)
  to service_role;

commit;

-- Contrôles après application (lecture seule) :
--   select has_function_privilege('authenticated',
--     'public.rpc_assistant_assert_user_admission(uuid,integer)', 'EXECUTE'); -- false
--   select has_function_privilege('service_role',
--     'public.rpc_assistant_assert_user_admission(uuid,integer)', 'EXECUTE'); -- true
--
-- Limite connue : `assistant_lock_identity` exige aujourd'hui une boutique
-- non nulle (`stores s where s.id = p_store_id`). Cette proposition passe
-- `null` et doit donc être adaptée (variante utilisateur seul) avant exécution :
-- c'est précisément le point à valider sur un PostgreSQL isolé.
