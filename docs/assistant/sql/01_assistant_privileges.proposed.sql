-- ============================================================================
-- PROPOSITION — NE PAS EXÉCUTER SANS VALIDATION EXPLICITE
-- Fichier volontairement hors de `supabase/migrations/` : un `supabase db push`
-- ne peut donc pas l'appliquer par inadvertance.
--
-- Objet : moindre privilège sur les tables de l'assistant IA.
--
-- Constat vérifié en lecture sur la production :
--   anon            : SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--   authenticated   : idem, sur chat_threads, chat_messages, ai_usage
--   policies        : accordées au rôle `public` (donc anon inclus)
--   chat_messages   : aucune policy UPDATE/DELETE (donc refus RLS) mais les
--                     privilèges restent accordés ; TRUNCATE n'est pas filtré
--                     par RLS.
--
-- Section 1 : applicable sans changement de code (aucun impact fonctionnel).
-- Section 2 : nécessite le changement de code décrit (écriture assistant via RPC).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- SECTION 1 — Sans impact fonctionnel
-- ---------------------------------------------------------------------------
begin;

-- 1.1 Aucun accès anonyme : l'assistant exige une session authentifiée.
revoke all on public.chat_threads, public.chat_messages, public.ai_usage from anon;

-- 1.2 Supprimer les privilèges non nécessaires (TRUNCATE n'est pas couvert par RLS).
revoke truncate, references, trigger
  on public.chat_threads, public.chat_messages, public.ai_usage
  from authenticated;

-- 1.3 Messages et journal IA : ajout seul.
revoke update, delete on public.chat_messages from authenticated;
revoke update, delete on public.ai_usage from authenticated;

-- 1.4 Restreindre les policies existantes au rôle `authenticated`
--     (prédicats inchangés, aucun changement de comportement applicatif).
drop policy if exists "Users can view their chat threads" on public.chat_threads;
create policy chat_threads_select_own on public.chat_threads
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can insert their chat threads" on public.chat_threads;
create policy chat_threads_insert_own on public.chat_threads
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Users can update their chat threads" on public.chat_threads;
create policy chat_threads_update_own on public.chat_threads
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Users can delete their chat threads" on public.chat_threads;
create policy chat_threads_delete_own on public.chat_threads
  for delete to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can view messages of their threads" on public.chat_messages;
create policy chat_messages_select_own_thread on public.chat_messages
  for select to authenticated
  using (exists (
    select 1 from public.chat_threads ct
     where ct.id = chat_messages.thread_id
       and ct.user_id = auth.uid()
  ));

drop policy if exists "Users can insert messages in their threads" on public.chat_messages;
create policy chat_messages_insert_own_thread on public.chat_messages
  for insert to authenticated
  with check (exists (
    select 1 from public.chat_threads ct
     where ct.id = chat_messages.thread_id
       and ct.user_id = auth.uid()
  ));

drop policy if exists "Users can view their AI usage" on public.ai_usage;
create policy ai_usage_select_own on public.ai_usage
  for select to authenticated
  using (user_id = auth.uid());

commit;

-- Rollback section 1 (remettre l'état antérieur) :
--   grant all on public.chat_threads, public.chat_messages, public.ai_usage to anon;
--   grant truncate, references, trigger on public.chat_threads, public.chat_messages, public.ai_usage to authenticated;
--   puis recréer les policies d'origine (nom + prédicat identiques).

-- ---------------------------------------------------------------------------
-- SECTION 2 — Écriture des messages assistant via RPC (NÉCESSITE UN CHANGEMENT DE CODE)
--
-- Problème : `authenticated` peut insérer un message `assistant` ou `system`
-- dans son propre thread (fabrication d'historique et de mémoire analytique).
-- Correctif : la table n'accepte plus que `role = 'user'` depuis le client ;
-- les réponses assistant sont écrites par une fonction SECURITY DEFINER qui
-- vérifie la propriété du thread.
--
-- IMPACT CODE OBLIGATOIRE AVANT APPLICATION :
--   lib/assistant/chat.ts -> addMessage() avec role 'assistant' doit appeler
--   supabase.rpc('rpc_assistant_append_message', {...}) au lieu d'un INSERT.
-- Sans ce changement, la persistance des réponses échoue (RLS).
-- ---------------------------------------------------------------------------
begin;

create or replace function public.rpc_assistant_append_message(
  p_thread_id uuid,
  p_role text,
  p_content text,
  p_credits_used integer default 0,
  p_metadata jsonb default null
)
returns public.chat_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message public.chat_messages;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;

  if p_role not in ('assistant', 'system') then
    raise exception 'INVALID_ROLE' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.chat_threads ct
     where ct.id = p_thread_id
       and ct.user_id = auth.uid()
  ) then
    raise exception 'THREAD_NOT_FOUND' using errcode = 'P0001';
  end if;

  insert into public.chat_messages (thread_id, role, content, credits_used, metadata)
  values (
    p_thread_id,
    p_role,
    coalesce(p_content, ''),
    greatest(0, coalesce(p_credits_used, 0)),
    p_metadata
  )
  returning * into v_message;

  return v_message;
end;
$$;

revoke all on function public.rpc_assistant_append_message(uuid, text, text, integer, jsonb) from public, anon;
grant execute on function public.rpc_assistant_append_message(uuid, text, text, integer, jsonb) to authenticated;

drop policy if exists chat_messages_insert_own_thread on public.chat_messages;
create policy chat_messages_insert_own_thread on public.chat_messages
  for insert to authenticated
  with check (
    role = 'user'
    and exists (
      select 1 from public.chat_threads ct
       where ct.id = chat_messages.thread_id
         and ct.user_id = auth.uid()
    )
  );

commit;

-- Rollback section 2 :
--   drop function if exists public.rpc_assistant_append_message(uuid, text, text, integer, jsonb);
--   drop policy if exists chat_messages_insert_own_thread on public.chat_messages;
--   create policy chat_messages_insert_own_thread on public.chat_messages
--     for insert to authenticated
--     with check (exists (select 1 from public.chat_threads ct
--                          where ct.id = chat_messages.thread_id and ct.user_id = auth.uid()));
--   (et revenir à l'INSERT direct dans addMessage())

