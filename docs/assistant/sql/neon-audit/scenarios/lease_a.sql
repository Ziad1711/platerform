-- ============================================================================
-- R5 — BAIL EXPIRANT PENDANT L'ATTENTE D'UN VERROU (session A)
-- Durée : ~130 s (bail = 2 minutes). C'est le seul scénario lent.
--
-- A détient la ligne non committée plus longtemps que le bail. B, dont la
-- transaction démarre AVANT le commit de A, doit REPRENDRE la requête.
-- Avec l'ancienne implémentation (`now()` = début de transaction), B aurait
-- répondu IDEMPOTENCY_IN_PROGRESS : c'est la régression que ce test prouve.
-- ============================================================================
\set ON_ERROR_STOP on

select owner_id, store_a, thread_owner from audit.fx \gset
\set fp_a 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
\set r5 '20000000-0000-4000-8000-000000000005'

select pg_advisory_lock(900005);

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'owner_id', true);
select *
  from public.rpc_assistant_begin_request(:'r5', :'store_a'::uuid, :'thread_owner'::uuid, :'fp_a')
\gset a5_
select pg_advisory_unlock(900005);

\echo 'A: bail acquis, attente 130 s (B doit se bloquer puis reprendre)'
select pg_sleep(130);
commit;

-- A constate que son jeton a été remplacé par la reprise de B.
select audit.assert_true('R5A.superseded',
  (select attempt_token::text from public.assistant_requests
    where user_id = :'owner_id'::uuid and request_id = :'r5') <> :'a5_attempt_token',
  'jeton remplacé par la reprise');

select audit.assert_true('R5A.lease_future',
  (select lease_until > clock_timestamp() from public.assistant_requests
    where user_id = :'owner_id'::uuid and request_id = :'r5'),
  'bail de la reprise encore valide');

\echo 'A: terminé'
