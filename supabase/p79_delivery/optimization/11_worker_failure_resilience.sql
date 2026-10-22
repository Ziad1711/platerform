-- JISRA - P7.10a : resilience du worker a l'echec de diagnostic.
-- Corrige un defaut demontre : si le verrou qui fait echouer le rebuild est
-- encore tenu, le handler d'erreur echouait a son tour et le worker levait une
-- exception au lieu de retourner partition_error.
-- Installation inactive : aucun trigger, aucun cron, aucun worker active.
\set ON_ERROR_STOP on

set local lock_timeout = '5s';

do $guard$
begin
  if current_setting('kpi.producers_opt_authorized', true) is distinct from 'yes' then
    raise exception 'WORKER_RESILIENCE_NOT_AUTHORIZED';
  end if;
  if current_database() <> 'postgres' then
    raise exception 'WORKER_RESILIENCE_IDENTITY';
  end if;
  if to_regprocedure('public.dashboard_kpi_worker_run(text,integer,bigint,numeric)') is null then
    raise exception 'WORKER_RESILIENCE_MISSING_SOCLE';
  end if;
  if to_regprocedure('public.dashboard_kpi_producer_active(uuid)') is null then
    raise exception 'WORKER_RESILIENCE_REQUIRES_P710';
  end if;
end
$guard$;

create or replace function public.dashboard_kpi_worker_note_failure(
  p_store_id uuid,
  p_day date,
  p_token uuid,
  p_error text
) returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare v_backoff boolean := false;
begin
  -- Bornes courtes : on ne veut jamais attendre le verrou qui a fait echouer
  -- la reconstruction.
  perform set_config('lock_timeout', '250ms', true);
  -- Deux points de sauvegarde INDEPENDANTS : le backoff du journal est
  -- l'element critique (il evite une boucle serree), l'etat boutique est
  -- seulement informatif. Un verrou sur l'un ne doit pas annuler l'autre.
  begin
    update public.dashboard_kpi_invalidation i
       set lease_expires_at = clock_timestamp()
             + make_interval(secs => least(300, 5 * greatest(i.attempts, 1))),
           last_error = left(p_error, 300)
     where i.store_id = p_store_id
       and i.business_date = p_day
       and i.processed_at is null
       and i.claim_token = p_token;
    v_backoff := found;
  exception when others then
    v_backoff := false;
  end;

  begin
    update public.dashboard_kpi_store_state st
       set last_error = left(p_error, 300), updated_at = clock_timestamp()
     where st.store_id = p_store_id;
  exception when others then
    null;
  end;

  return v_backoff;
end
$fn$;

revoke all on function public.dashboard_kpi_worker_note_failure(uuid,date,uuid,text) from public, anon, authenticated;
grant execute on function public.dashboard_kpi_worker_note_failure(uuid,date,uuid,text) to service_role;

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

      -- Diagnostic en meilleur effort : un echec de journalisation ne doit
      -- jamais transformer un echec de partition en erreur fatale du worker.
      perform public.dashboard_kpi_worker_note_failure(
        v_row.r_store_id, v_row.r_business_date, v_row.r_token, v_last_error);
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
