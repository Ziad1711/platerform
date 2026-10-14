// ============================================================
// Application d'un statut transporteur sur une commande.
//
// Une seule voie, atomique : cette fonction CONSTruit le patch metier propose
// (statuts, date, transition d'echange) et le remet a la RPC
// `finish_delivery_tracking_claim`, qui valide puis applique commande ET claim
// dans la MEME transaction.
//
// Garanties :
//  - `delivery_status_source = 'manual'` n'est jamais ecrase ;
//  - un statut non reconnu ne modifie aucun statut ;
//  - une commande terminee n'est jamais rouverte (sauf echange en cours) ;
//  - une transition refusee n'ecrit AUCUNE date ;
//  - une date metier deja renseignee n'est jamais reecrite ;
//  - une livraison terminee ne recule jamais (sauf echange en cours) ;
//  - un echange annule n'est jamais marque termine ;
//  - une reponse en retard echoue en `conflict` et ne modifie rien.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { TrackedStatus, TrackingStatusGuards } from './tracking-providers'
import { isExchangeActive } from './exchange-providers'
import {
  PARK_BLOCKED_MS,
  PARK_MANUAL_MS,
  PARK_TERMINAL_MS,
  STALE_RETRY_MS,
  UNRECOGNIZED_RETRY_MS,
  finishTrackingClaim,
  type FinishClaimResult,
  type ParkReason,
} from './tracking-claims'

type AdminClient = SupabaseClient<any, 'public', any>

/**
 * Transition refusee (notification transporteur en retard) : la commande reste
 * non resolue, mais on ne reinterroge pas le transporteur toutes les 15 min.
 */
const REFUSED_RETRY_MS = UNRECOGNIZED_RETRY_MS

/** Valeurs acceptees par la contrainte `orders_delivery_status_check`. */
export const DELIVERY_STATUS_ALLOWED = [
  'pending',
  'deposited',
  'picked_up',
  'pickup_pending',
  'in_transit',
  'delivered',
  'refused',
  'cancelled',
  'returned',
]

/** Champs de date metier pouvant etre renseignes par le suivi. */
export const STATUS_DATE_FIELDS = [
  'delivered_at',
  'sent_at',
  'picked_up_at',
  'refused_at',
  'cancelled_at',
  'returned_not_stocked_at',
  'returned_stocked_at',
  'dl_out_for_delivery_at',
  'dl_no_answer_at',
  'dl_unreachable_at',
  'dl_postponed_at',
]

/** Une livraison terminee ne doit pas etre rouverte par une reponse tardive. */
const TERMINAL_DELIVERY_STATUSES = ['delivered', 'refused', 'cancelled', 'returned']

export type ApplyTrackedStatusOrder = Record<string, unknown> & {
  id: string
  updated_at?: string | null
}

export type FinalizeTrackedStatusResult = FinishClaimResult & {
  parkReason: ParkReason | null
  notes: string[]
}

/** Delai d'attente associe a un motif. */
export function parkDelayMs(reason: ParkReason | null): number | null {
  if (reason === 'manual') return PARK_MANUAL_MS
  if (reason === 'terminal') return PARK_TERMINAL_MS
  if (reason === 'unrecognized') return UNRECOGNIZED_RETRY_MS
  if (reason === 'stale') return STALE_RETRY_MS
  return null
}

export { PARK_BLOCKED_MS }

/**
 * Construit le patch, calcule la planification du claim, puis delegue
 * l'ecriture atomique a la RPC. Le claim est toujours libere par la RPC,
 * meme en `conflict` (reprise rapide programmee).
 */
