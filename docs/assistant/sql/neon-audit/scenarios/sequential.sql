-- ============================================================================
-- SCÉNARIOS SÉQUENTIELS (une seule connexion)
-- Prérequis : 05/10/20/30 exécutés, 01→02→03b→05b appliqués, fixtures présentes.
-- Chaque scénario est isolé : transaction + rôle simulé + claims de session.
-- ============================================================================
\set ON_ERROR_STOP on

select owner_id, admin_id, viewer_id, accountant_id, outsider_id,
       store_a, store_b, plan_free, plan_paid, thread_owner, thread_admin
  from audit.fx
\gset

\set fp_a 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
\set fp_b 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
\set r1 '10000000-0000-4000-8000-000000000001'
\set r2 '10000000-0000-4000-8000-000000000002'
\set r3 '10000000-0000-4000-8000-000000000003'
\set r4 '10000000-0000-4000-8000-000000000004'
\set r5 '10000000-0000-4000-8000-000000000005'
\set r6 '10000000-0000-4000-8000-000000000006'
\set r13 '10000000-0000-4000-8000-000000000013'
\set r14 '10000000-0000-4000-8000-000000000014'

-- ---------------------------------------------------------------------------
-- R1 — Première acquisition
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'owner_id', true);
select *
  from public.rpc_assistant_begin_request(:'r1', :'store_a'::uuid, :'thread_owner'::uuid, :'fp_a')
\gset r1_
commit;

select audit.assert_eq('R1.state', :'r1_state', 'in_progress', 'acquisition owner');
select audit.assert_eq('R1.thread', :'r1_thread_id', :'thread_owner', 'conversation liée');
select audit.assert_true('R1.token', coalesce(:'r1_attempt_token', '') <> '', 'jeton émis');
select audit.assert_eq('R1.credit', :'r1_credit_status', 'not_charged', 'aucun débit à l''acquisition');

-- ---------------------------------------------------------------------------
-- R3 — Même clé, empreinte différente ⇒ conflit, aucune mutation
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'owner_id', true);
select audit.expect_error('R3.conflict', 'P0001',
  audit.sql_begin(:'r1', :'store_a'::uuid, :'thread_owner'::uuid, :'fp_b'));
commit;

select audit.assert_eq('R3.token_stable',
  (select attempt_token::text from public.assistant_requests
    where user_id = :'owner_id'::uuid and request_id = :'r1'),
  :'r1_attempt_token', 'jeton inchangé après conflit');

-- ---------------------------------------------------------------------------
-- R4 — Expiration du bail puis reprise (variante rapide, sans attente)
--      La valeur du bail est antidatée : on valide la frontière et la rotation,
--      pas la précision d'horloge (couverte par lease_a/lease_b).
-- ---------------------------------------------------------------------------
update public.assistant_requests
   set lease_until = clock_timestamp() - interval '1 second'
 where user_id = :'owner_id'::uuid and request_id = :'r1';

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'owner_id', true);
select *
  from public.rpc_assistant_begin_request(:'r1', :'store_a'::uuid, :'thread_owner'::uuid, :'fp_a')
\gset r4_
commit;

select audit.assert_true('R4.rotated', :'r4_attempt_token' <> :'r1_attempt_token', 'nouveau jeton');

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'owner_id', true);
select audit.expect_error('R4.old_token', 'P0001',
  audit.sql_bind(:'r1', :'r1_attempt_token'::uuid, :'thread_owner'::uuid));
commit;

-- ---------------------------------------------------------------------------
-- R7 — Rejeu d'une première question sans `thread_id` (régression corrigée)
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'owner_id', true);
select *
  from public.rpc_assistant_begin_request(:'r2', :'store_a'::uuid, NULL, :'fp_a')
\gset r7a_
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'owner_id', true);
select public.rpc_assistant_bind_request_thread(:'r2', :'r7a_attempt_token'::uuid, :'thread_owner'::uuid);
commit;

