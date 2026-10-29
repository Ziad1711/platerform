-- ============================================================================
-- OBSOLÈTE — NE PAS EXÉCUTER. Remplacé par docs/assistant/sql/neon-audit/ :
--   * orchestration A/B par barrières advisory + preuve de contention 55P03 ;
--   * timeouts compatibles (lock_timeout court, bail 130 s isolé) ;
--   * fixtures synthétiques explicites et SQLSTATE capturé ;
--   * R9/R10/R12 corrigés, R13 (échec tardif après débit) ajouté.
-- Conservé pour historique.
-- ============================================================================
-- ============================================================================
-- SCÉNARIOS POSTGRESQL À DEUX CONNEXIONS — **NON EXÉCUTÉ**
--
-- Ce fichier n'a jamais été exécuté. Il ne doit l'être que dans une base
-- PostgreSQL distante JETABLE et explicitement autorisée, avec des données
-- exclusivement SYNTHÉTIQUES. Aucune connexion à la production, aucun
-- `supabase db push`, aucun Docker, aucun Supabase Local.
--
-- Usage : deux terminaux `psql` sur la MÊME base, sections « SESSION A » et
-- « SESSION B » exécutées dans l'ordre indiqué. Les étapes marquées
-- `-- >>> COORDINATION` exigent d'attendre l'autre session.
--
-- Les COMMIT sont volontaires : les scénarios concurrents exigent la
-- visibilité inter-transactions. L'isolation vient de la base jetable, pas
-- d'un rollback global.
-- ============================================================================

\set ON_ERROR_STOP on

-- Garde d'environnement : la base doit porter exactement ce nom.
-- Fournir : \set audit_db 'jisra_assistant_audit_YYYYMMDD'
\if :{?audit_db}
\else
  \echo 'NO-GO : définir audit_db (\\set audit_db ...)'
  \quit
\endif

select current_database() = :'audit_db' as correct_database \gset
\if :correct_database
\else
  \echo 'REFUS : base non autorisée'
  \quit
\endif

-- Identités synthétiques (fournies par le processus d'amorçage autorisé).
-- Le script ne devine JAMAIS la structure de `profiles`/`stores` : les lignes
-- sont créées par la procédure d'amorçage approuvée, puis référencées ici.
--
-- À définir avant exécution :
--   \set u_owner   '<uuid profil owner synthétique>'
--   \set u_admin   '<uuid profil admin synthétique>'
--   \set u_viewer  '<uuid profil viewer synthétique>'
--   \set s_store   '<uuid boutique synthétique>'
--   \set t_thread  '<uuid conversation synthétique de u_owner>'
--   \set fp_a      '<empreinte sha256 64 caractères>'
--   \set fp_b      '<autre empreinte 64 caractères>'
--   \set r_a       '<uuid clé idempotence A>'
--   \set r_b       '<uuid clé idempotence B>'
--   \set r_c       '<uuid clé idempotence C>'
--   \set r_d       '<uuid clé idempotence D>'

set application_name = 'jisra-assistant-tx-audit';
set statement_timeout = '20s';
set lock_timeout = '10s';

\echo ''
\echo '== Contrôles préalables (lecture seule) =='
select p.oid::regprocedure as fonction,
       pg_get_userbyid(p.proowner) as owner,
       p.prosecdef,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname like 'rpc_assistant_%'
 order by 1::text;

\echo 'GO seulement si : complete/finalize non exécutables par authenticated,'
\echo 'aucune surcharge, policies limitées à authenticated.'

\echo ''
\echo '== Captures de référence (à comparer après chaque scénario) =='
select
  (select count(*) from public.chat_messages where thread_id = :'t_thread') as messages,
  (select count(*) from public.ai_usage where thread_id = :'t_thread') as usage_rows,
  (select credits_used from public.ai_credit_wallets where user_id = :'u_owner') as wallet_used,
  (select count(*) from public.assistant_requests where user_id = :'u_owner') as requests;

-- ---------------------------------------------------------------------------
-- Assertions utilitaires (à exécuter après chaque scénario)
-- ---------------------------------------------------------------------------
-- select r.request_id, r.state, r.credit_status, r.credits_reserved,
--        r.credits_consumed, r.credits_charged, r.lease_until
--   from public.assistant_requests r where r.user_id = :'u_owner'
--  order by r.created_at;
--
-- Invariants permanents :
--   * credits_charged <= credits_consumed pour toute ligne ;
--   * une seule ligne par (user_id, request_id) ;
--   * aucun état 'completed' sans assistant_message_id ;
--   * aucun état 'in_progress' avec lease_until > now() + 3 min.

-- ===========================================================================
-- R1 — Première acquisition
-- ===========================================================================
\echo '== R1 : SESSION A =='
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'u_owner', true);
select set_config('request.jwt.claims',
  jsonb_build_object('sub', :'u_owner', 'role', 'authenticated')::text, true);

