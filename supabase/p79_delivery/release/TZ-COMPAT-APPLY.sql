-- NON EXECUTE. Source Production read-only compared to patch before generation.
-- psql -X -w service=production -v ON_ERROR_STOP=1 -v capture_file=<absolute JSON path> -f <absolute this file>
\set ON_ERROR_STOP on
\pset pager off
\if :{?capture_file}
\else
\echo 'STOP: -v capture_file=<absolute path> mandatory'
\quit 3
\endif
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
set local kpi.tz_compat_authorized='yes';
create temp table _tz_expected(signature text primary key,md5 text not null) on commit drop;
insert into _tz_expected values ('dashboard_kpi_business_date(timestamp with time zone,text)','86835f3507dad67879ede24208f13818'),
('dashboard_kpi_direct_day(uuid,date,text)','20bbe141a11a94e72b9587c2d85eff54'),
('dashboard_kpi_invalidate_insert_stmt()','3aae1ffbfbbba014d6de0c321559be21'),
('dashboard_kpi_invalidate_orders_quality_trg()','091c0890a3e245de0b05387c7f2f4dbf'),
('dashboard_kpi_invalidate_trg()','b5211b6ea09373280e81a3f38c0aa01a'),
('dashboard_kpi_rebuild_day(uuid,date,uuid,bigint[])','08f35896a0b63dc67806926c5a5397af'),
('rpc_dashboard_kpi_reader(uuid[],date,date,boolean)','ea603cf2f66e47f7f57c79a985352e2d');
create temp table _tz_before on commit drop as
 select p.oid,pg_get_functiondef(p.oid) definition,p.prosrc,to_jsonb(p)-'oid' attrs
 from pg_proc p join _tz_expected e on p.oid=to_regprocedure('public.'||e.signature);
create temp table _tz_security on commit drop as select
 (select jsonb_agg(to_jsonb(p) order by tablename,policyname) from pg_policies p where schemaname='public') policies,
 (select jsonb_agg(jsonb_build_object('def',pg_get_triggerdef(t.oid),'enabled',t.tgenabled) order by t.oid) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace and not t.tgisinternal) triggers,
 (select to_jsonb(c) from public.dashboard_kpi_rollout_config c where id=1) rollout,
 (select to_jsonb(c) from public.dashboard_kpi_worker_config c where id=1) worker,
 (select to_jsonb(c) from public.dashboard_kpi_wakeup_config c where id=1) wakeup;
do $pre$
begin
 if current_database()<>'postgres' or current_user<>'postgres' then raise exception 'TZ_BAD_IDENTITY';end if;
 if (select count(*) from _tz_before)<>7 or exists(select 1 from _tz_expected e where md5(pg_get_functiondef(to_regprocedure('public.'||e.signature))) is distinct from e.md5) then raise exception 'TZ_SOURCE_DRIFT';end if;
 if to_regprocedure('public.dashboard_kpi_local_ts(timestamptz,text)') is not null or to_regprocedure('public.dashboard_kpi_local_instant(timestamp,text)') is not null then raise exception 'TZ_HELPER_ALREADY_PRESENT';end if;
 if exists(select 1 from pg_trigger where not tgisinternal and tgname like 'trg_kpi_%' and tgenabled<>'D') or exists(select 1 from public.dashboard_kpi_rollout_cohorts) or exists(select 1 from public.dashboard_kpi_worker_config where enabled) or exists(select 1 from public.dashboard_kpi_wakeup_config where enabled) or not exists(select 1 from public.dashboard_kpi_rollout_config where id=1 and kill_switch and requested_mode='legacy') then raise exception 'TZ_TARGET_NOT_INACTIVE';end if;
 if exists(select 1 from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and state='active' and query ~* '(create|alter|drop)[[:space:]]+(function|table|trigger|policy|extension)') then raise exception 'TZ_CONCURRENT_DDL';end if;
