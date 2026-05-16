import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

/**
 * Envoie un email d'invitation via Supabase.
 *
 * Stratégie :
 * 1) Essayer `inviteUserByEmail` (template "Invite user" de Supabase).
 *    Si l'utilisateur existe déjà, ça échoue → on bascule sur l'étape 2.
 * 2) `signInWithOtp` avec `shouldCreateUser: false` envoie un vrai email
 *    "Magic Link" (template Supabase) et redirige vers notre page /invite.
 *
 * Pourquoi pas `generateLink` ? Parce que `generateLink` ne fait que
 * générer un lien — il n'envoie AUCUN email.
 */

export async function sendInvitationEmail(
  email: string,
  token: string,
  options: {
    inviterName?: string
    storeNames?: string[]
  } = {}
) {
  const admin = createAdminClient()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!
  const redirectUrl = `${appUrl}/auth/finish?next=${encodeURIComponent('/invite/' + token)}`

  // 1) Essayer l'invitation classique (nouvel utilisateur)
  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(
    email,
    {
      redirectTo: redirectUrl,
      data: {
        invitation_token: token,
        password_set: false,
        inviter_name: options.inviterName || '',
        store_names: options.storeNames || [],
      },
    }
  )

  if (!inviteError) {
    return { method: 'invite' }
  }

  // 2) Si l'utilisateur existe déjà, on envoie un Magic Link
  const isAlreadyRegistered =
    inviteError.message?.toLowerCase().includes('already registered') ||
    inviteError.status === 422

  if (isAlreadyRegistered) {
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { error: otpError } = await anonClient.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: redirectUrl,
      },
    })

    if (otpError) {
      throw new Error(
        `EMAIL_SEND_FAILED_MAGICLINK: ${otpError.message} (code: ${otpError.status})`
      )
    }

    return { method: 'magiclink' }
  }

  // Erreur inattendue lors de l'invitation
  throw new Error(
    `EMAIL_SEND_FAILED: ${inviteError.message} (status: ${inviteError.status})`
  )
}
