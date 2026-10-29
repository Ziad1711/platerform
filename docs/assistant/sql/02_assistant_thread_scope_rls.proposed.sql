-- ============================================================================
-- 02 — Autorisation de l'assistant (helpers) + RLS de l'historique
-- PROPOSITION — ne pas exécuter sans le runbook unique :
--   docs/assistant/sql/RUNBOOK.md
--
-- Rejouable : oui (create or replace, drop policy/trigger if exists).
-- Prérequis : 01 appliquée.
--
-- Modèle d'autorisation, identique au gate applicatif
-- (lib/assistant/security.ts → requireAssistantStoreAccess) :
--   permission `ai_assistant.use` : owner, admin, viewer
--   ET accès financier `full`     : owner, admin, accountant
--   => effectivement owner et admin aujourd'hui (viewer = commercial,
--      accountant sans permission assistant).
--
-- Les helpers prennent l'utilisateur EXPLICITEMENT : aucun ne dépend de
-- `auth.uid()`, ce qui est indispensable pour la finalisation `service_role`
-- (05b) où `auth.uid()` est NULL. `assistant_can_read_thread(uuid)` reste le
-- seul adaptateur `auth.uid()`, réservé aux policies RLS.
--
-- Décision de sécurité : la lecture de l'historique exige ce gate COURANT. Les
-- conversations `store_id IS NULL` sont en quarantaine (lecture PostgREST
-- refusée) et restent supprimables par leur propriétaire.
--
-- Pré-requis opérationnel : toute reprise de `store_id` sur les conversations
-- historiques doit être faite AVANT ce fichier (le trigger d'immuabilité
-- l'interdit ensuite). Voir RUNBOOK.md §Préconditions.
-- ============================================================================
begin;

-- ---------------------------------------------------------------------------
-- 1. Helpers d'autorisation (source unique côté base)
-- ---------------------------------------------------------------------------

-- Rôles portant la permission applicative `ai_assistant.use`
-- (aligné sur lib/auth/permissions.ts : owner, admin, viewer).
create or replace function public.assistant_role_allows_use(p_role text)
returns boolean
language sql
immutable
set search_path = pg_temp
as $$
  select coalesce(p_role, '') in ('owner', 'admin', 'viewer');
$$;

-- Accès financier `full`, réplique de `can_view_store_finances` pour un
-- utilisateur explicite. La définition doit rester alignée sur la fonction
-- partagée par le Dashboard/Finances (contrôle fourni dans RUNBOOK.md).
create or replace function public.assistant_has_full_finances(
  p_store_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_store_id is not null
     and p_user_id is not null
     and (
       exists (
         select 1 from public.stores s
          where s.id = p_store_id and s.owner_user_id = p_user_id
       )
       or exists (
         select 1 from public.store_members sm
          where sm.store_id = p_store_id
            and sm.user_id = p_user_id
            and sm.status = 'active'
            and sm.role in ('owner', 'admin', 'accountant')
       )
     );
$$;

-- Gate complet de l'assistant : permission applicative ET finances `full`,
-- appréciés à l'instant de l'appel (aucun cache, aucune portée implicite).
create or replace function public.assistant_can_use_store(
  p_store_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_store_id is not null
     and p_user_id is not null
     and public.assistant_has_full_finances(p_store_id, p_user_id)
     and (
       exists (
         select 1 from public.stores s
          where s.id = p_store_id and s.owner_user_id = p_user_id
       )
       or exists (
         select 1 from public.store_members sm
          where sm.store_id = p_store_id
            and sm.user_id = p_user_id
            and sm.status = 'active'
            and public.assistant_role_allows_use(sm.role)
       )
     );
$$;

-- Adaptateur RLS : `false` pour `store_id IS NULL` (quarantaine, jamais de
-- portée implicite).
create or replace function public.assistant_can_read_thread(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.assistant_can_use_store(p_store_id, auth.uid());
$$;


-- ---------------------------------------------------------------------------
-- 2. Immuabilité du propriétaire et de la boutique de la conversation
--    (renommage, épinglage et updated_at restent libres)
-- ---------------------------------------------------------------------------
create or replace function public.assistant_thread_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'THREAD_OWNER_IMMUTABLE' using errcode = 'P0001';
  end if;
  if new.store_id is distinct from old.store_id then
    raise exception 'THREAD_STORE_IMMUTABLE' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assistant_thread_guard on public.chat_threads;
create trigger trg_assistant_thread_guard
  before update on public.chat_threads
  for each row execute function public.assistant_thread_guard();

-- ---------------------------------------------------------------------------
-- 3. Policies (rejouables : ancien nom ET nom courant supprimés)
-- ---------------------------------------------------------------------------

drop policy if exists "Users can view their chat threads" on public.chat_threads;
drop policy if exists chat_threads_select_own on public.chat_threads;
create policy chat_threads_select_own on public.chat_threads
  for select to authenticated
  using (user_id = auth.uid() and public.assistant_can_read_thread(store_id));

drop policy if exists "Users can view messages of their threads" on public.chat_messages;
drop policy if exists chat_messages_select_own_thread on public.chat_messages;
create policy chat_messages_select_own_thread on public.chat_messages
  for select to authenticated
  using (exists (
    select 1 from public.chat_threads ct
     where ct.id = chat_messages.thread_id
       and ct.user_id = auth.uid()
       and public.assistant_can_read_thread(ct.store_id)
  ));

-- Création : boutique obligatoire et autorisée (jamais de portée implicite).
drop policy if exists "Users can insert their chat threads" on public.chat_threads;
drop policy if exists chat_threads_insert_own on public.chat_threads;
create policy chat_threads_insert_own on public.chat_threads
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and store_id is not null
    and public.assistant_can_read_thread(store_id)
  );

-- Messages client : uniquement `role = 'user'`, dans une conversation lisible.
drop policy if exists "Users can insert messages in their threads" on public.chat_messages;
drop policy if exists chat_messages_insert_own_thread on public.chat_messages;
create policy chat_messages_insert_own_thread on public.chat_messages
  for insert to authenticated
  with check (
    role = 'user'
    and exists (
      select 1 from public.chat_threads ct
       where ct.id = chat_messages.thread_id
         and ct.user_id = auth.uid()
         and public.assistant_can_read_thread(ct.store_id)
    )
  );

-- Mise à jour : titre/épinglage seulement (propriétaire et boutique figés par
-- le trigger ci-dessus).
drop policy if exists "Users can update their chat threads" on public.chat_threads;
drop policy if exists chat_threads_update_own on public.chat_threads;
create policy chat_threads_update_own on public.chat_threads
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Suppression : droit à l'effacement, y compris conversation en quarantaine.
drop policy if exists "Users can delete their chat threads" on public.chat_threads;
drop policy if exists chat_threads_delete_own on public.chat_threads;
create policy chat_threads_delete_own on public.chat_threads
  for delete to authenticated using (user_id = auth.uid());

commit;

-- ============================================================================
-- Évolution prévue (non incluse) : quand le mode `commercial` sera livré, le
-- helper devra accepter les rôles commercialement autorisés ET l'historique
-- devra être rédigé (aucun coût/marge resservi) avant tout relâchement.
--
-- Rollback 02 (ordre des dépendances) :
--   drop policy if exists chat_threads_select_own on public.chat_threads;
--   drop policy if exists chat_messages_select_own_thread on public.chat_messages;
--   drop policy if exists chat_threads_insert_own on public.chat_threads;
--   drop policy if exists chat_messages_insert_own_thread on public.chat_messages;
--   drop policy if exists chat_threads_update_own on public.chat_threads;
--   drop policy if exists chat_threads_delete_own on public.chat_threads;
--   puis recréer les policies d'origine (prédicat `user_id = auth.uid()` seul) ;
--   drop trigger if exists trg_assistant_thread_guard on public.chat_threads;
--   drop function if exists public.assistant_can_read_thread(uuid);
--   drop function if exists public.assistant_thread_guard();
--   (conserver assistant_can_use_store / assistant_has_full_finances tant que
--    03b/05b sont installées : leurs définitions en dépendent.)
-- ============================================================================

revoke all on function public.assistant_role_allows_use(text) from public, anon, authenticated;
revoke all on function public.assistant_has_full_finances(uuid, uuid) from public, anon, authenticated;
revoke all on function public.assistant_can_use_store(uuid, uuid) from public, anon, authenticated;
revoke all on function public.assistant_can_read_thread(uuid) from public, anon;
grant execute on function public.assistant_can_read_thread(uuid) to authenticated, service_role;
grant execute on function public.assistant_can_use_store(uuid, uuid) to service_role;
grant execute on function public.assistant_has_full_finances(uuid, uuid) to service_role;
grant execute on function public.assistant_role_allows_use(text) to service_role;
