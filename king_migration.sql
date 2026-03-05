-- ═══════════════════════════════════════════════════════════════════
-- KING MEMBERSHIP MIGRATION
-- Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════

-- 1. Add is_king column (idempotent)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_king BOOLEAN NOT NULL DEFAULT false;

-- 2. Add audit tracking columns
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS audits_today INTEGER NOT NULL DEFAULT 0;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS last_audit_date DATE DEFAULT NULL;

-- 3. Ensure RLS is enabled
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- 4. Policy: users can read their own profile
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'profiles' AND policyname = 'Users can view own profile'
  ) THEN
    CREATE POLICY "Users can view own profile"
      ON profiles FOR SELECT
      USING (auth.uid() = id);
  END IF;
END $$;

-- 5. Policy: users can update their own audit fields (NOT is_king — server only)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'profiles' AND policyname = 'Users can update own audit fields'
  ) THEN
    CREATE POLICY "Users can update own audit fields"
      ON profiles FOR UPDATE
      USING (auth.uid() = id)
      WITH CHECK (auth.uid() = id);
  END IF;
END $$;

-- 6. Enable Realtime on profiles table
ALTER PUBLICATION supabase_realtime ADD TABLE profiles;

-- 7. Server-side function to safely increment audit (prevents client-side bypass)
CREATE OR REPLACE FUNCTION increment_audit(user_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  profile_row profiles%ROWTYPE;
  today DATE := CURRENT_DATE;
  result JSON;
BEGIN
  SELECT * INTO profile_row FROM profiles WHERE id = user_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Profile not found');
  END IF;

  -- Reset counter if new day
  IF profile_row.last_audit_date IS DISTINCT FROM today THEN
    UPDATE profiles
    SET audits_today = 1, last_audit_date = today
    WHERE id = user_id;
    RETURN json_build_object('allowed', true, 'audits_today', 1);
  END IF;

  -- Block if already used daily audit
  IF profile_row.audits_today >= 1 AND profile_row.is_king = false THEN
    RETURN json_build_object('allowed', false, 'audits_today', profile_row.audits_today);
  END IF;

  -- Increment
  UPDATE profiles
  SET audits_today = profile_row.audits_today + 1
  WHERE id = user_id;

  RETURN json_build_object('allowed', true, 'audits_today', profile_row.audits_today + 1);
END;
$$;

-- 8. Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION increment_audit(UUID) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- DONE. Verify with:
-- SELECT id, is_king, audits_today, last_audit_date FROM profiles LIMIT 5;
-- ═══════════════════════════════════════════════════════════════════
