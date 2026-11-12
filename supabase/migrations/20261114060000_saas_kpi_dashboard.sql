-- Lot 4D. Agrégats SaaS : aucune commande, aucun contenu de boutique.
begin;
set local lock_timeout='5s';
insert into saas_admin.role_permissions(role,permission) values
 ('platform_owner','dashboard.read'),('commercial_reader','dashboard.read');
create table saas_admin.account_classification (
 user_id uuid primary key references auth.users(id) on delete restrict,
 classification text not null default 'customer' check(classification in ('customer','internal','test')),
 classified_by uuid references auth.users(id),
 reason text check(length(trim(reason)) between 10 and 300),
 created_at timestamptz not null default now(),
 check(classification='customer' or (classified_by is not null and reason is not null))
);
create index if not exists stores_owner_created_dashboard on public.stores(owner_user_id,created_at);
create index if not exists subscriptions_dashboard_period on public.subscriptions(plan_id,status,started_at,expires_at);
create index if not exists payments_dashboard_value_date on saas_admin.payments(value_date);
alter table saas_admin.account_classification enable row level security;
revoke all on saas_admin.account_classification from public,anon,authenticated,service_role;
alter table saas_admin.finance_policies add column mrr_normalization_approved boolean not null default false;
comment on column saas_admin.finance_policies.mrr_normalization_approved is
 'Validation explicite de la normalisation MRR/ARR (prix HT, FX figé). Distincte du résultat de gestion.';

create function public.rpc_admin_saas_dashboard(p_from date,p_until date) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
 period_days integer;prev_from date;accounts_created bigint;accounts_prev bigint;owners bigint;stores_count bigint;
 current_dist jsonb;prev_dist jsonb;expiring bigint;renewals bigint;paying_end bigint;paying_start bigint;
 retention numeric;mrr jsonb;arr jsonb;mrr_state text;mrr_reason text;receipts jsonb;expenses jsonb;
 series jsonb;previous jsonb;coverage jsonb;start_t timestamptz;end_t timestamptz;
