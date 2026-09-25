import { NextResponse } from 'next/server'
import { requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { hasPermission, type Role } from '@/lib/auth/permissions'
import { getConfirmationErrorStatus } from '@/lib/confirmation/api-errors'

const EVENT_SELECT =
  'id, order_id, actor_user_id, agent_id, event_type, from_status, to_status, attempt_number, callback_at, reason_code, note, metadata, created_at'

/**
 * Historique complet d'une commande : actions de confirmation + créateurs.
 * Les événements sont en lecture seule pour tous les membres du store.
 */
export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const orderId = String(new URL(request.url).searchParams.get('orderId') || '').trim()

    if (!orderId) {
      return NextResponse.json({ error: 'MISSING_ORDER_ID' }, { status: 400 })
    }

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, store_id')
      .eq('id', orderId)
      .maybeSingle()

    if (orderError) throw orderError
    if (!order) {
      return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 })
    }

    const member = await verifyStoreAccess(supabase, user.id, order.store_id)
    if (!hasPermission(member.role as Role, 'confirmation.view')) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }

    const { data: events, error: eventsError } = await supabase
      .from('order_confirmation_events')
      .select(EVENT_SELECT)
      .eq('order_id', orderId)
      .order('created_at', { ascending: true })

    if (eventsError) throw eventsError

    const actorIds = Array.from(
      new Set((events || []).map((event: any) => event.actor_user_id).filter(Boolean))
    ) as string[]

    let actorNames: Record<string, string> = {}
    if (actorIds.length > 0) {
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, full_name, first_name, last_name')
        .in('id', actorIds)

      if (profilesError) throw profilesError

      actorNames = Object.fromEntries(
        (profiles || []).map((profile: any) => [
          String(profile.id),
          String(
            profile.full_name ||
              `${profile.first_name || ''} ${profile.last_name || ''}`.trim() ||
              'Utilisateur'
          ),
        ])
      )
    }

    return NextResponse.json({ events: events || [], actorNames })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CONFIRMATION_HISTORY_FETCH_FAILED'
    return NextResponse.json({ error: message }, { status: getConfirmationErrorStatus(message) })
  }
}