select * from public.rpc_assistant_begin_request(
  :'r_a', :'s_store'::uuid, :'t_thread'::uuid, :'fp_a'
);
-- Attendu : state = in_progress, attempt_token non nul, thread_id = t_thread.
commit;

-- ===========================================================================
-- R2 — Même clé concurrente
-- ===========================================================================
\echo '== R2 : SESSION A (garde la transaction ouverte) =='
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'u_owner', true);
select set_config('request.jwt.claims',
  jsonb_build_object('sub', :'u_owner', 'role', 'authenticated')::text, true);
select * from public.rpc_assistant_begin_request(
  :'r_b', :'s_store'::uuid, :'t_thread'::uuid, :'fp_a'
);
-- >>> COORDINATION : lancer maintenant la SESSION B, puis revenir ici.
-- >>> Ne pas committer avant que B ait signalé son attente.

\echo '== R2 : SESSION B (pendant que A est ouverte) =='
-- \set ON_ERROR_STOP off pendant ce bloc
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'u_owner', true);
select set_config('request.jwt.claims',
  jsonb_build_object('sub', :'u_owner', 'role', 'authenticated')::text, true);
savepoint expected_busy;
select * from public.rpc_assistant_begin_request(
  :'r_b', :'s_store'::uuid, :'t_thread'::uuid, :'fp_a'
);
-- Attendu : erreur P0001 / IDEMPOTENCY_IN_PROGRESS (B attend le verrou de A).
rollback to savepoint expected_busy;
rollback;
-- >>> COORDINATION : revenir en SESSION A pour committer.

\echo '== R2 : SESSION A (libération) =='
commit;

\echo '== R2 : vérification (une seule ligne, un seul jeton) =='
select request_id, count(*) as rows, count(distinct attempt_token) as tokens
  from public.assistant_requests
 where user_id = :'u_owner' and request_id = :'r_b'
 group by request_id;

-- ===========================================================================
-- R3 — Même clé, empreinte différente
-- ===========================================================================
\echo '== R3 : SESSION A =='
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'u_owner', true);
select set_config('request.jwt.claims',
  jsonb_build_object('sub', :'u_owner', 'role', 'authenticated')::text, true);
savepoint expected_conflict;
select * from public.rpc_assistant_begin_request(
  :'r_b', :'s_store'::uuid, :'t_thread'::uuid, :'fp_b'
);
-- Attendu : P0001 / IDEMPOTENCY_CONFLICT, empreinte et jeton inchangés.
rollback to savepoint expected_conflict;
rollback;

-- ===========================================================================
-- R4 — Expiration réelle du bail, puis reprise
-- ===========================================================================
\echo '== R4 : SESSION A (acquisition puis sortie de transaction) =='
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'u_owner', true);
select set_config('request.jwt.claims',
  jsonb_build_object('sub', :'u_owner', 'role', 'authenticated')::text, true);
select attempt_token as token_r4
  from public.rpc_assistant_begin_request(:'r_c', :'s_store'::uuid, :'t_thread'::uuid, :'fp_a')
\gset
commit;

\echo 'Attendre l''expiration du bail (2 minutes) HORS transaction :'
select pg_sleep(130);

\echo '== R4 : reprise par le même utilisateur (nouveau jeton) =='
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'u_owner', true);
select set_config('request.jwt.claims',
  jsonb_build_object('sub', :'u_owner', 'role', 'authenticated')::text, true);
select attempt_token as token_r4_new
  from public.rpc_assistant_begin_request(:'r_c', :'s_store'::uuid, :'t_thread'::uuid, :'fp_a')
\gset
commit;

select :'token_r4' <> :'token_r4_new' as token_rotated;

\echo '== R4 : l''ancien jeton doit être refusé par bind =='
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'u_owner', true);
select set_config('request.jwt.claims',
  jsonb_build_object('sub', :'u_owner', 'role', 'authenticated')::text, true);
