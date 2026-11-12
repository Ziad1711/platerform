import { createClient } from '@supabase/supabase-js'
import { assertQualificationIsolation } from '@/lib/env/qualification-guard'

export function createAdminClient() {
  // Défense en profondeur : le client à privilèges élevés refuse de se
  // construire si l'isolation de qualification n'est pas démontrée.
  assertQualificationIsolation()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

  if (!url || !serviceRoleKey) {
    throw new Error('MISSING_SUPABASE_ADMIN_CONFIG')
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
