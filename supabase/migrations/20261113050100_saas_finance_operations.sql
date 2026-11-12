begin;
create function public.rpc_admin_finance_write(p_key uuid,p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare op saas_admin.finance_operations; e saas_admin.expenses; a saas_admin.cash_accounts;
 b saas_admin.cash_accounts; m saas_admin.cash_movements; old_m saas_admin.cash_movements;
 s saas_admin.expense_settlements; p saas_admin.payments; result jsonb; new_id uuid;
 amount bigint; paid bigint; cat uuid; dt date; reason text; ref text; net_refunds bigint;
begin
 perform pg_advisory_xact_lock(hashtext('saas_admin_memberships'));
 if not saas_admin.has_permission('finance.write',true) then
   insert into saas_admin.audit_events(actor_id,action,outcome) values(auth.uid(),'finance.write','denied');
   return jsonb_build_object('error','ADMIN_FORBIDDEN');
 end if;
 if not saas_admin.admit_action('finance.write') then return jsonb_build_object('error','ADMIN_RATE_LIMIT'); end if;
 if p_key is null or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>8192 then return jsonb_build_object('error','ADMIN_INVALID'); end if;
 select * into op from saas_admin.finance_operations where id=p_key;
 if found then
   if op.actor_id<>auth.uid() or op.action<>p_action or op.payload<>p_data then return jsonb_build_object('error','FINANCE_IDEMPOTENCY'); end if;
   return op.result||jsonb_build_object('replayed',true);
 end if;
 reason:=trim(coalesce(p_data->>'reason',''));
 if length(reason) not between 10 and 500 then return jsonb_build_object('error','ADMIN_INVALID'); end if;
 if p_action='category' then
   if p_data ? 'id' then
     update saas_admin.expense_categories set name=trim(p_data->>'name'),active=(p_data->>'active')::boolean
     where id=(p_data->>'id')::uuid returning id into new_id;
     if new_id is null then return jsonb_build_object('error','FINANCE_NOT_FOUND'); end if;
   else insert into saas_admin.expense_categories(name) values(trim(p_data->>'name')) returning id into new_id; end if;
 elsif p_action='account' then
   insert into saas_admin.cash_accounts(code,name,currency,created_by)
   values(upper(trim(p_data->>'code')),trim(p_data->>'name'),p_data->>'currency',auth.uid()) returning id into new_id;
 elsif p_action in ('expense','expense_update','post','cancel','credit') then
   if p_action<>'expense' then
     select * into e from saas_admin.expenses where id=(p_data->>'id')::uuid for update;
     if not found then return jsonb_build_object('error','FINANCE_NOT_FOUND'); end if;
   end if;
   if p_action in ('expense','expense_update') then
     if p_action='expense_update' and (e.status<>'draft' or e.version<>(p_data->>'version')::integer) then return jsonb_build_object('error','FINANCE_VERSION'); end if;
     cat:=(p_data->>'categoryId')::uuid;
     if not exists(select 1 from saas_admin.expense_categories where id=cat and active) then return jsonb_build_object('error','ADMIN_INVALID'); end if;
     if p_action='expense' then
       insert into saas_admin.expenses(category_id,beneficiary,description,invoice_reference,amount_minor,tax_minor,currency,incurred_on,created_by)
       values(cat,trim(p_data->>'beneficiary'),trim(p_data->>'description'),upper(trim(p_data->>'invoiceReference')),
         (p_data->>'amountMinor')::bigint,coalesce((p_data->>'taxMinor')::bigint,0),p_data->>'currency',(p_data->>'date')::date,auth.uid()) returning id into new_id;
     else
       update saas_admin.expenses set category_id=cat,beneficiary=trim(p_data->>'beneficiary'),description=trim(p_data->>'description'),
         invoice_reference=upper(trim(p_data->>'invoiceReference')),amount_minor=(p_data->>'amountMinor')::bigint,
         tax_minor=coalesce((p_data->>'taxMinor')::bigint,0),currency=p_data->>'currency',incurred_on=(p_data->>'date')::date,
         version=version+1,updated_at=now() where id=e.id returning id into new_id;
     end if;
   elsif p_action in ('post','cancel') then
     if e.status<>'draft' then return jsonb_build_object('error','FINANCE_IMMUTABLE'); end if;
     update saas_admin.expenses set status=case when p_action='post' then 'posted' else 'cancelled' end,
       version=version+1,updated_at=now() where id=e.id returning id into new_id;
   else
     if e.status<>'posted' or e.kind<>'charge' then return jsonb_build_object('error','FINANCE_IMMUTABLE'); end if;
     -- Avoir intégral, sans effacer ni modifier la charge d'origine.
     insert into saas_admin.expenses(category_id,beneficiary,description,invoice_reference,amount_minor,tax_minor,currency,incurred_on,status,kind,reverses_id,created_by)
     values(e.category_id,e.beneficiary,'Avoir : '||left(e.description,490),'CREDIT-'||e.id::text,e.amount_minor,e.tax_minor,e.currency,
       (p_data->>'date')::date,'posted','credit',e.id,auth.uid()) returning id into new_id;
   end if;
 elsif p_action in ('settle','expense_refund') then
   select * into e from saas_admin.expenses where id=(p_data->>'id')::uuid for update;
   if not found then return jsonb_build_object('error','FINANCE_NOT_FOUND'); end if;
   if e.status<>'posted' or e.kind<>'charge' then return jsonb_build_object('error','FINANCE_IMMUTABLE'); end if;
   select * into a from saas_admin.cash_accounts where id=(p_data->>'accountId')::uuid for update;
   if not found or a.currency<>e.currency then return jsonb_build_object('error','FINANCE_CURRENCY'); end if;
   amount:=(p_data->>'amountMinor')::bigint;dt:=(p_data->>'date')::date;
   select coalesce(sum(direction*amount_minor),0) into paid from saas_admin.expense_settlements where expense_id=e.id;
   if p_action='settle' then
     if exists(select 1 from saas_admin.expenses where reverses_id=e.id) then return jsonb_build_object('error','FINANCE_IMMUTABLE'); end if;
     if amount is null or amount<=0 or paid+amount>e.amount_minor then return jsonb_build_object('error','FINANCE_OVERPAYMENT'); end if;
   else
     if amount is null or amount<=0 or amount>paid then return jsonb_build_object('error','FINANCE_OVERPAYMENT'); end if;
   end if;
   insert into saas_admin.cash_movements(account_id,amount_minor,direction,kind,occurred_on,reference,reason,operation_id,created_by)
   values(a.id,amount,case when p_action='settle' then -1 else 1 end,case when p_action='settle' then 'expense' else 'expense_refund' end,
     dt,upper(trim(p_data->>'reference')),reason,p_key,auth.uid()) returning * into m;
   insert into saas_admin.expense_settlements(expense_id,movement_id,amount_minor,direction)
   values(e.id,m.id,amount,case when p_action='settle' then 1 else -1 end) returning id into new_id;
 elsif p_action='transfer' then
   if p_data->>'accountId'=p_data->>'targetAccountId' then return jsonb_build_object('error','ADMIN_INVALID'); end if;
   perform 1 from saas_admin.cash_accounts where id in ((p_data->>'accountId')::uuid,(p_data->>'targetAccountId')::uuid) order by id for update;
   select * into a from saas_admin.cash_accounts where id=(p_data->>'accountId')::uuid;
   select * into b from saas_admin.cash_accounts where id=(p_data->>'targetAccountId')::uuid;
   if a.id is null or b.id is null or a.currency<>b.currency then return jsonb_build_object('error','FINANCE_CURRENCY'); end if;
   amount:=(p_data->>'amountMinor')::bigint;dt:=(p_data->>'date')::date;ref:=upper(trim(p_data->>'reference'));
   insert into saas_admin.cash_movements(account_id,amount_minor,direction,kind,occurred_on,reference,reason,operation_id,created_by)
   values(a.id,amount,-1,'transfer',dt,ref,reason,p_key,auth.uid()),(b.id,amount,1,'transfer',dt,ref,reason,p_key,auth.uid());
   new_id:=p_key;
 elsif p_action='movement' then
   select * into a from saas_admin.cash_accounts where id=(p_data->>'accountId')::uuid for update;
   if not found then return jsonb_build_object('error','FINANCE_NOT_FOUND'); end if;
   if p_data->>'kind' not in ('opening','contribution','withdrawal','payment_refund') then return jsonb_build_object('error','ADMIN_INVALID'); end if;
   amount:=(p_data->>'amountMinor')::bigint;
   if p_data->>'kind'='payment_refund' then
     select * into p from saas_admin.payments where id=(p_data->>'paymentId')::uuid for update;
     if not found or p.currency<>a.currency then return jsonb_build_object('error','FINANCE_CURRENCY'); end if;
     select coalesce(sum(case when kind='payment_refund' then amount_minor else -amount_minor end),0) into net_refunds
     from saas_admin.cash_movements where payment_id=p.id;
     if amount is null or amount<=0 or net_refunds+amount>p.amount_minor then return jsonb_build_object('error','FINANCE_OVERPAYMENT'); end if;
   end if;
   insert into saas_admin.cash_movements(account_id,amount_minor,direction,kind,occurred_on,reference,reason,operation_id,payment_id,created_by)
   values(a.id,amount,case when p_data->>'kind' in ('withdrawal','payment_refund') then -1 else 1 end,p_data->>'kind',
     (p_data->>'date')::date,upper(trim(p_data->>'reference')),reason,p_key,case when p_data->>'kind'='payment_refund' then p.id else null end,auth.uid()) returning id into new_id;
 elsif p_action='reverse' then
   select * into old_m from saas_admin.cash_movements where id=(p_data->>'id')::uuid for update;
   if not found then return jsonb_build_object('error','FINANCE_NOT_FOUND'); end if;
   if old_m.kind in ('transfer','correction','opening') then return jsonb_build_object('error','FINANCE_IMMUTABLE'); end if;
   select * into s from saas_admin.expense_settlements where movement_id=old_m.id;
   if found then
     perform 1 from saas_admin.expenses where id=s.expense_id for update;
     select coalesce(sum(direction*amount_minor),0) into paid from saas_admin.expense_settlements where expense_id=s.expense_id;
     if paid-s.direction*s.amount_minor<0 then return jsonb_build_object('error','FINANCE_OVERPAYMENT'); end if;
   end if;
   insert into saas_admin.cash_movements(account_id,amount_minor,direction,kind,occurred_on,reference,reason,operation_id,reverses_id,payment_id,created_by)
   values(old_m.account_id,old_m.amount_minor,-old_m.direction,'correction',(p_data->>'date')::date,
     upper(trim(p_data->>'reference')),reason,p_key,old_m.id,old_m.payment_id,auth.uid()) returning id into new_id;
   if s.id is not null then
     insert into saas_admin.expense_settlements(expense_id,movement_id,amount_minor,direction,reverses_id)
     values(s.expense_id,new_id,s.amount_minor,-s.direction,s.id);
   end if;
 else return jsonb_build_object('error','ADMIN_INVALID'); end if;
 result:=jsonb_build_object('ok',true,'id',new_id,'replayed',false);
 insert into saas_admin.finance_operations(id,actor_id,action,payload,result) values(p_key,auth.uid(),p_action,p_data,result);
 insert into saas_admin.audit_events(actor_id,action,target_id,outcome,reason) values(auth.uid(),'finance.'||p_action,new_id,'changed',reason);
 return result;
exception when unique_violation then return jsonb_build_object('error','FINANCE_DUPLICATE');
 when check_violation or not_null_violation or invalid_text_representation or datetime_field_overflow then return jsonb_build_object('error','ADMIN_INVALID');
end $$;

create function public.rpc_admin_finance_proof(p_expense uuid,p_proof jsonb default null,p_id uuid default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare proof_id uuid;path text;
begin
 perform pg_advisory_xact_lock(hashtext('saas_admin_memberships'));
 if not saas_admin.has_permission(case when p_proof is null then 'finance.read' else 'finance.write' end,true) then return jsonb_build_object('error','ADMIN_FORBIDDEN'); end if;
 if not exists(select 1 from saas_admin.expenses where id=p_expense) then return jsonb_build_object('error','FINANCE_NOT_FOUND'); end if;
 if p_proof is null then
   select object_path into path from saas_admin.expense_proofs where expense_id=p_expense and id=p_id;
   if path is null then return jsonb_build_object('error','FINANCE_NOT_FOUND'); end if;
   insert into saas_admin.audit_events(actor_id,action,target_id,outcome) values(auth.uid(),'finance.proof.download',p_id,'allowed');
   return jsonb_build_object('object_path',path);
 end if;
 if not saas_admin.admit_action('finance.proof') then return jsonb_build_object('error','ADMIN_RATE_LIMIT'); end if;
 select id into proof_id from saas_admin.expense_proofs where expense_id=p_expense and sha256=p_proof->>'sha256';
 if found then return jsonb_build_object('ok',true,'id',proof_id,'replayed',true); end if;
 if (select count(*) from saas_admin.expense_proofs where expense_id=p_expense)>=3 then return jsonb_build_object('error','FINANCE_PROOF_LIMIT'); end if;
 proof_id:=(p_proof->>'id')::uuid;path:=p_expense::text||'/'||proof_id::text;
 if p_proof->>'object_path' is distinct from path then return jsonb_build_object('error','ADMIN_INVALID'); end if;
 insert into saas_admin.expense_proofs(id,expense_id,object_path,mime_type,size_bytes,sha256,created_by)
 values(proof_id,p_expense,path,p_proof->>'mime_type',(p_proof->>'size_bytes')::integer,p_proof->>'sha256',auth.uid());
 insert into saas_admin.audit_events(actor_id,action,target_id,outcome) values(auth.uid(),'finance.proof.add',proof_id,'changed');
 return jsonb_build_object('ok',true,'id',proof_id,'replayed',false);
end $$;
revoke all on function public.rpc_admin_finance_write(uuid,text,jsonb),public.rpc_admin_finance_proof(uuid,jsonb,uuid) from public,anon,service_role;
grant execute on function public.rpc_admin_finance_write(uuid,text,jsonb),public.rpc_admin_finance_proof(uuid,jsonb,uuid) to authenticated;
commit;