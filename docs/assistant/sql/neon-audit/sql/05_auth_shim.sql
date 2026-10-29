-- ============================================================================
-- 05 — Rôles Supabase émulés + shim `auth`
-- À exécuter si la base restaurée ne contient pas déjà `anon`, `authenticated`,
-- `service_role` et `auth.uid()`. Reproduit la sémantique documentée :
--   * `anon` / `authenticated` : NOLOGIN, sans héritage ;
--   * `service_role` : NOLOGIN + BYPASSRLS (équivalent Supabase côté serveur) ;
--   * `auth.uid()` lit `request.jwt.claim.sub` puis `request.jwt.claims.sub`.
-- Ce shim est une SIMULATION (voir DEPENDENCIES.md §5). Idempotent.
-- ============================================================================
\set ON_ERROR_STOP on

begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$$;

-- Indispensable pour `SET LOCAL ROLE authenticated|service_role` dans les tests
-- (sans superuser, SET ROLE exige une appartenance explicite).
do $$
begin
  execute format('grant anon, authenticated, service_role to %I', current_user);
exception when others then
  raise exception 'ROLE_MEMBERSHIP_FAILED: % — les scénarios utilisent SET ROLE', sqlerrm;
end;
$$;

create schema if not exists auth;

-- Table minimale `auth.users` : REQUISE par les clés étrangères du schéma
-- production (`profiles.id → auth.users(id)`, `store_members.invited_by`).
-- Aucun contenu métier, aucune authentification : simple support référentiel.
create table if not exists auth.users (
  id         uuid primary key,
  email      text,
  created_at timestamptz not null default now()
);
revoke all on auth.users from public, anon, authenticated;
grant select, insert, update, delete on auth.users to service_role;

create or replace function auth.uid()
returns uuid
language sql
stable
set search_path = pg_temp
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
set search_path = pg_temp
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
set search_path = pg_temp
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  );
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.role() to anon, authenticated, service_role;
grant execute on function auth.jwt() to anon, authenticated, service_role;

commit;
