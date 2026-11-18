-- Correctif : permettre la modification/republication des coordonnées publiées,
-- et renvoyer des erreurs de champ explicites (motif, RIB).
begin;
set local lock_timeout='5s';

create or replace function public.rpc_admin_bank_settings(p_values jsonb default null,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  b public.billing_bank_settings;
  v_action text;
  v_beneficiary text;
  v_bank_name text;
  v_rib text;
  v_instructions text;
  v_approved boolean;
begin
  perform pg_advisory_xact_lock(hashtext('saas_admin_memberships'));
  if not saas_admin.has_permission('bank_settings.manage',true) then
    insert into saas_admin.audit_events(actor_id,action,outcome) values(auth.uid(),'bank_settings.manage','denied');
    return jsonb_build_object('error','ADMIN_FORBIDDEN');
  end if;

  if p_values is null then
    select * into b from public.billing_bank_settings where id=true;
    insert into saas_admin.audit_events(actor_id,action,outcome) values(auth.uid(),'bank_settings.read','allowed');
    return jsonb_build_object('settings',to_jsonb(b),'public_enable_locked',(b.status<>'published'));
  end if;

  if not saas_admin.admit_action('bank_settings.manage') then
    return jsonb_build_object('error','ADMIN_RATE_LIMIT');
  end if;
  if length(trim(coalesce(p_reason,''))) not between 10 and 300 then
    return jsonb_build_object('error','BANK_REASON_INVALID');
  end if;

  v_action := nullif(trim(p_values->>'action'),'');
  if v_action not in ('save_draft','publish','suspend') then
    return jsonb_build_object('error','ADMIN_INVALID');
  end if;

  v_beneficiary := nullif(trim(p_values->>'beneficiary'),'');
  v_bank_name := nullif(trim(p_values->>'bank_name'),'');
  v_rib := nullif(trim(p_values->>'rib'),'');
  v_instructions := p_values->>'instructions';

  if v_rib is not null and v_rib !~ '^[0-9]{24}$' then
    return jsonb_build_object('error','BANK_RIB_INVALID');
  end if;

  select * into b from public.billing_bank_settings where id=true for update;

  if v_action = 'publish' then
    v_approved := coalesce((p_values->>'commercial_conditions_approved')::boolean,false);
    if v_beneficiary is null or length(v_beneficiary)<2
       or v_bank_name is null or length(v_bank_name)<2
       or v_rib is null or v_approved is not true then
      return jsonb_build_object('error','BANK_PUBLICATION_INCOMPLETE');
    end if;
    update public.billing_bank_settings set
      beneficiary=v_beneficiary, bank_name=v_bank_name, rib=v_rib,
      instructions=v_instructions, commercial_conditions_approved=true,
      currency='MAD', status='published', enabled=true, updated_at=now()
      where id=true returning * into b;
    insert into saas_admin.audit_events(actor_id,action,outcome,reason)
      values(auth.uid(),'bank_settings.publish','changed',trim(p_reason));
  elsif v_action = 'suspend' then
    if b.status <> 'published' then
      return jsonb_build_object('error','BANK_NOT_PUBLISHED');
    end if;
    update public.billing_bank_settings set
      status='suspended', enabled=false, updated_at=now()
      where id=true returning * into b;
    insert into saas_admin.audit_events(actor_id,action,outcome,reason)
      values(auth.uid(),'bank_settings.suspend','changed',trim(p_reason));
  else
    if b.status = 'published' then
      return jsonb_build_object('error','BANK_PUBLISHED_IMMUTABLE');
    end if;
    update public.billing_bank_settings set
      beneficiary=v_beneficiary, bank_name=v_bank_name, rib=v_rib,
      instructions=v_instructions, commercial_conditions_approved=false,
      currency='MAD', status='draft', enabled=false, updated_at=now()
      where id=true returning * into b;
    insert into saas_admin.audit_events(actor_id,action,outcome,reason)
      values(auth.uid(),'bank_settings.update','changed',trim(p_reason));
  end if;

  insert into saas_admin.bank_settings_history(actor_id,beneficiary,bank_name,rib,instructions,commercial_conditions_approved,status,currency,reason)
  values(auth.uid(),b.beneficiary,b.bank_name,b.rib,b.instructions,b.commercial_conditions_approved,b.status,b.currency,trim(p_reason));

  return jsonb_build_object('settings',to_jsonb(b),'public_enable_locked',(b.status<>'published'));
end $$;

revoke all on function public.rpc_admin_bank_settings(jsonb,text) from public,anon,service_role;
grant execute on function public.rpc_admin_bank_settings(jsonb,text) to authenticated;

commit;
