-- ============================================================================
-- JISRA — P7.10 : ROLLBACK de l'optimisation des producteurs KPI V5.
-- ============================================================================
-- Retour exact au socle final précédent (C0 Casablanca), producteurs NON créés.
-- Aucune donnée métier, aucun agrégat, aucun journal n'est supprimé.
-- La configuration de capture (2 tables) est supprimée : elle ne contient que
-- des décisions d'exploitation, à redéclarer après réinstallation.
--
-- Exécution : psql -X -w -v ON_ERROR_STOP=1 --single-transaction
--              -c "set kpi.producers_opt_authorized='yes'" -f ce_fichier
-- ============================================================================
\set ON_ERROR_STOP on
set local lock_timeout = '5s';

do $guard$
begin
  if current_setting('kpi.producers_opt_authorized', true) is distinct from 'yes' then
    raise exception 'ROLLBACK_NOT_AUTHORIZED';
  end if;
  if current_database() <> 'postgres' or current_user <> 'postgres' then
    raise exception 'ROLLBACK_IDENTITY';
  end if;
end
$guard$;

-- 1. Producteurs hors service.
drop trigger if exists trg_kpi_invalidate_ad_spend on public.ad_spend_daily;
drop trigger if exists trg_kpi_invalidate_order_items on public.order_items;
drop trigger if exists trg_kpi_invalidate_orders on public.orders;
drop trigger if exists trg_kpi_invalidate_orders_insert on public.orders;
drop trigger if exists trg_kpi_invalidate_orders_quality on public.orders;
drop trigger if exists trg_kpi_mark_order_insert on public.orders;

