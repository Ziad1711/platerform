import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export const createClient = async () => {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        async getAll() {
          return await cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    }
  )
}

/**
 * Récupère l'utilisateur connecté côté serveur.
 * Utilise d'abord getUser() (vérification API), puis getSession() en fallback
 * pour gérer les incohérences de cookies SSR (notamment sur Safari).
 */
export async function getServerUser() {
  const supabase = await createClient()
  
  // Essayer getUser() d'abord (vérification JWT via API)
  const { data: { user }, error } = await supabase.auth.getUser()
  if (user && !error) return user

  // Fallback: getSession() lit le cookie localement
  const { data: { session } } = await supabase.auth.getSession()
  return session?.user ?? null
}
