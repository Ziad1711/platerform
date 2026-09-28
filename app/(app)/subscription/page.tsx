'use client'

import { createClient } from '@/lib/supabase/client'
import { useQuery } from '@tanstack/react-query'
import { useStore } from '@/lib/store-context'
import { usePermissions } from '@/lib/auth/use-permissions'

/** `enforced: false` = limite affichée à titre informatif, non bloquée en base. */
type UsageBlock = { used?: number; limit?: number | null; enforced?: boolean }

type BillingSubscription = {
  id?: string
  status?: string
  amount_paid?: number
  currency?: string
  started_at?: string | null
  expires_at?: string | null
  plan_name?: string
}

type BillingStatus = {
  period_start?: string
  plan?: {
    id?: string
    name?: string
    price?: number
    order_limit?: number | null
    stores_limit?: number | null
    confirmation_agents_limit?: number | null
    delivery_integrations_limit?: number | null
    ai_credits_monthly?: number | null
  }
  /** Abonnement réellement appliqué par la base, ou null (offre gratuite). */
  subscription?: BillingSubscription | null
  /** Ligne d'abonnement la plus récente, pour information. */
  latest_subscription?: BillingSubscription | null
  has_expired_subscription?: boolean
  orders?: UsageBlock
  stores?: UsageBlock
  agents?: UsageBlock
  credits?: UsageBlock
}

/** 999999 (ou plus) = convention « illimité » du catalogue d'offres. */
function formatLimit(limit?: number | null) {
  if (limit === null || limit === undefined) return '—'
  return limit >= 999999 ? 'Illimité' : limit.toLocaleString('fr-FR')
}

function isUnlimited(limit?: number | null) {
  return limit === null || limit === undefined || limit >= 999999
}

function UsageLine({
  label,
  used,
  limit,
  enforced = true,
}: {
  label: string
  used: number
  limit?: number | null
  enforced?: boolean
}) {
  return (
    <div className="border rounded-lg p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground">
        {used.toLocaleString('fr-FR')} / {formatLimit(limit)}
      </p>
      {enforced
        ? !isUnlimited(limit) && (
            <p className="text-xs text-muted-foreground">
              Restant : {Math.max(0, Number(limit) - used).toLocaleString('fr-FR')}
            </p>
          )
        : <p className="text-xs text-muted-foreground">Informatif — non bloqué en base</p>}
    </div>
  )
}

