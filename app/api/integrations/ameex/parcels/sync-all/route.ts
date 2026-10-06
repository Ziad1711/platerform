// ============================================================
// Resynchronisation ciblee des commandes AMEEX
//
// Filet de securite lorsque le webhook n'a pas ete recu (indisponibilite,
// secret non configure, evenement perdu). Utilise exactement la meme
// fonction metier que le webhook : les corrections manuelles sont
// protegees et aucune regression de statut n'est possible.
//
// POST /api/integrations/ameex/parcels/sync-all
// body: { storeId: string, limit?: number }
// ============================================================

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, requireAuthenticatedUser } from '@/lib/assistant/security'
import { trackAmeexParcel } from '@/lib/integrations/ameex'
import { getAmeexCredentials } from '@/lib/integrations/ameex-credentials'
import { resolveAmeexStatus } from '@/lib/integrations/ameex-status'
import {
  AMEEX_TRACKING_ORDER_COLUMNS,
  applyAmeexStatusToOrder,
  type AmeexTrackingOrder,
} from '@/lib/integrations/ameex-parcel-status'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 50

/** Statuts terminaux : inutile de re-interroger le transporteur. */
const TERMINAL_STATUSES = [
  'delivered',
  'refused',
  'cancelled',
  'returned_not_stocked',
  'returned_stocked',
]

export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request)
    const { user } = await requireAuthenticatedUser()

    const body = (await request.json().catch(() => ({}))) as {
      storeId?: string
      limit?: number
    }

    const storeId = String(body.storeId || '').trim()
    if (!storeId) return NextResponse.json({ error: 'MISSING_STORE_ID' }, { status: 400 })

    const limit = Math.min(
      Math.max(Number(body.limit) || DEFAULT_LIMIT, 1),
      MAX_LIMIT,
    )

    const admin = createAdminClient()

    const { data: membership, error: membershipError } = await admin
      .from('store_members')
      .select('store_id')
      .eq('user_id', user.id)
      .eq('store_id', storeId)
      .eq('status', 'active')
      .maybeSingle()

    if (membershipError) throw membershipError
    if (!membership) return NextResponse.json({ error: 'STORE_ACCESS_DENIED' }, { status: 403 })

    const { data: integration, error: integrationError } = await admin
      .from('integrations')
      .select('id')
      .eq('provider', 'ameex')
      .eq('store_id', storeId)
      .maybeSingle()

    if (integrationError) throw integrationError
    if (!integration) return NextResponse.json({ error: 'AMEEX_NOT_CONNECTED' }, { status: 400 })

    const credentials = await getAmeexCredentials(admin, integration.id)

    const { data: orderRows, error: ordersError } = await admin
      .from('orders')
      .select(AMEEX_TRACKING_ORDER_COLUMNS)
      .eq('store_id', storeId)
      .not('ameex_parcel_code', 'is', null)
      .neq('ameex_parcel_code', '')
      .not('status', 'in', `(${TERMINAL_STATUSES.join(',')})`)
      .order('last_delivery_sync_at', { ascending: true, nullsFirst: true })
      .limit(limit)

    if (ordersError) throw ordersError

    // Les corrections manuelles ne sont jamais reinterrogees inutilement.
    const orders = ((orderRows || []) as unknown as AmeexTrackingOrder[]).filter(
      (order) => order.delivery_status_source !== 'manual',
    )

    const results: Array<{ orderId: string; parcelCode: string | null; outcome: string; detail?: string }> = []
    let applied = 0
    let failed = 0

    for (const order of orders) {
      const parcelCode = String(order.ameex_parcel_code || '').trim()
      try {
        const raw = await trackAmeexParcel(credentials.apiId, credentials.apiKey, parcelCode)
        const parcel = (raw as any)?.Parcel
        const rawStatut = String(parcel?.STATUT || '').trim()
        const rawStatutS = String(parcel?.STATUT_S || '').trim()
        const statusDate = String(parcel?.DATE || parcel?.STATUT_DATE || '').trim()

        const resolved = resolveAmeexStatus(rawStatut, rawStatutS || undefined)
        const result = await applyAmeexStatusToOrder({ admin, order, resolved, statusDate })

        if (result.outcome === 'applied') applied += 1

        results.push({
          orderId: order.id,
          parcelCode,
          outcome: result.outcome,
          detail: result.detail,
        })
      } catch (error) {
        failed += 1
        results.push({
          orderId: order.id,
          parcelCode,
          outcome: 'error',
          detail: error instanceof Error ? error.message : 'AMEEX_TRACK_FAILED',
        })
      }
    }

    return NextResponse.json({
      ok: true,
      processed: orders.length,
      applied,
      failed,
      results,
    })
  } catch (error) {
    console.error('AMEEX sync-all error:', error)
    const message = error instanceof Error ? error.message : 'AMEEX_SYNC_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
