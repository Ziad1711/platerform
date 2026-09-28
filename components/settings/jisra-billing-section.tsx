'use client'

import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useStore } from '@/lib/store-context'
import { usePermissions } from '@/lib/auth/use-permissions'
import JisraPlanCatalog, { type CatalogPlan } from '@/components/settings/jisra-plan-catalog'
import UsageProgress, { formatCount, formatLimit } from '@/components/settings/jisra-usage-progress'

/**
 * Numéro WhatsApp de l'équipe Jisra, au format international sans « + ».
 * Tant qu'il n'est pas renseigné, aucun lien n'est généré : le bouton de demande
 * d'offre supérieure reste désactivé au lieu de pointer vers une destination inconnue.
 */
const JISRA_WHATSAPP_NUMBER = ''

type UsageBlock = { used?: number; limit?: number | null; enforced?: boolean }

type BillingStatus = {
  period_start?: string
  plan?: {
    name?: string
    price?: number
    order_limit?: number | null
    ai_credits_monthly?: number | null
  }
  /** Abonnement réellement appliqué par la base, ou null (offre gratuite). */
  subscription?: { plan_name?: string; status?: string; expires_at?: string | null } | null
  orders?: UsageBlock
  /** Crédits IA consommés sur le mois en cours (compteur remis à zéro chaque mois). */
  credits?: UsageBlock
}
type BillingDetailsProps = {
  data: BillingStatus
  planName: string
  plans: CatalogPlan[]
  whatsappNumber: string
}

function BillingDetails({ data, planName, plans, whatsappNumber }: BillingDetailsProps) {
  const ordersUsed = Number(data.orders?.used ?? 0)
  const ordersLimit = data.orders?.limit ?? data.plan?.order_limit ?? null
  const creditsUsed = Number(data.credits?.used ?? 0)
  const creditsLimit = data.credits?.limit ?? data.plan?.ai_credits_monthly ?? null
  const periodNote = data.period_start
    ? `Comptage depuis le ${new Date(data.period_start).toLocaleDateString('fr-FR')} sur la date des commandes.`
    : undefined
  // Consommation du mois reprise dans la demande transmise à l'équipe Jisra.
  const usageSummary =
    `Commandes du mois : ${formatCount(ordersUsed)} sur ${formatLimit(ordersLimit)}. ` +
    `Crédits IA : ${formatCount(creditsUsed)} sur ${formatLimit(creditsLimit)}.`

  return (
    <div className="mt-5 space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Offre appliquée</p>
          <p className="text-sm font-medium text-foreground">{planName}</p>
          <p className="text-xs text-muted-foreground">{data.plan?.price ?? 0} MAD / mois</p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Échéance</p>
          <p className="text-sm font-medium text-foreground">
            {data.subscription?.expires_at
              ? new Date(data.subscription.expires_at).toLocaleDateString('fr-FR')
              : 'Aucune (offre gratuite)'}
          </p>
          <p className="text-xs text-muted-foreground">
            {data.subscription?.status || 'Aucun abonnement en cours'}
          </p>
        </div>
      </div>

      <div className="space-y-5">
        <UsageProgress
          label="Commandes du mois"
          used={ordersUsed}
          limit={ordersLimit}
          unitOne="commande"
          unitMany="commandes"
          unlimitedMessage="Votre offre n'a pas de limite de commandes."
          note={periodNote}
        />
        <UsageProgress
          label="Crédits IA du mois"
          used={creditsUsed}
          limit={creditsLimit}
          unitOne="crédit"
          unitMany="crédits"
          unlimitedMessage="Votre offre n'a pas de limite de crédits IA."
          note="Les crédits se rechargent chaque mois : le compteur repart à zéro le 1er, sur l'offre appliquée à ce moment-là."
        />
      </div>

      <JisraPlanCatalog
        plans={plans}
        currentPlanName={planName}
        whatsappNumber={whatsappNumber}
        usageSummary={usageSummary}
      />
    </div>
  )
}



export default function JisraBillingSection() {
  const supabase = createClient()
  const { userId } = useStore()
  const { role, can } = usePermissions(null)

  // Même source que la page Abonnement Jisra : plan effectif et consommation réels
  // (voir `rpc_billing_status`), afin que l'affichage ne diverge pas des droits.
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['settings-billing-status', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('rpc_billing_status')

      if (error) throw error
      return (data || null) as BillingStatus | null
    },
  })

  // Catalogue des offres : comparatif indicatif. Le passage à une offre
  // supérieure reste traité par l'équipe Jisra, sans paiement en ligne.
  const { data: plans = [] } = useQuery({
    queryKey: ['settings-plans-catalog'],
    queryFn: async () => {
      const { data: catalog, error } = await supabase
        .from('plans')
        .select('id, name, price, order_limit, ai_credits_monthly, stores_limit')
        .order('price', { ascending: true })

      if (error) throw error
      return (catalog || []) as CatalogPlan[]
    },
  })

  const planName = data?.plan?.name || 'Offre actuelle'
  const whatsappNumber = JISRA_WHATSAPP_NUMBER.replace(/\D/g, '')

  if (role && !can('billing.manage')) {
    return (
      <section id="jisra-billing" className="rounded-2xl border bg-card p-6 scroll-mt-32">
        <h2 className="text-lg font-semibold">Facturation Jisra</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Seul le propriétaire du compte peut consulter l&apos;abonnement et le quota Jisra.
        </p>
      </section>
    )
  }


  return (
    <section id="jisra-billing" className="rounded-2xl border bg-card p-6 scroll-mt-32">
      <h2 className="text-lg font-semibold">Facturation Jisra</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Votre abonnement à Jisra, votre quota de commandes et vos crédits IA du mois en cours. Les factures
        émises pour vos propres clients se configurent dans Factures clients.
      </p>

      {isLoading ? (
        <div className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          Chargement de votre facturation...
        </div>
      ) : isError || !data ? (
        <div className="mt-5 space-y-3">
          <p className="text-sm text-red-600">Impossible de charger l&apos;état de facturation Jisra.</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="rounded-xl border px-4 py-2 text-sm font-medium hover:bg-secondary"
          >
            Réessayer
          </button>
        </div>
      ) : (
        <BillingDetails data={data} planName={planName} plans={plans} whatsappNumber={whatsappNumber} />
      )}
    </section>
  )
}

