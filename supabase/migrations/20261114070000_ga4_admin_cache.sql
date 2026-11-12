-- Lot 4E. Cache de rapports GA4 uniquement ; aucune donnée client.
begin;
insert into saas_admin.role_permissions(role,permission) values
 ('platform_owner','analytics.read'),('commercial_reader','analytics.read');
create table saas_admin.analytics_reports (
 id uuid primary key default gen_random_uuid(),
 report_key text not null check(report_key ~ '^[a-z_]{3,40}$'),
 period_start date not null,period_end date not null,
 status text not null check(status in ('ok','unavailable','error','quota')),
 payload jsonb,
 payload_sha256 text check(payload_sha256 is null or payload_sha256 ~ '^[a-f0-9]{64}$'),
 source text not null check(source in ('ga4','synthetic')),
 error_code text check(error_code is null or error_code in ('not_configured','auth','permission','quota','upstream','invalid_response')),
 fetched_at timestamptz not null default now(),
 expires_at timestamptz not null,
 check(period_end>period_start),
 unique(report_key,period_start,period_end)
);
create index analytics_reports_fresh on saas_admin.analytics_reports(report_key,period_start,period_end,expires_at);
alter table saas_admin.analytics_reports enable row level security;
revoke all on saas_admin.analytics_reports from public,anon,authenticated,service_role;

-- Lecture stricte : aucune écriture client. Le cache est alimenté par le serveur
-- après validation de la permission analytics.read et du niveau AAL2.
create function public.rpc_admin_analytics_read(p_from date,p_until date,p_source text default 'ga4') returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare rows jsonb; last_at timestamptz;
begin
 if not saas_admin.has_permission('analytics.read',true) then
   insert into saas_admin.audit_events(actor_id,action,outcome) values(auth.uid(),'analytics.read','denied');
   return jsonb_build_object('error','ADMIN_FORBIDDEN');
 end if;
 if p_from is null or p_until is null or p_until<=p_from or p_until>p_from+92 or p_source not in ('ga4','synthetic') then
   return jsonb_build_object('error','ADMIN_INVALID'); end if;
 select coalesce(jsonb_agg(jsonb_build_object('report',report_key,'status',status,'payload',payload,
   'source',source,'fetched_at',fetched_at,'expires_at',expires_at,'error_code',error_code,'fresh',expires_at>now()) order by report_key),'[]'::jsonb),
   max(fetched_at) into rows,last_at
 from saas_admin.analytics_reports where period_start=p_from and period_end=p_until and source=p_source;
 insert into saas_admin.audit_events(actor_id,action,outcome) values(auth.uid(),'analytics.read','allowed');
 return jsonb_build_object('from',p_from,'until',p_until,'source',p_source,'reports',rows,'last_sync',last_at,
   'external_calls_enabled',false,
   'coverage',jsonb_build_object(
     'ga4','Mesure consentie uniquement ; visiteurs uniques dédupliqués par Google, jamais additionnés par jour.',
     'commercial','Inscriptions et activations issues de la base Jisra, population distincte de GA4.',
     'mixed_rate','Non calculé : populations GA4 et comptes ne sont pas comparables sans identifiant commun.'));
end $$;
revoke all on function public.rpc_admin_analytics_read(date,date,text) from public,anon,service_role;
grant execute on function public.rpc_admin_analytics_read(date,date,text) to authenticated;
commit;
