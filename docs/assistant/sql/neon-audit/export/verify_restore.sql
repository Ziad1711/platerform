-- ============================================================================
-- verify_restore.sql — contrôle de conformité après restauration du schéma
-- LECTURE SEULE. À exécuter juste après `psql -f public-schema.sql`.
--
-- Valeurs de référence mesurées en production (PG 17.6, lecture seule) :
--   tables 107 | vues 4 | séquences 4 | fonctions 209 | policies 219 | triggers 70
-- ============================================================================
\set ON_ERROR_STOP on

create temporary table if not exists expected (
  objet text primary key, attendu bigint not null
);
insert into expected values
  ('tables', 107), ('views', 4), ('sequences', 4),
  ('functions', 209), ('policies', 219), ('triggers', 70)
on conflict (objet) do nothing;

with observed as (
  select 'tables' as objet, count(*)::bigint as n
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
  union all
  select 'views', count(*)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
  union all
  select 'sequences', count(*)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'S'
  union all
  select 'functions', count(*)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
  union all
  select 'policies', count(*) from pg_policies where schemaname = 'public'
  union all
  select 'triggers', count(*)
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and not t.tgisinternal
)
select e.objet, o.n as observe, e.attendu,
       (o.n = e.attendu) as conforme
  from expected e join observed o using (objet)
 order by e.objet;

-- Invariants de structure
select
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity) as tables_sans_rls,
  (select count(*) from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typtype in ('e','d')) as types_personnalises,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef) as security_definer,
  (select count(*) from pg_extension where extname in ('pg_net','supabase_vault','pg_cron')) as extensions_exclues_presentes;

-- Absence de données métier (le dump était structurel)
select
  coalesce((select count(*) from public.chat_threads), 0)   as chat_threads_rows,
  coalesce((select count(*) from public.chat_messages), 0)  as chat_messages_rows,
  coalesce((select count(*) from public.ai_usage), 0)       as ai_usage_rows,
  coalesce((select count(*) from public.profiles), 0)       as profiles_rows;

\echo ''
\echo 'Attendu : conforme = t pour les 6 objets ; tables_sans_rls = 0 ;'
\echo 'types_personnalises = 0 ; security_definer = 150 ;'
\echo 'extensions_exclues_presentes = 0 ; toutes les colonnes *_rows = 0.'