export async function finalizeTrackedStatus(params: {
  admin: AdminClient
  storeId: string
  provider: string
  order: ApplyTrackedStatusOrder
  tracked: TrackedStatus
  terminalOrderStatuses: string[]
  exchangeReturnStatus: string
  isExchangeFollowUp: boolean
  guards?: TrackingStatusGuards
  worker: string
  trackingKey: string
  freshnessMs: number
  /** Colonne de suivi du transporteur + societes autorisees (verifiees cote SQL). */
  trackingColumn: string
  deliveryCompanyIds: string[]
  /** true uniquement pour le suivi manuel d'un colis (aucun bail detenu). */
  allowWithoutClaim?: boolean
  leaseSeconds?: number
}): Promise<FinalizeTrackedStatusResult> {
  const {
    admin,
    storeId,
    provider,
    order,
    tracked,
    terminalOrderStatuses,
    exchangeReturnStatus,
    isExchangeFollowUp,
    guards,
    worker,
    trackingKey,
    freshnessMs,
    trackingColumn,
    deliveryCompanyIds,
    allowWithoutClaim = false,
    leaseSeconds = 180,
  } = params

  const notes: string[] = []
  const currentStatus = String(order.status || '')
  const currentDelivery = String(order.delivery_status || '')
  const currentSource = String(order.delivery_status_source || '')

  let parkReason: ParkReason | null = null
  let patchStatus: string | null = null
  let patchDelivery: string | null = null
  let patchDateField: string | null = null
  let statusRefused = false

  // 1. Verdict : aucune ecriture de statut si refuse.
  if (currentSource === 'manual') {
    parkReason = 'manual'
    notes.push('correction manuelle conservee')
  } else if (!tracked.recognized || (!tracked.orderStatus && !tracked.deliveryStatus)) {
    parkReason = 'unrecognized'
    notes.push(`statut transporteur non reconnu (${tracked.rawStatus || 'vide'})`)
  } else if (terminalOrderStatuses.includes(currentStatus) && !isExchangeFollowUp) {
    parkReason = 'terminal'
    notes.push(`commande deja terminee (${currentStatus})`)
  }

  if (!parkReason) {
    // 2. Statut commande (avec les regles de progression du transporteur).
    if (tracked.orderStatus && tracked.orderStatus !== order.status) {
      const allowed = guards?.statusAllowed ? guards.statusAllowed(order.status === null ? null : currentStatus, tracked.orderStatus) : true
      if (allowed) {
        patchStatus = tracked.orderStatus
      } else {
        statusRefused = true
        notes.push(`transition refusee (${currentStatus || '-'} -> ${tracked.orderStatus})`)
      }
    }

    // 3. Statut de livraison (jamais hors referentiel, jamais un recul).
    if (tracked.deliveryStatus && tracked.deliveryStatus !== order.delivery_status) {
      const target = String(tracked.deliveryStatus)
      const reopening = TERMINAL_DELIVERY_STATUSES.includes(currentDelivery) && target !== currentDelivery
      const regression = guards?.deliveryAllowed ? !guards.deliveryAllowed(currentDelivery || null, target) : false

      if (!DELIVERY_STATUS_ALLOWED.includes(target)) {
        notes.push(`delivery_status hors referentiel ignore (${target})`)
      } else if (regression || (reopening && !isExchangeFollowUp)) {
        notes.push(`recul de livraison refuse (${currentDelivery} -> ${target})`)
      } else {
        patchDelivery = target
      }
    }

    // 4. Date metier : jamais ecrite si la transition est refusee, jamais
    // reecrite si elle existe deja.
    const dateField = String(tracked.statusDateField || '')
    const existing = dateField ? order[dateField] : null
    const dateEmpty = existing === null || existing === undefined || existing === ''
    if (dateField && STATUS_DATE_FIELDS.includes(dateField) && dateEmpty && !statusRefused) {
      patchDateField = dateField
      if (!tracked.eventAt) notes.push(`${dateField} = date de reception (transporteur non date)`)
    }
  }

  const statusChanged = patchStatus !== null
  const deliveryChanged = patchDelivery !== null
  const parkDelay = parkDelayMs(parkReason)
  const didWork = statusChanged || deliveryChanged
  const markSynced = !parkReason && appliedIsSynced(parkReason, didWork, statusRefused, tracked, patchDelivery)

  // Transition refusee (notification en retard) : rien n'est ecrit et la
  // commande reste NON RESOLUE, mais on ne martele pas le transporteur pour
  // autant : nouvelle tentative differee.
  const retryDelayMs = parkDelay ?? (statusRefused ? REFUSED_RETRY_MS : freshnessMs)

  const result = await finishTrackingClaim(admin, {
    storeId,
    provider,
    orderId: String(order.id),
    worker,
    trackingColumn,
    deliveryCompanyIds,
    allowWithoutClaim,
    leaseSeconds,
    expectedTrackingKey: trackingKey,
    expectedUpdatedAt: (order.updated_at as string) || null,
    attempts: 0,
    lastOutcome: parkReason ? 'skipped' : didWork ? 'applied' : 'unchanged',
    parkReason,
    nextAttemptAt: new Date(Date.now() + retryDelayMs),
    lastError: notes.length > 0 ? notes.join(' ; ').slice(0, 400) : null,
    markSynced,
    patch: {
      status: patchStatus,
      deliveryStatus: patchDelivery,
      statusDateField: patchDateField,
      statusDateValue: patchDateField ? tracked.eventAt || null : null,
      rawStatus: tracked.rawStatus || '',
      completeExchange: tracked.orderStatus === exchangeReturnStatus && isExchangeActive(order.exchange_status),
    },
  })

  return { ...result, parkReason: result.outcome === 'conflict' ? 'stale' : parkReason, notes }
}

/**
 * Un suivi est « synchronise » (donc frais) quand il a ete lu, reconnu, et
 * qu'aucun refus/erreur ne l'empeche : une transition refusee n'est pas une
 * synchronisation utile.
 */
function appliedIsSynced(
  parkReason: ParkReason | null,
  didWork: boolean,
  statusRefused: boolean,
  tracked: TrackedStatus,
  patchDelivery: string | null
): boolean {
  if (parkReason) return false
  if (statusRefused) return false
  return Boolean(didWork || tracked.recognized || patchDelivery)
}

