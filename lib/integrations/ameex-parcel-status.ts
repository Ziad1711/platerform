// ============================================================
// Application d'un statut AMEEX sur une commande.
//
// Fonction metier UNIQUE partagee par le webhook de suivi et par la
// resynchronisation ciblee. Elle ne doit jamais etre contournee.
//
// Regles appliquees :
//  - un statut inconnu n'entraine AUCUNE modification de statut ;
//  - `delivery_status_source = 'manual'` protege les corrections humaines ;
//  - toute regression de `status` ET de `delivery_status` est refusee
//    (notifications en retard ou dans le desordre) ;
//  - les champs de date deja renseignes ne sont jamais reecrits ;
//  - l'ecriture est conditionnelle (compare-and-set) pour rester idempotente.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  AMEEX_DELIVERY_STATUS_STAGE,
  AMEEX_ORDER_STATUS_STAGE,
  type AmeexResolvedStatus,
} from './ameex-status'

type AdminClient = SupabaseClient<any, 'public', any>

export type AmeexApplyOutcome =
  | 'applied'
  | 'already_applied'
  | 'manual_protected'
  | 'regression_blocked'
  | 'unrecognized_status'
  | 'stale_order'

export type AmeexTrackingOrder = {
  id: string
  store_id: string
  status: string | null
  delivery_status: string | null
  delivery_status_source: string | null
  [key: string]: unknown
}

/** Colonnes necessaires pour savoir si une date de statut est deja renseignee. */
export const AMEEX_TRACKING_ORDER_COLUMNS = [
  'id',
  'store_id',
  'status',
  'delivery_status',
  'delivery_status_source',
  'delivery_company_id',
  'ameex_parcel_code',
  'delivered_at',
  'sent_at',
  'picked_up_at',
  'refused_at',
  'cancelled_at',
  'returned_not_stocked_at',
  'dl_out_for_delivery_at',
  'dl_no_answer_at',
  'dl_unreachable_at',
  'dl_postponed_at',
].join(', ')

