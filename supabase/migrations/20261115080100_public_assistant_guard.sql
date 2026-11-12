begin;
-- Admission atomique : fenêtre glissante par minute, une requête simultanée,
-- plafond journalier de coût. Aucune donnée personnelle en entrée.
create function public.rpc_public_chat_admit(p_key_hash text,p_ip_hash text,p_daily_budget_micro bigint,
 p_per_key integer default 12,p_per_ip integer default 40) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare bucket timestamptz:=to_timestamp(floor(extract(epoch from clock_timestamp())/60)*60);
 key_hits integer;ip_hits integer;busy integer;spent bigint;today date:=current_date;
begin
 if p_key_hash is null or p_ip_hash is null or p_key_hash !~ '^[a-f0-9]{64}$' or p_ip_hash !~ '^[a-f0-9]{64}$'
   or p_daily_budget_micro is null or p_daily_budget_micro<0 then
   return jsonb_build_object('allowed',false,'code','invalid'); end if;
 perform pg_advisory_xact_lock(hashtext('public_chat_budget'));
 insert into saas_admin.public_chat_usage(day) values(today) on conflict(day) do nothing;
 select cost_micro_usd into spent from saas_admin.public_chat_usage where day=today for update;
 if spent>=p_daily_budget_micro then
   insert into saas_admin.public_chat_events(outcome,reason) values('budget','daily_cap');
   return jsonb_build_object('allowed',false,'code','budget'); end if;
 delete from saas_admin.public_chat_admission where window_start<clock_timestamp()-interval '10 minutes';
 insert into saas_admin.public_chat_admission(key_hash,window_start,hits,in_flight) values(p_key_hash,bucket,1,1)
 on conflict(key_hash,window_start) do update set hits=saas_admin.public_chat_admission.hits+1
 where saas_admin.public_chat_admission.in_flight=0 and saas_admin.public_chat_admission.hits<p_per_key
 returning hits,in_flight into key_hits,busy;
 if key_hits is null or busy is null then
   insert into saas_admin.public_chat_events(outcome,reason) values('denied','key_limit');
   return jsonb_build_object('allowed',false,'code','rate_limit'); end if;
 insert into saas_admin.public_chat_admission(key_hash,window_start,hits,in_flight) values(p_ip_hash,bucket,1,0)
 on conflict(key_hash,window_start) do update set hits=saas_admin.public_chat_admission.hits+1
 where saas_admin.public_chat_admission.hits<p_per_ip returning hits into ip_hits;
 if ip_hits is null then
   update saas_admin.public_chat_admission set in_flight=0 where key_hash=p_key_hash and window_start=bucket;
   insert into saas_admin.public_chat_events(outcome,reason) values('denied','ip_limit');
   return jsonb_build_object('allowed',false,'code','rate_limit'); end if;
 insert into saas_admin.public_chat_events(outcome) values('allowed');
 return jsonb_build_object('allowed',true,'key_hash',p_key_hash,'window_start',bucket,
   'remaining_budget_micro',p_daily_budget_micro-spent);
end $$;

create function public.rpc_public_chat_release(p_key_hash text) returns void
language sql security definer set search_path=pg_catalog,public as $$
 update saas_admin.public_chat_admission set in_flight=0
 where key_hash=p_key_hash and window_start=to_timestamp(floor(extract(epoch from clock_timestamp())/60)*60);
$$;

-- Usage réel enregistré après l'appel (ou l'échec) : coût jamais sous-estimé.
create function public.rpc_public_chat_record(p_cost_micro bigint,p_input bigint,p_output bigint,p_outcome text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if coalesce(p_cost_micro,0)<0 or coalesce(p_input,0)<0 or coalesce(p_output,0)<0 then return; end if;
 insert into saas_admin.public_chat_usage(day,requests,input_tokens,output_tokens,cost_micro_usd,updated_at)
 values(current_date,1,coalesce(p_input,0),coalesce(p_output,0),coalesce(p_cost_micro,0),now())
 on conflict(day) do update set requests=saas_admin.public_chat_usage.requests+1,
  input_tokens=saas_admin.public_chat_usage.input_tokens+coalesce(p_input,0),
  output_tokens=saas_admin.public_chat_usage.output_tokens+coalesce(p_output,0),
  cost_micro_usd=saas_admin.public_chat_usage.cost_micro_usd+coalesce(p_cost_micro,0),updated_at=now();
 if p_outcome in ('reply','provider_error') then
   insert into saas_admin.public_chat_events(outcome,reason) values(p_outcome,null); end if;
end $$;

create function public.rpc_public_chat_contact(p_message text,p_email text,p_channel text,p_locale text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare id uuid;
begin
 if length(trim(coalesce(p_message,''))) not between 10 and 1000 or p_channel not in ('email','phone')
   or p_locale not in ('fr','ar','ary') then return jsonb_build_object('error','invalid'); end if;
 if p_email is not null and (length(p_email)>254 or p_email !~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$') then
   return jsonb_build_object('error','invalid'); end if;
 if (select count(*) from saas_admin.public_chat_contacts where created_at>now()-interval '1 hour')>=100 then
   return jsonb_build_object('error','rate_limit'); end if;
 insert into saas_admin.public_chat_contacts(message,email,preferred_channel,locale)
 values(trim(p_message),nullif(trim(p_email),''),p_channel,p_locale) returning id into id;
 return jsonb_build_object('id',id);
end $$;
revoke all on function public.rpc_public_chat_admit(text,text,bigint,integer,integer),
 public.rpc_public_chat_release(text),public.rpc_public_chat_record(bigint,bigint,bigint,text),
 public.rpc_public_chat_contact(text,text,text,text) from public,anon,authenticated;
grant execute on function public.rpc_public_chat_admit(text,text,bigint,integer,integer),
 public.rpc_public_chat_release(text),public.rpc_public_chat_record(bigint,bigint,bigint,text),
 public.rpc_public_chat_contact(text,text,text,text) to service_role;
commit;