export default function AbonnementPage() {
  const supabase = createClient()
  const { userId } = useStore()
  const { role, can } = usePermissions(null)

  // Plan effectif + consommation : même règle que la base (abonnement actif non
  // expiré le plus élevé, sinon offre gratuite). Voir `rpc_billing_status`.
  const { data: billingStatus, isLoading: isBillingLoading } = useQuery({
    queryKey: ['billing-status-dashboard', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('rpc_billing_status')

      if (error) throw error
      return (data || null) as BillingStatus | null
    },
  })

  const { data: subscriptionsHistory = [] } = useQuery({
    queryKey: ['settings-subscription-history-dashboard', userId],
    queryFn: async () => {
      if (!userId) return []


      const { data, error } = await supabase
        .from('subscriptions')
        .select('id, status, amount_paid, currency, started_at, expires_at, plans(name)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(12)

      if (error) throw error
      return data || []
    },
  })

  const { data: plans = [] } = useQuery({
    queryKey: ['settings-plans-list-dashboard'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('plans')
        .select('id, name, price, order_limit')
        .order('price', { ascending: true })

      if (error) throw error
      return data || []
    },
  })

  // Abonnement réellement appliqué par la base (et non « la dernière ligne ») :
  // il peut différer de la ligne la plus récente si celle-ci est expirée ou moins
  // élevée. Voir `rpc_billing_status`.
  const appliedSubscription = billingStatus?.subscription || null
  const latestSubscription = billingStatus?.latest_subscription || null
  const showExpiredNotice = !appliedSubscription && !!billingStatus?.has_expired_subscription
  const latestIsNotApplied =
    !!appliedSubscription && !!latestSubscription && latestSubscription.id !== appliedSubscription.id

  if (role && !can('billing.manage')) {
    return (
      <div className="space-y-6 pt-2 sm:pt-0">
        <div className="bg-card rounded-xl shadow p-6">
          <h2 className="text-lg font-semibold text-foreground mb-2">Abonnement Jisra</h2>
          <p className="text-sm text-muted-foreground">
            Seul le propriétaire du compte peut consulter et gérer l&apos;abonnement Jisra.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 pt-2 sm:pt-0">

      <div className="bg-card rounded-xl shadow p-6">
        <h2 className="text-lg font-semibold text-foreground mb-2">Abonnement Jisra</h2>
        <p className="text-sm text-muted-foreground">
          Plan, statut et échéance de votre abonnement à Jisra. Les factures émises pour vos
          propres clients se configurent dans Paramètres &gt; Factures clients.
        </p>
      </div>

      <div className="bg-card rounded-xl shadow p-6 space-y-4">
        {isBillingLoading ? (
          <p className="text-sm text-muted-foreground">Chargement...</p>
        ) : !billingStatus?.plan ? (
          <p className="text-sm text-muted-foreground">Aucun abonnement Jisra actif.</p>
        ) : (
          <>
            <div className="space-y-2 text-sm">
              <p>
                <span className="text-muted-foreground">Plan Jisra :</span>{' '}
                {billingStatus.plan.name || '-'}
              </p>
              <p>
                <span className="text-muted-foreground">Montant de l&apos;offre :</span>{' '}
                {billingStatus.plan.price ?? 0} MAD / mois
              </p>
              <p>
                <span className="text-muted-foreground">Abonnement appliqué :</span>{' '}
                {appliedSubscription
                  ? appliedSubscription.plan_name || billingStatus.plan.name || '-'
                  : 'aucun (offre gratuite appliquée)'}
              </p>
              {appliedSubscription && (
                <>
                  <p><span className="text-muted-foreground">Statut :</span> {appliedSubscription.status || '-'}</p>
                  <p><span className="text-muted-foreground">Montant payé :</span> {appliedSubscription.amount_paid ?? 0} {appliedSubscription.currency || ''}</p>
                  <p><span className="text-muted-foreground">Début :</span> {appliedSubscription.started_at ? new Date(appliedSubscription.started_at).toLocaleString() : '-'}</p>
                  <p><span className="text-muted-foreground">Fin :</span> {appliedSubscription.expires_at ? new Date(appliedSubscription.expires_at).toLocaleString() : '-'}</p>
                </>
              )}
            </div>

            {showExpiredNotice && (
              <p className="text-sm text-amber-600">
                Votre abonnement a expiré. Les droits appliqués sont ceux de l&apos;offre gratuite.
              </p>
            )}

            {latestIsNotApplied && (
              <p className="text-sm text-muted-foreground">
                Les droits appliqués sont ceux de l&apos;abonnement encore valide le plus élevé, et
                non la dernière ligne enregistrée.
              </p>
            )}

            <div>
              <p className="text-sm font-medium text-foreground mb-2">
                Consommation du mois en cours
                {billingStatus.period_start
                  ? ` (depuis le ${new Date(billingStatus.period_start).toLocaleDateString()})`
                  : ''}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <UsageLine
                  label="Commandes"
                  used={Number(billingStatus.orders?.used || 0)}
                  limit={billingStatus.orders?.limit ?? billingStatus.plan.order_limit}
                  enforced={billingStatus.orders?.enforced ?? true}
                />
                <UsageLine
                  label="Stores"
                  used={Number(billingStatus.stores?.used || 0)}
                  limit={billingStatus.stores?.limit ?? billingStatus.plan.stores_limit}
                  enforced={billingStatus.stores?.enforced ?? true}
                />
                <UsageLine
                  label="Agents de confirmation"
                  used={Number(billingStatus.agents?.used || 0)}
                  limit={billingStatus.agents?.limit ?? billingStatus.plan.confirmation_agents_limit}
                  enforced={billingStatus.agents?.enforced ?? false}
                />
                <UsageLine
                  label="Crédits IA"
                  used={Number(billingStatus.credits?.used || 0)}
                  limit={billingStatus.credits?.limit ?? billingStatus.plan.ai_credits_monthly}
                  enforced={billingStatus.credits?.enforced ?? true}
                />
              </div>
            </div>
          </>
        )}
      </div>

      <div id="upgrade" className="bg-card rounded-xl shadow p-6 space-y-3">
        <h3 className="text-base font-semibold text-foreground">Offres disponibles</h3>
        <p className="text-sm text-muted-foreground">Comparatif des offres Jisra.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {plans.map((plan: any) => (
            <div key={plan.id} className="border rounded-lg p-3">
              <p className="text-sm font-semibold text-foreground">{plan.name}</p>
              <p className="text-xs text-muted-foreground">{plan.price ?? 0} MAD / mois</p>
              <p className="text-xs text-muted-foreground">Limite commandes: {plan.order_limit ?? '-'}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-card rounded-xl shadow p-6">
        <h3 className="text-base font-semibold text-foreground mb-3">Historique des abonnements</h3>
        <div className="border rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-secondary">
              <tr>
                <th className="px-4 py-2 text-left text-xs uppercase text-muted-foreground">Plan</th>
                <th className="px-4 py-2 text-left text-xs uppercase text-muted-foreground">Période</th>
                <th className="px-4 py-2 text-left text-xs uppercase text-muted-foreground">Montant</th>
                <th className="px-4 py-2 text-left text-xs uppercase text-muted-foreground">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {subscriptionsHistory.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-3 text-muted-foreground">Aucun historique disponible.</td>
                </tr>
              ) : (
                subscriptionsHistory.map((row: any) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3">{row?.plans?.name || '-'}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {row.started_at ? new Date(row.started_at).toLocaleDateString() : '-'} → {row.expires_at ? new Date(row.expires_at).toLocaleDateString() : '-'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{row.amount_paid ?? 0} {row.currency || 'MAD'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{row.status || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
