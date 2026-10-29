-- ============================================================================
-- SCÉNARIOS CONCURRENTS — SESSION A (à lancer AVANT la session B)
-- R2 (même clé), R6 (finalisation concurrente), R12 (suppression concurrente)
--
-- Orchestration : A prend les 3 barrières advisory AVANT que B ne démarre.
-- Chaque `pg_advisory_unlock(90xxxx)` ouvre la scène correspondante à B, puis A
-- dort 8 s pour laisser B prouver son blocage (lock_timeout 4 s côté B) avant
-- de committer. B ne peut donc pas exécuter une scène avant qu'elle commence.
-- ============================================================================
\set ON_ERROR_STOP on

select owner_id, store_a, thread_owner
  from audit.fx
\gset

\set fp_a 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
\set r2 '20000000-0000-4000-8000-000000000002'
\set r6 '20000000-0000-4000-8000-000000000006'
\set r12 '20000000-0000-4000-8000-000000000012'
\set t_r12 '33333333-aaaa-4000-8000-000000000012'

-- Conversation dédiée à R12 (les autres scénarios gardent `thread_owner`).
select audit.seed_row('chat_threads', jsonb_build_object(
  'id', :'t_r12'::uuid, 'user_id', :'owner_id'::uuid,
  'store_id', :'store_a'::uuid, 'title', 'audit r12'));

-- Acquisitions préalables (committées) : B doit pouvoir lire les jetons.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'owner_id', true);
select * from public.rpc_assistant_begin_request(:'r6', :'store_a'::uuid, :'thread_owner'::uuid, :'fp_a');
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'owner_id', true);
select * from public.rpc_assistant_begin_request(:'r12', :'store_a'::uuid, :'t_r12'::uuid, :'fp_a');
commit;

-- Barrières : A verrouille les trois scènes dès maintenant.
select pg_advisory_lock(900001);
select pg_advisory_lock(900002);
select pg_advisory_lock(900003);

\echo 'A: barrières posées'

-- ---------------------------------------------------------------------------
-- R2 — A détient la ligne de registre non committée ; B doit être bloqué.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'owner_id', true);
select *
  from public.rpc_assistant_begin_request(:'r2', :'store_a'::uuid, :'thread_owner'::uuid, :'fp_a')
\gset r2a_
select pg_advisory_unlock(900001);
select pg_sleep(8);
commit;

select audit.assert_eq('R2A.state', :'r2a_state', 'in_progress', 'A détient la requête');
select audit.assert_true('R2A.token', coalesce(:'r2a_attempt_token', '') <> '', 'jeton A');

-- ---------------------------------------------------------------------------
-- R6 — A finalise ; B doit être bloqué sur la ligne puis rejouer.
-- ---------------------------------------------------------------------------
begin;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select *
  from public.rpc_assistant_finalize_request(
    :'owner_id'::uuid, :'thread_owner'::uuid, :'r6', :'fp_a',
    (select attempt_token from public.assistant_requests
      where user_id = :'owner_id'::uuid and request_id = :'r6'),
    :'store_a'::uuid, 'audit', 'Question R6', 'Réponse R6',
    jsonb_build_object('request_id', :'r6', 'request_fingerprint', :'fp_a'),
    4, '{"input_tokens":40,"output_tokens":60}'::jsonb, 'Titre R6')
\gset r6a_
select pg_advisory_unlock(900002);
select pg_sleep(8);
commit;

select audit.assert_eq('R6A.replayed', :'r6a_replayed', 'false', 'première finalisation');
select audit.assert_eq('R6A.charged', :'r6a_credits_charged', '4', 'débit A');

-- ---------------------------------------------------------------------------
-- R12 — A finalise ; B supprime la conversation en parallèle.
-- ---------------------------------------------------------------------------
begin;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select *
  from public.rpc_assistant_finalize_request(
    :'owner_id'::uuid, :'t_r12'::uuid, :'r12', :'fp_a',
    (select attempt_token from public.assistant_requests
      where user_id = :'owner_id'::uuid and request_id = :'r12'),
    :'store_a'::uuid, 'audit', 'Question R12', 'Réponse R12',
    jsonb_build_object('request_id', :'r12', 'request_fingerprint', :'fp_a'),
    1, '{"input_tokens":10,"output_tokens":15}'::jsonb, NULL)
\gset r12a_
select pg_advisory_unlock(900003);
select pg_sleep(8);
commit;

select audit.assert_eq('R12A.replayed', :'r12a_replayed', 'false', 'finalisation A');

-- Libération des barrières restantes (sécurité).
select pg_advisory_unlock_all();
\echo 'A: terminé'
