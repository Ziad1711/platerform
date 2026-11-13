begin;
-- Verrou de propriété des objets du chatbot public.
--
-- Une fonction SECURITY DEFINER appartenant à un rôle sans droits sur
-- `saas_admin` est inutilisable (permission denied au premier accès). Ce
-- correctif rend l'exigence explicite, idempotente et vérifiée : il ne dépend
-- plus d'un ALTER OWNER manuel après migration.
--
-- Aucune donnée, aucun contrat existant n'est modifié.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    raise exception 'OWNER_ROLE_MISSING: supabase_admin';
  end if;
end $$;

alter function public.rpc_public_contact_admit(text, text, text, integer, integer, integer)
  owner to supabase_admin;
alter function public.rpc_public_chat_reserve(text, bigint, bigint, integer)
  owner to supabase_admin;
alter function public.rpc_public_chat_settle(uuid, bigint, bigint, bigint, text)
  owner to supabase_admin;
alter table saas_admin.public_chat_reservations owner to supabase_admin;

do $$
declare
  missing text;
begin
  select string_agg(w.expected, ',') into missing
  from (values
    ('rpc_public_contact_admit'), ('rpc_public_chat_reserve'), ('rpc_public_chat_settle')
  ) w(expected)
  where not exists (
    select 1
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = w.expected
      and pg_get_userbyid(p.proowner) = 'supabase_admin'
  );
  if missing is not null then
    raise exception 'OWNER_GUARD_FAILED: %', missing;
  end if;

  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'saas_admin' and c.relname = 'public_chat_reservations'
      and pg_get_userbyid(c.relowner) = 'supabase_admin'
  ) then
    raise exception 'OWNER_GUARD_FAILED: saas_admin.public_chat_reservations';
  end if;
end $$;
commit;
