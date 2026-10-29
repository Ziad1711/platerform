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

-- Épinglage de session : mesure INFORMATIVE, non bloquante.
-- Chez Neon, le proxy PgBouncer conserve la même connexion serveur pour un
-- client au repos : deux transactions successives renvoient le même backend
-- MÊME via l'endpoint mutualisé. Test non discriminant → seul le nom d'hôte
-- (absence de `-pooler`) fait foi.
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

-- Capacité effective de contourner la RLS : attribut direct OU appartenance à
-- un rôle porteur (Neon : neondb_owner est membre de neon_superuser, qui porte
-- BYPASSRLS ; l'attribut n'est pas posé sur le rôle lui-même).
select
  coalesce((select rolsuper or rolbypassrls from pg_roles where rolname = current_user), false)
  or coalesce((select bool_or(pg_has_role(current_user, g.rolname, 'member'))
                 from pg_roles g
                where g.rolsuper or g.rolbypassrls), false) as owner_bypasses_rls
\gset

-- TLS : `pg_stat_ssl` n'est PAS probant chez Neon. L'endpoint termine le TLS au
-- proxy ; la liaison proxy→backend est interne et apparaît sans TLS (ssl = f).
-- Le TLS client est prouvé : (a) par sslmode=verify-full accepté par libpq,
-- (b) par la vérification cryptographique `openssl s_client -starttls postgres`
--     de check_connection.sh (chaîne + nom d'hôte). Aucun FAIL n'est donc émis ici.
select
  case
    when not :'identity_ok'::boolean then 'FAIL:identite'
    when not :'host_direct_ok'::boolean then 'FAIL:connexion-non-directe'
    when current_setting('server_version_num')::int < 130000 then 'FAIL:version'
    when not :'owner_bypasses_rls'::boolean then 'FAIL:owner-sans-bypassrls'
    else 'PASS'
  end as preflight;

-- Informations (rôles et auth.uid sont créés par 05_auth_shim.sql ; leur
-- présence est contrôlée de façon bloquante par 20_verify_schema_ready.sql)
select
  coalesce((select extversion from pg_extension where extname = 'neon'), '(extension neon absente)') as neon_ext,
  coalesce((select ssl from pg_stat_ssl where pid = pg_backend_pid()), false) as tls_enabled,
  coalesce((select version from pg_stat_ssl where pid = pg_backend_pid()), '') as tls_version,
  coalesce((select rolsuper from pg_roles where rolname = current_user), false) as is_superuser,
  :'owner_bypasses_rls'::boolean as bypassrls_effective,
  (select count(*) from pg_roles where rolname in ('anon','authenticated','service_role')) as supabase_roles,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid') as auth_uid_functions;

-- Présence des tables attendues (aucune erreur si elles sont absentes).
select t.name as table_name,
       to_regclass('public.' || t.name) is not null as present
  from (values ('orders'), ('chat_threads'), ('chat_messages'),
               ('ai_usage'), ('assistant_requests')) t(name)
 order by t.name;

-- Comptage dynamique, uniquement sur les tables réellement présentes
-- (aucune référence statique : une base vide ne provoque aucune erreur).
select coalesce(
         string_agg(
           format('select %L as table_name, count(*)::bigint as rows from public.%I',
                  t.name, t.name),
           ' union all ' order by t.name),
         'select null::text as table_name, null::bigint as rows where false'
       )
  from (values ('orders'), ('chat_threads'), ('chat_messages'),
               ('ai_usage'), ('assistant_requests')) t(name)
 where to_regclass('public.' || t.name) is not null
\gexec

\echo ''
\echo 'PASS/FAIL attendu : preflight = PASS, host_direct_ok = t, session_pinned = t,'
\echo 'TLS:ssl = t (ou NULL si pg_stat_ssl est masqué : TLS prouvé par verify-full),'
\echo 'server_version_num >= 130000, bypassrls_effective = t,'
\echo 'et toutes les colonnes rows = 0 (base neuve, aucune donnée métier).'
\echo 'supabase_roles/auth_uid_functions valent 0 avant 05_auth_shim.sql : normal.'
\echo 'Si bypassrls_effective = f : les SECURITY DEFINER subiront la RLS et les'
\echo 'tests seront invalides (voir DEPENDENCIES.md §3).'