begin
 if not saas_admin.has_permission('dashboard.read',true) then
   insert into saas_admin.audit_events(actor_id,action,outcome) values(auth.uid(),'dashboard.read','denied');
   return jsonb_build_object('error','ADMIN_FORBIDDEN');
 end if;
 if p_from is null or p_until is null or p_until<=p_from or p_until>p_from+366 then return jsonb_build_object('error','ADMIN_INVALID'); end if;
 period_days:=p_until-p_from;prev_from:=p_from-period_days;
 start_t:=p_from::timestamp at time zone 'UTC';end_t:=p_until::timestamp at time zone 'UTC';
 select count(*) filter(where u.created_at>=start_t and u.created_at<end_t),
   count(*) filter(where u.created_at>=prev_from::timestamp at time zone 'UTC' and u.created_at<start_t)
   into accounts_created,accounts_prev from auth.users u
   where not exists(select 1 from saas_admin.account_classification c where c.user_id=u.id and c.classification<>'customer');
 select count(distinct st.owner_user_id),count(*) into owners,stores_count from public.stores st
   where st.owner_user_id is not null
   and not exists(select 1 from saas_admin.account_classification c where c.user_id=st.owner_user_id and c.classification<>'customer');
 with eff as (
   select q.code from auth.users u left join lateral (
     select q.code from public.subscriptions s join public.plans q on q.id=s.plan_id
      where s.user_id=u.id and s.status='active' and (s.started_at is null or s.started_at<=end_t)
        and (s.expires_at is null or s.expires_at>end_t)
      order by q.rank desc,s.started_at desc nulls last,s.id limit 1) q on true
   where not exists(select 1 from saas_admin.account_classification c where c.user_id=u.id and c.classification<>'customer')
 )
 select coalesce(jsonb_object_agg(coalesce(code,'free'),n),'{}'::jsonb) into current_dist
   from (select code,count(*) n from eff group by code) z;
 with eff as (
   select q.code from auth.users u left join lateral (
     select q.code from public.subscriptions s join public.plans q on q.id=s.plan_id
      where s.user_id=u.id and s.status='active' and (s.started_at is null or s.started_at<=start_t)
        and (s.expires_at is null or s.expires_at>start_t)
      order by q.rank desc,s.started_at desc nulls last,s.id limit 1) q on true
   where not exists(select 1 from saas_admin.account_classification c where c.user_id=u.id and c.classification<>'customer')
 )
 select coalesce(jsonb_object_agg(coalesce(code,'free'),n),'{}'::jsonb) into prev_dist
   from (select code,count(*) n from eff group by code) z;
 paying_start:=coalesce((prev_dist->>'pro')::bigint,0)+coalesce((prev_dist->>'ultimate')::bigint,0);
 paying_end:=coalesce((current_dist->>'pro')::bigint,0)+coalesce((current_dist->>'ultimate')::bigint,0);
 retention:=case when paying_start=0 then null else round(paying_end::numeric/paying_start,4) end;
 select count(*) into renewals from public.subscriptions s join saas_admin.payment_allocations a on a.subscription_id=s.id
   where s.started_at>=start_t and s.started_at<end_t
   and exists(select 1 from public.subscriptions o where o.user_id=s.user_id and o.plan_id=s.plan_id and o.expires_at<=s.started_at and o.id<>s.id);
 select count(*) into expiring from public.subscriptions s where s.status='active' and s.expires_at>=end_t
   and s.expires_at<end_t+interval '30 days';

 mrr:=null;arr:=null;
 if exists(select 1 from saas_admin.finance_policies where approved and mrr_normalization_approved) then
   mrr_state:='available';mrr_reason:=null;
   select jsonb_agg(jsonb_build_object('currency',x.currency,'mrr_minor',x.mrr_minor,'arr_minor',x.mrr_minor*12)) into mrr from (
     select p.currency,sum(round((s.amount_paid*100/(1+(select vat_rate from saas_admin.finance_policies f
         where f.currency=p.currency and f.approved limit 1)))::numeric
         *(extract(epoch from (least(s.expires_at,end_t)-greatest(s.started_at,start_t))))
         /nullif(extract(epoch from (s.expires_at-s.started_at)),0)))::bigint as mrr_minor
     from public.subscriptions s join saas_admin.payment_allocations a on a.subscription_id=s.id
       join saas_admin.payments p on p.id=a.payment_id
     where s.status='active' and s.expires_at>start_t and s.started_at<end_t group by p.currency) x;
   arr:=mrr;
 else
   mrr_state:='unavailable';
   mrr_reason:='Normalisation MRR/ARR non approuvée (HT/TVA et hypothèses de conversion) : aucun montant récurrent affiché.';
 end if;
 select coalesce(jsonb_agg(x),'[]'::jsonb) into receipts from (
   select p.currency,sum(p.amount_minor) receipts_minor,count(*) receipt_count from saas_admin.payments p
   where p.value_date>=p_from and p.value_date<p_until group by p.currency) x;
 select coalesce(jsonb_agg(x),'[]'::jsonb) into expenses from (
   select e.currency,sum((case when e.kind='charge' then 1 else -1 end)*e.amount_minor) committed_gross_minor
   from saas_admin.expenses e where e.status='posted' and e.incurred_on>=p_from and e.incurred_on<p_until group by e.currency) x;
 select coalesce(jsonb_agg(jsonb_build_object('day',bucket,'accounts',accounts,'paid_starts',starts) order by bucket),'[]'::jsonb) into series from (
   select d::date AS bucket,
     (select count(*) from auth.users u where u.created_at>=d::timestamp at time zone 'UTC'
       and u.created_at<(d+interval '1 day')::timestamp at time zone 'UTC') accounts,
     (select count(*) from public.subscriptions s where s.status='active'
       and s.started_at>=d::timestamp at time zone 'UTC' and s.started_at<(d+interval '1 day')::timestamp at time zone 'UTC') starts
   from generate_series(p_from,p_until-1,'1 day'::interval) d) x;
 select coalesce(jsonb_agg(jsonb_build_object('day',bucket,'accounts',accounts) order by bucket),'[]'::jsonb) into previous from (
   select d::date AS bucket,(select count(*) from auth.users u where u.created_at>=d::timestamp at time zone 'UTC'
     and u.created_at<(d+interval '1 day')::timestamp at time zone 'UTC') accounts
   from generate_series(prev_from,p_from-1,'1 day'::interval) d) x;
 coverage:=jsonb_build_object(
   'activity','Indisponible : instrumentation d’activité authentifiée non approuvée.',
   'acquisition','Indisponible : Google Analytics non connecté (Lot 4E).',
   'revenue_recognition','Indisponible sans politique fiscale approuvée.',
   'historical_baseline','Cohortes antérieures à la mesure indisponibles ; aucune reconstitution inventée.',
   'onboarding','Date de première boutique utilisée comme approximation de l’activation.');
 insert into saas_admin.audit_events(actor_id,action,outcome) values(auth.uid(),'dashboard.read','allowed');
 return jsonb_build_object('from',p_from,'until',p_until,'previous_from',prev_from,'days',period_days,
  'accounts_created',accounts_created,'accounts_previous',accounts_prev,
  'customers',owners,'stores',stores_count,
  'plans',current_dist,'plans_previous',prev_dist,'paying_accounts',paying_end,'paying_start',paying_start,
  'retention_rate',retention,'renewals',renewals,'expiring_30d',expiring,
  'mrr',mrr,'arr',arr,'mrr_state',mrr_state,'mrr_reason',mrr_reason,
  'receipts',receipts,'expenses_committed',expenses,'series',series,'series_previous',previous,'coverage',coverage,
  'notes',jsonb_build_array('MRR/ARR normalisés distincts des encaissements et de la trésorerie.',
    'Aucun accès aux commandes, produits ou clients des boutiques.','Aucun bénéfice comptable affiché.'));
end $$;
revoke all on function public.rpc_admin_saas_dashboard(date,date) from public,anon,service_role;
grant execute on function public.rpc_admin_saas_dashboard(date,date) to authenticated;
commit;
