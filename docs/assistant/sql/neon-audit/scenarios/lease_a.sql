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

-- Le jeton de A est consigné : la rotation sera vérifiée APRÈS la fin de B
-- (invariant I16), car A ne peut pas observer la reprise de B dans sa propre
-- fenêtre temporelle.
select audit.record('R5A.token', 'SKIP', null, :'a5_attempt_token');

\echo 'A: terminé'
