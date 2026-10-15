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
 *
 * L'identité ne vient jamais d'un décodage local du cookie : elle est
 * toujours vérifiée par l'API Auth (`GET /user` avec le JWT en Bearer).
 * En cas d'échec de la première vérification, le repli relit le jeton
 * d'accès (et non l'objet `user`) puis le resoumet à l'API : un cookie
 * forgé ne peut donc pas authentifier.
 *
 * Justification du repli : l'ancien code l'expliquait par des
 * « incohérences de cookies SSR (notamment sur Safari) ». Ce cas n'est ni
 * documenté ni reproduit (aucune trace dans memory-bank) : le repli est
 * donc conservé comme simple seconde tentative vérifiée, sans prétendre
 * corriger un bug identifié.
 */
export async function getServerUser() {
  const supabase = await createClient()

  // 1. Vérification serveur du JWT (source de vérité)
  const { data: { user }, error } = await supabase.auth.getUser()
  if (user && !error) return user

  // 2. Repli : jeton d'accès relu du cookie, puis revérifié par l'API Auth
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) return null

  const { data: { user: verifiedUser } } = await supabase.auth.getUser(
    session.access_token
  )
  return verifiedUser ?? null
}

/**
 * Indique si un cookie de session Supabase est présent.
 *
 * Les cookies de session `@supabase/ssr` sont nommés `sb-<ref>-auth-token`
 * et peuvent être découpés en fragments suffixés (`.0`, `.1`, …). On teste
 * donc un préfixe et un marqueur, sans jamais lire la valeur : la simple
 * présence d'un cookie n'authentifie personne. Elle sert uniquement d'indice
 * pour savoir si une vérification serveur (`getUser`) est pertinente.
 */
export async function hasSessionCookie(): Promise<boolean> {
  const cookieStore = await cookies()
  return cookieStore
    .getAll()
    .some((cookie) => cookie.name.startsWith('sb-') && cookie.name.includes('-auth-token'))
}