savepoint expected_old_token;
select public.rpc_assistant_bind_request_thread(:'r_c', :'token_r4'::uuid, :'t_thread'::uuid);
-- Attendu : P0001 / IDEMPOTENCY_TOKEN_MISMATCH
rollback to savepoint expected_old_token;
rollback;

-- ===========================================================================
-- R5 — Bail expirant PENDANT l'attente d'un verrou (horloge réelle)
--      Régression historique : `now()` (début de transaction) aurait fait
--      croire à B que le bail de A était encore valide.
-- ===========================================================================
\echo '== R5 : SESSION A (acquisition, puis attente longue SANS commit) =='
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'u_owner', true);
select set_config('request.jwt.claims',
  jsonb_build_object('sub', :'u_owner', 'role', 'authenticated')::text, true);
select * from public.rpc_assistant_begin_request(
  :'r_d', :'s_store'::uuid, :'t_thread'::uuid, :'fp_a'
);
-- >>> COORDINATION : lancer la SESSION B (qui va se bloquer), puis
select pg_sleep(130);
commit;
-- Le bail de A est désormais expiré au commit.

\echo '== R5 : SESSION B (démarrée AVANT le commit de A) =='
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'u_owner', true);
select set_config('request.jwt.claims',
  jsonb_build_object('sub', :'u_owner', 'role', 'authenticated')::text, true);
-- B attend le verrou de A : la transaction de B démarre avant l'expiration.
select attempt_token as token_r5
  from public.rpc_assistant_begin_request(:'r_d', :'s_store'::uuid, :'t_thread'::uuid, :'fp_a')
\gset
commit;
-- Attendu : B REPREND (nouveau jeton). Si B lève IDEMPOTENCY_IN_PROGRESS,
-- la correction d'horloge est en échec : NO-GO.

-- ===========================================================================
-- R6 — Finalisation concurrente de la même clé
-- ===========================================================================
\echo '== R6 : acquisition préalable (clé r_e, à créer) =='
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'u_owner', true);
select set_config('request.jwt.claims',
  jsonb_build_object('sub', :'u_owner', 'role', 'authenticated')::text, true);
select attempt_token as token_r6
  from public.rpc_assistant_begin_request(:'r_e', :'s_store'::uuid, :'t_thread'::uuid, :'fp_a')
\gset
commit;

\echo '== R6 : SESSION A (service_role, finalisation non commitée) =='
begin;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select 'A' as session, replayed, credit_status, credits_consumed, credits_charged
  from public.rpc_assistant_finalize_request(
    :'u_owner'::uuid, :'t_thread'::uuid, :'r_e', :'fp_a', :'token_r6'::uuid,
    :'s_store'::uuid, 'audit',
    'Question synthétique R6', 'Réponse synthétique R6',
    jsonb_build_object('request_id', :'r_e', 'request_fingerprint', :'fp_a'),
    3,
    '{"input_tokens":25,"output_tokens":50,"provider_name":"synthetic",
      "model_name":"audit","provider_cost_usd":0.001}'::jsonb,
    NULL
  );
-- >>> COORDINATION : lancer la SESSION B avant ce COMMIT.
commit;

\echo '== R6 : SESSION B (même requête, après le commit de A) =='
begin;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select 'B' as session, replayed, credit_status, credits_consumed, credits_charged
  from public.rpc_assistant_finalize_request(
    :'u_owner'::uuid, :'t_thread'::uuid, :'r_e', :'fp_a', :'token_r6'::uuid,
    :'s_store'::uuid, 'audit',
    'Question synthétique R6', 'Réponse synthétique R6',
    jsonb_build_object('request_id', :'r_e', 'request_fingerprint', :'fp_a'),
    3,
    '{"input_tokens":25,"output_tokens":50,"provider_name":"synthetic",
      "model_name":"audit","provider_cost_usd":0.001}'::jsonb,
    NULL
  );
-- Attendu B : replayed = true, mêmes montants, AUCUN nouveau débit.
commit;

-- ===========================================================================
-- R7 — Rejeu d'une première question sans `thread_id`
-- ===========================================================================
\echo '== R7 : première question, aucune conversation initiale =='
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'u_owner', true);
select set_config('request.jwt.claims',
  jsonb_build_object('sub', :'u_owner', 'role', 'authenticated')::text, true);
