-- ============================================================================
-- PROPOSITION — NE PAS EXÉCUTER SANS VALIDATION EXPLICITE
-- Fichier hors de `supabase/migrations/` : `supabase db push` ne peut pas l'appliquer.
--
-- Objet : moindre privilège sur les tables de l'assistant IA.
--
-- Constat vérifié en lecture (production) :
--   anon / authenticated : SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--   policies accordées au rôle `public` (donc anon) ; TRUNCATE n'est pas filtré par RLS.
--
-- Cette migration NE crée AUCUNE fonction d'écriture accessible à `authenticated`.
-- L'écriture fiable des réponses est traitée par 05_ (backend uniquement).
-- Aucune restriction de rôle sur l'INSERT n'est appliquée ici : elle exigerait
-- le backend de 05_ déjà déployé (sinon les réponses assistant échouent).
--
-- Prérequis : RLS activée sur les 3 tables (déjà le cas).
-- Rollback : section finale, non destructive.
-- ============================================================================
begin;

-- 1. Aucun accès anonyme.
revoke all on public.chat_threads, public.chat_messages, public.ai_usage from anon;
revoke all on public.chat_threads, public.chat_messages, public.ai_usage from public;

-- 2. Privilèges non nécessaires à une session authentifiée.
revoke truncate, references, trigger
  on public.chat_threads, public.chat_messages, public.ai_usage
  from authenticated;

-- 3. Journal en ajout seul ; messages non modifiables par le client.
revoke update, delete on public.chat_messages from authenticated;
revoke update, delete on public.ai_usage from authenticated;

-- 4. Policies rejouables, restreintes au rôle `authenticated` (prédicats inchangés).
drop policy if exists "Users can view their chat threads" on public.chat_threads;
create policy chat_threads_select_own on public.chat_threads
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "Users can insert their chat threads" on public.chat_threads;
create policy chat_threads_insert_own on public.chat_threads
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "Users can update their chat threads" on public.chat_threads;
create policy chat_threads_update_own on public.chat_threads
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "Users can delete their chat threads" on public.chat_threads;
create policy chat_threads_delete_own on public.chat_threads
  for delete to authenticated using (user_id = auth.uid());

drop policy if exists "Users can view messages of their threads" on public.chat_messages;
create policy chat_messages_select_own_thread on public.chat_messages
  for select to authenticated
  using (exists (
    select 1 from public.chat_threads ct
     where ct.id = chat_messages.thread_id and ct.user_id = auth.uid()
  ));

drop policy if exists "Users can insert messages in their threads" on public.chat_messages;
create policy chat_messages_insert_own_thread on public.chat_messages
  for insert to authenticated
  with check (exists (
    select 1 from public.chat_threads ct
     where ct.id = chat_messages.thread_id and ct.user_id = auth.uid()
  ));

drop policy if exists "Users can view their AI usage" on public.ai_usage;
create policy ai_usage_select_own on public.ai_usage
  for select to authenticated using (user_id = auth.uid());

commit;

-- Contrôles après application (lecture seule) :
--   select grantee, table_name, privilege_type from information_schema.role_table_grants
--    where table_schema='public' and table_name like 'chat_%' or table_name='ai_usage';
--   select tablename, policyname, cmd, roles from pg_policies where schemaname='public';

-- NOTE v2 : l'insertion directe d'un message `assistant` ou `system` par
-- `authenticated` est INTERDITE ci-dessous ; les réponses de confiance passent
-- par le backend (service_role) et par 05b. À appliquer APRÈS déploiement du
-- code backend (sinon les réponses échouent volontairement, fail-closed).
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

-- Rollback (ne jamais réaccorder ALL à anon) :
--   grant select, insert, update, delete on public.chat_threads, public.chat_messages, public.ai_usage to authenticated;
--   puis recréer les policies d'origine (prédicats identiques).
