-- ============================================================
-- P8.1 — Capture préalable (LECTURE SEULE)
-- Projet autorisé : jisra-test / goqedvcdmgtejtyrawsp
-- ------------------------------------------------------------
-- À exécuter AVANT toute migration. Chaque requête est un SELECT.
-- La sortie de (2), (3) et (4) constitue la source du rollback :
-- elle doit être conservée telle quelle (fichier daté, hors dépôt
-- public si elle contient des identifiants d'utilisateurs).
--
-- Aucune requête ici ne modifie l'état. Ne pas ajouter d'ORDER BY
-- sur des colonnes absentes : le script doit échouer proprement si
-- un objet attendu manque, car cela signalerait une dérive.
-- ============================================================

-- (1) Identité et version d'historique ------------------------
select current_database() as database,
       current_setting('server_version') as pg_version,
       (select max(version) from supabase_migrations.schema_migrations) as max_migration_version;

-- (2) Fonctions concernées : définition, ACL, propriétaire ----
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as security_definer,
       pg_get_userbyid(p.proowner) as owner,
       p.proacl::text as acl,
       pg_get_functiondef(p.oid) as restore_sql
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'accept_team_invitation',
    'is_store_admin_or_owner',
    'is_store_member',
    'revoke_member_pending_invitations',
    'block_store_member_insert',
    'block_store_member_mutation',
    'sync_confirmation_agent_for_member'
  )
order by p.proname, args;

-- (3) Politiques RLS : état et reconstruction exécutable ------
select c.relname as table_name,
       pol.polname as policy_name,
       case pol.polcmd
         when 'r' then 'SELECT' when 'a' then 'INSERT'
         when 'w' then 'UPDATE' when 'd' then 'DELETE'
         else 'ALL'
       end as command,
       pol.polpermissive as permissive,
       case when exists (select 1 from unnest(pol.polroles) as r(role_oid) where role_oid = 0) then 'PUBLIC'
            else (select string_agg(quote_ident(rolname), ', ' order by rolname)
                  from pg_roles where oid = any(pol.polroles))
       end as roles,
       pg_get_expr(pol.polqual, pol.polrelid) as using_expr,
       pg_get_expr(pol.polwithcheck, pol.polrelid) as check_expr,
       format(
         'create policy %I on %I.%I as %s for %s to %s%s%s;',
         pol.polname, n.nspname, c.relname,
         case when pol.polpermissive then 'permissive' else 'restrictive' end,
         case pol.polcmd
           when 'r' then 'select' when 'a' then 'insert'
           when 'w' then 'update' when 'd' then 'delete'
           else 'all'
         end,
         case when exists (select 1 from unnest(pol.polroles) as r(role_oid) where role_oid = 0) then 'public'
              else (select string_agg(quote_ident(rolname), ', ' order by rolname)
                    from pg_roles where oid = any(pol.polroles))
         end,
         case when pol.polqual is not null
              then E'\n  using (' || pg_get_expr(pol.polqual, pol.polrelid) || ')'
              else '' end,
         case when pol.polwithcheck is not null
              then E'\n  with check (' || pg_get_expr(pol.polwithcheck, pol.polrelid) || ')'
              else '' end
       ) as restore_sql
from pg_policy pol
join pg_class c on c.oid = pol.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('team_invitations','team_invitation_assignments','store_members')
order by c.relname,
         case pol.polcmd when 'r' then 1 when 'a' then 2 when 'w' then 3 when 'd' then 4 else 5 end,
         pol.polname;

-- (4) Triggers actifs -----------------------------------------
select c.relname as table_name,
       t.tgname,
       p.proname as function_name,
       t.tgenabled as enabled_flag,
       pg_get_triggerdef(t.oid) as restore_sql
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_proc p on p.oid = t.tgfoid
where not t.tgisinternal
  and n.nspname = 'public'
  and c.relname in ('team_invitations','team_invitation_assignments','store_members')
order by c.relname, t.tgname;

-- (5) RLS, propriétaire et ACL des tables ----------------------
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as force_rls,
       pg_get_userbyid(c.relowner) as owner,
       c.relacl::text as acl
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('team_invitations','team_invitation_assignments','store_members','stores')
order by c.relname;

-- (6) Invariant : chaque boutique a bien une appartenance owner active
--     Le helper de la migration reprend la sémantique de
--     is_store_admin_or_owner (appartenance, pas owner_user_id).
--     Résultat attendu : 0. Tout écart est un NO-GO (risque de refuser
--     une invitation légitime émise par un propriétaire sans ligne).
select count(*) as stores_without_active_owner_membership
from public.stores s
where not exists (
  select 1 from public.store_members sm
  where sm.store_id = s.id
    and sm.user_id = s.owner_user_id
    and sm.status = 'active'
    and sm.role = 'owner'
);

-- (7) Inventaire agrégé des invitations (aucune donnée personnelle) --
select ti.status,
       count(*) as invitations,
       count(*) filter (
         where exists (
           select 1 from public.team_invitation_assignments a
           where a.invitation_id = ti.id
             and not exists (
               select 1 from public.store_members sm
               where sm.store_id = a.store_id
                 and sm.user_id = ti.invited_by
                 and sm.status = 'active'
                 and sm.role in ('owner','admin')
             )
         )
       ) as with_inviter_no_longer_authorized
from public.team_invitations ti
group by ti.status
order by ti.status;

-- (8) Détail par boutique des invitations `pending` dont l'invitant
--     a perdu ses droits : décision métier requise avant application.
select a.store_id,
       count(*) as pending_assignments,
       min(ti.created_at) as oldest_created_at
from public.team_invitation_assignments a
join public.team_invitations ti on ti.id = a.invitation_id
where ti.status = 'pending'
  and not exists (
    select 1 from public.store_members sm
    where sm.store_id = a.store_id
      and sm.user_id = ti.invited_by
      and sm.status = 'active'
      and sm.role in ('owner','admin')
  )
group by a.store_id
order by a.store_id;
