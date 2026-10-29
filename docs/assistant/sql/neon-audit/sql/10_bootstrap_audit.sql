-- ============================================================================
-- 10 — Harnais d'audit (schéma `audit`, résultats, assertions, injection)
-- À exécuter UNE fois sur la base jetable, après vérification du schéma.
-- Idempotent (create if not exists / create or replace).
-- ============================================================================
\set ON_ERROR_STOP on

begin;

create schema if not exists audit;

create table if not exists audit.results (
  case_name   text primary key,
  status      text not null check (status in ('PASS','FAIL','SKIP')),
  sqlstate    text,
  detail      text,
  recorded_at timestamptz not null default clock_timestamp()
);

create or replace function audit.record(
  p_case text, p_status text, p_sqlstate text default null, p_detail text default null
)
returns void
language sql
set search_path = public, pg_temp
as $$
  insert into audit.results (case_name, status, sqlstate, detail, recorded_at)
  values (p_case, p_status, p_sqlstate, left(coalesce(p_detail, ''), 400), clock_timestamp())
  on conflict (case_name) do update
    set status = excluded.status,
        sqlstate = excluded.sqlstate,
        detail = excluded.detail,
        recorded_at = excluded.recorded_at;
$$;

create or replace function audit.assert_true(p_case text, p_condition boolean, p_detail text default '')
returns text
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if p_condition is true then
    perform audit.record(p_case, 'PASS', null, p_detail);
    return 'PASS';
  end if;
  perform audit.record(p_case, 'FAIL', null, p_detail);
  return 'FAIL';
end;
$$;

create or replace function audit.assert_eq(p_case text, p_actual text, p_expected text, p_detail text default '')
returns text
language plpgsql
set search_path = public, pg_temp
as $$
begin
  return audit.assert_true(
    p_case,
    p_actual is not distinct from p_expected,
    coalesce(p_detail, '') || ' attendu=' || coalesce(p_expected, 'null')
      || ' obtenu=' || coalesce(p_actual, 'null')
  );
end;
$$;

-- Exécute une instruction en capturant son SQLSTATE, sans interrompre la session.
-- La sous-transaction PL/pgSQL annule uniquement les écritures de l'instruction.
create or replace function audit.expect_error(p_case text, p_expected_state text, p_sql text)
returns text
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_state text;
  v_message text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    if v_state = p_expected_state then
      perform audit.record(p_case, 'PASS', v_state, v_message);
      return 'PASS';
    end if;
    perform audit.record(p_case, 'FAIL', v_state, v_message);
    return 'FAIL';
  end;

  perform audit.record(p_case, 'FAIL', null, 'aucune erreur levée');
  return 'FAIL';
end;
$$;

-- Sonde NON bloquante : utilisée pour les observations de concurrence, dont
-- l'issue dépend de l'ordre réel des deux sessions (non déterministe).
-- Un état attendu observé => PASS ; aucun état inattendu ne fait échouer la
-- campagne, mais l'état réel est consigné (ou 'NO_ERROR' si l'action a abouti).
create or replace function audit.probe_error(p_case text, p_expected_state text, p_sql text)
returns text
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_state text;
  v_message text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    if v_state = p_expected_state then
      perform audit.record(p_case, 'PASS', v_state, 'contention observée : ' || v_message);
      return 'PASS';
    end if;
    perform audit.record(p_case, 'SKIP', v_state, 'état concurrent différent : ' || v_message);
    return 'SKIP';
  end;

  perform audit.record(p_case, 'SKIP', null, 'NO_ERROR : action aboutie (course gagnée)');
  return 'NO_ERROR';
end;
$$;

create or replace function audit.expect_ok(p_case text, p_sql text)
returns text
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_state text;
  v_message text;
begin
  begin
    execute p_sql;
    perform audit.record(p_case, 'PASS', null, 'exécution nominale');
    return 'PASS';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    perform audit.record(p_case, 'FAIL', v_state, v_message);
    return 'FAIL';
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Injection d'erreur APRÈS débit : trigger AFTER UPDATE sur le portefeuille.
-- Le débit est écrit dans la transaction, puis l'erreur est levée : elle prouve
-- qu'un échec tardif annule un débit déjà effectué.
-- Activée uniquement par `set local audit.fail_after_debit = 'on'`.
-- ---------------------------------------------------------------------------
create or replace function audit.late_failure_trigger()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_setting('audit.fail_after_debit', true) = 'on' then
    raise exception 'AUDIT_LATE_FAILURE_AFTER_DEBIT' using errcode = 'P0001';
  end if;
  return null;
