-- P7.10 : verification de l'INSTALLATION INACTIVE (lecture seule).
-- A executer apres 10_ + 11_, AVANT 20_. Aucune ecriture.
\set ON_ERROR_STOP on
\pset pager off
-- Aucune ecriture persistante : SELECT et table temporaire de session seulement.

create temp table _i(label text primary key, ok boolean not null, detail text);
do $v$
declare
  rec record; n int; h text;
begin
  insert into _i values ('config_table', to_regclass('public.dashboard_kpi_producer_config') is not null, '');
  insert into _i values ('stores_table', to_regclass('public.dashboard_kpi_producer_stores') is not null, '');
  insert into _i values ('status_view', to_regclass('public.dashboard_kpi_producer_status') is not null, '');

  for rec in
    select * from (values
      ('dashboard_kpi_producers_armed()'),
      ('dashboard_kpi_producer_active(uuid)'),
      ('dashboard_kpi_day_claimed(uuid,date)'),
      ('dashboard_kpi_producer_arm(boolean)'),
      ('dashboard_kpi_producer_disable_store(uuid,text)'),
      ('dashboard_kpi_producer_enable_store(uuid,date,text)'),
      ('dashboard_kpi_worker_note_failure(uuid,date,uuid,text)')
    ) as e(sig)
  loop
    insert into _i select 'function_' || rec.sig,
      to_regprocedure('public.' || rec.sig) is not null, coalesce(to_regprocedure('public.' || rec.sig)::text, 'ABSENTe');
  end loop;

  select count(*) into n from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where c.relnamespace = 'public'::regnamespace and not t.tgisinternal and t.tgname like 'trg_kpi_%';
  insert into _i values ('zero_trigger', n = 0, 'triggers=' || n);

  insert into _i values ('capture_disarmed',
    (select enabled from public.dashboard_kpi_producer_config where id = 1) is false, 'enabled=false');
  select count(*) into n from public.dashboard_kpi_producer_stores where enabled;
  insert into _i values ('no_eligible_store', n = 0, 'eligibles=' || n);

  insert into _i values ('worker_disabled',
    (select enabled from public.dashboard_kpi_worker_config where id = 1) is false, 'worker=false');
  insert into _i values ('wakeup_disabled',
    (select enabled from public.dashboard_kpi_wakeup_config where id = 1) is false, 'wakeup=false');
  select count(*) into n from public.dashboard_kpi_rollout_cohorts;
  insert into _i values ('no_reader_cohort', n = 0, 'cohortes=' || n);
  insert into _i values ('rollout_legacy',
    (select kill_switch and requested_mode = 'legacy' from public.dashboard_kpi_rollout_config where id = 1),
    'legacy');
  insert into _i values ('no_cron_extension', to_regclass('cron.job') is null or
    (select count(*) from pg_extension where extname = 'pg_cron') = 0, 'cron absent ou inactif');

  for rec in
    select * from (values
      ('dashboard_kpi_invalidate_trg()', '3a11c2a622833bd58ba64244a9f23a08'),
      ('dashboard_kpi_invalidate_insert_stmt()', '60a03918fcb663b4f908f13486179d8e'),
      ('dashboard_kpi_mark_order_insert()', '80ed494f8623b37e92937b26677a2546'),
      ('dashboard_kpi_invalidate_orders_quality_trg()', '4a5b55cb2e2d443c8f0c7a4fd5287b8a'),
      ('dashboard_kpi_producers_armed()', 'ca961583cb7c5722e9d3d453424c33db'),
      ('dashboard_kpi_producer_active(uuid)', '70fb8a5b5c3861755036a37798cf5cf7'),
      ('dashboard_kpi_day_claimed(uuid,date)', 'd3b8a065a801678631d0fc2278eafbb0'),
      ('dashboard_kpi_producer_arm(boolean)', '4cc7900d7392566e0ef4c11f71141038'),
      ('dashboard_kpi_producer_disable_store(uuid,text)', 'd4621a5768dd08783d7071dbd1a0750f'),
      ('dashboard_kpi_producer_enable_store(uuid,date,text)', 'c3b12d082732bb8ebddf37f6309d694d'),
      ('dashboard_kpi_worker_run(text,integer,bigint,numeric)', '98cb969dd827a1dc1858f69bfea6d3ac'),
      ('dashboard_kpi_worker_note_failure(uuid,date,uuid,text)', '1b1cc0fc8dd90bd28f5fd645b4ef67ee')
    ) as e(sig, md5)
  loop
    h := null;
    if to_regprocedure('public.' || rec.sig) is not null then
      h := md5(pg_get_functiondef(to_regprocedure('public.' || rec.sig)));
    end if;
    insert into _i values ('hash_' || rec.sig, h = rec.md5, coalesce(h, 'ABSENTE'));
  end loop;
end
$v$;

select label, case when ok then 'PASS' else 'FAIL' end as status, detail from _i order by label;
do $v$
declare n int; total int;
begin
  select count(*), count(*) filter (where not ok) into total, n from _i;
  if n > 0 then raise exception 'INSTALL_INACTIVE_FAILED : % / %', n, total; end if;
  raise notice 'INSTALL_INACTIVE_OK : % controles', total;
end
$v$;
