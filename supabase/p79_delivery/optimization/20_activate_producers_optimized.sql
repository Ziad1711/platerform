-- PREPARATION ONLY. Not authorized for execution by this document.
-- Run in ONE psql --single-transaction session, ON_ERROR_STOP=1, UTF-8/LF.
-- Requires 10_install_producer_optimization.sql already applied.
-- Creates only triggers: the global armement stays false (capture disarmed).
\set ON_ERROR_STOP on
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create temp table _opt_expected(signature text primary key, md5 text not null) on commit drop;
insert into _opt_expected values
 ('dashboard_kpi_invalidate_trg()','3a11c2a622833bd58ba64244a9f23a08'),
 ('dashboard_kpi_invalidate_insert_stmt()','60a03918fcb663b4f908f13486179d8e'),
 ('dashboard_kpi_mark_order_insert()','80ed494f8623b37e92937b26677a2546'),
 ('dashboard_kpi_invalidate_orders_quality_trg()','4a5b55cb2e2d443c8f0c7a4fd5287b8a'),
 ('dashboard_kpi_producers_armed()','ca961583cb7c5722e9d3d453424c33db'),
 ('dashboard_kpi_producer_active(uuid)','70fb8a5b5c3861755036a37798cf5cf7'),
 ('dashboard_kpi_day_claimed(uuid,date)','d3b8a065a801678631d0fc2278eafbb0'),
 ('dashboard_kpi_producer_arm(boolean)','4cc7900d7392566e0ef4c11f71141038'),
 ('dashboard_kpi_producer_disable_store(uuid,text)','d4621a5768dd08783d7071dbd1a0750f'),
 ('dashboard_kpi_producer_enable_store(uuid,date,text)','c3b12d082732bb8ebddf37f6309d694d'),
 ('dashboard_kpi_worker_run(text,integer,bigint,numeric)','98cb969dd827a1dc1858f69bfea6d3ac'),
 ('dashboard_kpi_worker_note_failure(uuid,date,uuid,text)','1b1cc0fc8dd90bd28f5fd645b4ef67ee');

do $guard$
declare v_auth text; n int;
begin
  if current_setting('transaction_read_only') = 'on' then raise exception 'ACTIVATION_READ_ONLY'; end if;
  if current_database() <> 'postgres' or current_user <> 'postgres' then raise exception 'ACTIVATION_IDENTITY'; end if;
  v_auth := coalesce(current_setting('kpi.producers_authorized', true), '');
  if v_auth = '' then raise exception 'ACTIVATION_NOT_AUTHORIZED'; end if;
  if v_auth not in ('attvfeoqgbxsnnsllatt', 'biqrgdopcvkrbgfxkzxm') then
    raise exception 'ACTIVATION_PROJECT_NOT_ALLOWED';
  end if;
  if current_setting('kpi.global_write_risk_accepted', true) is distinct from 'yes' then
    raise exception 'ACTIVATION_RISK_UNSIGNED';
  end if;
  if not exists (select 1 from public.dashboard_kpi_rollout_config
                  where id = 1 and kill_switch and requested_mode = 'legacy') then
    raise exception 'ACTIVATION_NOT_LEGACY';
  end if;
  if exists (select 1 from public.dashboard_kpi_worker_config where enabled)
     or exists (select 1 from public.dashboard_kpi_wakeup_config where enabled) then
    raise exception 'ACTIVATION_WORKER_OR_WAKEUP_ENABLED';
  end if;
  if exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
              where c.relnamespace = 'public'::regnamespace and not t.tgisinternal
                and t.tgname like 'trg_kpi_%') then
    raise exception 'ACTIVATION_TRIGGER_ALREADY_PRESENT';
  end if;
  if exists (select 1 from _opt_expected e
              where to_regprocedure('public.' || e.signature) is null
                 or md5(pg_get_functiondef(to_regprocedure('public.' || e.signature))) is distinct from e.md5) then
    raise exception 'ACTIVATION_FUNCTION_DRIFT';
  end if;
  if (select enabled from public.dashboard_kpi_producer_config where id = 1) is not false then
    raise exception 'ACTIVATION_MUST_START_DISARMED';
  end if;
  select count(*) into n from public.dashboard_kpi_producer_stores where enabled;
  if n <> 0 then raise exception 'ACTIVATION_MUST_START_WITH_NO_ELIGIBLE_STORE %', n; end if;
end
$guard$;

create trigger trg_kpi_mark_order_insert
  after insert on public.orders
  referencing new table as new_rows
  for each statement execute function public.dashboard_kpi_mark_order_insert();

create trigger trg_kpi_invalidate_orders
  after update or delete on public.orders
  for each row execute function public.dashboard_kpi_invalidate_trg();

create trigger trg_kpi_invalidate_orders_insert
  after insert on public.orders
  referencing new table as new_rows
  for each statement execute function public.dashboard_kpi_invalidate_insert_stmt();

create trigger trg_kpi_invalidate_order_items
  after insert or update or delete on public.order_items
  for each row execute function public.dashboard_kpi_invalidate_trg();

create trigger trg_kpi_invalidate_ad_spend
  after insert or update or delete on public.ad_spend_daily
  for each row execute function public.dashboard_kpi_invalidate_trg();

create trigger trg_kpi_invalidate_orders_quality
  after update of subtotal_amount, rounding_adjustment on public.orders
  for each row execute function public.dashboard_kpi_invalidate_orders_quality_trg();

do $post$
declare n int;
begin
  select count(*) into n from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where c.relnamespace = 'public'::regnamespace and not t.tgisinternal
     and t.tgname like 'trg_kpi_%' and t.tgenabled = 'O';
  if n <> 6 then raise exception 'ACTIVATION_EXPECTED_SIX_TRIGGERS %', n; end if;
  if (select enabled from public.dashboard_kpi_producer_config where id = 1) is not false then
    raise exception 'ACTIVATION_ARMED_WITHOUT_EXPLICIT_STEP';
  end if;
  raise notice 'SIX_OPTIMIZED_PRODUCERS_INSTALLED_CAPTURE_DISARMED';
end
$post$;
