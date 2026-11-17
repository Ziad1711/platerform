import Link from 'next/link'
import { readPublicPlanCatalog } from '@/lib/billing/catalog.server'
import { formatMad, priceDescription, subscribePath } from '@/lib/billing/presentation'
import { getServerUserResult } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { bankInstructions } from '@/lib/billing/payments.server'
import { Container } from '@/components/marketing/shared/container'
import { PaymentRequestCreate } from '@/components/billing/payment-request-create'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Récapitulatif de souscription', robots: { index: false, follow: false } }

export default async function SubscribePage({ searchParams }: {
  searchParams: Promise<{ plan?: string; period?: string; price?: string }>
}) {
  const params = await searchParams
  let catalog
  try { catalog = await readPublicPlanCatalog() } catch {
    return <Container className="py-20"><h1 className="text-2xl font-semibold">Catalogue temporairement indisponible</h1>
      <p className="mt-4">Aucun paiement ni changement d’abonnement n’a été effectué.</p>
      <Link className="mt-6 inline-block underline" href="/pricing">Revenir aux forfaits</Link></Container>
  }
  const price = catalog.find((item) => item.code === params.plan && item.billing_period === params.period
    && (!params.price || item.price_id === params.price))
  if (!price) {
    return <Container className="py-20"><h1 className="text-2xl font-semibold">Forfait ou tarif indisponible</h1>
      <p className="mt-4">Cette sélection est invalide ou le tarif a changé. Choisissez à nouveau une offre ; aucun montant n’a été accepté.</p>
      <Link className="mt-6 inline-block underline" href="/pricing">Consulter les tarifs actuels</Link></Container>
  }
  const { user, authUnavailable } = await getServerUserResult()
  const bank = await bankInstructions(createAdminClient())
  const next = subscribePath(price)
  const authLink = (path: string) => `${path}?next=${encodeURIComponent(next)}`
  return (
    <Container className="py-16 sm:py-24">
      <div className="marketing-panel mx-auto max-w-xl space-y-6 p-6 sm:p-10">
        <div>
          <p className="text-sm uppercase tracking-wider text-jisra-green">Confirmer votre offre</p>
          <h1 className="mt-1 text-3xl font-bold">{price.name} — {price.billing_period === 'yearly' ? 'Annuel' : 'Mensuel'}</h1>
        </div>
        <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm text-jisra-cream/70">Montant total à régler</span>
            <span className="text-2xl font-bold">{formatMad(price.amount_minor)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm text-jisra-cream/70">Durée</span>
            <span className="font-medium">{price.duration_months} mois, en une fois</span>
          </div>
          <p className="text-sm text-jisra-cream/60">{priceDescription(price)}</p>
        </div>
        {price.requires_payment ? (bank.enabled ? (
          <p className="text-sm text-jisra-cream/70">Votre abonnement sera confirmé après vérification bancaire de la réception du virement.</p>
        ) : (
          <div role="status" className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm">
            Le paiement par virement est momentanément indisponible : les coordonnées bancaires officielles ne sont pas encore publiées.
          </div>
        )) : <p className="text-sm">Votre compte gratuit ne nécessite aucun paiement.</p>}
        {authUnavailable ? <p role="status" className="text-sm">Impossible de vérifier votre session. Réessayez ultérieurement.</p>
          : user ? <>
            <p className="text-sm text-jisra-cream/70">Vous êtes connecté. Votre sélection est conservée.</p>
            {price.requires_payment && <PaymentRequestCreate priceId={price.price_id} />}
            <Link href={price.requires_payment ? '/subscription' : '/dashboard?onboarding=1'} className="inline-flex min-h-11 items-center rounded-xl bg-jisra-green px-5 py-3 text-white">{price.requires_payment ? 'Consulter mon abonnement' : 'Accéder à mon espace gratuit'}</Link>
          </> : <div className="flex flex-col gap-3">
            <Link href={authLink('/signup')} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-jisra-green px-5 py-3 text-white">Créer mon compte{price.requires_payment ? '' : ' gratuit'}</Link>
            <Link href={authLink('/login')} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-white/20 px-5 py-3">Déjà inscrit ? Se connecter</Link>
          </div>}
        <Link href="/pricing" className="inline-block text-sm underline">Modifier mon offre</Link>
      </div>
    </Container>
  )
}