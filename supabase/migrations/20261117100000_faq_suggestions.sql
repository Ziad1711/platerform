begin;
-- Suggestions de questions FAQ : contenu soumis publiquement et examiné par
-- l'équipe avant toute publication. Aucune réponse n'est publiée
-- automatiquement. Les clés d'admission réutilisent la table du chat public,
-- avec des préfixes distincts et des plafonds propres.
create table saas_admin.faq_suggestions (
  id uuid primary key default gen_random_uuid(),
  question text not null check(length(trim(question)) between 10 and 500),
  locale text not null default 'fr' check(locale in ('fr','ar','ary')),
  status text not null default 'new' check(status in ('new','accepted','rejected')),
  created_at timestamptz not null default now(),
  handled_at timestamptz
);
create index faq_suggestions_status_time on saas_admin.faq_suggestions(status, created_at desc);
alter table saas_admin.faq_suggestions enable row level security;
revoke all on saas_admin.faq_suggestions from public,anon,authenticated,service_role;
grant select,insert,update on saas_admin.faq_suggestions to service_role;

-- Admission atomique (fenêtre de 10 minutes) : visiteur, adresse et global.
-- Le bloc interne annule les incréments déjà effectués si un plafond tombe.
create function public.rpc_faq_suggestion_admit(
  p_key_hash text,
  p_ip_hash text,
  p_global_hash text,
  p_per_key integer default 3,
  p_per_ip integer default 8,
  p_global integer default 40
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  bucket timestamptz:=to_timestamp(floor(extract(epoch from clock_timestamp())/600)*600);
  key_hits integer;
  ip_hits integer;
  global_hits integer;
begin
  if p_key_hash is null or p_ip_hash is null or p_global_hash is null
    or p_key_hash !~ '^[a-f0-9]{64}$' or p_ip_hash !~ '^[a-f0-9]{64}$'
    or p_global_hash !~ '^[a-f0-9]{64}$'
    or p_per_key is null or p_per_ip is null or p_global is null
    or p_per_key<1 or p_per_ip<1 or p_global<1 then
    return jsonb_build_object('allowed',false,'code','invalid'); end if;

  delete from saas_admin.public_chat_admission
  where window_start<clock_timestamp()-interval '1 hour';

  begin
    insert into saas_admin.public_chat_admission(key_hash,window_start,hits,in_flight)
    values(p_global_hash,bucket,1,0)
    on conflict(key_hash,window_start) do update
      set hits=saas_admin.public_chat_admission.hits+1
      where saas_admin.public_chat_admission.hits<p_global
    returning hits into global_hits;
    if global_hits is null then raise exception 'FAQ_LIMIT' using errcode='P0001'; end if;

    insert into saas_admin.public_chat_admission(key_hash,window_start,hits,in_flight)
    values(p_ip_hash,bucket,1,0)
    on conflict(key_hash,window_start) do update
      set hits=saas_admin.public_chat_admission.hits+1
      where saas_admin.public_chat_admission.hits<p_per_ip
    returning hits into ip_hits;
    if ip_hits is null then raise exception 'FAQ_LIMIT' using errcode='P0001'; end if;

    insert into saas_admin.public_chat_admission(key_hash,window_start,hits,in_flight)
    values(p_key_hash,bucket,1,0)
    on conflict(key_hash,window_start) do update
      set hits=saas_admin.public_chat_admission.hits+1
      where saas_admin.public_chat_admission.hits<p_per_key
    returning hits into key_hits;
    if key_hits is null then raise exception 'FAQ_LIMIT' using errcode='P0001'; end if;
  exception when sqlstate 'P0001' then
    insert into saas_admin.public_chat_events(outcome,reason) values('denied','faq_limit');
    return jsonb_build_object('allowed',false,'code','rate_limit');
  end;

  return jsonb_build_object('allowed',true,'window_start',bucket);
end $$;

-- Insertion bornée : statut 'new' uniquement, plafond horaire global.
create function public.rpc_faq_suggestion_submit(p_question text, p_locale text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare suggestion_id uuid;
begin
  if length(trim(coalesce(p_question,''))) not between 10 and 500 or p_locale not in ('fr','ar','ary') then
    return jsonb_build_object('error','invalid'); end if;
  if (select count(*) from saas_admin.faq_suggestions where created_at>now()-interval '1 hour')>=200 then
    return jsonb_build_object('error','rate_limit'); end if;
  insert into saas_admin.faq_suggestions(question,locale)
  values(trim(p_question),p_locale)
  returning saas_admin.faq_suggestions.id into suggestion_id;
  return jsonb_build_object('id',suggestion_id);
end $$;

revoke all on function public.rpc_faq_suggestion_admit(text,text,text,integer,integer,integer)
  from public,anon,authenticated;
grant execute on function public.rpc_faq_suggestion_admit(text,text,text,integer,integer,integer)
  to service_role;
revoke all on function public.rpc_faq_suggestion_submit(text,text) from public,anon,authenticated;
grant execute on function public.rpc_faq_suggestion_submit(text,text) to service_role;
commit;