select attempt_token as token_r7
  from public.rpc_assistant_begin_request(:'r_f', :'s_store'::uuid, NULL, :'fp_a')
\gset
commit;

\echo '== R7 : liaison de la conversation créée APRÈS acquisition =='
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'u_owner', true);
select set_config('request.jwt.claims',
  jsonb_build_object('sub', :'u_owner', 'role', 'authenticated')::text, true);
select public.rpc_assistant_bind_request_thread(:'r_f', :'token_r7'::uuid, :'t_thread'::uuid);
commit;

\echo '== R7 : finalisation puis rejeu avec la même clé et sans thread =='
begin;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select replayed from public.rpc_assistant_finalize_request(
  :'u_owner'::uuid, :'t_thread'::uuid, :'r_f', :'fp_a', :'token_r7'::uuid,
  :'s_store'::uuid, 'audit', 'Question R7', 'Réponse R7',
  jsonb_build_object('request_id', :'r_f', 'request_fingerprint', :'fp_a'),
  2, '{"input_tokens":10,"output_tokens":20}'::jsonb, NULL
);
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'u_owner', true);
select set_config('request.jwt.claims',
  jsonb_build_object('sub', :'u_owner', 'role', 'authenticated')::text, true);
select state, thread_id, assistant_message_id
  from public.rpc_assistant_begin_request(:'r_f', :'s_store'::uuid, NULL, :'fp_a');
commit;
-- Attendu : state = completed, thread_id NON NULL (régression corrigée).

-- ===========================================================================
-- R8 — Crash / interruption avant commit
-- ===========================================================================
\echo '== R8 : transaction interrompue =='
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'u_owner', true);
select set_config('request.jwt.claims',
  jsonb_build_object('sub', :'u_owner', 'role', 'authenticated')::text, true);
select * from public.rpc_assistant_begin_request(
  :'r_g', :'s_store'::uuid, :'t_thread'::uuid, :'fp_a'
);
rollback;   -- équivalent d'un crash : rien n'est publié

\echo 'Vérification : aucune ligne pour r_g'
select count(*) as must_be_zero
  from public.assistant_requests
 where user_id = :'u_owner' and request_id = :'r_g';
-- Complément manuel : couper la connexion cliente pendant la transaction doit
-- produire le même résultat.

-- ===========================================================================
-- R9 — Révocation avant finalisation
-- ===========================================================================
\echo '== R9 : acquisition puis révocation synthétique de l''accès =='
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'u_admin', true);
select set_config('request.jwt.claims',
  jsonb_build_object('sub', :'u_admin', 'role', 'authenticated')::text, true);
select attempt_token as token_r9
  from public.rpc_assistant_begin_request(:'r_h', :'s_store'::uuid, :'t_thread'::uuid, :'fp_a')
\gset
commit;

-- ATTENTION : opération synthétique, base jetable uniquement. Vérifier le nom
-- de la colonne de rôle sur le schéma réel (précondition §2.3 du RUNBOOK).
update public.store_members
   set status = 'revoked'
 where store_id = :'s_store'::uuid and user_id = :'u_admin'::uuid;

\echo '== R9 : la finalisation doit échouer (FORBIDDEN_STORE) =='
begin;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
savepoint expected_forbidden;
select replayed from public.rpc_assistant_finalize_request(
  :'u_admin'::uuid, :'t_thread'::uuid, :'r_h', :'fp_a', :'token_r9'::uuid,
  :'s_store'::uuid, 'audit', 'Question R9', 'Réponse R9',
  jsonb_build_object('request_id', :'r_h', 'request_fingerprint', :'fp_a'),
  1, '{}'::jsonb, NULL
);
rollback to savepoint expected_forbidden;
rollback;

-- ===========================================================================
-- R10 — Journal d'usage invalide : rollback complet
-- ===========================================================================
\echo '== R10 : finalisation avec p_usage invalide =='
begin;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
savepoint expected_invalid_usage;
select replayed from public.rpc_assistant_finalize_request(
  :'u_owner'::uuid, :'t_thread'::uuid, :'r_i', :'fp_a', :'token_r10'::uuid,
  :'s_store'::uuid, 'audit', 'Question R10', 'Réponse R10',
  jsonb_build_object('request_id', :'r_i', 'request_fingerprint', :'fp_a'),
  2, '{"input_tokens":"invalide"}'::jsonb, 'Titre qui ne doit pas persister'
);
-- Attendu : P0001 / INVALID_USAGE
rollback to savepoint expected_invalid_usage;
rollback;

