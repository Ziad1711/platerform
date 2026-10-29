-- ============================================================================
-- 30 — Fixtures synthétiques (aucune donnée métier, aucun identifiant réel)
-- Prérequis : 10_bootstrap_audit.sql, schéma vérifié (20).
-- Idempotent uniquement après 99_cleanup.sql.
-- ============================================================================
\set ON_ERROR_STOP on

begin;

create table if not exists audit.fx (
  id int primary key check (id = 1),
  owner_id      uuid not null,
  admin_id      uuid not null,
  viewer_id     uuid not null,
  accountant_id uuid not null,
  outsider_id   uuid not null,
  store_a       uuid not null,
  store_b       uuid not null,
  plan_free     uuid not null,
  plan_paid     uuid not null,
  thread_owner  uuid not null,
  thread_admin  uuid not null
);

do $$
begin
  if exists (select 1 from audit.fx) then
    raise exception 'FIXTURES_ALREADY_PRESENT: exécuter 99_cleanup.sql avant de relancer';
  end if;
end;
$$;

-- Remplissage générique : complète les colonnes NOT NULL sans défaut par des
-- valeurs synthétiques. Échoue explicitement (REVIEW_COLUMN) sur un type inconnu
-- afin de ne jamais inventer une donnée métier.
create or replace function audit.seed_row(p_table text, p_values jsonb)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_cols text[] := array[]::text[];
  v_exprs text[] := array[]::text[];
  v_key text;
  v_val text;
  v_missing record;
  v_expr text;
  v_counter int := 0;
  v_has_id boolean;
  v_sql text;
  v_id uuid;
