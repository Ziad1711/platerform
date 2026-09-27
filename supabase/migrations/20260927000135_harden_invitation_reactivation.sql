-- (1) Aligner le RPC sur la route /api/team/accept : identité de l'appelant
--     + conflit sur la clé unique (store_id, user_id), sans référence à la
--     colonne inexistante `updated_at` de team_invitations.
create or replace function public.accept_team_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to public
as $$
declare
  v_invitation team_invitations%rowtype;
  v_user_id uuid;
  v_assignment team_invitation_assignments%rowtype;
  v_result jsonb := '[]'::jsonb;
begin
  select * into v_invitation from team_invitations where token = p_token;
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
$$;

-- (2) Révoquer un membre annule ses invitations `pending` pour le store ciblé.
create or replace function public.revoke_member_pending_invitations()
returns trigger
language plpgsql
security definer
set search_path to public
as $$
declare
  v_email text;
begin
  if new.status = 'revoked' and old.status is distinct from 'revoked' then
    select email into v_email from auth.users where id = new.user_id;
    if v_email is not null then
      update team_invitations
        set status = 'revoked'
      where status = 'pending'
        and email = v_email
        and exists (
          select 1 from team_invitation_assignments tia
          where tia.invitation_id = team_invitations.id
            and tia.store_id = new.store_id
        );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_revoke_member_pending_invitations on public.store_members;
create trigger trg_revoke_member_pending_invitations
  after update of status on public.store_members
  for each row execute function public.revoke_member_pending_invitations();
