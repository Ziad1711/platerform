// ============================================================
// Relance d'un colis bloque (apres epuisement des essais).
//
// POST { orderId } -> rearme le claim si ce colis est bloque, dans une
// transaction unique. Le transporteur est RESOLU cote serveur a partir de la
// commande : le client ne choisit ni le provider ni le store.
//
// Securite : utilisateur authentifie + origine de confiance + appartenance
// ACTIVE au store. La lecture est filtree par les stores accessibles.
// ============================================================

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  assertTrustedOrigin,
  getAccessibleStoreIds,
  getErrorStatus,
  requireAuthenticatedUser,
} from '@/lib/assistant/security'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

const bodySchema = z.object({
  orderId: z.string().uuid(),
})

export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request)
    const { supabase, user } = await requireAuthenticatedUser()

    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 })

    const { orderId } = parsed.data
    const admin = createAdminClient()

    // Autorisation d'abord : lecture filtree par les stores accessibles.
    const accessible = await getAccessibleStoreIds(supabase, user.id)
    if (accessible.length === 0) return NextResponse.json({ error: 'STORE_ACCESS_DENIED' }, { status: 403 })

    const { data: order, error: orderError } = await admin
      .from('orders')
      .select('store_id')
      .eq('id', orderId)
      .in('store_id', accessible)
      .maybeSingle()

    if (orderError) throw orderError
    if (!order?.store_id) return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 })

    const { data: result, error: retryError } = await admin.rpc('retry_delivery_tracking_order', {
      p_order_id: orderId,
      p_store_id: order.store_id,
    })

    if (retryError) throw retryError

    const row = (Array.isArray(result) ? result[0] : result) as Record<string, unknown> | null
    const outcome = (row?.outcome as string) || 'error'
    const provider = (row?.provider as string) || null

    return NextResponse.json({ ok: outcome === 'rearmed', outcome, provider })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'DELIVERY_TRACKING_RETRY_FAILED'
    if (getErrorStatus(error) >= 500) console.error('[delivery-tracking] retry failed', { error: message })
    return NextResponse.json({ error: message }, { status: getErrorStatus(error) })
  }
}