begin
  for v_key, v_val in
    select key, (value #>> '{}') from jsonb_each(p_values)
  loop
    v_cols := v_cols || quote_ident(v_key);
    v_exprs := v_exprs || quote_literal(v_val);
  end loop;

  for v_missing in
    select c.column_name, c.data_type
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.table_name = p_table
       and c.is_nullable = 'NO'
       and c.column_default is null
       and not (c.column_name in (select jsonb_object_keys(p_values)))
  loop
    v_counter := v_counter + 1;
    v_expr := case v_missing.data_type
      when 'uuid' then 'gen_random_uuid()'
      when 'text' then quote_literal('audit-synthetic-' || v_counter)
      when 'character varying' then quote_literal('audit-synthetic-' || v_counter)
      when 'integer' then '0'
      when 'bigint' then '0'
      when 'smallint' then '0'
      when 'numeric' then '0'
      when 'double precision' then '0'
      when 'boolean' then 'false'
      when 'date' then 'current_date'
      when 'timestamp with time zone' then 'now()'
      when 'timestamp without time zone' then 'now()::timestamp'
      when 'jsonb' then '''{}''::jsonb'
      when 'json' then '''{}''::json'
      when 'ARRAY' then '''{}'''
      else null
    end;

    if v_expr is null then
      raise exception 'REVIEW_COLUMN: %.% de type % sans valeur synthétique',
        p_table, v_missing.column_name, v_missing.data_type;
    end if;

    v_cols := v_cols || quote_ident(v_missing.column_name);
    v_exprs := v_exprs || v_expr;
  end loop;

  select exists (
    select 1 from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = p_table and c.column_name = 'id'
  ) into v_has_id;

  v_sql := format(
    'insert into public.%I (%s) values (%s)%s',
    p_table,
    array_to_string(v_cols, ', '),
    array_to_string(v_exprs, ', '),
    case when v_has_id then ' returning id' else '' end
  );

  if v_has_id then
    execute v_sql into v_id;
    return v_id;
  end if;

  execute v_sql;
  return null;
end;
$$;

revoke all on function audit.seed_row(text, jsonb) from public, anon, authenticated;
grant execute on function audit.seed_row(text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Identités et périmètres synthétiques (UUID fixes, non réels)
-- ---------------------------------------------------------------------------
do $$
declare
  c_owner      uuid := '11111111-1111-4111-8111-111111111111';
  c_admin      uuid := '22222222-2222-4222-8222-222222222222';
  c_viewer     uuid := '33333333-3333-4333-8333-333333333333';
  c_accountant uuid := '44444444-4444-4444-8444-444444444444';
  c_outsider   uuid := '55555555-5555-4555-8555-555555555555';
  c_store_a    uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  c_store_b    uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  c_plan_free  uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  c_plan_paid  uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  c_thread_own uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  c_thread_adm uuid := 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  v_month date := date_trunc('month', now())::date;
begin
  perform audit.seed_row('profiles', jsonb_build_object('id', c_owner));
  perform audit.seed_row('profiles', jsonb_build_object('id', c_admin));
  perform audit.seed_row('profiles', jsonb_build_object('id', c_viewer));
  perform audit.seed_row('profiles', jsonb_build_object('id', c_accountant));
  perform audit.seed_row('profiles', jsonb_build_object('id', c_outsider));

  perform audit.seed_row('plans', jsonb_build_object(
    'id', c_plan_free, 'price', 0, 'ai_credits_monthly', 0));
  perform audit.seed_row('plans', jsonb_build_object(
    'id', c_plan_paid, 'price', 19, 'ai_credits_monthly', 100));

  -- Abonnement payant actif pour l'owner : plafond 100 crédits.
  perform audit.seed_row('subscriptions', jsonb_build_object(
    'user_id', c_owner, 'plan_id', c_plan_paid, 'status', 'active',
    'started_at', now() - interval '1 day'));

  perform audit.seed_row('stores', jsonb_build_object(
    'id', c_store_a, 'owner_user_id', c_owner));
  perform audit.seed_row('stores', jsonb_build_object(
    'id', c_store_b, 'owner_user_id', c_outsider));

  perform audit.seed_row('store_members', jsonb_build_object(
    'store_id', c_store_a, 'user_id', c_admin, 'role', 'admin', 'status', 'active'));
  perform audit.seed_row('store_members', jsonb_build_object(
    'store_id', c_store_a, 'user_id', c_viewer, 'role', 'viewer', 'status', 'active'));
  perform audit.seed_row('store_members', jsonb_build_object(
    'store_id', c_store_a, 'user_id', c_accountant, 'role', 'accountant', 'status', 'active'));

  perform audit.seed_row('chat_threads', jsonb_build_object(
    'id', c_thread_own, 'user_id', c_owner, 'store_id', c_store_a, 'title', 'audit owner'));
  perform audit.seed_row('chat_threads', jsonb_build_object(
    'id', c_thread_adm, 'user_id', c_admin, 'store_id', c_store_a, 'title', 'audit admin'));

  -- Portefeuille présent et confortable : le débit nominal doit réussir.
  perform audit.seed_row('ai_credit_wallets', jsonb_build_object(
    'user_id', c_owner, 'plan_id', c_plan_paid,
    'monthly_credits', 100, 'credits_used', 0, 'reset_date', v_month));

  insert into audit.fx (id, owner_id, admin_id, viewer_id, accountant_id, outsider_id,
                        store_a, store_b, plan_free, plan_paid, thread_owner, thread_admin)
  values (1, c_owner, c_admin, c_viewer, c_accountant, c_outsider,
          c_store_a, c_store_b, c_plan_free, c_plan_paid, c_thread_own, c_thread_adm);
end;
$$;

-- Traçabilité des fixtures créées (nombre de lignes par table touchée).
select 'profiles' as tbl, count(*) from public.profiles
union all select 'stores', count(*) from public.stores
union all select 'store_members', count(*) from public.store_members
union all select 'plans', count(*) from public.plans
union all select 'subscriptions', count(*) from public.subscriptions
union all select 'chat_threads', count(*) from public.chat_threads
union all select 'ai_credit_wallets', count(*) from public.ai_credit_wallets
order by 1;

-- Contrôle immédiat de cohérence des fixtures.
select
  audit.assert_eq('FX01', (select count(*)::text from audit.fx), '1', 'fixtures enregistrées'),
  audit.assert_eq('FX02',
    (select count(*)::text from public.store_members where store_id = (select store_a from audit.fx)),
    '3', 'trois membres actifs'),
  audit.assert_eq('FX03',
    (select coalesce(sum(monthly_credits - credits_used), 0)::text
       from public.ai_credit_wallets where user_id = (select owner_id from audit.fx)),
    '100', 'solde initial owner');

commit;
