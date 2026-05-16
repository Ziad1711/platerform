-- Migration: Team management v2 - stores, invitations, roles, RLS

-- 1. Extend store_members with invitation tracking
ALTER TABLE store_members
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','invited','inactive')),
  ADD COLUMN IF NOT EXISTS invited_email text,
  ADD COLUMN IF NOT EXISTS invited_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Ensure unique constraint on active members
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE indexname = 'store_members_unique_active'
  ) THEN
    CREATE UNIQUE INDEX store_members_unique_active 
      ON store_members(store_id, user_id) 
      WHERE status = 'active';
  END IF;
END $$;

-- 2. Team invitations table
CREATE TABLE IF NOT EXISTS team_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invited_by uuid NOT NULL REFERENCES auth.users(id),
  email text NOT NULL,
  token text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked','expired')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE team_invitations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'team_invitations' AND policyname = 'team_invitations_inviter_select'
  ) THEN
    CREATE POLICY team_invitations_inviter_select ON team_invitations FOR SELECT USING (invited_by = auth.uid());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'team_invitations' AND policyname = 'team_invitations_inviter_insert'
  ) THEN
    CREATE POLICY team_invitations_inviter_insert ON team_invitations FOR INSERT WITH CHECK (invited_by = auth.uid());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'team_invitations' AND policyname = 'team_invitations_inviter_update'
  ) THEN
    CREATE POLICY team_invitations_inviter_update ON team_invitations FOR UPDATE USING (invited_by = auth.uid());
  END IF;
END $$;

-- 3. Invitation assignments (multi-store per invite)
CREATE TABLE IF NOT EXISTS team_invitation_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id uuid NOT NULL REFERENCES team_invitations(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'viewer',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE team_invitation_assignments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'team_invitation_assignments' AND policyname = 'invitation_assignments_inviter_select'
  ) THEN
    CREATE POLICY invitation_assignments_inviter_select ON team_invitation_assignments FOR SELECT USING (
      EXISTS (SELECT 1 FROM team_invitations ti WHERE ti.id = invitation_id AND ti.invited_by = auth.uid())
    );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'team_invitation_assignments' AND policyname = 'invitation_assignments_inviter_insert'
  ) THEN
    CREATE POLICY invitation_assignments_inviter_insert ON team_invitation_assignments FOR INSERT WITH CHECK (
      EXISTS (SELECT 1 FROM team_invitations ti WHERE ti.id = invitation_id AND ti.invited_by = auth.uid())
    );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'team_invitation_assignments' AND policyname = 'invitation_assignments_inviter_delete'
  ) THEN
    CREATE POLICY invitation_assignments_inviter_delete ON team_invitation_assignments FOR DELETE USING (
      EXISTS (SELECT 1 FROM team_invitations ti WHERE ti.id = invitation_id AND ti.invited_by = auth.uid())
    );
  END IF;
END $$;

-- 4. Helper: is store admin or owner
CREATE OR REPLACE FUNCTION is_store_admin_or_owner(p_store_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM store_members
    WHERE store_id = p_store_id
      AND user_id = p_user_id
      AND status = 'active'
      AND role IN ('owner','admin')
  );
END;
$$;

-- 5. RPC: Accept team invitation
CREATE OR REPLACE FUNCTION accept_team_invitation(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
$$;

-- 6. RPC: Delete store (owner only)
CREATE OR REPLACE FUNCTION delete_store(p_store_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM store_members 
    WHERE store_id = p_store_id AND user_id = auth.uid() AND role = 'owner' AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: only owner can delete store';
  END IF;
  DELETE FROM stores WHERE id = p_store_id;
END;
$$;

-- 7. RPC: Change member role
CREATE OR REPLACE FUNCTION change_member_role(p_store_id uuid, p_user_id uuid, p_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT is_store_admin_or_owner(p_store_id, auth.uid()) THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;
  UPDATE store_members 
    SET role = p_role, updated_at = now() 
    WHERE store_id = p_store_id AND user_id = p_user_id AND status = 'active';
END;
$$;

-- 8. RPC: Remove member
CREATE OR REPLACE FUNCTION remove_member(p_store_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT is_store_admin_or_owner(p_store_id, auth.uid()) THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;
  UPDATE store_members 
    SET status = 'inactive', updated_at = now() 
    WHERE store_id = p_store_id AND user_id = p_user_id AND status = 'active';
END;
$$;

-- 9. RPC: Get my stores with role
CREATE OR REPLACE FUNCTION get_my_stores()
RETURNS TABLE (
  id uuid,
  name text,
  logo_url text,
  currency text,
  country text,
  role text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT s.id, s.name, s.logo_url, s.currency, s.country, sm.role::text
  FROM stores s
  JOIN store_members sm ON sm.store_id = s.id
  WHERE sm.user_id = auth.uid()
    AND sm.status = 'active'
  ORDER BY s.created_at ASC;
END;
$$;

-- 10. Update RLS on store_members for admin operations
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'store_members' AND policyname = 'store_members_admin_update'
  ) THEN
    CREATE POLICY store_members_admin_update ON store_members FOR UPDATE USING (
      is_store_admin_or_owner(store_id, auth.uid())
    );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'store_members' AND policyname = 'store_members_admin_delete'
  ) THEN
    CREATE POLICY store_members_admin_delete ON store_members FOR DELETE USING (
      is_store_admin_or_owner(store_id, auth.uid())
    );
  END IF;
END $$;