end;
$$;

create or replace function audit.install_late_failure()
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  execute 'drop trigger if exists audit_late_failure on public.ai_credit_wallets';
  execute 'create trigger audit_late_failure after update on public.ai_credit_wallets
             for each row execute function audit.late_failure_trigger()';
end;
$$;

create or replace function audit.remove_late_failure()
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  execute 'drop trigger if exists audit_late_failure on public.ai_credit_wallets';
end;
$$;

create or replace function audit.reset_results()
returns void
language sql
set search_path = public, pg_temp
as $$
  truncate table audit.results;
$$;

-- ---------------------------------------------------------------------------
-- Coordination A/B : signal persistant + attente bornée.
-- Deux sessions psql distinctes n'ont pas d'autre canal ; sans ce jalon, la
-- session B peut acquérir une barrière avant A (course) et fausser la scène.
-- ---------------------------------------------------------------------------
create table if not exists audit.signals (
  name       text primary key,
  created_at timestamptz not null default clock_timestamp()
);

create or replace function audit.signal(p_name text)
returns void
language sql
set search_path = public, pg_temp
as $$
  insert into audit.signals (name, created_at)
  values (p_name, clock_timestamp())
  on conflict (name) do update set created_at = excluded.created_at;
$$;

create or replace function audit.wait_for(p_name text, p_timeout_s integer default 60)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_deadline timestamptz := clock_timestamp() + make_interval(secs => greatest(1, p_timeout_s));
begin
  while not exists (select 1 from audit.signals s where s.name = p_name) loop
    if clock_timestamp() > v_deadline then
      raise exception 'AUDIT_BARRIER_TIMEOUT:%', p_name using errcode = 'P0001';
    end if;
    perform pg_sleep(0.2);
  end loop;
end;
$$;

create or replace function audit.reset_signals()
returns void
language sql
set search_path = public, pg_temp
as $$
  truncate table audit.signals;
$$;

-- ---------------------------------------------------------------------------
-- Générateurs d'instructions (évite tout problème de quoting dans les scénarios)
-- ---------------------------------------------------------------------------
create or replace function audit.sql_begin(p_req text, p_store uuid, p_thread uuid, p_fp text)
returns text language sql immutable set search_path = pg_temp as $$
  select format('select * from public.rpc_assistant_begin_request(%L, %L::uuid, %L::uuid, %L)',
                p_req, p_store, p_thread, p_fp);
$$;

create or replace function audit.sql_bind(p_req text, p_token uuid, p_thread uuid)
returns text language sql immutable set search_path = pg_temp as $$
  select format('select public.rpc_assistant_bind_request_thread(%L, %L::uuid, %L::uuid)',
                p_req, p_token, p_thread);
$$;

create or replace function audit.sql_fail(p_req text, p_token uuid, p_reason text)
returns text language sql immutable set search_path = pg_temp as $$
  select format('select public.rpc_assistant_fail_request(%L, %L::uuid, %L)', p_req, p_token, p_reason);
$$;

create or replace function audit.sql_reserve(p_req text, p_token uuid, p_credits int)
returns text language sql immutable set search_path = pg_temp as $$
  select format('select public.rpc_assistant_reserve_credits(%L, %L::uuid, %s)', p_req, p_token, p_credits);
$$;

create or replace function audit.sql_release(p_req text, p_token uuid)
returns text language sql immutable set search_path = pg_temp as $$
  select format('select public.rpc_assistant_release_credits(%L, %L::uuid)', p_req, p_token);
$$;

create or replace function audit.sql_complete(
  p_user uuid, p_req text, p_token uuid, p_message uuid,
  p_status text, p_consumed int, p_charged int
)
returns text language sql immutable set search_path = pg_temp as $$
  select format(
    'select public.rpc_assistant_complete_request(%L::uuid, %L, %L::uuid, %L::uuid, %L, %s, %s)',
    p_user, p_req, p_token, p_message, p_status, p_consumed, p_charged);
