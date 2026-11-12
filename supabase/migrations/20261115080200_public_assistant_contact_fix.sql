begin;
-- Correction : variable locale `id` ambiguë avec la colonne de retour.
create or replace function public.rpc_public_chat_contact(p_message text,p_email text,p_channel text,p_locale text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare contact_id uuid;
begin
 if length(trim(coalesce(p_message,''))) not between 10 and 1000 or p_channel not in ('email','phone')
   or p_locale not in ('fr','ar','ary') then return jsonb_build_object('error','invalid'); end if;
 if p_email is not null and (length(p_email)>254 or p_email !~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$') then
   return jsonb_build_object('error','invalid'); end if;
 if (select count(*) from saas_admin.public_chat_contacts where created_at>now()-interval '1 hour')>=100 then
   return jsonb_build_object('error','rate_limit'); end if;
 insert into saas_admin.public_chat_contacts(message,email,preferred_channel,locale)
 values(trim(p_message),nullif(trim(p_email),''),p_channel,p_locale)
 returning saas_admin.public_chat_contacts.id into contact_id;
 return jsonb_build_object('id',contact_id);
end $$;
revoke all on function public.rpc_public_chat_contact(text,text,text,text) from public,anon,authenticated;
grant execute on function public.rpc_public_chat_contact(text,text,text,text) to service_role;
commit;
