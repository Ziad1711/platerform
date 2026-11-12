-- Finalisation 4C. Aucune hypothèse fiscale approuvée par défaut.
begin;
create table saas_admin.finance_policies (
 id uuid primary key default gen_random_uuid(),
 currency text not null check(currency in ('MAD','EUR','USD','GBP','CAD','AED')),
 approved boolean not null default false,
 revenue_basis text not null check(revenue_basis in ('no_vat','vat_included')),
 vat_rate numeric(8,6),
 expense_tax_deductible boolean,
 attribution text not null default 'expense_date' check(attribution='expense_date'),
 service_timezone text not null default 'UTC' check(service_timezone='UTC'),
 method text not null default 'linear_elapsed_cumulative' check(method='linear_elapsed_cumulative'),
 refund_method text not null default 'cumulative_catchup' check(refund_method='cumulative_catchup'),
 valid_from date not null,
 documentation text not null check(length(trim(documentation))>=20),
 approved_by uuid references auth.users(id),approved_at timestamptz,
 check(not approved or (approved_by is not null and approved_at is not null and expense_tax_deductible is not null
   and ((revenue_basis='no_vat' and vat_rate=0) or (revenue_basis='vat_included' and vat_rate between 0 and 1))))
);
create unique index finance_policy_one_approved on saas_admin.finance_policies(currency) where approved;
create table saas_admin.document_retention (
 bucket_id text primary key check(bucket_id in ('saas-expense-proofs','payment-proofs')),
 enabled boolean not null default false,
 retention_months integer check(retention_months>0),
 orphan_grace_hours integer check(orphan_grace_hours>0),
 legal_basis text,
 approved_by uuid references auth.users(id),approved_at timestamptz,
 check(not enabled or (retention_months is not null and orphan_grace_hours is not null
   and legal_basis is not null and length(trim(legal_basis))>=20 and approved_by is not null and approved_at is not null))
);
insert into saas_admin.document_retention(bucket_id) values('saas-expense-proofs'),('payment-proofs');
comment on table saas_admin.document_retention is
 'Aucune durée légale présumée. Configuration réservée à un opérateur autorisé, après validation juridique. Conservation des pièces liées à partir de leur dépôt ; délai des orphelins depuis storage.objects.created_at. Gel juridique prioritaire. Aucune suppression automatisée au Lot 4C.';
create table saas_admin.document_holds (
 bucket_id text not null references saas_admin.document_retention(bucket_id),object_path text not null,
 reason text not null check(length(trim(reason))>=10),created_at timestamptz not null default now(),primary key(bucket_id,object_path)
);
alter table saas_admin.finance_policies enable row level security;
alter table saas_admin.document_retention enable row level security;
alter table saas_admin.document_holds enable row level security;
revoke all on saas_admin.finance_policies,saas_admin.document_retention,saas_admin.document_holds from public,anon,authenticated,service_role;
create trigger finance_policy_append_only before update or delete on saas_admin.finance_policies
 for each row execute function saas_admin.append_only();

-- Prorata à la seconde, arrondi cumulatif : deux périodes adjacentes additionnent
-- exactement le total. Jamais 12 x un arrondi mensuel indépendant.
create function saas_admin.recognition_cumulative(p_net numeric,p_start timestamptz,p_end timestamptz,p_at timestamptz)
returns numeric language sql immutable set search_path=pg_catalog as $$
 select case when p_end<=p_start or p_at<=p_start then 0
 when p_at>=p_end then p_net
 else round(p_net * extract(epoch from (p_at-p_start))/extract(epoch from (p_end-p_start))) end;
$$;

create function public.rpc_admin_finance_recognition(p_from date,p_until date,p_currency text default '') returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare rows jsonb:='[]'::jsonb; cur text; policy saas_admin.finance_policies;
 revenue numeric; charges numeric; r record; start_t timestamptz; end_t timestamptz;
 refunded_start numeric;refunded_end numeric;net_start numeric;net_end numeric;reason text;
