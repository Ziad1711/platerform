-- ============================================================
-- P8.1 — Invitations inter-boutiques : autorisation de l'invitant
-- Version : 20261021120000
-- Statut  : PRÉPARÉE — NON APPLIQUÉE
-- ------------------------------------------------------------
-- Objet :
--   (1) un helper unique (owner/admin actif d'une boutique pour un
--       utilisateur donné) partagé par la politique et la RPC ;
--   (2) suppression de toute politique INSERT/UPDATE d'affectation qui
--       s'appuie sur `invited_by` sans exiger owner/admin actif de la
--       boutique ciblée — quel que soit son nom installé ;
--   (3) politique d'insertion d'affectation : owner/admin actif de la
--       boutique ciblée ET affectation rattachée à l'invitation de
--       l'appelant ;
--   (4) `accept_team_invitation` revérifie, pour CHAQUE affectation, le
--       droit actuel de l'invitant avant toute écriture ; refus atomique.
--
-- Hors portée : aucun changement des huit rôles, des permissions métier,
-- des politiques de lecture, des triggers existants, ni des données.
--
-- Prérequis (ordre strict) :
--   1. exécuter supabase/p8_1_package/10_preflight_capture.sql (lecture seule) ;
--   2. conserver sa sortie : elle est la source du rollback 20_rollback.sql ;
--   3. vérifier que 20261021120000 > max(version) de
--      supabase_migrations.schema_migrations sur l'environnement cible.
--
-- Idempotence : drop if exists / create or replace / boucle sur pg_policy.
-- ============================================================

-- ------------------------------------------------------------
-- (1) Helper partagé
--     Même sémantique que public.is_store_admin_or_owner(uuid), mais
--     explicite sur l'utilisateur : indispensable pour que la RPC puisse
--     vérifier l'invitant (et non l'appelant).
-- ------------------------------------------------------------
create or replace function public.can_invite_to_store(p_store_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.store_members sm
    where sm.store_id = p_store_id
      and sm.user_id = p_user_id
      and sm.status = 'active'
      and sm.role in ('owner','admin')
  );
$$;

revoke all on function public.can_invite_to_store(uuid, uuid) from public;
revoke all on function public.can_invite_to_store(uuid, uuid) from anon;
grant execute on function public.can_invite_to_store(uuid, uuid) to authenticated, service_role;

-- ------------------------------------------------------------
-- (2) Fermeture des politiques d'écriture « inviter seul »
--     Les politiques permissives se cumulent en OR : une seule politique
--     insuffisamment gardée suffit à ouvrir l'écriture. On retire donc
--     toute politique PERMISSIVE INSERT/UPDATE dont l'expression cite
--     `invited_by` sans contenir de contrôle owner/admin de la boutique
--     ciblée. Une politique RESTRICTIVE n'est jamais retirée : elle ne
--     peut que réduire l'accès (les restrictives se cumulent en AND).
--     Les noms installés ne sont pas tous versionnés : la sélection se
--     fait sur l'expression, pas sur le nom.
-- ------------------------------------------------------------
do $$
declare
  v_policy record;
  v_expr text;
begin
  for v_policy in
    select pol.polname,
           pg_get_expr(pol.polqual, pol.polrelid) as qual,
           pg_get_expr(pol.polwithcheck, pol.polrelid) as with_check
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'team_invitation_assignments'
      and pol.polcmd in ('a','w')
      and pol.polpermissive
  loop
    v_expr := coalesce(v_policy.qual, '') || ' ' || coalesce(v_policy.with_check, '');

    if v_expr ilike '%invited_by%'
       and v_expr not ilike '%is_store_admin_or_owner%'
       and v_expr not ilike '%can_invite_to_store%' then
      execute format('drop policy %I on public.team_invitation_assignments', v_policy.polname);
      raise notice 'P8.1 : politique d''affectation supprimée (inviter seul) -> %', v_policy.polname;
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------
-- (3) Politique d'insertion unique et gardée
--     Restriction au rôle `authenticated` : un appel anonyme ne peut pas
--     évaluer le helper et n'a de toute façon aucun `auth.uid()`.
--     Note : si `team_invitations` n'expose aucune politique SELECT,
--     le EXISTS reste faux — la politique est alors fail-closed.
-- ------------------------------------------------------------
drop policy if exists invitation_assignments_inviter_insert on public.team_invitation_assignments;

create policy invitation_assignments_inviter_insert on public.team_invitation_assignments
  for insert
  to authenticated
  with check (
    public.can_invite_to_store(store_id, auth.uid())
    and exists (
      select 1
      from public.team_invitations ti
      where ti.id = team_invitation_assignments.invitation_id
        and ti.invited_by = auth.uid()
    )
  );

-- ------------------------------------------------------------
-- (3 bis) Garde-fou : refuser l'application si une politique permissive
--         d'écriture reste non gardée (expression sans `store_id`), par
--         exemple un legs `with check (true)` non détecté plus haut.
--         Une exception annule toute la migration.
-- ------------------------------------------------------------
do $$
declare
  v_left text;
begin
  select string_agg(pol.polname, ', ' order by pol.polname)
  into v_left
  from pg_policy pol
  join pg_class c on c.oid = pol.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'team_invitation_assignments'
    and pol.polcmd in ('a','w')
    and pol.polpermissive
    and (
      coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || ' ' ||
      coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')
    ) not ilike '%store_id%';

  if v_left is not null then
    raise exception 'P8.1_BLOCKED_UNGUARDED_POLICY: %', v_left;
  end if;
end $$;

-- ------------------------------------------------------------
-- (4) RPC d'acceptation : revérification du droit actuel de l'invitant
--     Conservé tel quel : verrou FOR UPDATE, contrôles e-mail / statut /
--     expiration, comportement multiboutique, on conflict (store_id,user_id).
--     Ajouté : validation préalable de TOUTES les affectations avant la
--     moindre écriture, ce qui rend le refus atomique (aucune invitation
--     consommée, aucune appartenance créée ni réactivée).
-- ------------------------------------------------------------
create or replace function public.accept_team_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
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

  -- P8.1 : aucune écriture avant validation de toutes les affectations.
  for v_assignment in
    select * from team_invitation_assignments where invitation_id = v_invitation.id
  loop
    if not public.can_invite_to_store(v_assignment.store_id, v_invitation.invited_by) then
      return jsonb_build_object(
        'error','INVITER_NOT_AUTHORIZED',
        'store_id', v_assignment.store_id
      );
    end if;
  end loop;

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
$$;

-- ACL réaffirmée à l'identique (CREATE OR REPLACE conserve l'ACL existante ;
-- cette réaffirmation protège d'une dérive où anon aurait retrouvé EXECUTE).
revoke all on function public.accept_team_invitation(text) from public;
revoke all on function public.accept_team_invitation(text) from anon;
grant execute on function public.accept_team_invitation(text) to authenticated, service_role;
