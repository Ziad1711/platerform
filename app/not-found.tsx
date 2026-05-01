import Link from 'next/link'
import { JisraMark } from '@/components/logo'
import { Spotlight } from '@/components/marketing/shared/spotlight'

export default function NotFound() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center gap-6 overflow-hidden bg-jisra-ink px-6 text-center text-jisra-cream">
      <Spotlight />
      <div className="marketing-panel relative z-10 flex max-w-2xl flex-col items-center gap-6 px-8 py-10">
        <JisraMark size={56} ink="#f3efe6" accent="#1fa971" />
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-jisra-green">Erreur 404</p>
          <h1 className="text-4xl font-bold tracking-tight">Cette page n’existe pas</h1>
          <p className="max-w-lg text-base leading-8 text-jisra-cream/65">
            Revenez au site marketing ou connectez-vous à votre espace pour reprendre la navigation.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link href="/" className="rounded-2xl bg-jisra-green px-5 py-3 text-sm font-semibold text-white">
            Retour à l’accueil
          </Link>
          <Link href="/login" className="rounded-2xl border border-jisra-green/20 px-5 py-3 text-sm font-semibold">
            Se connecter
          </Link>
        </div>
      </div>
    </div>
  )
}