begin
 if not saas_admin.has_permission('finance.read',true) then return jsonb_build_object('error','ADMIN_FORBIDDEN'); end if;
 if p_from is null or p_until is null or p_until<=p_from or p_until>p_from+366 then return jsonb_build_object('error','ADMIN_INVALID'); end if;
 start_t:=p_from::timestamp at time zone 'UTC';end_t:=p_until::timestamp at time zone 'UTC';
 for cur in select currency from saas_admin.cash_accounts union select currency from saas_admin.expenses
   union select currency from saas_admin.payments union select currency from saas_admin.finance_policies loop
   if coalesce(p_currency,'')<>'' and cur<>p_currency then continue; end if;
   reason:=null;revenue:=0;charges:=0;
   select * into policy from saas_admin.finance_policies where currency=cur and approved;
   if not found then reason:='Hypothèses HT/TTC, TVA, déductibilité et attribution des charges non approuvées.';
   elsif policy.valid_from>p_from then reason:='La période précède la couverture de la politique approuvée.';
   elsif exists(select 1 from saas_admin.payments p left join saas_admin.payment_allocations a on a.payment_id=p.id
     left join public.subscriptions s on s.id=a.subscription_id where p.currency=cur
     and (a.subscription_id is null or s.started_at is null or s.expires_at is null or s.expires_at<=s.started_at
       or a.amount_minor<>p.amount_minor or s.currency<>p.currency)) then
     reason:='Encaissement sans période de service ou allocation cohérente : rapprochement requis.';
   end if;
   if reason is null then
     for r in select p.id,p.amount_minor,s.started_at,s.expires_at from saas_admin.payments p
       join saas_admin.payment_allocations a on a.payment_id=p.id join public.subscriptions s on s.id=a.subscription_id
       where p.currency=cur and s.started_at<end_t loop
       -- Les remboursements ne sont pas des charges : réduction du revenu de
       -- la période initiale. A la date de valeur, rattrapage de la part déjà
       -- reconnue ; une compensation inverse restaure la même base.
       select coalesce(sum(-m.direction*m.amount_minor),0) into refunded_start from saas_admin.cash_movements m
         where m.payment_id=r.id and m.occurred_on<p_from;
       select coalesce(sum(-m.direction*m.amount_minor),0) into refunded_end from saas_admin.cash_movements m
         where m.payment_id=r.id and m.occurred_on<p_until;
       if refunded_start not between 0 and r.amount_minor or refunded_end not between 0 and r.amount_minor then
         reason:='Remboursement net incohérent : correction requise.';exit;
       end if;
       net_start:=round((r.amount_minor-refunded_start)/(1+policy.vat_rate));
       net_end:=round((r.amount_minor-refunded_end)/(1+policy.vat_rate));
       revenue:=revenue+saas_admin.recognition_cumulative(net_end,r.started_at,r.expires_at,end_t)
         -saas_admin.recognition_cumulative(net_start,r.started_at,r.expires_at,start_t);
     end loop;
     select coalesce(sum((case when e.kind='charge' then 1 else -1 end)*
       (e.amount_minor-case when policy.expense_tax_deductible then e.tax_minor else 0 end)),0)
       into charges from saas_admin.expenses e where e.currency=cur and e.status='posted'
       and e.incurred_on>=p_from and e.incurred_on<p_until;
   end if;
   rows:=rows||jsonb_build_array(jsonb_build_object('currency',cur,'available',reason is null,'reason',reason,
     'recognized_revenue_minor',case when reason is null then revenue else null end,
     'attributable_charges_minor',case when reason is null then charges else null end,
     'management_result_minor',case when reason is null then revenue-charges else null end,
     'policy_id',policy.id,'method','Prorata temporel cumulatif UTC ; charges à leur date ; remboursement avec rattrapage.',
     'official_accounting',false));
 end loop;
 insert into saas_admin.audit_events(actor_id,action,outcome) values(auth.uid(),'finance.recognition.read','allowed');
 return jsonb_build_object('rows',rows,'timezone','UTC','scope','Entreprise Jisra, période et devise ; indépendant des filtres catégorie/compte/statut.',
   'no_policy_reason','Aucune politique fiscale/comptable approuvée. Revenu et résultat indisponibles, trésorerie inchangée.');
end $$;

create function public.rpc_admin_document_retention() returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare rows jsonb;
begin
 if not saas_admin.has_permission('finance.read',true) then return jsonb_build_object('error','ADMIN_FORBIDDEN'); end if;
 with linked as (
   select 'saas-expense-proofs'::text bucket_id,object_path,created_at from saas_admin.expense_proofs
   union all select 'payment-proofs',object_path,created_at from public.payment_proofs
 )
 select jsonb_agg(jsonb_build_object('bucket',p.bucket_id,'configured',p.enabled,'retention_months',p.retention_months,
   'orphan_grace_hours',p.orphan_grace_hours,'legal_basis',p.legal_basis,
   'orphan_objects',(select count(*) from storage.objects o where o.bucket_id=p.bucket_id and not exists(select 1 from linked l where l.bucket_id=o.bucket_id and l.object_path=o.name)),
   'missing_objects',(select count(*) from linked l where l.bucket_id=p.bucket_id and not exists(select 1 from storage.objects o where o.bucket_id=l.bucket_id and o.name=l.object_path)),
   'purge_candidates',case when p.enabled then (select count(*) from storage.objects o
     where o.bucket_id=p.bucket_id and not exists(select 1 from saas_admin.document_holds h where h.bucket_id=o.bucket_id and h.object_path=o.name)
     and ((exists(select 1 from linked l where l.bucket_id=o.bucket_id and l.object_path=o.name and l.created_at<now()-make_interval(months=>p.retention_months)))
       or (o.created_at<now()-make_interval(hours=>p.orphan_grace_hours) and not exists(select 1 from linked l where l.bucket_id=o.bucket_id and l.object_path=o.name)))) else null end))
 into rows from saas_admin.document_retention p;
 insert into saas_admin.audit_events(actor_id,action,outcome) values(auth.uid(),'finance.retention.inventory','allowed');
 return jsonb_build_object('rows',rows,'deletion_enabled',false,
   'rules','Inventaire seul. Durées à approuver ; gel juridique prioritaire ; orphelins après délai de sécurité ; pièces manquantes à investiguer. Aucune purge, aucun cron ni suppression autorisés dans ce lot.');
end $$;
revoke all on function saas_admin.recognition_cumulative(numeric,timestamptz,timestamptz,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.rpc_admin_finance_recognition(date,date,text),public.rpc_admin_document_retention() from public,anon,service_role;
grant execute on function public.rpc_admin_finance_recognition(date,date,text),public.rpc_admin_document_retention() to authenticated;
commit;