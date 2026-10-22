-- P7.10 : worker, backlog, arret/reprise, rattrapage des agregats.
\set ON_ERROR_STOP on
set client_min_messages = notice;
set statement_timeout = '240s';
create temp table _w(label text primary key, ok boolean not null, detail text);
create or replace function pg_temp.chk(p_label text, p_actual text, p_expected text)
returns void language plpgsql as $fn$
begin
  insert into _w values (p_label, p_actual is not distinct from p_expected,
    'attendu=' || coalesce(p_expected,'<null>') || ' obtenu=' || coalesce(p_actual,'<null>'));
end $fn$;

-- 1. Worker arrete : le backlog s'accumule, rien n'est traite.
DO $t$
declare r record;
begin
  perform p710_reset_ev();
  update public.dashboard_kpi_worker_config set enabled = false where id = 1;
  perform p710_mk_order('7e000000-0000-4000-8000-0000000000a1'::uuid, '2035-02-01', 'W1');
  perform p710_mk_order('7e000000-0000-4000-8000-0000000000a1'::uuid, '2035-02-02', 'W1');
  select * into r from public.dashboard_kpi_worker_run('qualif', 10, 1000, 10.0);
  perform pg_temp.chk('W1_worker_disabled_stop', r.stop_reason, 'disabled');
  perform pg_temp.chk('W1_backlog_kept', p710_pending_total()::text, '2');
end
$t$;

-- 2. Activation : drainage complet et agregats identiques au calcul direct.
DO $t$
declare r record; v_agg record; v_dir record;
begin
  update public.dashboard_kpi_worker_config set enabled = true where id = 1;
  select * into r from public.dashboard_kpi_worker_run('qualif', 10, 1000, 20.0);
  perform pg_temp.chk('W2_backlog_drained', p710_pending_total()::text, '0');
  perform pg_temp.chk('W2_no_failure', r.partitions_failed::text, '0');
  select m.orders_count into v_agg from public.dashboard_daily_metrics m
   where m.store_id = '7e000000-0000-4000-8000-0000000000a1' and m.business_date = '2035-02-01' and m.axis='order';
  select d.orders_count into v_dir from public.dashboard_kpi_direct_day('7e000000-0000-4000-8000-0000000000a1', '2035-02-01', 'Africa/Casablanca') d;
  perform pg_temp.chk('W2_aggregate_matches_direct', coalesce(v_agg.orders_count::text,'ABSENT'), coalesce(v_dir.orders_count::text,'ABSENT'));
end
$t$;

-- 3. Arret en cours de drainage (budget de temps) puis reprise.
DO $t$
declare r record; i int := 0;
begin
  perform p710_reset_ev();
  for i in 1..8 loop
    perform p710_mk_order('7e000000-0000-4000-8000-0000000000a1'::uuid, date '2035-02-10' + i, 'W3 ' || i);
  end loop;
  perform pg_temp.chk('W3_eight_partitions', p710_pending_total()::text, '8');
  select * into r from public.dashboard_kpi_worker_run('qualif', 1, 1000, 0.5);
  perform pg_temp.chk('W3_partial_stop', (r.stop_reason in ('time_budget','partition_budget'))::text, 'true');
  perform pg_temp.chk('W3_partial_drain', (p710_pending_total() < 8)::text, 'true');
  -- reprise : aucun evenement perdu, drainage final complet
  select * into r from public.dashboard_kpi_worker_run('qualif', 30, 100000, 25.0);
  perform pg_temp.chk('W3_resume_drained', p710_pending_total()::text, '0');
  perform pg_temp.chk('W3_resume_no_failure', r.partitions_failed::text, '0');
  perform pg_temp.chk('W3_all_partitions_computed',
    (select count(*)::text from public.dashboard_daily_metrics
      where store_id = '7e000000-0000-4000-8000-0000000000a1'
        and business_date between '2035-02-11' and '2035-02-18' and axis = 'order'), '8');
end
$t$;

-- 4. Arret effectif et reprise manuelle explicite (p_force).
DO $t$
declare v_rebuilt int; v_failed int; v_backoff int; s text;
begin
  perform p710_reset_ev();
  perform p710_mk_order('7e000000-0000-4000-8000-0000000000a1'::uuid, '2035-03-01', 'W4');
  update public.dashboard_kpi_worker_config set enabled = false where id = 1;

  -- Sans forcage explicite, la reprise est refusee : l'arret est effectif.
  begin
    perform public.dashboard_kpi_resume(25, 'qualif', false);
    s := 'SUCCESS';
  exception when others then s := SQLERRM;
  end;
  perform pg_temp.chk('W4_resume_blocked_when_disabled', s, 'KPI_WORKER_DISABLED');

  select rebuilt, failed, backoff into v_rebuilt, v_failed, v_backoff
    from public.dashboard_kpi_resume(25, 'qualif', true);
  perform pg_temp.chk('W4_forced_resume_rebuilt', coalesce(v_rebuilt::text,'NULL'), '1');
  perform pg_temp.chk('W4_forced_resume_no_failure', coalesce(v_failed::text,'NULL'), '0');
  perform pg_temp.chk('W4_forced_resume_drained', p710_pending_total()::text, '0');
end
$t$;

update public.dashboard_kpi_worker_config set enabled = false where id = 1;
select label, case when ok then 'PASS' else 'FAIL' end as status, detail from _w order by label;
do $t$
declare n int; total int;
begin
  select count(*), count(*) filter (where not ok) into total, n from _w;
  if n > 0 then raise exception 'WORKER_FAILED : % / %', n, total; end if;
  raise notice 'WORKER_PASS : % controles', total;
end
$t$;
