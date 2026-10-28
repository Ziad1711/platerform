-- ============================================================================
-- PROPOSITION — NE PAS EXÉCUTER SANS VALIDATION EXPLICITE
-- Objet : RLS de lecture des conversations alignée sur l'accès COURANT à la
-- boutique (défense en profondeur après révocation d'accès).
--
-- Constat : les policies actuelles ne vérifient que `user_id = auth.uid()`.
-- Un utilisateur rétrogradé ou retiré d'une boutique conserve donc l'accès
-- direct PostgREST à son historique, qui contient coûts, marges et profits.
-- L'API du Lot 1 refuse déjà ce cas ; cette migration ferme le chemin direct.
--
-- Effet de bord assumé : une conversation dont `store_id` est NULL (orpheline
-- après suppression de boutique, 13/26 en production) reste lisible par son
-- propriétaire. Voir 04_* pour la revue de ces conversations.
--
-- Ordre conseillé : 01 (privilèges) puis 02 (RLS).
-- ============================================================================
begin;

create or replace function public.assistant_thread_readable(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_store_id is null
      or exists (
           select 1 from public.stores s
            where s.id = p_store_id
              and s.owner_user_id = auth.uid()
         )
      or exists (
           select 1 from public.store_members sm
            where sm.store_id = p_store_id
              and sm.user_id = auth.uid()
              and sm.status = 'active'
         );
$$;

revoke all on function public.assistant_thread_readable(uuid) from public, anon;
grant execute on function public.assistant_thread_readable(uuid) to authenticated;

drop policy if exists "Users can view their chat threads" on public.chat_threads;
drop policy if exists chat_threads_select_own on public.chat_threads;
create policy chat_threads_select_own on public.chat_threads
  for select to authenticated
  using (user_id = auth.uid() and public.assistant_thread_readable(store_id));

drop policy if exists "Users can view messages of their threads" on public.chat_messages;
drop policy if exists chat_messages_select_own_thread on public.chat_messages;
create policy chat_messages_select_own_thread on public.chat_messages
  for select to authenticated
  using (exists (
    select 1 from public.chat_threads ct
     where ct.id = chat_messages.thread_id
       and ct.user_id = auth.uid()
       and public.assistant_thread_readable(ct.store_id)
  ));

drop policy if exists "Users can insert their chat threads" on public.chat_threads;
drop policy if exists chat_threads_insert_own on public.chat_threads;
create policy chat_threads_insert_own on public.chat_threads
  for insert to authenticated
  with check (user_id = auth.uid() and public.assistant_thread_readable(store_id));

commit;

-- Rollback 02 :
--   drop function if exists public.assistant_thread_readable(uuid);
--   puis recréer les policies d'origine (user_id = auth.uid() uniquement).
