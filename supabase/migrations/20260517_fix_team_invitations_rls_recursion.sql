-- Fix: Remove duplicate and recursive RLS policies on team_invitations
-- The policy "read invitations related to my stores" causes infinite recursion
-- because it calls is_store_admin_or_owner() which queries store_members,
-- and store_members policies may reference team_invitations back.

-- Drop the problematic policy that causes recursion
DROP POLICY IF EXISTS "read invitations related to my stores" ON team_invitations;

-- Drop duplicate policies from the original migration that overlap with simpler ones
DROP POLICY IF EXISTS "team_invitations_inviter_select" ON team_invitations;
DROP POLICY IF EXISTS "team_invitations_inviter_insert" ON team_invitations;
DROP POLICY IF EXISTS "team_invitations_inviter_update" ON team_invitations;

-- Add search_path to security definer functions for safety
CREATE OR REPLACE FUNCTION public.is_store_admin_or_owner(p_store_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER SET search_path = public
AS $function$
  select exists (
    select 1 from store_members
    where store_id = p_store_id
      and user_id = auth.uid()
      and role in ('owner','admin')
      and status = 'active'
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_store_admin_or_owner(p_store_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM store_members
    WHERE store_id = p_store_id
      AND user_id = p_user_id
      AND status = 'active'
      AND role IN ('owner','admin')
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.change_member_role(p_store_id uuid, p_user_id uuid, p_role text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  IF NOT is_store_admin_or_owner(p_store_id, auth.uid()) THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;
  UPDATE store_members 
    SET role = p_role, updated_at = now() 
    WHERE store_id = p_store_id AND user_id = p_user_id AND status = 'active';
END;
$function$;

CREATE OR REPLACE FUNCTION public.remove_member(p_store_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  IF NOT is_store_admin_or_owner(p_store_id, auth.uid()) THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;
  UPDATE store_members 
    SET status = 'inactive', updated_at = now() 
    WHERE store_id = p_store_id AND user_id = p_user_id AND status = 'active';
END;
$function$;

CREATE OR REPLACE FUNCTION public.accept_team_invitation(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_invitation team_invitations%ROWTYPE;
  v_user_id uuid;
  v_assignment team_invitation_assignments%ROWTYPE;
  v_result jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_invitation FROM team_invitations WHERE token = p_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error','INVITATION_NOT_FOUND');
  END IF;
  IF v_invitation.status != 'pending' THEN
    RETURN jsonb_build_object('error','INVITATION_NOT_PENDING');
  END IF;
  IF v_invitation.expires_at < now() THEN
    RETURN jsonb_build_object('error','INVITATION_EXPIRED');
  END IF;

  SELECT id INTO v_user_id FROM auth.users WHERE email = v_invitation.email;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error','USER_NOT_FOUND');
  END IF;

  UPDATE team_invitations 
    SET status = 'accepted', updated_at = now() 
    WHERE id = v_invitation.id;

  FOR v_assignment IN 
    SELECT * FROM team_invitation_assignments WHERE invitation_id = v_invitation.id
  LOOP
    INSERT INTO store_members (store_id, user_id, role, status, invited_email, invited_by, accepted_at, updated_at)
    VALUES (v_assignment.store_id, v_user_id, v_assignment.role, 'active', v_invitation.email, v_invitation.invited_by, now(), now())
    ON CONFLICT (store_id, user_id) WHERE status = 'active' 
    DO UPDATE SET role = v_assignment.role, status = 'active', updated_at = now();

    v_result := v_result || jsonb_build_object(
      'store_id', v_assignment.store_id,
      'role', v_assignment.role
    );
  END LOOP;

  RETURN jsonb_build_object('success', true, 'assignments', v_result);
END;
$function$;
