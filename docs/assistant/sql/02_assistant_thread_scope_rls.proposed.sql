-- ============================================================================
-- PROPOSITION — NE PAS EXÉCUTER SANS VALIDATION EXPLICITE
-- Objet : RLS de l'historique de l'assistant + immuabilité des conversations.
--
-- Constats :
--   * les policies actuelles ne vérifient que `user_id = auth.uid()` : un
--     utilisateur rétrogradé (owner -> viewer) ou retiré d'une boutique garde
--     l'accès direct PostgREST à un historique contenant coûts et marges ;
--   * `chat_threads.store_id` est librement modifiable par le propriétaire, ce
--     qui permet de rattacher un ancien historique à un autre périmètre ;
--   * 13 conversations sur 26 ont `store_id = NULL` (orphelines) : leur portée
--     métier n'est plus vérifiable.
--
-- Décision de sécurité : la lecture de l'historique exige un accès financier
-- `full` COURANT sur la boutique (gate identique à l'API). Les conversations
-- sans boutique sont QUARANTINE : elles ne sont plus lisibles via PostgREST.
-- Le propriétaire peut toujours les supprimer (effacement de ses données).
--
-- Prérequis : 01_ appliquée (noms de policies). Ordre : 01 puis 02.
-- ============================================================================
begin;

-- 1. Accès courant à la boutique de la conversation, niveau financier inclus.
--    `false` pour store_id NULL : quarantaine, jamais de portée implicite.
create or replace function public.assistant_can_read_thread(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_store_id is not null
     and public.can_view_store_finances(p_store_id);
$$;

revoke all on function public.assistant_can_read_thread(uuid) from public, anon;
grant execute on function public.assistant_can_read_thread(uuid) to authenticated;

-- 2. Lecture des conversations et des messages.
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

-- 3. Création : toute nouvelle conversation est liée à une boutique autorisée.
drop policy if exists "Users can insert their chat threads" on public.chat_threads;
drop policy if exists chat_threads_insert_own on public.chat_threads;
create policy chat_threads_insert_own on public.chat_threads
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and store_id is not null
    and public.assistant_can_read_thread(store_id)
  );

-- 4. Immuabilité : ni le propriétaire ni la boutique de la conversation ne
--    peuvent être réécrits (renommage, épinglage et updated_at restent libres).
create or replace function public.assistant_thread_guard()
returns trigger
language plpgsql
set search_path = public
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

-- 5. Suppression : reste possible sur son propre historique (droit à l'effacement),
--    y compris pour une conversation en quarantaine.
drop policy if exists "Users can delete their chat threads" on public.chat_threads;
drop policy if exists chat_threads_delete_own on public.chat_threads;
create policy chat_threads_delete_own on public.chat_threads
  for delete to authenticated using (user_id = auth.uid());

commit;

-- Évolution prévue (non incluse) : quand le mode `commercial` sera livré, la
-- fonction devra accepter les rôles commercialement autorisés ET l'historique
-- devra être rédigé (aucun coût/marge resservi). Tant que ce n'est pas fait,
-- `full` reste la seule condition d'accès à l'historique.

-- Rollback 02 :
--   drop trigger if exists trg_assistant_thread_guard on public.chat_threads;
--   drop function if exists public.assistant_thread_guard();
--   drop function if exists public.assistant_can_read_thread(uuid);
--   puis recréer les policies d'origine (user_id = auth.uid() uniquement).

