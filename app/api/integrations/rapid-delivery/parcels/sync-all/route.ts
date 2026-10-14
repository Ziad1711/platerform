import { NextRequest } from 'next/server'
import { runProviderTrackingSync } from '@/lib/integrations/delivery/tracking-route'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Delegue au service de suivi partage (meme mecanisme que le cron serveur et
 * le rattrapage du dashboard) : un seul verrou, une seule resolution
 * d'integration (proprietaire du store), aucune boucle dupliquee.
 * Conserve pour compatibilite : plus aucun declenchement automatique ne passe
 * par ici (l'ancien useEffect de la page Sales a ete retire).
 */
export async function POST(request: NextRequest) {
  return runProviderTrackingSync(request, {
    providerSlug: 'rapid-delivery',
    fallbackError: 'RAPID_DELIVERY_SYNC_ALL_FAILED',
  })
}
