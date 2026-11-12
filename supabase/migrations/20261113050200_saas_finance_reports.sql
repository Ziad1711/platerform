begin;
create function public.rpc_admin_finance_read(p_from date,p_until date,p_currency text default '',
 p_category uuid default null,p_account uuid default null,p_status text default '',p_offset integer default 0,
 p_export boolean default false) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare accounts jsonb;categories jsonb;expenses jsonb;movements jsonb;summary jsonb;history jsonb;max_rows integer;
begin
 if not saas_admin.has_permission(case when p_export then 'finance.export' else 'finance.read' end,true) then
   return jsonb_build_object('error','ADMIN_FORBIDDEN'); end if;
 if p_from is null or p_until is null or p_until<=p_from or p_until>p_from+366 or p_offset<0 or p_offset>100000 then
   return jsonb_build_object('error','ADMIN_INVALID'); end if;
 max_rows:=case when p_export then 1000 else 50 end;
 select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into accounts from (
   select a.*,coalesce((select sum(l.amount_minor*l.direction) from saas_admin.cash_ledger l where l.account_id=a.id and l.occurred_on<p_until),0) as balance_minor
   from saas_admin.cash_accounts a where coalesce(p_currency,'')='' or a.currency=p_currency order by a.code) q;
 select coalesce(jsonb_agg(to_jsonb(c) order by c.name),'[]'::jsonb) into categories from saas_admin.expense_categories c;
 select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into expenses from (
   select e.*,c.name as category_name,
    coalesce((select sum(s.direction*s.amount_minor) from saas_admin.expense_settlements s where s.expense_id=e.id),0) as paid_minor,
    (select coalesce(jsonb_agg(jsonb_build_object('id',pr.id,'mime_type',pr.mime_type,'created_at',pr.created_at)),'[]'::jsonb) from saas_admin.expense_proofs pr where pr.expense_id=e.id) as proofs
   from saas_admin.expenses e join saas_admin.expense_categories c on c.id=e.category_id
   where e.incurred_on>=p_from and e.incurred_on<p_until
    and (coalesce(p_currency,'')='' or e.currency=p_currency) and (p_category is null or e.category_id=p_category)
    and (coalesce(p_status,'')='' or e.status=p_status)
    and (p_account is null or exists(select 1 from saas_admin.expense_settlements s join saas_admin.cash_movements m on m.id=s.movement_id where s.expense_id=e.id and m.account_id=p_account))
   order by e.incurred_on desc,e.id limit max_rows offset p_offset) q;
 select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into movements from (
   select l.*,a.name as account_name from saas_admin.cash_ledger l left join saas_admin.cash_accounts a on a.id=l.account_id
   where l.occurred_on>=p_from and l.occurred_on<p_until and (coalesce(p_currency,'')='' or l.currency=p_currency)
    and (p_account is null or l.account_id=p_account)
    and (p_category is null or exists(select 1 from saas_admin.expense_settlements s join saas_admin.expenses e on e.id=s.expense_id where s.movement_id=l.id and e.category_id=p_category))
   order by l.occurred_on desc,l.id limit max_rows offset p_offset) q;
 -- Agrégats distincts, jamais de somme multidevise et jamais de bénéfice comptable.
 select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into summary from (
   select cur.currency,
    (select coalesce(sum(case when e.kind='charge' then e.amount_minor else -e.amount_minor end),0)
      from saas_admin.expenses e where e.status='posted' and e.currency=cur.currency and e.incurred_on>=p_from and e.incurred_on<p_until
      and (p_category is null or e.category_id=p_category)) as committed_gross_minor,
    (select coalesce(sum(l.amount_minor*l.direction),0) from saas_admin.cash_ledger l where l.currency=cur.currency and l.occurred_on>=p_from and l.occurred_on<p_until
      and l.kind not in ('transfer','opening') and (p_account is null or l.account_id=p_account)) as net_cash_flow_minor,
    (select coalesce(sum(l.amount_minor),0) from saas_admin.cash_ledger l where l.currency=cur.currency and l.occurred_on>=p_from and l.occurred_on<p_until
      and l.kind='subscription_receipt' and (p_account is null or l.account_id=p_account)) as receipts_minor,
    (select coalesce(sum(-l.direction*l.amount_minor),0) from saas_admin.cash_ledger l where l.currency=cur.currency and l.occurred_on>=p_from and l.occurred_on<p_until
      and l.kind in ('expense','expense_refund','correction') and (p_account is null or l.account_id=p_account)) as net_operating_outflow_minor,
    (select count(*) from saas_admin.cash_ledger l where l.currency=cur.currency and l.account_id is null and l.occurred_on<p_until) as unassigned_receipts
   from (select currency from saas_admin.cash_accounts union select currency from saas_admin.expenses union select currency from saas_admin.payments) cur
   where coalesce(p_currency,'')='' or cur.currency=p_currency order by cur.currency) q;
 select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into history from (
   select id,action,target_id,outcome,reason,created_at from saas_admin.audit_events where action like 'finance.%'
   order by id desc limit 50) q;
 insert into saas_admin.audit_events(actor_id,action,outcome) values(auth.uid(),case when p_export then 'finance.export' else 'finance.read' end,'allowed');
 return jsonb_build_object('accounts',accounts,'categories',categories,'expenses',expenses,'movements',movements,'summary',summary,'history',history,
   'from',p_from,'until',p_until,'revenue_recognition_available',false,'conversion_available',false);
end $$;
revoke all on function public.rpc_admin_finance_read(date,date,text,uuid,uuid,text,integer,boolean) from public,anon,service_role;
grant execute on function public.rpc_admin_finance_read(date,date,text,uuid,uuid,text,integer,boolean) to authenticated;
commit;