import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { Permission, hasPermission } from './permissions'

export async function getServerClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll() {},
      },
    }
  )
}

export async function getCurrentUser() {
  const supabase = await getServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return null
  return user
}

export async function getMemberRole(storeId: string, userId: string): Promise<string | null> {
  const supabase = await getServerClient()
  const { data, error } = await supabase
    .from('store_members')
    .select('role')
    .eq('store_id', storeId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle()
  if (error) return null
  return data?.role || null
}

export async function requirePermission(storeId: string, permission: Permission) {
  const user = await getCurrentUser()
  if (!user) throw new Error('UNAUTHORIZED')
  const role = await getMemberRole(storeId, user.id)
  if (!hasPermission(role as any, permission)) throw new Error('FORBIDDEN')
  return { user, role }
}

export async function requireAuth() {
  const user = await getCurrentUser()
  if (!user) throw new Error('UNAUTHORIZED')
  return user
}