/** Convertit la date d'evenement AMEEX (AAAA-MM-JJ) en horodatage ISO, sinon `now`. */
function resolveEventTimestamp(statusDate?: string | null): string {
  const raw = String(statusDate || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const parsed = new Date(`${raw}T00:00:00.000Z`)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    const parsed = new Date(raw)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  return new Date().toISOString()
}

/**
 * Une transition est autorisee si l'etape cible est superieure a l'etape
 * courante. Les statuts "feuille" de l'etape 4 (no_answer, postponed, ...)
 * peuvent s'echanger entre eux car ils ne representent pas une progression.
 */
function isTransitionAllowed(currentStatus: string | null, targetStatus: string): boolean {
  const currentStage = AMEEX_ORDER_STATUS_STAGE[String(currentStatus || '')] ?? 0
  const targetStage = AMEEX_ORDER_STATUS_STAGE[targetStatus] ?? 0
  if (targetStage > currentStage) return true
  return targetStage === 4 && currentStage === 4
}

/**
 * Meme regle pour `delivery_status` : un recul est refuse (une notification
 * AMEEX en retard ne doit pas reouvrir une livraison deja terminee). Une
 * valeur hors referentiel (etape 0) est toujours autorisee.
 */
function isDeliveryTransitionAllowed(
  currentDeliveryStatus: string | null,
  targetDeliveryStatus: string,
): boolean {
  const currentStage = AMEEX_DELIVERY_STATUS_STAGE[String(currentDeliveryStatus || '')] ?? 0
  const targetStage = AMEEX_DELIVERY_STATUS_STAGE[targetDeliveryStatus] ?? 0
  if (currentStage === 0 || targetStage === 0) return true
  return targetStage >= currentStage
}

export async function applyAmeexStatusToOrder(params: {
  admin: AdminClient
  order: AmeexTrackingOrder
  resolved: AmeexResolvedStatus
  statusDate?: string | null
}): Promise<{ outcome: AmeexApplyOutcome; detail: string }> {
  const { admin, order, resolved, statusDate } = params
  const now = new Date().toISOString()

  // Champs toujours synchronises : statut brut transporteur + horodatage de synchro.
  const baseUpdate: Record<string, unknown> = {
    delivery_company_status_raw: resolved.rawStatus || null,
    last_delivery_sync_at: now,
    updated_at: now,
  }

  // 1. Statut inconnu : on conserve uniquement la trace brute.
  if (!resolved.recognized) {
    await admin.from('orders').update(baseUpdate).eq('id', order.id)
    return {
      outcome: 'unrecognized_status',
      detail: `Statut AMEEX non reconnu conserve pour diagnostic: ${resolved.rawStatus || '(vide)'}`,
    }
  }

  // 2. Correction manuelle : ne jamais ecraser silencieusement.
  if (order.delivery_status_source === 'manual') {
    await admin.from('orders').update(baseUpdate).eq('id', order.id)
    return {
      outcome: 'manual_protected',
      detail: `Statut manuel (${order.status || '-'}/${order.delivery_status || '-'}) conserve face au statut transporteur ${resolved.rawStatus || '-'}`,
    }
  }

  const update: Record<string, unknown> = { ...baseUpdate }
  let statusChanged = false
  let deliveryChanged = false
  let deliveryRegressionBlocked = false

  // 3. Statut commande cible.
  if (resolved.orderStatus && resolved.orderStatus !== order.status) {
    if (!isTransitionAllowed(order.status, resolved.orderStatus)) {
      await admin.from('orders').update(baseUpdate).eq('id', order.id)
      return {
        outcome: 'regression_blocked',
        detail: `Transition refusee ${order.status || '-'} -> ${resolved.orderStatus}`,
      }
    }
    update.status = resolved.orderStatus
    update.last_status_update_at = now
    statusChanged = true
  }

  // 4. Statut de livraison cible : jamais de recul (notification en retard).
  if (resolved.deliveryStatus && resolved.deliveryStatus !== order.delivery_status) {
    if (isDeliveryTransitionAllowed(order.delivery_status, resolved.deliveryStatus)) {
      update.delivery_status = resolved.deliveryStatus
      deliveryChanged = true
    } else {
      deliveryRegressionBlocked = true
    }
  }

  // 5. Date de statut : uniquement si elle n'est pas deja renseignee.
  if (resolved.statusDateField && !order[resolved.statusDateField]) {
    update[resolved.statusDateField] = resolveEventTimestamp(statusDate)
  }

  if (statusChanged || deliveryChanged) {
    update.delivery_status_source = 'delivery_company'
  }

  if (!statusChanged && !deliveryChanged) {
    await admin.from('orders').update(baseUpdate).eq('id', order.id)
    if (deliveryRegressionBlocked) {
      return {
        outcome: 'regression_blocked',
        detail: `Recul de livraison refuse ${order.delivery_status || '-'} -> ${resolved.deliveryStatus}`,
      }
    }
    return {
      outcome: 'already_applied',
      detail: `Statut deja a jour pour ${resolved.rawStatus || '-'}`,
    }
  }

  // Ecriture conditionnelle (compare-and-set) : la commande ne doit pas avoir
  // change entre-temps. On verrouille aussi `delivery_status` et
  // `delivery_status_source` afin qu'une correction manuelle validee pendant
  // le traitement (`source = 'manual'`) ne soit jamais ecrasee.
  let query = admin.from('orders').update(update).eq('id', order.id)

  if (order.status === null) {
    query = query.is('status', null)
  } else {
    query = query.eq('status', order.status)
  }

  if (order.delivery_status === null) {
    query = query.is('delivery_status', null)
  } else {
    query = query.eq('delivery_status', order.delivery_status)
  }

  if (order.delivery_status_source === null) {
    query = query.is('delivery_status_source', null)
  } else {
    query = query.eq('delivery_status_source', order.delivery_status_source)
  }

  const { data: affected, error } = await query.select('id')

  if (error) throw error
  if (!affected || affected.length === 0) {
    return {
      outcome: 'stale_order',
      detail: 'La commande a ete modifiee pendant le traitement ; mise a jour abandonnee.',
    }
  }

  return {
    outcome: 'applied',
    detail: `Statut applique: ${resolved.orderStatus || order.status} / ${resolved.deliveryStatus || order.delivery_status}`,
  }
}
