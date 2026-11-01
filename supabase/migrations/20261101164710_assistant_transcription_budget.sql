-- Dictée vocale — plafond partagé, atomique et anti-rejeu.
--
-- Objectif : réserver la durée RÉELLE (déjà validée depuis l'en-tête WAV côté
-- serveur) AVANT tout appel OpenAI, de façon atomique entre instances.
--
-- Volume : une ligne de budget par utilisateur et par jour, plus une ligne par
-- tentative. Aucune lecture d'agrégat métier, aucun recalcul KPI : la charge
-- disque reste négligeable et bornée (nettoyage à 7 jours limité à l'appelant).
--
-- Aucun texte transcrit n'est stocké ici : uniquement l'identifiant de requête.

create table if not exists public.assistant_transcription_budget (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  seconds_used integer not null default 0 check (seconds_used >= 0),
  requests integer not null default 0 check (requests >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

create table if not exists public.assistant_transcription_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  day date not null,
  seconds integer not null check (seconds > 0),
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);

create index if not exists assistant_transcription_requests_day_idx
  on public.assistant_transcription_requests (user_id, day);

alter table public.assistant_transcription_budget enable row level security;
alter table public.assistant_transcription_requests enable row level security;

-- Aucun accès direct : uniquement le RPC ci-dessous (SECURITY DEFINER).
revoke all on table public.assistant_transcription_budget from public, anon, authenticated;
revoke all on table public.assistant_transcription_requests from public, anon, authenticated;

create or replace function public.rpc_assistant_reserve_transcription(
  p_request_id uuid,
  p_seconds integer
)
returns table (outcome text, seconds_used integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  -- Plafonds fixés côté base : un appelant ne peut jamais les élargir.
  c_max_seconds constant integer := 600;
  c_max_requests constant integer := 40;
  v_user uuid := auth.uid();
  v_day date := (now() at time zone 'utc')::date;
  v_used integer;
  v_requests integer;
begin
  if v_user is null then
    raise exception 'TRANSCRIPTION_UNAUTHENTICATED';
  end if;
  if p_request_id is null then
    raise exception 'TRANSCRIPTION_BAD_REQUEST';
  end if;
  if p_seconds is null or p_seconds < 1 or p_seconds > 120 then
    raise exception 'TRANSCRIPTION_BAD_DURATION';
  end if;
  -- Sérialise les tentatives d'un même utilisateur : la vérification et
  -- l'écriture ne peuvent pas s'intercaler entre deux instances.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 12));

  delete from public.assistant_transcription_requests r
   where r.user_id = v_user
     and r.day < v_day - 7;

  if exists (
    select 1
      from public.assistant_transcription_requests r
     where r.user_id = v_user
       and r.request_id = p_request_id
  ) then
    select coalesce(b.seconds_used, 0)
      into v_used
      from public.assistant_transcription_budget b
     where b.user_id = v_user
       and b.day = v_day;
    return query select 'duplicate'::text, coalesce(v_used, 0);
    return;
  end if;

  insert into public.assistant_transcription_budget (user_id, day, seconds_used, requests)
  values (v_user, v_day, 0, 0)
  on conflict (user_id, day) do nothing;

  select b.seconds_used, b.requests
    into v_used, v_requests
    from public.assistant_transcription_budget b
   where b.user_id = v_user
     and b.day = v_day
   for update;

  if v_used + p_seconds > c_max_seconds or v_requests + 1 > c_max_requests then
    return query select 'daily_limit'::text, v_used;
    return;
  end if;

  update public.assistant_transcription_budget b
     set seconds_used = b.seconds_used + p_seconds,
         requests = b.requests + 1,
         updated_at = now()
   where b.user_id = v_user
     and b.day = v_day;

  insert into public.assistant_transcription_requests (user_id, request_id, day, seconds)
  values (v_user, p_request_id, v_day, p_seconds);

  return query select 'reserved'::text, (v_used + p_seconds);
end;
$function$;

comment on function public.rpc_assistant_reserve_transcription(uuid, integer) is
  'Réserve atomiquement une durée de dictée avant l''appel fournisseur ; anti-rejeu par request_id.';

revoke all on function public.rpc_assistant_reserve_transcription(uuid, integer)
  from public, anon;
grant execute on function public.rpc_assistant_reserve_transcription(uuid, integer)
  to authenticated;
