import { NextRequest } from 'next/server'
import { runProviderTrackingSync } from '@/lib/integrations/delivery/tracking-route'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Delegue au service de suivi partage (meme mecanisme que le cron serveur et
 * le rattrapage du dashboard) : resolutions d'integration et verrou uniques.
 */
export async function POST(request: NextRequest) {
  return runProviderTrackingSync(request, {
    providerSlug: 'rushliv',
    fallbackError: 'RUSHLIV_SYNC_ALL_FAILED',
  })
}