end $pre$;
-- Client-side capture only. No server-side file access. No secrets.
\pset format unaligned
\pset tuples_only on
\o :capture_file
select jsonb_build_object('functions',(select jsonb_agg(to_jsonb(b) order by oid) from _tz_before b),'security',(select to_jsonb(s) from _tz_security s));
\o
\ir TZ-COMPAT-PATCH.sql
create temp table _tz_target(signature text primary key,body_md5 text,definition_md5 text) on commit drop;
insert into _tz_target values ('dashboard_kpi_business_date(timestamp with time zone,text)','e9f9dc6e74d518127a938bd5a55171c6','d0550083e6cab3fcf69de8f98407e92f'),
('dashboard_kpi_direct_day(uuid,date,text)','89da378339a950390ed3dab8c8111807','58fd299e575c3fd05c83f83ccaa0b1ba'),
('dashboard_kpi_invalidate_insert_stmt()','63a98ce2c754c9e706f4c779488d6443','db18817564f6348743ee82b389ec56db'),
('dashboard_kpi_invalidate_orders_quality_trg()','f9ba2e9d587edbb4cb50a1ef9fccfe50','0af853293f65fb45a51887a3a0dd82cc'),
('dashboard_kpi_invalidate_trg()','9c9c348d9554d97e15f5e66818406539','10e7ba5957e8e70479208ab82e1fbfd4'),
('dashboard_kpi_local_instant(timestamp without time zone,text)','14886a8204e75e8f5b4816c4b7d89750','4ed00c8d501110ec36eb79f62eb2a396'),
('dashboard_kpi_local_ts(timestamp with time zone,text)','43edb54b0a5b4eb3b86d1e166dc91e9c','b813c1f2e4533f54e00675911a39883f'),
('dashboard_kpi_rebuild_day(uuid,date,uuid,bigint[])','434de140177a2e1cea5aca42fd050804','93c3b3244bec4fa57346120dc691af4c'),
('rpc_dashboard_kpi_reader(uuid[],date,date,boolean)','b95d97616b6ba7c513c5937f78ada3c4','3f535506d9a59e9ae11898f3566f2107');
do $post$
declare ts timestamptz; local_ts timestamp; z text; sample timestamp; orig jsonb; curr jsonb;
begin
 if exists(select 1 from _tz_before b join pg_proc p on p.oid=b.oid where (b.attrs-'prosrc') is distinct from (to_jsonb(p)-'oid'-'prosrc')) then raise exception 'TZ_METADATA_ACL_DRIFT';end if;
 if (select count(*) from _tz_target)<>9 or exists(select 1 from _tz_target e where to_regprocedure('public.'||e.signature) is null or md5(pg_get_functiondef(to_regprocedure('public.'||e.signature))) is distinct from e.definition_md5 or (select md5(p.prosrc) from pg_proc p where p.oid=to_regprocedure('public.'||e.signature)) is distinct from e.body_md5) then raise exception 'TZ_TARGET_HASH_FAILED';end if;
 if exists(select 1 from pg_proc p where p.oid in (to_regprocedure('public.dashboard_kpi_local_ts(timestamptz,text)'),to_regprocedure('public.dashboard_kpi_local_instant(timestamp,text)')) and (p.prosecdef or p.provolatile<>'s' or has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))) then raise exception 'TZ_HELPER_ACL_FAILED';end if;
 for ts in select unnest(array[timestamptz '2026-09-20 00:59:59Z',timestamptz '2026-09-20 01:00Z',timestamptz '2026-09-20 01:00:01Z',timestamptz '2026-10-21 23:30Z']) loop
 sample:=case when ts<timestamptz '2026-09-20 01:00Z' then timestamp '2026-09-20 01:59:59' else ts at time zone 'UTC' end;
 if public.dashboard_kpi_local_ts(ts,'Africa/Casablanca') is distinct from sample or public.dashboard_kpi_business_date(ts,'Africa/Casablanca') is distinct from sample::date then raise exception 'TZ_CONVERSION_FAILED %',ts;end if;end loop;
 for local_ts in select unnest(array[timestamp '2026-09-20 00:00',timestamp '2026-09-20 01:00',timestamp '2026-09-20 01:30',timestamp '2026-09-20 02:00',timestamp '2026-09-21 00:00']) loop
 ts:=case when local_ts<timestamp '2026-09-20 01:00' then (local_ts-interval '1 hour') at time zone 'UTC' else local_ts at time zone 'UTC' end;
 if public.dashboard_kpi_local_instant(local_ts,'Africa/Casablanca') is distinct from ts then raise exception 'TZ_INVERSE_FAILED %',local_ts;end if;end loop;
 if extract(epoch from (public.dashboard_kpi_local_instant('2026-09-21 00:00','Africa/Casablanca')-public.dashboard_kpi_local_instant('2026-09-20 00:00','Africa/Casablanca')))<>90000 then raise exception 'TZ_25H_FAILED';end if;
 -- No modification of policies/triggers/configs is permitted.
 select to_jsonb(s) into orig from _tz_security s;
 select jsonb_build_object('policies',(select jsonb_agg(to_jsonb(p) order by tablename,policyname) from pg_policies p where schemaname='public'),'triggers',(select jsonb_agg(jsonb_build_object('def',pg_get_triggerdef(t.oid),'enabled',t.tgenabled) order by t.oid) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace and not t.tgisinternal),'rollout',(select to_jsonb(c) from public.dashboard_kpi_rollout_config c where id=1),'worker',(select to_jsonb(c) from public.dashboard_kpi_worker_config c where id=1),'wakeup',(select to_jsonb(c) from public.dashboard_kpi_wakeup_config c where id=1)) into curr;
 if orig is distinct from curr then raise exception 'TZ_SECURITY_OR_CONFIG_DRIFT';end if;
 raise notice 'TZ_COMPAT_VALIDATED_NO_ACTIVATION';
end $post$;
commit;
