-- JISRA — P7.10 : vérification des producteurs optimisés (LECTURE SEULE).
--   psql -X -w -v ON_ERROR_STOP=1 "service=..." -f 90_verify_producer_optimization.sql
\set ON_ERROR_STOP on
\pset pager off

create temp table _opt_check(label text primary key, ok boolean not null, detail text);
do $verify$
declare
  n int; v int;
  v_hash text;
  rec record;
begin
  -- 1. Configuration de capture présente, désarmée par défaut après installation.
  insert into _opt_check
  select 'config_present',
         to_regclass('public.dashboard_kpi_producer_config') is not null
         and to_regclass('public.dashboard_kpi_producer_stores') is not null,
         'tables de capture';
  insert into _opt_check
  select 'view_present',
         to_regclass('public.dashboard_kpi_producer_status') is not null,
         'vue de statut';

  -- 2. Producteurs : exactement six triggers actifs, tous attendus.
  select count(*) into n from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where c.relnamespace = 'public'::regnamespace and not t.tgisinternal
     and t.tgname like 'trg_kpi_%' and t.tgenabled = 'O';
  insert into _opt_check values ('six_producers', n = 6, 'actifs=' || n);
  insert into _opt_check
  select 'mark_is_statement_level',
         bool_or((t.tgtype & 1) = 0 and (t.tgtype & 2) = 0 and (t.tgtype & 4) = 4),
         'trg_kpi_mark_order_insert doit être un trigger AFTER INSERT STATEMENT'
    from pg_trigger t
   where t.tgrelid = 'public.orders'::regclass
     and t.tgname = 'trg_kpi_mark_order_insert';

  -- 3. Empreintes des fonctions critiques.
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
    v_hash := null;
    if to_regprocedure('public.' || rec.sig) is not null then
      v_hash := md5(pg_get_functiondef(to_regprocedure('public.' || rec.sig)));
    end if;
    insert into _opt_check values ('hash_' || rec.sig, v_hash = rec.md5,
      coalesce(v_hash, '<absente>'));
  end loop;

  -- 4. Invariant de justesse : aucune boutique servie par le lecteur V5 sans capture.
  if to_regclass('public.dashboard_kpi_rollout_cohorts') is not null then
    select count(*) into n
      from public.dashboard_kpi_rollout_cohorts c
     where c.enabled
       and not coalesce((select s.enabled from public.dashboard_kpi_producer_stores s
                          where s.store_id = c.store_id), false);
    insert into _opt_check values ('reader_implies_capture', n = 0,
      'cohortes lecteur sans capture=' || n);
  else
    insert into _opt_check values ('reader_implies_capture', true, 'aucune table de cohortes');
  end if;

  -- 5. Cohérence : une capture armée sans boutique éligible est sans effet.
  select count(*) into v from public.dashboard_kpi_producer_stores where enabled;
  insert into _opt_check values ('capture_state_reported', true,
    'armed=' || (select enabled::text from public.dashboard_kpi_producer_config where id = 1)
    || ' eligible_stores=' || v);
end
$verify$;

select label, case when ok then 'PASS' else 'FAIL' end as status, detail
  from _opt_check order by label;

do $verify$
declare n int; total int;
begin
  select count(*), count(*) filter (where not ok) into total, n from _opt_check;
  if n > 0 then raise exception 'P710_VERIFY_FAILED : % / %', n, total; end if;
  raise notice 'P710_VERIFY_PASS : % controles', total;
end
$verify$;
