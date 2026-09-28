'use client'

import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useStore } from '@/lib/store-context'
import { usePermissions } from '@/lib/auth/use-permissions'
import { formatCount, isUnlimited } from '@/components/settings/jisra-usage-progress'

/**
 * Bandeau d'alerte du quota mensuel de commandes, fixé en haut de la zone de
 * contenu (au-dessus de `main`, donc toujours visible sans recouvrir la page).
 *
 * Il n'apparaît que lorsque le quota touche à sa fin, afin de prévenir avant le
 * blocage plutôt que de le constater : la base refuse toute nouvelle commande
 * une fois la limite du mois dépassée (`enforce_order_quota`).
 */
const LOW_REMAINING_THRESHOLD = 15

type BillingStatus = {
  plan?: { name?: string; order_limit?: number | null }
  orders?: { used?: number; limit?: number | null }
}

export default function QuotaAlertBar() {
  const supabase = createClient()
  const { userId } = useStore()
  const { role, can } = usePermissions(null)

  // Même source que `/subscription` (voir `rpc_billing_status`), donc mêmes clé de
  // cache et chiffres : le quota mesuré est bien celui appliqué par la base.
  const { data } = useQuery({
    queryKey: ['billing-status-dashboard', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('rpc_billing_status')

      if (error) throw error
      return (data || null) as BillingStatus | null
    },
  })

  const ordersUsed = Number(data?.orders?.used ?? 0)
  const ordersLimit = data?.orders?.limit ?? data?.plan?.order_limit ?? null

  // Pas d'alerte pendant le chargement ni en cas d'erreur : aucun état rouge tant
  // que la consommation réelle n'est pas connue. Aucune alerte non plus quand
  // l'offre est sans limite de commandes.
  if (!data || isUnlimited(ordersLimit)) return null

  // Le quota est mesuré par la base sur le propriétaire du compte : l'alerte ne
  // s'adresse qu'à qui peut gérer la facturation (mêmes droits que Paramètres >
  // Facturation Jisra), pour ne pas afficher un quota qui n'est pas le sien.
  if (role && !can('billing.manage')) return null

  const limit = Number(ordersLimit)
  const remaining = limit - ordersUsed
  if (remaining > LOW_REMAINING_THRESHOLD) return null

  const reached = remaining <= 0
  const overBy = ordersUsed - limit
  const planName = data.plan?.name || 'votre offre'

  const message = reached
    ? overBy > 0
      ? `Quota de commandes dépassé ce mois-ci de ${formatCount(overBy)} : ${formatCount(ordersUsed)} / ${formatCount(limit)}. Les nouvelles commandes sont refusées jusqu'au 1er du mois prochain.`
      : `Quota de commandes atteint ce mois-ci : ${formatCount(ordersUsed)} / ${formatCount(limit)}. Les nouvelles commandes sont refusées jusqu'au 1er du mois prochain.`
    : `Il vous reste ${formatCount(remaining)} commande${remaining > 1 ? 's' : ''} ce mois-ci (offre ${planName} : ${formatCount(ordersUsed)} / ${formatCount(limit)}).`

  return (
    <div
      role="status"
      aria-live="polite"
      // `pl-16` réserve la place du bouton de menu mobile (fixé en haut à gauche).
      className={`flex shrink-0 items-center gap-2 border-b px-4 py-2 pl-16 text-xs font-medium sm:text-sm lg:pl-4 ${
        reached
          ? 'border-red-700 bg-red-600 text-white'
          : 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300'
      }`}
    >
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <p>{message}</p>
    </div>
  )
}
