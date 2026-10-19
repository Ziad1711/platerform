-- P7.3 — préflight lecture seule avant export/restauration structurelle.
-- Aucune écriture. À exécuter sur Production via le MCP read-only.
select jsonb_build_object(
  'schemas', (select jsonb_agg(nspname order by nspname) from pg_namespace where nspname not like 'pg_%' and nspname <> 'information_schema'),
  'extensions', (select jsonb_agg(jsonb_build_object('name', extname, 'version', extversion) order by extname) from pg_extension),
  'public_tables_rls_off', (
    select jsonb_agg(relname order by relname)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  ),
  'user_triggers', (
    select jsonb_agg(jsonb_build_object('table', c.relname, 'trigger', t.tgname, 'enabled', t.tgenabled) order by c.relname, t.tgname)
      from pg_trigger t join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where not t.tgisinternal and n.nspname = 'public'
  ),
  'security_definer_functions', (
    select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef
  ),
  'external_effect_functions', (
    select jsonb_agg(jsonb_build_object('name', p.proname, 'args', pg_get_function_identity_arguments(p.oid)) order by p.proname)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and pg_get_functiondef(p.oid) ~* '(net\.http_|http_post|dblink|pg_read_file|pg_ls_dir|copy .*program|aws_|vault\.decrypted|pg_notify)'
  ),
  'publications', (select count(*) from pg_publication),
  'subscriptions', (select count(*) from pg_subscription),
  'foreign_servers', (select count(*) from pg_foreign_server),
  'event_triggers', (select count(*) from pg_event_trigger),
  'large_objects', (select count(*) from pg_largeobject_metadata),
  'suspicious_comments', (
    select count(*) from pg_description d
     where d.description ~* '(password|secret|token|api[_-]?key|private key|@[a-z0-9.-]+\.[a-z]{2,})'
  )
) as preflight;
