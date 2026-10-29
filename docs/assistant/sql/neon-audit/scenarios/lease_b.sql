-- ============================================================================
-- R5 — BAIL EXPIRANT PENDANT L'ATTENTE D'UN VERROU (session B)
-- B démarre sa transaction AVANT le commit de A et attend le verrou jusqu'à
-- ~130 s (lock_timeout 150 s). Au réveil, le bail de A est expiré en temps
-- réel : B doit REPRENDRE (nouveau jeton), jamais répondre « in progress ».
-- ============================================================================
\set ON_ERROR_STOP on

select owner_id, store_a, thread_owner from audit.fx \gset
\set fp_a 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
\set r5 '20000000-0000-4000-8000-000000000005'

select pg_advisory_lock(900005);
select pg_advisory_unlock(900005);

\echo 'B: attente du verrou de A (jusqu''à 150 s)'
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'owner_id', true);
set local lock_timeout = '150s';
select *
  from public.rpc_assistant_begin_request(:'r5', :'store_a'::uuid, :'thread_owner'::uuid, :'fp_a')
\gset b5_
commit;

select audit.assert_eq('R5B.takeover', :'b5_state', 'in_progress', 'reprise après expiration');
select audit.assert_true('R5B.new_token', coalesce(:'b5_attempt_token', '') <> '', 'nouveau jeton émis');
select audit.record('R5B.token', 'SKIP', null, :'b5_attempt_token');

\echo 'B: terminé'
