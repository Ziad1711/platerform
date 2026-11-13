begin;
-- Admission du formulaire de contact public : atomique et concurrente.
--
-- Trois plafonds sur une fenêtre de 10 minutes : visiteur (clé HMAC),
-- adresse (HMAC d'IP) et global. Les clés sont pseudonymisées côté serveur ;
-- aucune adresse IP ni identité n'est stockée. La même table d'admission que
-- le chat public est réutilisée avec des clés préfixées distinctes.
--
-- Le bloc interne crée un point de sauvegarde : si un plafond est atteint,
-- les incréments déjà effectués sont annulés avant de répondre.
create function public.rpc_public_contact_admit(
  p_key_hash text,
  p_ip_hash text,
  p_global_hash text,
  p_per_key integer default 5,
  p_per_ip integer default 10,
  p_global integer default 15
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
    if global_hits is null then raise exception 'CONTACT_LIMIT' using errcode='P0001'; end if;

    insert into saas_admin.public_chat_admission(key_hash,window_start,hits,in_flight)
    values(p_ip_hash,bucket,1,0)
    on conflict(key_hash,window_start) do update
      set hits=saas_admin.public_chat_admission.hits+1
      where saas_admin.public_chat_admission.hits<p_per_ip
    returning hits into ip_hits;
    if ip_hits is null then raise exception 'CONTACT_LIMIT' using errcode='P0001'; end if;

    insert into saas_admin.public_chat_admission(key_hash,window_start,hits,in_flight)
    values(p_key_hash,bucket,1,0)
    on conflict(key_hash,window_start) do update
      set hits=saas_admin.public_chat_admission.hits+1
      where saas_admin.public_chat_admission.hits<p_per_key
    returning hits into key_hits;
    if key_hits is null then raise exception 'CONTACT_LIMIT' using errcode='P0001'; end if;
  exception when sqlstate 'P0001' then
    insert into saas_admin.public_chat_events(outcome,reason) values('denied','contact_limit');
    return jsonb_build_object('allowed',false,'code','rate_limit');
  end;

  return jsonb_build_object('allowed',true,'window_start',bucket);
end $$;

revoke all on function public.rpc_public_contact_admit(text,text,text,integer,integer,integer)
  from public,anon,authenticated;
grant execute on function public.rpc_public_contact_admit(text,text,text,integer,integer,integer)
  to service_role;
commit;
