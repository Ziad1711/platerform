-- ============================================================================
-- OBSOLÈTE — NE PAS APPLIQUER. Remplacé par 03b_assistant_idempotency_registry_v2
-- (attempt_token, credit_status, on conflict). Conservé pour historique seulement.
-- PROPOSITION — NE PAS EXÉCUTER SANS VALIDATION EXPLICITE
-- Objet : registre persistant d'idempotence des requêtes de l'assistant.
--
-- Comble la course inter-instances laissée ouverte par la clé stockée dans les
-- métadonnées des messages : la réservation est unique et atomique en base.
--
-- Garanties visées : une seule réservation active par (user_id, request_id) ;
-- même clé + empreinte différente => conflit ; reprise d'un bail expiré sans
-- double exécution silencieuse ; le client ne peut ni fabriquer une réponse ni
-- fixer un montant facturé.
--
-- NON garanti : l'exécution exactement-une-fois de l'appel fournisseur, et
-- l'atomicité complète tant que 05_ n'est pas appliquée.
--
-- Prérequis : 01_ et 02_. Ordre : 01 → 02 → 03 → 05.
-- Activation application : ASSISTANT_IDEMPOTENCY_REGISTRY=enabled
-- ============================================================================
begin;

create table if not exists public.assistant_requests (
  user_id              uuid        not null references public.profiles(id) on delete cascade,
  request_id           text        not null check (char_length(request_id) between 8 and 100),
  store_id             uuid        not null references public.stores(id) on delete cascade,
  thread_id            uuid        references public.chat_threads(id) on delete set null,
  fingerprint          text        not null check (char_length(fingerprint) = 64),
  state                text        not null default 'in_progress'
                                   check (state in ('in_progress', 'completed', 'failed')),
  lease_until          timestamptz not null default (now() + interval '2 minutes'),
  assistant_message_id uuid        references public.chat_messages(id) on delete set null,
  credits_reserved     integer     not null default 0 check (credits_reserved >= 0),
  credits_charged      integer     not null default 0 check (credits_charged >= 0),
  last_error           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  primary key (user_id, request_id)
);

create index if not exists assistant_requests_lease_idx
  on public.assistant_requests (lease_until)
  where state = 'in_progress';

alter table public.assistant_requests enable row level security;
revoke all on public.assistant_requests from anon, authenticated;

-- 1. Réservation : crée le bail ou retourne l'état courant.
--    Appelable par le client authentifié : n'écrit que SA propre ligne.
create or replace function public.rpc_assistant_begin_request(
  p_request_id text,
  p_store_id uuid,
  p_thread_id uuid,
  p_fingerprint text
)
returns table (state text, assistant_message_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_row public.assistant_requests;
begin
  if v_user is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;
  if not public.assistant_can_read_thread(p_store_id) then
    raise exception 'FORBIDDEN_STORE' using errcode = 'P0001';
  end if;

  select * into v_row
    from public.assistant_requests r
   where r.user_id = v_user and r.request_id = p_request_id
   for update;

  if found then
    if v_row.fingerprint <> p_fingerprint then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;
    if v_row.state = 'completed' then
      return query select 'completed'::text, v_row.assistant_message_id;
      return;
    end if;
    if v_row.state = 'in_progress' and v_row.lease_until > now() then
      raise exception 'IDEMPOTENCY_IN_PROGRESS' using errcode = 'P0001';
    end if;
    update public.assistant_requests r
       set state = 'in_progress',
           lease_until = now() + interval '2 minutes',
           updated_at = now()
     where r.user_id = v_user and r.request_id = p_request_id;
    return query select 'in_progress'::text, null::uuid;
    return;
  end if;

  insert into public.assistant_requests (user_id, request_id, store_id, thread_id, fingerprint)
  values (v_user, p_request_id, p_store_id, p_thread_id, p_fingerprint);

  return query select 'in_progress'::text, null::uuid;
end;
$$;

-- 2. Abandon : libère le bail pour une reprise contrôlée (aucune réponse stockée).
create or replace function public.rpc_assistant_fail_request(p_request_id text, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;

  update public.assistant_requests r
     set state = 'failed',
         lease_until = now(),
         last_error = left(coalesce(p_reason, ''), 200),
         updated_at = now()
   where r.user_id = auth.uid()
     and r.request_id = p_request_id
     and r.state = 'in_progress';
end;
$$;

-- 3. Clôture : NON accordée au client. Exécutée uniquement par la finalisation
--    transactionnelle (05_), pour empêcher la fabrication d'une réponse stockée
--    et la sous-déclaration du montant facturé.
create or replace function public.rpc_assistant_complete_request(
  p_request_id text,
  p_assistant_message_id uuid,
  p_credits_charged integer
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;

  update public.assistant_requests r
     set state = 'completed',
         assistant_message_id = p_assistant_message_id,
         credits_charged = greatest(0, coalesce(p_credits_charged, 0)),
         lease_until = now(),
         updated_at = now()
   where r.user_id = auth.uid()
     and r.request_id = p_request_id;
end;
$$;

revoke all on function public.rpc_assistant_begin_request(text, uuid, uuid, text) from public, anon;
revoke all on function public.rpc_assistant_fail_request(text, text) from public, anon;
revoke all on function public.rpc_assistant_complete_request(text, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.rpc_assistant_begin_request(text, uuid, uuid, text) to authenticated;
grant execute on function public.rpc_assistant_fail_request(text, text) to authenticated;
grant execute on function public.rpc_assistant_complete_request(text, uuid, integer) to service_role;

commit;

-- Contrôle après application :
--   select grantee, routine_name from information_schema.routine_privileges
--    where routine_name like 'rpc_assistant_%';
--   select proname, has_function_privilege('authenticated', oid, 'EXECUTE')
--     from pg_proc where proname like 'rpc_assistant_%';

-- Rollback 03 :
--   drop function if exists public.rpc_assistant_complete_request(text, uuid, integer);
--   drop function if exists public.rpc_assistant_fail_request(text, text);
--   drop function if exists public.rpc_assistant_begin_request(text, uuid, uuid, text);
--   drop table if exists public.assistant_requests;


