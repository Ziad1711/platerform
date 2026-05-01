import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import SignupForm from '@/components/auth/signup-form'
import { JisraMark, JisraWordmark } from '@/components/logo'

export default async function SignupPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    redirect('/dashboard')
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-jisra-ink text-jisra-cream">
      <div className="absolute inset-0 opacity-[0.03]">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: 'radial-gradient(circle at 1px 1px, #1fa971 1px, transparent 0)',
            backgroundSize: '40px 40px',
          }}
        />
      </div>

      <div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-jisra-green/10 blur-3xl" />
      <div className="absolute -bottom-40 -left-40 h-96 w-96 rounded-full bg-jisra-green/5 blur-3xl" />

      <div className="relative mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-6 sm:px-6 lg:grid lg:grid-cols-[1.05fr_0.95fr] lg:gap-10 lg:px-8 lg:py-10">
        <div className="mb-8 flex items-center justify-between lg:col-span-2">
          <Link href="/" className="text-sm text-jisra-cream/60 transition hover:text-jisra-cream">
            ← Retour à l'accueil
          </Link>
          <div className="flex items-center gap-3">
            <JisraMark size={34} ink="#f3efe6" accent="#1fa971" />
            <JisraWordmark size={28} ink="#f3efe6" accent="#1fa971" />
          </div>
        </div>

        <div className="relative flex items-center">
          <div className="absolute -inset-1 rounded-2xl bg-jisra-green/10 blur-xl" />
          <div className="relative w-full rounded-2xl border border-jisra-green/20 bg-jisra-ink-light/90 p-8 shadow-2xl backdrop-blur-xl sm:p-10">
            <div className="absolute left-8 right-8 top-0 h-px bg-gradient-to-r from-transparent via-jisra-green/40 to-transparent" />
            <div className="mb-8 space-y-3">
              <span className="inline-flex rounded-full border border-jisra-green/20 bg-jisra-green/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-jisra-green-light">
                Inscription
              </span>
              <h1 className="text-3xl font-bold tracking-tight text-jisra-cream">
                Créez votre compte Jisra
              </h1>
              <p className="max-w-lg text-sm leading-6 text-jisra-cream/65 sm:text-base">
                Configurez votre espace en quelques secondes puis finalisez votre business dès votre arrivée sur le dashboard.
              </p>
            </div>

            <SignupForm />
          </div>
        </div>

        <div className="mt-8 flex items-center lg:mt-0">
          <div className="w-full rounded-[28px] border border-white/10 bg-white/[0.03] p-6 shadow-[0_30px_80px_rgba(0,0,0,0.34)] backdrop-blur-2xl sm:p-8">
            <div className="space-y-6">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-jisra-green-light/90">Pourquoi Jisra</p>
                <h2 className="mt-3 text-2xl font-semibold text-jisra-cream">
                  Un onboarding pensé pour les marchands marocains.
                </h2>
              </div>

              <div className="grid gap-4">
                {[
                  'Accès immédiat au dashboard après connexion.',
                  'Configuration guidée du store avec devise et fuseau adaptés.',
                  'Base propre pour ventes, publicité, livraison et profit réel.',
                ].map((item) => (
                  <div key={item} className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-jisra-cream/72">
                    {item}
                  </div>
                ))}
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  ['< 2 min', 'Création de compte'],
                  ['100%', 'Interface en français'],
                  ['MAD', 'Devise suggérée par défaut'],
                ].map(([value, label]) => (
                  <div key={label} className="rounded-2xl border border-jisra-green/15 bg-jisra-green/5 p-4">
                    <div className="text-xl font-bold text-jisra-cream">{value}</div>
                    <div className="mt-1 text-xs uppercase tracking-[0.18em] text-jisra-cream/45">{label}</div>
                  </div>
                ))}
              </div>

              <p className="text-sm text-jisra-cream/55">
                Déjà inscrit ?{' '}
                <Link href="/login" className="font-medium text-jisra-green-light transition hover:text-jisra-green">
                  Se connecter
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}