-- 2. Corps C0 restaurés (Casablanca + marqueur ligne d'origine).
CREATE OR REPLACE FUNCTION public.dashboard_kpi_invalidate_trg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_relevant boolean := false;
  v_ns uuid; v_nd1 date; v_nd2 date; v_os uuid; v_od1 date; v_od2 date;
  v_tz text; v_tx bigint; v_new_ok boolean := false; v_old_ok boolean := false;
  v_s uuid; v_od timestamptz; v_dd timestamptz;
begin
  if tg_table_name = 'orders' then
    if tg_op in ('INSERT','DELETE') then v_relevant := true;
    else
      v_relevant := (new.status is distinct from old.status)
        or (new.order_date is distinct from old.order_date)
        or (new.delivered_at is distinct from old.delivered_at)
        or (new.store_id is distinct from old.store_id)
        or (new.buy_price is distinct from old.buy_price)
        or (new.buy_price_source is distinct from old.buy_price_source)
        or (new.delivery_fee is distinct from old.delivery_fee)
        or (new.confirmation_cost_allocated is distinct from old.confirmation_cost_allocated)
        or (new.ads_cost_allocated is distinct from old.ads_cost_allocated)
        or (new.discount_amount is distinct from old.discount_amount)
        or (new.delivery_charge_to_customer is distinct from old.delivery_charge_to_customer)
        or (new.total_selling_price is distinct from old.total_selling_price);
      if not v_relevant then return null; end if;
      if tg_op = 'UPDATE' and new.store_id = old.store_id and new.order_date = old.order_date
         and new.delivered_at is not distinct from old.delivered_at
         and current_setting('app.kpi_inv_order_' || replace(new.id::text,'-','_'), true) = '1' then
        return null;
      end if;
    end if;
    if tg_op <> 'DELETE' then
      v_ns := new.store_id;
      v_tz := public.dashboard_kpi_store_tz_cached(v_ns);
      v_nd1 := public.dashboard_kpi_local_ts(new.order_date, v_tz)::date;
      v_nd2 := public.dashboard_kpi_local_ts(coalesce(new.delivered_at,new.order_date), v_tz)::date;
      v_new_ok := true;
    end if;
    if tg_op <> 'INSERT' then
      if tg_op='UPDATE' and old.store_id=new.store_id and old.order_date=new.order_date and old.delivered_at is not distinct from new.delivered_at then
        v_os:=v_ns; v_od1:=v_nd1; v_od2:=v_nd2; v_old_ok:=v_new_ok;
      else
        v_os:=old.store_id;
        v_tz := public.dashboard_kpi_store_tz_cached(v_os);
        v_od1:=public.dashboard_kpi_local_ts(old.order_date, v_tz)::date;
        v_od2:=public.dashboard_kpi_local_ts(coalesce(old.delivered_at,old.order_date), v_tz)::date;
        v_old_ok:=true;
      end if;
    end if;
  elsif tg_table_name = 'order_items' then
    if tg_op = 'INSERT' and current_setting('app.kpi_inv_order_' || replace(new.order_id::text, '-', '_'), true) = '1' then
      return null;
    end if;
    v_relevant := true;
    if tg_op <> 'DELETE' then
      select o.store_id,o.order_date,o.delivered_at into v_s,v_od,v_dd from public.orders o where o.id=new.order_id;
      if v_s is not null then
        v_ns:=v_s;
        v_tz := public.dashboard_kpi_store_tz_cached(v_s);
        v_nd1:=public.dashboard_kpi_local_ts(v_od, v_tz)::date;
        v_nd2:=public.dashboard_kpi_local_ts(coalesce(v_dd,v_od), v_tz)::date;
        v_new_ok:=true;
      end if;
    end if;
    if tg_op <> 'INSERT' then
      if tg_op='UPDATE' and old.order_id=new.order_id then
        v_os:=v_ns; v_od1:=v_nd1; v_od2:=v_nd2; v_old_ok:=v_new_ok;
      else
        select o.store_id,o.order_date,o.delivered_at into v_s,v_od,v_dd from public.orders o where o.id=old.order_id;
        if v_s is not null then
          v_os:=v_s;
          v_tz := public.dashboard_kpi_store_tz_cached(v_s);
          v_od1:=public.dashboard_kpi_local_ts(v_od, v_tz)::date;
          v_od2:=public.dashboard_kpi_local_ts(coalesce(v_dd,v_od), v_tz)::date;
          v_old_ok:=true;
        end if;
      end if;
    end if;
  elsif tg_table_name = 'ad_spend_daily' then
    v_relevant := true;
    if tg_op <> 'DELETE' then
      v_ns:=new.store_id;
      v_tz := public.dashboard_kpi_store_tz_cached(v_ns);
      v_nd1:=public.dashboard_kpi_local_ts(new.spend_date, v_tz)::date;
      v_new_ok:=true;
    end if;
    if tg_op <> 'INSERT' then
      if tg_op='UPDATE' and old.store_id=new.store_id and old.spend_date=new.spend_date then
        v_os:=v_ns; v_od1:=v_nd1; v_old_ok:=v_new_ok;
      else
        v_os:=old.store_id;
        v_tz := public.dashboard_kpi_store_tz_cached(v_os);
        v_od1:=public.dashboard_kpi_local_ts(old.spend_date, v_tz)::date;
        v_old_ok:=true;
      end if;
    end if;
  end if;
  if not v_relevant then return null; end if;
  v_tx := txid_current();
  insert into public.dashboard_kpi_invalidation (store_id,business_date,reason,note_tx)
  select v.s,v.d,v.r,v_tx from (values
    (v_ns,v_nd1,case when v_new_ok then tg_table_name||':'||tg_op||':order' end),
    (v_ns,v_nd2,case when v_new_ok then tg_table_name||':'||tg_op||':delivery' end),
    (v_os,v_od1,case when v_old_ok then tg_table_name||':'||tg_op||':order:old' end),
    (v_os,v_od2,case when v_old_ok then tg_table_name||':'||tg_op||':delivery:old' end)
  ) v(s,d,r)
  where v.s is not null and v.d is not null
  on conflict do nothing;
  if tg_table_name = 'order_items' then
    if tg_op = 'INSERT' and current_setting('app.kpi_inv_order_' || replace(new.order_id::text, '-', '_'), true) = '1' then
      return null;
    end if;
    if v_new_ok then
      perform set_config('app.kpi_inv_order_'||replace(new.order_id::text,'-','_'),'1',true);
    end if;
    if v_old_ok and (tg_op <> 'UPDATE' or old.order_id is distinct from new.order_id) then
      perform set_config('app.kpi_inv_order_'||replace(old.order_id::text,'-','_'),'1',true);
    end if;
  end if;
  return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.dashboard_kpi_invalidate_insert_stmt()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_tx bigint := txid_current();
begin
  if tg_table_name = 'orders' then
    insert into public.dashboard_kpi_invalidation (store_id,business_date,reason,note_tx)
    select o.store_id,
           public.dashboard_kpi_local_ts(o.order_date, st.tz)::date,
           'orders:INSERT:stmt', v_tx
    from new_rows o
    left join public.dashboard_kpi_store_state st on st.store_id=o.store_id
    where o.store_id is not null
    union all
    select o.store_id,
           public.dashboard_kpi_local_ts(coalesce(o.delivered_at,o.order_date), st.tz)::date,
           'orders:INSERT:stmt', v_tx
    from new_rows o
    left join public.dashboard_kpi_store_state st on st.store_id=o.store_id
    where o.store_id is not null
    on conflict do nothing;
  elsif tg_table_name = 'order_items' then
    insert into public.dashboard_kpi_invalidation (store_id,business_date,reason,note_tx)
    select o.store_id,
           public.dashboard_kpi_local_ts(o.order_date, st.tz)::date,
           'order_items:INSERT:stmt', v_tx
    from new_rows ni
    join public.orders o on o.id=ni.order_id
    left join public.dashboard_kpi_store_state st on st.store_id=o.store_id
    where o.store_id is not null
    union all
    select o.store_id,
           public.dashboard_kpi_local_ts(coalesce(o.delivered_at,o.order_date), st.tz)::date,
           'order_items:INSERT:stmt', v_tx
    from new_rows ni
    join public.orders o on o.id=ni.order_id
    left join public.dashboard_kpi_store_state st on st.store_id=o.store_id
    where o.store_id is not null
    on conflict do nothing;
  elsif tg_table_name = 'ad_spend_daily' then
    insert into public.dashboard_kpi_invalidation (store_id,business_date,reason,note_tx)
    select a.store_id,public.dashboard_kpi_local_ts(a.spend_date, st.tz)::date,'ad_spend_daily:INSERT:stmt',v_tx
    from new_rows a
    left join public.dashboard_kpi_store_state st on st.store_id=a.store_id
    where a.store_id is not null
    on conflict do nothing;
  end if;
  return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.dashboard_kpi_invalidate_orders_quality_trg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tz text;
  v_tx bigint;
begin
  -- Aucune invalidation si les valeurs ne changent pas réellement.
  if new.subtotal_amount is not distinct from old.subtotal_amount
     and new.rounding_adjustment is not distinct from old.rounding_adjustment then
    return null;
  end if;

  if new.store_id is null or new.order_date is null then
    return null;
  end if;

  v_tz := public.dashboard_kpi_store_tz_cached(new.store_id);
  v_tx := txid_current();

  insert into public.dashboard_kpi_invalidation (store_id, business_date, reason, note_tx)
  select v.s, v.d, v.r, v_tx
  from (values
    (new.store_id,
     public.dashboard_kpi_local_ts(new.order_date, v_tz)::date,
     'orders:UPDATE:quality:order'),
    (new.store_id,
     public.dashboard_kpi_local_ts(coalesce(new.delivered_at, new.order_date), v_tz)::date,
     'orders:UPDATE:quality:delivery')
  ) v(s, d, r)
  where v.s is not null and v.d is not null
  on conflict do nothing;

  return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.dashboard_kpi_mark_order_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform set_config('app.kpi_inv_order_' || replace(new.id::text, '-', '_'), '1', true);
  return new;
end;
$function$
;

-- 2bis. Worker : corps d origine restaure (diagnostic non protege).
CREATE OR REPLACE FUNCTION public.dashboard_kpi_worker_run(p_worker text DEFAULT 'cron'::text, p_max_partitions integer DEFAULT NULL::integer, p_max_events bigint DEFAULT NULL::bigint, p_max_seconds numeric DEFAULT NULL::numeric)
 RETURNS TABLE(partitions_rebuilt integer, partitions_failed integer, events_processed bigint, stop_reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_started timestamptz := clock_timestamp();
  v_ended timestamptz;
  v_deadline timestamptz;
  v_ok int := 0;
  v_ko int := 0;
  v_events bigint := 0;
  v_row record;
  v_stop text := 'idle';
  v_last_outcome text;          -- 'ok' | 'error' | null
  v_last_error text;
  v_enabled boolean;
  v_max_partitions int;
  v_max_events bigint;
  v_max_seconds numeric;
  v_statement_timeout_ms int;
begin
  select c.enabled, c.max_partitions_per_run, c.max_events_per_run,
         c.max_seconds_per_run, c.statement_timeout_ms
    into v_enabled, v_max_partitions, v_max_events, v_max_seconds, v_statement_timeout_ms
    from public.dashboard_kpi_worker_config c
   where c.id = 1;

  if v_enabled is null then
    partitions_rebuilt := 0; partitions_failed := 0; events_processed := 0;
    stop_reason := 'no_configuration';
    return next; return;
  end if;

  if v_enabled is not true then
    partitions_rebuilt := 0; partitions_failed := 0; events_processed := 0;
    stop_reason := 'disabled';
    return next; return;
  end if;

  if not pg_try_advisory_xact_lock(hashtextextended('dashboard_kpi_worker', 0)) then
    partitions_rebuilt := 0; partitions_failed := 0; events_processed := 0;
    stop_reason := 'concurrent_run';
    return next; return;
  end if;

  v_max_partitions := greatest(1, least(coalesce(p_max_partitions, v_max_partitions), 50));
  v_max_events := greatest(1::bigint, least(coalesce(p_max_events, v_max_events), 100000::bigint));
  v_max_seconds := greatest(0.50::numeric, least(coalesce(p_max_seconds, v_max_seconds), 30.00::numeric));
  v_deadline := v_started + make_interval(secs => v_max_seconds);

  perform set_config('statement_timeout', v_statement_timeout_ms::text || 'ms', true);
  perform set_config('lock_timeout', '2000ms', true);

  loop
    select c.enabled into v_enabled
      from public.dashboard_kpi_worker_config c where c.id = 1;
    if v_enabled is not true then
      v_stop := 'disabled_mid_run'; exit;
    end if;

    if clock_timestamp() >= v_deadline then v_stop := 'time_budget'; exit; end if;
    if v_ok >= v_max_partitions then v_stop := 'partition_budget'; exit; end if;
    if v_events >= v_max_events then v_stop := 'event_budget'; exit; end if;

    select c.* into v_row
      from public.dashboard_kpi_claim(1, p_worker) c
     limit 1;

    if v_row is null or v_row.r_store_id is null then
      v_stop := case
                  when v_last_outcome = 'error' then 'partition_error'
                  when v_ok = 0 and v_ko = 0 then 'idle'
                  else 'drained'
                end;
      exit;
    end if;

    begin
      perform public.dashboard_kpi_rebuild_day(
        v_row.r_store_id, v_row.r_business_date, v_row.r_token, v_row.r_seqs);
      v_ok := v_ok + 1;
      v_events := v_events + coalesce(array_length(v_row.r_seqs, 1), 0);
      v_last_outcome := 'ok';
    exception when others then
      v_ko := v_ko + 1;
      v_last_outcome := 'error';
      v_last_error := left(sqlerrm, 300);
      v_stop := 'partition_error';

      update public.dashboard_kpi_invalidation i
         set lease_expires_at = clock_timestamp()
               + make_interval(secs => least(300, 5 * greatest(i.attempts, 1))),
             last_error = v_last_error
       where i.store_id = v_row.r_store_id
         and i.business_date = v_row.r_business_date
         and i.processed_at is null
         and i.claim_token = v_row.r_token;

      update public.dashboard_kpi_store_state st
         set last_error = v_last_error, updated_at = clock_timestamp()
       where st.store_id = v_row.r_store_id;
    end;
  end loop;

  if v_ok > 0 or v_ko > 0 then
    v_ended := clock_timestamp();
    insert into public.dashboard_kpi_worker_run
      (worker, started_at, ended_at, duration_ms,
       partitions_rebuilt, partitions_failed, events_processed, stop_reason, last_error)
    values
      (coalesce(p_worker, 'cron'), v_started, v_ended,
       round(extract(epoch from (v_ended - v_started)) * 1000, 3),
       v_ok, v_ko, v_events, v_stop, v_last_error);
  end if;

  partitions_rebuilt := v_ok;
  partitions_failed := v_ko;
  events_processed := v_events;
  stop_reason := v_stop;
  return next;
end;
$function$;

-- 3. Objets propres à l'optimisation.
drop view if exists public.dashboard_kpi_producer_status;
drop function if exists public.dashboard_kpi_worker_note_failure(uuid, date, uuid, text);
drop function if exists public.dashboard_kpi_producer_enable_store(uuid, date, text);
drop function if exists public.dashboard_kpi_producer_disable_store(uuid, text);
drop function if exists public.dashboard_kpi_producer_arm(boolean);
drop function if exists public.dashboard_kpi_day_claimed(uuid, date);
drop function if exists public.dashboard_kpi_producer_active(uuid);
drop function if exists public.dashboard_kpi_producers_armed();
drop table if exists public.dashboard_kpi_producer_stores;
drop table if exists public.dashboard_kpi_producer_config;

-- 4. Contrôles de sortie : empreintes C0 et absence de producteur.
do $post$
declare n int; h text;
begin
  select count(*) into n from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where c.relnamespace = 'public'::regnamespace and not t.tgisinternal
     and t.tgname like 'trg_kpi_%';
  if n <> 0 then raise exception 'ROLLBACK_TRIGGERS_REMAIN %', n; end if;

  if md5(pg_get_functiondef('public.dashboard_kpi_invalidate_trg()'::regprocedure))
       <> '10e7ba5957e8e70479208ab82e1fbfd4' then raise exception 'ROLLBACK_C0_TRG_HASH'; end if;
  if md5(pg_get_functiondef('public.dashboard_kpi_invalidate_insert_stmt()'::regprocedure))
       <> 'db18817564f6348743ee82b389ec56db' then raise exception 'ROLLBACK_C0_STMT_HASH'; end if;
  if md5(pg_get_functiondef('public.dashboard_kpi_mark_order_insert()'::regprocedure))
       <> '51396e7b26984fc83a72852f79f9490e' then raise exception 'ROLLBACK_C0_MARK_HASH'; end if;
  if md5(pg_get_functiondef('public.dashboard_kpi_invalidate_orders_quality_trg()'::regprocedure))
       <> '0af853293f65fb45a51887a3a0dd82cc' then raise exception 'ROLLBACK_C0_QUALITY_HASH'; end if;
  if md5(pg_get_functiondef('public.dashboard_kpi_worker_run(text,integer,bigint,numeric)'::regprocedure))
       <> 'f41abff2c59cbba39ef740740307eb07' then raise exception 'ROLLBACK_C0_WORKER_HASH'; end if;

  if to_regprocedure('public.dashboard_kpi_producer_active(uuid)') is not null
     or to_regclass('public.dashboard_kpi_producer_config') is not null then
    raise exception 'ROLLBACK_OPT_OBJECTS_REMAIN';
  end if;
  raise notice 'ROLLBACK_OK_C0_RESTORED_NO_PRODUCER';
end
$post$;
