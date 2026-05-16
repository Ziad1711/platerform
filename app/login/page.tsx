import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import AuthForm from '@/components/auth/auth-form'
import { JisraMark, JisraWordmark } from '@/components/logo'
import { sanitizeInternalRedirectPath } from '@/lib/assistant/security'

type LoginPageProps = {
  searchParams?: Promise<{ signup?: string; recovery?: string; error?: string; next?: string }>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = (await searchParams) ?? {}
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const nextPath = sanitizeInternalRedirectPath(params.next, '/dashboard')

  if (user && params.recovery !== '1') {
    redirect(nextPath)
  }
  const defaultMode = params.recovery === '1' ? 'recovery' : params.signup === '1' ? 'signup' : 'login'
  const isInvitationExpired = params.error === 'invitation_expired'

  return (
    <div className="min-h-screen relative overflow-hidden bg-jisra-ink">
      <div className="absolute inset-0 opacity-[0.03]">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, #1fa971 1px, transparent 0)',
            backgroundSize: '40px 40px',
          }}
        />
      </div>

      <div className="absolute -top-40 -right-40 w-96 h-96 bg-jisra-green/10 rounded-full blur-3xl" />
      <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-jisra-green/5 rounded-full blur-3xl" />
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-jisra-green/30 to-transparent" />

      <div className="relative min-h-screen flex items-center justify-center p-4 sm:p-6 lg:p-8">
        <div className="w-full max-w-md animate-fade-in-up">
          <div className="flex justify-center mb-8">
            <div className="flex items-center gap-3">
              <JisraMark size={40} ink="#f3efe6" accent="#1fa971" />
              <JisraWordmark size={32} ink="#f3efe6" accent="#1fa971" />
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-1 bg-jisra-green/10 rounded-2xl blur-xl" />

            <div className="relative bg-jisra-ink-light/90 backdrop-blur-xl rounded-2xl border border-jisra-green/20 shadow-2xl p-8 sm:p-10">
              <div className="absolute top-0 left-8 right-8 h-px bg-gradient-to-r from-transparent via-jisra-green/40 to-transparent" />

              <div className="text-center mb-8">
                <h1 className="text-2xl font-bold text-jisra-cream">Bienvenue</h1>
                <p className="text-jisra-cream/60 mt-2 text-sm">
                  Connectez-vous à votre tableau de bord
                </p>
                {isInvitationExpired && (
                  <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm text-red-400">
                    Lien d&apos;invitation invalide ou expiré. Veuillez demander une nouvelle invitation.
                  </div>
                )}
                <p className="mt-3 text-sm text-jisra-cream/45">
                  Nouveau sur Jisra ?{' '}
                  <Link href="/signup" className="font-medium text-jisra-green-light hover:text-jisra-green">
                    Créer un compte
                  </Link>
                </p>
              </div>

              <AuthForm defaultMode={defaultMode} />

              <div className="mt-8 pt-6 border-t border-jisra-green/10">
                <p className="text-center text-xs text-jisra-cream/40">
                  Plateforme conçue pour le marché marocain
                </p>
                <p className="text-center text-xs text-jisra-cream/30 mt-1">
                  Interface en français · Multi-tenant · Dashboard analytique
                </p>
              </div>
            </div>
          </div>

          <p className="text-center text-xs text-jisra-cream/30 mt-6">
            © {new Date().getFullYear()} Jisra. Tous droits réservés.
          </p>
        </div>
      </div>
    </div>
  )
}