begin;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select audit.expect_ok('R7.finalize', audit.sql_finalize(
  :'owner_id'::uuid, :'thread_owner'::uuid, :'r2', :'fp_a', :'r7a_attempt_token'::uuid,
  :'store_a'::uuid, 'Question R7', 'Réponse R7', 2,
  '{"input_tokens":10,"output_tokens":20,"provider_name":"synthetic","model_name":"audit","provider_cost_usd":0.001}'::jsonb,
  'Titre R7'));
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'owner_id', true);
select *
  from public.rpc_assistant_begin_request(:'r2', :'store_a'::uuid, NULL, :'fp_a')
\gset r7b_
commit;

select audit.assert_eq('R7.replay_state', :'r7b_state', 'completed', 'rejeu complet');
select audit.assert_eq('R7.replay_thread', :'r7b_thread_id', :'thread_owner', 'conversation retrouvée');
select audit.assert_eq('R7.replay_credit', :'r7b_credit_status', 'charged', 'statut de débit conservé');

-- ---------------------------------------------------------------------------
-- R8 — Interruption avant COMMIT : aucun effet
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'owner_id', true);
select public.rpc_assistant_begin_request(:'r3', :'store_a'::uuid, :'thread_owner'::uuid, :'fp_a');
rollback;

select audit.assert_eq('R8.no_row',
  (select count(*)::text from public.assistant_requests
    where user_id = :'owner_id'::uuid and request_id = :'r3'), '0', 'transaction annulée');

-- ---------------------------------------------------------------------------
-- R9 — Révocation de l'accès AVANT finalisation ⇒ FORBIDDEN_STORE
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select *
  from public.rpc_assistant_begin_request(:'r4', :'store_a'::uuid, :'thread_admin'::uuid, :'fp_a')
\gset r9_
commit;

update public.store_members
   set status = 'revoked'
 where store_id = :'store_a'::uuid and user_id = :'admin_id'::uuid;

begin;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select audit.expect_error('R9.revoked', 'P0001', audit.sql_finalize(
  :'admin_id'::uuid, :'thread_admin'::uuid, :'r4', :'fp_a', :'r9_attempt_token'::uuid,
  :'store_a'::uuid, 'Question R9', 'Réponse R9', 1, '{}'::jsonb, NULL));
commit;

update public.store_members
   set status = 'active'
 where store_id = :'store_a'::uuid and user_id = :'admin_id'::uuid;

select audit.assert_eq('R9.no_message',
  (select count(*)::text from public.chat_messages
    where thread_id = :'thread_admin'::uuid and content = 'Réponse R9'), '0', 'aucune écriture');

-- ---------------------------------------------------------------------------
-- R10 — Journal d'usage invalide ⇒ INVALID_USAGE et rollback complet
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'owner_id', true);
select *
  from public.rpc_assistant_begin_request(:'r5', :'store_a'::uuid, :'thread_owner'::uuid, :'fp_a')
\gset r10_
commit;

select credits_used as w_before_r10
  from public.ai_credit_wallets where user_id = :'owner_id'::uuid
\gset

begin;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select audit.expect_error('R10.invalid_usage', 'P0001', audit.sql_finalize(
  :'owner_id'::uuid, :'thread_owner'::uuid, :'r5', :'fp_a', :'r10_attempt_token'::uuid,
  :'store_a'::uuid, 'Question R10', 'Réponse R10', 2,
  '{"input_tokens":"invalide"}'::jsonb, 'Titre interdit'));
commit;

select audit.assert_eq('R10.no_message',
  (select count(*)::text from public.chat_messages
    where thread_id = :'thread_owner'::uuid and content = 'Réponse R10'), '0', 'messages annulés');
select audit.assert_eq('R10.wallet_intact',
  (select credits_used::text from public.ai_credit_wallets where user_id = :'owner_id'::uuid),
  :'w_before_r10', 'portefeuille inchangé');
