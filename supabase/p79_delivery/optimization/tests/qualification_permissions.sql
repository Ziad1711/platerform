-- P7.10 : permissions du pilotage de capture et du journal.
\set ON_ERROR_STOP on
set client_min_messages = notice;
create temp table _p(label text primary key, ok boolean not null, detail text);

DO $t$
declare s text;
begin
  -- 1. ACL statiques
  insert into _p values ('acl_arm_authenticated',
    not has_function_privilege('authenticated', 'public.dashboard_kpi_producer_arm(boolean)', 'EXECUTE'), 'execute refuse');
  insert into _p values ('acl_arm_anon',
    not has_function_privilege('anon', 'public.dashboard_kpi_producer_arm(boolean)', 'EXECUTE'), 'execute refuse');
  insert into _p values ('acl_enable_authenticated',
    not has_function_privilege('authenticated', 'public.dashboard_kpi_producer_enable_store(uuid,date,text)', 'EXECUTE'), 'execute refuse');
  insert into _p values ('acl_disable_authenticated',
    not has_function_privilege('authenticated', 'public.dashboard_kpi_producer_disable_store(uuid,text)', 'EXECUTE'), 'execute refuse');
  insert into _p values ('acl_arm_service_role',
    has_function_privilege('service_role', 'public.dashboard_kpi_producer_arm(boolean)', 'EXECUTE'), 'execute autorise');
  insert into _p values ('acl_config_table_authenticated',
    not has_table_privilege('authenticated', 'public.dashboard_kpi_producer_config', 'SELECT,INSERT,UPDATE,DELETE'), 'aucun droit table');
  insert into _p values ('acl_stores_table_authenticated',
    not has_table_privilege('authenticated', 'public.dashboard_kpi_producer_stores', 'SELECT,INSERT,UPDATE,DELETE'), 'aucun droit table');
  insert into _p values ('acl_invalidation_authenticated',
    not has_table_privilege('authenticated', 'public.dashboard_kpi_invalidation', 'SELECT,INSERT,UPDATE,DELETE'), 'aucun droit journal');
  insert into _p values ('acl_status_view_authenticated',
    not has_table_privilege('authenticated', 'public.dashboard_kpi_producer_status', 'SELECT'), 'vue non lisible');

  -- 2. Tentatives reelles sous role applicatif
  begin
    set local role authenticated;
    perform public.dashboard_kpi_producer_arm(true);
    s := 'SUCCESS';
  exception when others then s := SQLSTATE;
  end;
  reset role;
  insert into _p values ('arm_denied_authenticated', s = '42501', s);

  begin
    set local role authenticated;
    perform public.dashboard_kpi_producer_enable_store('7e000000-0000-4000-8000-0000000000a1'::uuid, null, 'x');
    s := 'SUCCESS';
  exception when others then s := SQLSTATE;
  end;
  reset role;
  insert into _p values ('enable_denied_authenticated', s = '42501', s);

  begin
    set local role anon;
    perform public.dashboard_kpi_producer_arm(true);
    s := 'SUCCESS';
  exception when others then s := SQLSTATE;
  end;
  reset role;
  insert into _p values ('arm_denied_anon', s = '42501', s);

  begin
    set local role authenticated;
    perform 1 from public.dashboard_kpi_invalidation limit 1;
    s := 'SUCCESS';
  exception when others then s := SQLSTATE;
  end;
  reset role;
  insert into _p values ('journal_read_denied_authenticated', s = '42501', s);

  begin
    set local role authenticated;
    insert into public.dashboard_kpi_invalidation (store_id, business_date, reason)
    values ('7e000000-0000-4000-8000-0000000000a1'::uuid, '2035-02-01', 'forged');
    s := 'SUCCESS';
  exception when others then s := SQLSTATE;
  end;
  reset role;
  insert into _p values ('journal_write_denied_authenticated', s = '42501', s);

  begin
    set local role authenticated;
    update public.dashboard_kpi_producer_stores set enabled = true;
    s := 'SUCCESS';
  exception when others then s := SQLSTATE;
  end;
  reset role;
  insert into _p values ('store_config_write_denied_authenticated', s = '42501', s);

  -- 3. service_role conserve le pilotage (puis remise en etat)
  begin
    set local role service_role;
    perform public.dashboard_kpi_producer_arm(true);
    s := 'SUCCESS';
  exception when others then s := SQLSTATE;
  end;
  reset role;
  insert into _p values ('arm_allowed_service_role', s = 'SUCCESS', s);
end
$t$;

select label, case when ok then 'PASS' else 'FAIL' end as status, detail from _p order by label;
do $t$
declare n int; total int;
begin
  select count(*), count(*) filter (where not ok) into total, n from _p;
  if n > 0 then raise exception 'PERMISSIONS_FAILED : % / %', n, total; end if;
  raise notice 'PERMISSIONS_PASS : % controles', total;
end
$t$;