\echo 'Vérification : aucun message, aucun usage'
select count(*) as must_be_zero_messages
  from public.chat_messages
 where thread_id = :'t_thread' and content = 'Réponse R10';

-- ===========================================================================
-- R11 — Écriture ai_usage refusée au client authentifié
-- ===========================================================================
\echo '== R11 : tentative d''insertion ai_usage par authenticated =='
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'u_owner', true);
select set_config('request.jwt.claims',
  jsonb_build_object('sub', :'u_owner', 'role', 'authenticated')::text, true);
savepoint expected_privilege_denied;
insert into public.ai_usage (user_id, store_id, thread_id, feature, credits_used)
values (:'u_owner'::uuid, :'s_store'::uuid, :'t_thread'::uuid, 'chatbot', 999);
-- Attendu : 42501 (permission denied) ou violation RLS — jamais un succès.
rollback to savepoint expected_privilege_denied;
rollback;

-- ===========================================================================
-- R12 — Suppression de conversation concurrente d'une finalisation
-- ===========================================================================
\echo '== R12 : SESSION A (finalisation ouverte) =='
begin;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select replayed from public.rpc_assistant_finalize_request(
  :'u_owner'::uuid, :'t_thread'::uuid, :'r_j', :'fp_a', :'token_r12'::uuid,
  :'s_store'::uuid, 'audit', 'Question R12', 'Réponse R12',
  jsonb_build_object('request_id', :'r_j', 'request_fingerprint', :'fp_a'),
  1, '{}'::jsonb, NULL
);
-- >>> COORDINATION : lancer la suppression en SESSION B avant ce COMMIT.
commit;

\echo '== R12 : SESSION B (suppression concurrente de la conversation) =='
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'u_owner', true);
select set_config('request.jwt.claims',
  jsonb_build_object('sub', :'u_owner', 'role', 'authenticated')::text, true);
delete from public.chat_threads where id = :'t_thread'::uuid;
commit;
-- Attendu : soit B attend puis supprime, soit PostgreSQL résout un deadlock
-- (40P01). Dans les deux cas : aucune ligne orpheline, aucun débit sans
-- message ; tout deadlock doit être journalisé puis rejoué sans corruption.

-- ===========================================================================
-- S1 — Crédits insuffisants : aucun dépassement, aucun débit
-- ===========================================================================
\echo '== S1 : portefeuille volontairement presque épuisé (base jetable) =='
update public.ai_credit_wallets
   set credits_used = greatest(0, monthly_credits - 1)
 where user_id = :'u_owner'::uuid;

\echo '== S1 : finalisation coûteuse (2 crédits pour 1 disponible) =='
begin;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select credit_status, credits_consumed, credits_charged
  from public.rpc_assistant_finalize_request(
    :'u_owner'::uuid, :'t_thread'::uuid, :'r_k', :'fp_a', :'token_s1'::uuid,
    :'s_store'::uuid, 'audit', 'Question S1', 'Réponse S1',
    jsonb_build_object('request_id', :'r_k', 'request_fingerprint', :'fp_a'),
    2, '{}'::jsonb, NULL
  );
commit;
-- Attendu : credit_status = insufficient, credits_consumed = 2,
-- credits_charged = 0, et `credits_used` du portefeuille INCHANGÉ.

select credits_used, monthly_credits
  from public.ai_credit_wallets
 where user_id = :'u_owner'::uuid;
-- Invariant : credits_used <= monthly_credits (aucun dépassement).

-- ===========================================================================
-- Clôture : réconciliation et nettoyage
-- ===========================================================================
select credit_status, count(*) as requests,
       sum(credits_reserved) as reserved,
       sum(credits_consumed) as consumed,
       sum(credits_charged) as charged
  from public.assistant_requests
 where user_id in (:'u_owner'::uuid, :'u_admin'::uuid)
 group by credit_status;

select count(*) as violated_rows
  from public.assistant_requests
 where credits_charged > credits_consumed;   -- attendu : 0

\echo 'Nettoyage : détruire la base jetable selon la procédure autorisée, ou'
\echo 'supprimer les fixtures synthétiques (profiles, stores, chat_threads,'
\echo 'chat_messages, ai_usage, ai_credit_wallets, assistant_requests).'
\echo 'Conserver les sorties psql comme preuves de validation.'
