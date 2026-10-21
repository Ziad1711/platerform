-- ============================================================
-- P8.1 — Rollback de la migration 20261021120000
-- Projet autorisé : jisra-test / goqedvcdmgtejtyrawsp
-- ------------------------------------------------------------
-- Ce rollback ne touche AUCUNE donnée : il ne supprime, ne réactive et ne
-- révoque ni invitation ni appartenance. Il ne restaure que des
-- définitions (fonctions, politiques) et des ACL.
--
-- Règle de priorité : la définition réellement installée AVANT migration
-- (sortie de 10_preflight_capture.sql, requêtes 2 et 3) fait foi. Les
-- blocs ci-dessous ne sont que le repli versionné ; si la capture diffère,
-- recoller la capture à la place.
-- ============================================================

-- ------------------------------------------------------------
-- (1) Restaurer accept_team_invitation
--     Définition recopiée VERBATIM depuis la capture de l'état
--     installé (02_block.json, pg_get_functiondef), conformément
--     à la règle de priorité de l'en-tête.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_team_invitation(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invitation team_invitations%rowtype;
  v_user_id uuid;
  v_assignment team_invitation_assignments%rowtype;
  v_result jsonb := '[]'::jsonb;
begin
  select * into v_invitation from team_invitations where token = p_token for update;
  if not found then
    return jsonb_build_object('error','INVITATION_NOT_FOUND');
  end if;
  if v_invitation.status != 'pending' then
    return jsonb_build_object('error','INVITATION_NOT_PENDING');
  end if;
  if v_invitation.expires_at < now() then
    return jsonb_build_object('error','INVITATION_EXPIRED');
  end if;

  if not exists (
    select 1 from auth.users u
    where u.id = auth.uid()
      and lower(u.email) = lower(v_invitation.email)
  ) then
    return jsonb_build_object('error','INVITATION_EMAIL_MISMATCH');
  end if;
  v_user_id := auth.uid();

  update team_invitations
    set status = 'accepted', accepted_at = now(), accepted_user_id = v_user_id
    where id = v_invitation.id;

  for v_assignment in
    select * from team_invitation_assignments where invitation_id = v_invitation.id
  loop
    insert into store_members (store_id, user_id, role, status, invited_email, invited_by, accepted_at, updated_at)
    values (v_assignment.store_id, v_user_id, v_assignment.role, 'active', v_invitation.email, v_invitation.invited_by, now(), now())
    on conflict (store_id, user_id)
    do update set role = v_assignment.role, status = 'active', updated_at = now();

    v_result := v_result || jsonb_build_object(
      'store_id', v_assignment.store_id,
      'role', v_assignment.role
    );
  end loop;

  return jsonb_build_object('success', true, 'assignments', v_result);
end;
$function$;

-- ACL remise dans l'état capturé avant migration (02_block.json) :
--   {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
-- La migration révoque PUBLIC et anon ; le rollback les rétablit à l'identique.
grant execute on function public.accept_team_invitation(text) to public;
grant execute on function public.accept_team_invitation(text) to anon;
grant execute on function public.accept_team_invitation(text) to authenticated;
grant execute on function public.accept_team_invitation(text) to service_role;

-- ------------------------------------------------------------
-- (2) Retirer la politique gardée créée par la migration
--     (idempotent : sans effet si la migration n'a pas été appliquée).
-- ------------------------------------------------------------
drop policy if exists invitation_assignments_inviter_insert on public.team_invitation_assignments;

-- ------------------------------------------------------------
-- (3) Recréer la politique d'affectation telle qu'elle était
--     installée avant la migration.
--     Contenu recopié VERBATIM depuis la capture (03_block.json,
--     colonne restore_sql, politique invitation_assignments_inviter_insert).
--     L'autre politique d'écriture, `create assignments as admin`,
--     n'est jamais supprimée par la migration (elle cite store_id et
--     is_store_admin_or_owner) : elle n'a donc pas à être rétablie.
-- ------------------------------------------------------------
-- ------------------------------------------------------------
drop policy if exists invitation_assignments_inviter_insert on public.team_invitation_assignments;

create policy invitation_assignments_inviter_insert on public.team_invitation_assignments as permissive for insert to public
  with check ((EXISTS ( SELECT 1
   FROM team_invitations ti
  WHERE ((ti.id = team_invitation_assignments.invitation_id) AND (ti.invited_by = auth.uid())))));

-- Garde-fou : un rollback sans politique d'écriture laisserait la table
-- fermée. L'exception annule l'exécution tant que la capture n'est pas
-- recollée ci-dessus.
do $$
begin
  if not exists (
    select 1
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'team_invitation_assignments'
      and pol.polcmd in ('a','w')
  ) then
    raise exception 'P8.1_ROLLBACK_INCOMPLETE: recoller les CREATE POLICY de la capture avant exécution';
  end if;
end $$;
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- (4) Supprimer le helper ajouté par la migration
--     (aucune politique ne doit encore le référencer : (2) l'a retirée).
-- ------------------------------------------------------------
drop function if exists public.can_invite_to_store(uuid, uuid);

-- ------------------------------------------------------------
-- (5) Vérifications post-rollback (lecture seule)
-- ------------------------------------------------------------
-- a. la fonction restaurée ne contient plus la garde P8.1 :
select position('INVITER_NOT_AUTHORIZED' in pg_get_functiondef(p.oid)) = 0 as p81_guard_removed
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'accept_team_invitation';

-- b. le helper a disparu :
select count(*) = 0 as helper_dropped
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'can_invite_to_store';

-- c. les politiques d'affectation correspondent à la capture :
select pol.polname, pol.polcmd,
       pg_get_expr(pol.polwithcheck, pol.polrelid) as check_expr
from pg_policy pol
join pg_class c on c.oid = pol.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'team_invitation_assignments'
order by pol.polcmd, pol.polname;

-- d. aucune donnée touchée (comparer aux valeurs de la capture) :
select status, count(*) from public.team_invitations group by status order by status;
select status, count(*) from public.store_members group by status order by status;