$$;

create or replace function audit.sql_finalize(
  p_user uuid, p_thread uuid, p_req text, p_fp text, p_token uuid, p_store uuid,
  p_user_message text, p_assistant_content text, p_credits int, p_usage jsonb,
  p_next_title text default null
)
returns text language sql immutable set search_path = pg_temp as $$
  select format(
    'select * from public.rpc_assistant_finalize_request(%L::uuid, %L::uuid, %L, %L, %L::uuid, %L::uuid, %L, %L, %L, %L::jsonb, %s, %L::jsonb, %L)',
    p_user, p_thread, p_req, p_fp, p_token, p_store, 'audit',
    p_user_message, p_assistant_content,
    jsonb_build_object('request_id', p_req, 'request_fingerprint', p_fp),
    p_credits, p_usage, p_next_title);
$$;

-- Harnais réservé à la base jetable ; jamais exposé à un client final.
revoke all on schema audit from public;
revoke all on audit.results from public, anon;
grant usage on schema audit to authenticated, service_role;
grant select, insert, update on audit.results to authenticated, service_role;

revoke all on function audit.record(text, text, text, text) from public, anon;
revoke all on function audit.assert_true(text, boolean, text) from public, anon;
revoke all on function audit.assert_eq(text, text, text, text) from public, anon;
revoke all on function audit.expect_error(text, text, text) from public, anon;
revoke all on function audit.expect_ok(text, text) from public, anon;
revoke all on function audit.probe_error(text, text, text) from public, anon;
revoke all on function audit.install_late_failure() from public, anon, authenticated;
revoke all on function audit.remove_late_failure() from public, anon, authenticated;
revoke all on function audit.reset_results() from public, anon, authenticated;
revoke all on function audit.signal(text) from public, anon;
revoke all on function audit.wait_for(text, integer) from public, anon;
revoke all on function audit.reset_signals() from public, anon, authenticated;
grant execute on function audit.signal(text) to authenticated, service_role;
grant execute on function audit.wait_for(text, integer) to authenticated, service_role;
grant execute on function audit.reset_signals() to service_role;

revoke all on audit.signals from public, anon;
grant select, insert, update on audit.signals to authenticated, service_role;
revoke all on function audit.late_failure_trigger() from public, anon, authenticated;
revoke all on function audit.sql_begin(text, uuid, uuid, text) from public, anon;
revoke all on function audit.sql_bind(text, uuid, uuid) from public, anon;
revoke all on function audit.sql_fail(text, uuid, text) from public, anon;
revoke all on function audit.sql_reserve(text, uuid, int) from public, anon;
revoke all on function audit.sql_release(text, uuid) from public, anon;
revoke all on function audit.sql_complete(uuid, text, uuid, uuid, text, int, int) from public, anon;
revoke all on function audit.sql_finalize(uuid, uuid, text, text, uuid, uuid, text, text, int, jsonb, text) from public, anon;

grant execute on function audit.sql_begin(text, uuid, uuid, text) to authenticated, service_role;
grant execute on function audit.sql_bind(text, uuid, uuid) to authenticated, service_role;
grant execute on function audit.sql_fail(text, uuid, text) to authenticated, service_role;
grant execute on function audit.sql_reserve(text, uuid, int) to authenticated, service_role;
grant execute on function audit.sql_release(text, uuid) to authenticated, service_role;
grant execute on function audit.sql_complete(uuid, text, uuid, uuid, text, int, int) to service_role;
grant execute on function audit.sql_finalize(uuid, uuid, text, text, uuid, uuid, text, text, int, jsonb, text) to service_role;

grant execute on function audit.record(text, text, text, text) to authenticated, service_role;
grant execute on function audit.assert_true(text, boolean, text) to authenticated, service_role;
grant execute on function audit.assert_eq(text, text, text, text) to authenticated, service_role;
grant execute on function audit.expect_error(text, text, text) to authenticated, service_role;
grant execute on function audit.expect_ok(text, text) to authenticated, service_role;
grant execute on function audit.probe_error(text, text, text) to authenticated, service_role;
grant execute on function audit.install_late_failure() to service_role;
grant execute on function audit.remove_late_failure() to service_role;
grant execute on function audit.reset_results() to service_role;

commit;
