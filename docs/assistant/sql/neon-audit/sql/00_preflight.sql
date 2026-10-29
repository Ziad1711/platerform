-- ============================================================================
-- 00 — PRÉVOL : identité de la cible, TLS, version, rôles, sûreté
-- LECTURE SEULE. Aucune écriture, aucune migration.
--
-- Usage :
--   psql "$AUDIT_URL" -v ON_ERROR_STOP=1 -f 00_preflight.sql
--   (AUDIT_URL porte déjà host/db/user/password/sslmode=verify-full)
--
-- Sortie : une ligne PASS/FAIL par contrôle, puis « PREFLIGHT: OK|NO-GO ».
-- ============================================================================
\set ON_ERROR_STOP on
\set QUIET off

\getenv audit_db AUDIT_DB
\getenv audit_env AUDIT_ENV
\getenv audit_host PGHOST

\if :{?audit_db}
\else
  \echo 'NO-GO : AUDIT_DB absent (nom exact de la base jetable attendue)'
  \quit
\endif

\if :{?audit_env}
\else
  \echo 'NO-GO : AUDIT_ENV absent (valeur attendue : neon-audit)'
  \quit
\endif

-- Garde de nom : jamais une base de production, de test partagé ou Supabase.
select
  current_database() = :'audit_db'
  and :'audit_env' = 'neon-audit'
  and current_database() !~* '(prod|production|jisra-test|goqedvcdmgtejtyrawsp|supabase)'
  as identity_ok
\gset

select current_database() as database, current_user as role, version() as version;

-- ---------------------------------------------------------------------------
-- Garde « connexion directe » (sans pooler PgBouncer)
--   1. le nom d'hôte ne doit pas contenir `-pooler` (endpoint mutualisé Neon) ;
--   2. l'identité de session doit rester stable entre deux transactions
--      (sous pooler en mode transaction, le backend change).
-- ---------------------------------------------------------------------------
select (coalesce(:'audit_host', '') <> ''
        and coalesce(:'audit_host', '') !~* '-pooler') as host_direct_ok
\gset

select pg_backend_pid() as pid_first \gset
select pg_backend_pid() as pid_second \gset
select (:'pid_first' = :'pid_second') as session_pinned \gset

select :'host_direct_ok'::boolean as host_direct_ok,
       :'session_pinned'::boolean as session_pinned;

\echo ''
\echo '== Contrôles =='

select
  :'identity_ok'::boolean as "PASS/FAIL:identite",
  (select ssl from pg_stat_ssl where pid = pg_backend_pid()) as "TLS:ssl",
  (select version from pg_stat_ssl where pid = pg_backend_pid()) as "TLS:version",
  current_setting('server_version_num')::int as server_version_num,
  (select rolsuper or rolbypassrls from pg_roles where rolname = current_user) as owner_bypasses_rls,
  (select count(*) from pg_roles where rolname in ('anon','authenticated','service_role')) as supabase_roles,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid') as auth_uid_functions;

-- Verdict agrégé (aucune écriture).
select
  case
    when not :'identity_ok'::boolean then 'FAIL:identite'
    when not :'host_direct_ok'::boolean then 'FAIL:connexion-non-directe'
    when not :'session_pinned'::boolean then 'FAIL:pooler-detecte'
    when coalesce((select ssl from pg_stat_ssl where pid = pg_backend_pid()), false) is not true then 'FAIL:tls'
    when current_setting('server_version_num')::int < 130000 then 'FAIL:version'
    when not coalesce((select rolsuper or rolbypassrls from pg_roles where rolname = current_user), false)
      then 'FAIL:owner-sans-bypassrls'
    else 'PASS'
  end as preflight;

-- Informations (rôles et auth.uid sont créés par 05_auth_shim.sql ; leur
-- présence est contrôlée de façon bloquante par 20_verify_schema_ready.sql)
select
  coalesce((select extversion from pg_extension where extname = 'neon'), '(extension neon absente)') as neon_ext,
  coalesce((select ssl from pg_stat_ssl where pid = pg_backend_pid()), false) as tls_enabled,
  coalesce((select version from pg_stat_ssl where pid = pg_backend_pid()), '') as tls_version,
  coalesce((select rolsuper from pg_roles where rolname = current_user), false) as is_superuser,
  coalesce((select rolbypassrls from pg_roles where rolname = current_user), false) as bypassrls,
  (select count(*) from pg_roles where rolname in ('anon','authenticated','service_role')) as supabase_roles,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid') as auth_uid_functions;

-- Absence de données métier : la base doit être vide avant fixtures.
-- (to_regclass évite l'échec si une table n'existe pas encore.)
select
  coalesce((select count(*) from public.orders), 0) as orders_rows,
  coalesce((select count(*) from public.chat_threads), 0) as chat_threads_rows,
  coalesce((select count(*) from public.chat_messages), 0) as chat_messages_rows,
  coalesce((select count(*) from public.ai_usage), 0) as ai_usage_rows,
  coalesce((select count(*) from public.assistant_requests), 0) as assistant_requests_rows;

\echo ''
\echo 'PASS/FAIL attendu : preflight = PASS, host_direct_ok = t, session_pinned = t,'
\echo 'tls_enabled = t, server_version_num >= 130000, bypassrls = t,'
\echo 'et toutes les colonnes *_rows = 0 (base neuve, aucune donnée métier).'
\echo 'supabase_roles/auth_uid_functions valent 0 avant 05_auth_shim.sql : normal.'
\echo 'Si bypassrls = f : les SECURITY DEFINER subiront la RLS et les tests seront'
\echo 'invalides (voir DEPENDENCIES.md §3).'