select audit.assert_eq('R10.title_intact',
  (select (title is distinct from 'Titre interdit')::text from public.chat_threads
    where id = :'thread_owner'::uuid), 'true', 'titre non modifié');

-- ---------------------------------------------------------------------------
-- R11 — Écriture ai_usage refusée au client authentifié
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'owner_id', true);
select audit.expect_error('R11.ai_usage_insert', '42501', format(
  'insert into public.ai_usage (user_id, store_id, thread_id, feature, credits_used) values (%L::uuid, %L::uuid, %L::uuid, %L, 999)',
  :'owner_id', :'store_a', :'thread_owner', 'chatbot'));
commit;

-- ---------------------------------------------------------------------------
-- S1 — Crédits insuffisants : réponse conservée, débit nul
-- ---------------------------------------------------------------------------
update public.ai_credit_wallets
   set credits_used = greatest(0, monthly_credits - 1)
 where user_id = :'owner_id'::uuid;

select credits_used as w_before_s1
  from public.ai_credit_wallets where user_id = :'owner_id'::uuid
\gset

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'owner_id', true);
select *
  from public.rpc_assistant_begin_request(:'r6', :'store_a'::uuid, :'thread_owner'::uuid, :'fp_a')
\gset s1_
commit;

begin;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select *
  from public.rpc_assistant_finalize_request(
    :'owner_id'::uuid, :'thread_owner'::uuid, :'r6', :'fp_a', :'s1_attempt_token'::uuid,
    :'store_a'::uuid, 'audit', 'Question S1', 'Réponse S1',
    jsonb_build_object('request_id', :'r6', 'request_fingerprint', :'fp_a'),
    2, '{"input_tokens":10,"output_tokens":20}'::jsonb, NULL)
\gset s1r_
commit;

select audit.assert_eq('S1.status', :'s1r_credit_status', 'insufficient', 'statut explicite');
select audit.assert_eq('S1.consumed', :'s1r_credits_consumed', '2', 'consommation tracée');
select audit.assert_eq('S1.charged', :'s1r_credits_charged', '0', 'aucun débit');
select audit.assert_eq('S1.wallet_intact',
  (select credits_used::text from public.ai_credit_wallets where user_id = :'owner_id'::uuid),
  :'w_before_s1', 'portefeuille inchangé');
select audit.assert_eq('S1.messages_written',
  (select count(*)::text from public.chat_messages
    where thread_id = :'thread_owner'::uuid and content = 'Réponse S1'), '1', 'réponse conservée');

-- Restauration du solde pour les scénarios suivants.
update public.ai_credit_wallets
   set credits_used = 0
 where user_id = :'owner_id'::uuid;

-- ---------------------------------------------------------------------------
-- R13 — ROLLBACK APRÈS DÉBIT DÉJÀ EFFECTUÉ
--   Un trigger AFTER UPDATE sur `ai_credit_wallets` lève une erreur APRÈS que
--   le débit a été écrit. On vérifie : (a) l'erreur survient bien après le
--   débit, (b) rien ne persiste, (c) la même requête aboutit ensuite sans
--   dérive de solde.
-- ---------------------------------------------------------------------------
select audit.install_late_failure();

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'owner_id', true);
select *
  from public.rpc_assistant_begin_request(:'r13', :'store_a'::uuid, :'thread_owner'::uuid, :'fp_a')
\gset r13_
commit;

select credits_used as w_before_r13
  from public.ai_credit_wallets where user_id = :'owner_id'::uuid
\gset

select count(*) as msgs_before_r13
  from public.chat_messages where thread_id = :'thread_owner'::uuid
\gset

begin;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('audit.fail_after_debit', 'on', true);
select audit.expect_error('R13.late_after_debit', 'P0001', audit.sql_finalize(
  :'owner_id'::uuid, :'thread_owner'::uuid, :'r13', :'fp_a', :'r13_attempt_token'::uuid,
  :'store_a'::uuid, 'Question R13', 'Réponse R13', 3,
  '{"input_tokens":30,"output_tokens":45}'::jsonb, 'Titre R13'));
