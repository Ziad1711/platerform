import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { User } from '@supabase/supabase-js'

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
 * Résultat d'une vérification d'identité côté serveur, distinguant
 * « aucun utilisateur connecté » d'une indisponibilité temporaire de
 * l'API Auth. Un appelant ne doit jamais confondre les deux : une panne
 * Supabase ne doit pas faire passer un compte connecté pour anonyme.
 */
export type ServerUserResult = {
  user: User | null
  /** true quand l'API Auth est momentanément injoignable/indisponible (pas une absence de session). */
  authUnavailable: boolean
}

function isDefinitiveUnauthenticated(
  error: { name?: string; code?: string; status?: number } | null | undefined
): boolean {
  if (!error) return false
  // Session manquante ou révoquée.
  if (error.name === 'AuthSessionMissingError' || error.code === 'session_not_found') return true
  // Jeton invalide (signature/formats) : définitif, ce n'est pas une panne.
  if (error.name === 'AuthInvalidJwtError' || error.code === 'invalid_jwt' || error.code === 'bad_jwt') return true
  // Session expirée, refresh révoqué/réutilisé, utilisateur supprimé : définitif.
  if (
    error.code === 'session_expired' ||
    error.code === 'refresh_token_not_found' ||
    error.code === 'refresh_token_already_used' ||
    error.code === 'user_not_found'
  ) return true
  return false
}

/**
 * Récupère l'utilisateur connecté côté serveur.
 *
 * L'identité ne vient jamais d'un décodage local du cookie : elle est
 * toujours vérifiée par l'API Auth (`GET /user` avec le JWT en Bearer).
 * En cas d'échec de la première vérification, le repli relit le jeton
 * d'accès (et non l'objet `user`) puis le resoumet à l'API : un cookie
 * forgé ne peut donc pas authentifier.
 */
export async function getServerUserResult(): Promise<ServerUserResult> {
  const supabase = await createClient().catch(() => null)
  if (!supabase) return { user: null, authUnavailable: true }

  // 1. Vérification serveur du JWT (source de vérité).
  let user: User | null = null
  let firstError: { name?: string; code?: string; status?: number } | null = null
  try {
    const { data, error } = await supabase.auth.getUser()
    user = data.user ?? null
    firstError = error ?? null
  } catch {
    // Erreur inattendue : ne pas conclure à une déconnexion.
    return { user: null, authUnavailable: true }
  }

  if (user && !firstError) return { user, authUnavailable: false }

  // 2. Repli : jeton d'accès relu du cookie, puis revérifié par l'API Auth.
  let session: { access_token?: string } | null = null
  let sessionError: { name?: string; code?: string; status?: number } | null = null
  try {
    const { data, error } = await supabase.auth.getSession()
    session = data.session ?? null
    sessionError = error ?? null
  } catch {
    return { user: null, authUnavailable: true }
  }

  if (session?.access_token) {
    let verifiedUser: User | null = null
    let verifyError: { name?: string; code?: string; status?: number } | null = null
    try {
      const { data, error } = await supabase.auth.getUser(session.access_token)
      verifiedUser = data.user ?? null
      verifyError = error ?? null
    } catch {
      return { user: null, authUnavailable: true }
    }

    if (verifiedUser && !verifyError) return { user: verifiedUser, authUnavailable: false }

    // Un jeton existe mais l'API ne le confirme pas : session révoquée/invalide
    // (déconnecté) ou panne temporaire.
    return { user: null, authUnavailable: !isDefinitiveUnauthenticated(verifyError) }
  }

  // Aucun jeton exploitable. Priorité : toute erreur « définitive » (session
  // révoquée/expirée/absente) est décisive ; sinon toute autre erreur est une
  // panne temporaire ; sinon c'est une absence réelle de session.
  if (isDefinitiveUnauthenticated(sessionError) || isDefinitiveUnauthenticated(firstError)) {
    return { user: null, authUnavailable: false }
  }
  if (sessionError || firstError) {
    return { user: null, authUnavailable: true }
  }
  return { user: null, authUnavailable: false }
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
