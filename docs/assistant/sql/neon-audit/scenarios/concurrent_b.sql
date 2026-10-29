-- ============================================================================
-- SCÉNARIOS CONCURRENTS — SESSION B (lancer ~2 s APRÈS la session A)
-- B attend chaque barrière posée par A : aucune scène ne peut démarrer avant
-- que A ne soit dans la transaction correspondante.
-- La preuve de blocage vient de `lock_timeout` (SQLSTATE 55P03) : ce n'est pas
-- une mesure de temps, c'est une contention réellement observée.
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
\set t_r12 '33333333-aaaa-4000-8000-000000000012'

-- ---------------------------------------------------------------------------
-- R2 — Même clé pendant que A détient la ligne
-- ---------------------------------------------------------------------------
select pg_advisory_lock(900001);
select pg_advisory_unlock(900001);

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'owner_id', true);
set local lock_timeout = '4s';
select audit.expect_error('R2B.blocked', '55P03',
  audit.sql_begin(:'r2', :'store_a'::uuid, :'thread_owner'::uuid, :'fp_a'));
commit;

-- Après le COMMIT de A, la même clé doit être refusée (bail actif).
select pg_sleep(6);

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'owner_id', true);
select audit.expect_error('R2B.in_progress', 'P0001',
  audit.sql_begin(:'r2', :'store_a'::uuid, :'thread_owner'::uuid, :'fp_a'));
commit;

select audit.assert_eq('R2B.single_row',
  (select count(*)::text from public.assistant_requests
    where user_id = :'owner_id'::uuid and request_id = :'r2'), '1', 'une seule réservation');

-- ---------------------------------------------------------------------------
-- R6 — Finalisation concurrente de la même clé
-- ---------------------------------------------------------------------------
select pg_advisory_lock(900002);
select pg_advisory_unlock(900002);

begin;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
set local lock_timeout = '4s';
select audit.expect_error('R6B.blocked', '55P03', audit.sql_finalize(
  :'owner_id'::uuid, :'thread_owner'::uuid, :'r6', :'fp_a',
  (select attempt_token from public.assistant_requests
    where user_id = :'owner_id'::uuid and request_id = :'r6'),
  :'store_a'::uuid, 'Question R6', 'Réponse R6', 4,
  '{"input_tokens":40,"output_tokens":60}'::jsonb, 'Titre R6'));
commit;

select pg_sleep(6);

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
\gset r6b_
commit;

select audit.assert_eq('R6B.replayed', :'r6b_replayed', 'true', 'rejeu après contention');
select audit.assert_eq('R6B.charged', :'r6b_credits_charged', '4', 'débit d''origine relu');

-- ---------------------------------------------------------------------------
-- R12 — Suppression de la conversation pendant la finalisation
-- ---------------------------------------------------------------------------
select pg_advisory_lock(900003);
select pg_advisory_unlock(900003);

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'owner_id', true);
set local lock_timeout = '4s';
select audit.expect_error('R12B.blocked', '55P03',
  format('delete from public.chat_threads where id = %L::uuid', :'t_r12'));
commit;

select pg_sleep(6);

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'owner_id', true);
select audit.expect_ok('R12B.delete_after_commit',
  format('delete from public.chat_threads where id = %L::uuid', :'t_r12'));
commit;

-- Aucune ligne orpheline : la conversation supprimée ne doit plus être
-- référencée par le registre (ON DELETE SET NULL) ni par un message.
select audit.assert_eq('R12B.no_orphan_thread',
  (select count(*)::text from public.assistant_requests
    where thread_id = :'t_r12'::uuid), '0', 'registre détaché');
select audit.assert_eq('R12B.no_orphan_message',
  (select count(*)::text from public.chat_messages
    where thread_id = :'t_r12'::uuid), '0', 'messages détachés ou supprimés');

\echo 'B: terminé'