commit;

select audit.remove_late_failure();

select audit.assert_eq('R13.wallet_rolled_back',
  (select credits_used::text from public.ai_credit_wallets where user_id = :'owner_id'::uuid),
  :'w_before_r13', 'débit annulé');
select audit.assert_eq('R13.no_message',
  (select count(*)::text from public.chat_messages where thread_id = :'thread_owner'::uuid),
  :'msgs_before_r13', 'aucun message écrit');
select audit.assert_eq('R13.no_usage',
  (select count(*)::text from public.ai_usage
    where thread_id = :'thread_owner'::uuid and feature = 'chatbot' and credits_used = 3
      and created_at > clock_timestamp() - interval '2 minutes'), '0', 'aucun journal');
select audit.assert_eq('R13.still_in_progress',
  (select state || '/' || credits_charged::text from public.assistant_requests
    where user_id = :'owner_id'::uuid and request_id = :'r13'), 'in_progress/0',
  'registre non clôturé');

-- Contrôle : sans injection, la même requête aboutit et débite normalement.
begin;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select *
  from public.rpc_assistant_finalize_request(
    :'owner_id'::uuid, :'thread_owner'::uuid, :'r13', :'fp_a', :'r13_attempt_token'::uuid,
    :'store_a'::uuid, 'audit', 'Question R13', 'Réponse R13',
    jsonb_build_object('request_id', :'r13', 'request_fingerprint', :'fp_a'),
    3, '{"input_tokens":30,"output_tokens":45}'::jsonb, 'Titre R13')
\gset r13r_
commit;

select audit.assert_eq('R13.retry_status', :'r13r_credit_status', 'charged', 'reprise nominative');
select audit.assert_eq('R13.retry_charged', :'r13r_credits_charged', '3', 'débit unique');
select audit.assert_eq('R13.retry_wallet',
  (select credits_used::text from public.ai_credit_wallets where user_id = :'owner_id'::uuid),
  (:w_before_r13::int + 3)::text, 'un seul débit');

-- ---------------------------------------------------------------------------
-- R14 — Changement d'offre : le plafond suit le plan effectif
-- ---------------------------------------------------------------------------
update public.subscriptions
   set plan_id = :'plan_free'::uuid
 where user_id = :'owner_id'::uuid and status = 'active';

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'owner_id', true);
select *
  from public.rpc_assistant_begin_request(:'r14', :'store_a'::uuid, :'thread_owner'::uuid, :'fp_a')
\gset r14_
commit;

begin;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select *
  from public.rpc_assistant_finalize_request(
    :'owner_id'::uuid, :'thread_owner'::uuid, :'r14', :'fp_a', :'r14_attempt_token'::uuid,
    :'store_a'::uuid, 'audit', 'Question R14', 'Réponse R14',
    jsonb_build_object('request_id', :'r14', 'request_fingerprint', :'fp_a'),
    5, '{"input_tokens":50,"output_tokens":75}'::jsonb, NULL)
\gset r14r_
commit;

select audit.assert_eq('R14.status', :'r14r_credit_status', 'insufficient', 'plafond réduit appliqué');
select audit.assert_eq('R14.charged', :'r14r_credits_charged', '0', 'aucun débit');
select audit.assert_eq('R14.plan_synced',
  (select monthly_credits::text from public.ai_credit_wallets where user_id = :'owner_id'::uuid),
  '0', 'plafond synchronisé sur l''offre gratuite');

-- Restauration.
update public.subscriptions
   set plan_id = :'plan_paid'::uuid
 where user_id = :'owner_id'::uuid and status = 'active';
update public.ai_credit_wallets
   set monthly_credits = 100
 where user_id = :'owner_id'::uuid;
