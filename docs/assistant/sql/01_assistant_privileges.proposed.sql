-- ============================================================================
-- 01 — Moindre privilège sur les tables de l'assistant IA
-- PROPOSITION — ne pas exécuter sans le runbook unique :
--   docs/assistant/sql/RUNBOOK.md
--
-- Rejouable : oui (revoke répétables, drop policy if exists avant create).
-- Prérequis : aucun changement de code pour cette étape, MAIS le backend
-- `service_role` doit déjà écrire `chat_messages`(assistant) et `ai_usage`
-- (lib/assistant/finalization.ts). Vérifier avant application : sans lui, les
-- réponses assistant et le journal d'usage cesseraient d'être écrits.
--
-- Effets :
--   1. aucun accès anonyme (anon ni PUBLIC) ;
--   2. retrait de TRUNCATE / REFERENCES / TRIGGER (non filtrés par RLS) ;
--   3. journal `ai_usage` en ajout serveur uniquement : INSERT/UPDATE/DELETE
--      retirés à `authenticated`, policies d'insertion historique supprimées ;
--   4. messages en ajout seul côté client, `role = 'user'` exclusivement ;
--   5. policies rejouables, limitées au rôle `authenticated`.
--
-- Constat de reprise (lecture seule, AVANT la transaction) : toute policy
-- inattendue doit être traitée explicitement.
--   select tablename, policyname, roles, cmd, qual, with_check
--     from pg_policies
--    where schemaname = 'public'
--      and tablename in ('chat_threads','chat_messages','ai_usage');
-- ============================================================================
begin;

-- 1. Aucun accès anonyme.
revoke all on public.chat_threads, public.chat_messages, public.ai_usage
  from anon;
revoke all on public.chat_threads, public.chat_messages, public.ai_usage
  from public;

-- 2. Privilèges non nécessaires à une session authentifiée.
revoke truncate, references, trigger
  on public.chat_threads, public.chat_messages, public.ai_usage
  from authenticated;
revoke truncate, references, trigger
  on public.ai_credit_wallets
  from authenticated, anon;
-- Défensif : les écritures du portefeuille passent déjà par des RPC serveur
-- (20260928020200). Répéter la révocation rend l'état explicite et rejouable.
revoke insert, update, delete on public.ai_credit_wallets from authenticated;
grant select on public.ai_credit_wallets to authenticated;

-- 3. Journal d'usage : écriture serveur uniquement (aucune falsification de
--    consommation ni d'imputation de coût par un client authentifié).
revoke insert, update, delete on public.ai_usage from authenticated;
grant select on public.ai_usage to authenticated;

drop policy if exists "Users can insert their AI usage" on public.ai_usage;
drop policy if exists ai_usage_insert_own_scoped_store on public.ai_usage;
drop policy if exists ai_usage_insert_own on public.ai_usage;

-- 4. Messages : ajout seul côté client, jamais une réponse assistant.
revoke update, delete on public.chat_messages from authenticated;
grant select, insert on public.chat_messages to authenticated;

-- 5. Conversations : lecture/création/renommage/suppression de SA conversation
--    (02 ajoute la condition boutique + permission courante).
grant select, insert, update, delete on public.chat_threads to authenticated;

drop policy if exists "Users can view their chat threads" on public.chat_threads;
drop policy if exists chat_threads_select_own on public.chat_threads;
create policy chat_threads_select_own on public.chat_threads
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "Users can insert their chat threads" on public.chat_threads;
drop policy if exists chat_threads_insert_own on public.chat_threads;
create policy chat_threads_insert_own on public.chat_threads
  for insert to authenticated
  with check (user_id = auth.uid() and store_id is not null);

drop policy if exists "Users can update their chat threads" on public.chat_threads;
drop policy if exists chat_threads_update_own on public.chat_threads;
create policy chat_threads_update_own on public.chat_threads
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "Users can delete their chat threads" on public.chat_threads;
drop policy if exists chat_threads_delete_own on public.chat_threads;
create policy chat_threads_delete_own on public.chat_threads
  for delete to authenticated using (user_id = auth.uid());

drop policy if exists "Users can view messages of their threads" on public.chat_messages;
drop policy if exists chat_messages_select_own_thread on public.chat_messages;
create policy chat_messages_select_own_thread on public.chat_messages
  for select to authenticated
  using (exists (
    select 1 from public.chat_threads ct
     where ct.id = chat_messages.thread_id and ct.user_id = auth.uid()
  ));

drop policy if exists "Users can insert messages in their threads" on public.chat_messages;
drop policy if exists chat_messages_insert_own_thread on public.chat_messages;
create policy chat_messages_insert_own_thread on public.chat_messages
  for insert to authenticated
  with check (
    role = 'user'
    and exists (
      select 1 from public.chat_threads ct
       where ct.id = chat_messages.thread_id and ct.user_id = auth.uid()
    )
  );

drop policy if exists "Users can view their AI usage" on public.ai_usage;
drop policy if exists ai_usage_select_own on public.ai_usage;
create policy ai_usage_select_own on public.ai_usage
  for select to authenticated using (user_id = auth.uid());

commit;


-- ============================================================================
-- Contrôles après application (lecture seule) :
--   select grantee, table_name, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name in ('chat_threads','chat_messages','ai_usage','ai_credit_wallets')
--      and grantee in ('anon','authenticated','service_role','PUBLIC')
--    order by table_name, grantee, privilege_type;
--   select tablename, policyname, roles, cmd
--     from pg_policies
--    where schemaname = 'public'
--      and tablename in ('chat_threads','chat_messages','ai_usage')
--    order by tablename, policyname;
-- Attendu : aucun privilège pour anon/PUBLIC ; authenticated sans TRUNCATE,
-- REFERENCES, TRIGGER ; ai_usage et ai_credit_wallets en SELECT seul pour
-- authenticated ; chat_messages en SELECT/INSERT seulement.
--
-- Rollback 01 (ne jamais réaccorder ALL à anon) :
--   grant insert, update, delete on public.ai_usage to authenticated;
--   grant insert, update, delete on public.ai_credit_wallets to authenticated;
--   puis restaurer les policies d'insertion d'origine si ce chemin d'écriture
--   client est volontairement rétabli (RUNBOOK.md §Rollback).
-- ============================================================================
