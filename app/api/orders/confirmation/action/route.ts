import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { hasPermission, type Role } from '@/lib/auth/permissions'
import {
  getConfirmationErrorStatus,
  resolveConfirmationErrorStatus,
} from '@/lib/confirmation/api-errors'
import type { ConfirmationAction } from '@/lib/confirmation/constants'
import type { ConfirmationActionResponse } from '@/lib/confirmation/types'
import type { ConfirmationProgressStage } from '@/lib/confirmation/progress'
import { normalizeOrderCityById } from '@/lib/integrations/city-normalizer'
import {
  deliveryCityKeyOf,
  deliveryProviderCatalogueId,
  resolveDeliveryProvider,
  sanitizeDeliveryOptions,
  type ConfirmationDeliveryOptions,
  type ConfirmationDeliveryProvider,
} from '@/lib/confirmation/delivery-options'

const ALLOWED_ACTIONS: ConfirmationAction[] = ['NO_ANSWER', 'POSTPONE', 'CANCEL', 'CONFIRM']

type ParcelResult = { created: boolean; trackingNumber: string | null; warning: string | null }

/**
 * La confirmation doit créer le colis chez le transporteur comme aujourd'hui.
 * On réutilise le pipeline existant de `/api/orders/status` (normalisation ville,
 * tarif de livraison, tous les transporteurs) au lieu de le réécrire.
 */
async function triggerParcelCreation(
  request: Request,
  orderId: string,
  deliveryNote: string,
  deliveryCompanyId: string | null,
  deliveryMode: 'internal' | 'shipping',
  deliveryOptions: ConfirmationDeliveryOptions,
  cityAlreadyNormalized: boolean
): Promise<ParcelResult> {
  const target = new URL('/api/orders/status', new URL(request.url).origin)

  const response = await fetch(target, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie: request.headers.get('cookie') || '',
    },
    body: JSON.stringify({
      orderId,
      status: 'confirmed',
      deliveryNote: deliveryNote || undefined,
      deliveryCompanyId: deliveryMode === 'shipping' && deliveryCompanyId ? deliveryCompanyId : undefined,
      deliveryMode,
      // La ville a déjà été normalisée ici : le pipeline de statut ne doit pas la
      // recalculer (une seule normalisation pour toute la confirmation).
      cityAlreadyNormalized,
      // Paramètres colis propres au transporteur (ville, ouverture, fragile...).
      ...deliveryOptions,
    }),
  })

  const payload = (await response.json().catch(() => null)) as
    | { ok?: boolean; warning?: string; trackingNumber?: string; error?: string }
    | null

  if (!response.ok) {
    return {
      created: false,
      trackingNumber: null,
      warning: payload?.error || 'PARCEL_CREATION_FAILED',
    }
  }

  const trackingNumber = payload?.trackingNumber ? String(payload.trackingNumber) : null
  return { created: Boolean(trackingNumber), trackingNumber, warning: payload?.warning || null }
}

/** Trace le résultat de la création du colis : une erreur transporteur ne doit jamais être silencieuse. */
async function logParcelEvent(input: {
  storeId: string
  orderId: string
  userId: string
  agentId: string | null
  status: string
  parcel: ParcelResult
}) {
  try {
    const admin = createAdminClient()
    await admin.from('order_confirmation_events').insert({
      store_id: input.storeId,
      order_id: input.orderId,
      actor_user_id: input.userId,
      agent_id: input.agentId,
      event_type: input.parcel.created ? 'parcel_creation_succeeded' : 'parcel_creation_failed',
      from_status: input.status,
      to_status: input.status,
      metadata: {
        trackingNumber: input.parcel.trackingNumber,
        warning: input.parcel.warning,
      },
    })
  } catch (error) {
    console.error('CONFIRMATION_PARCEL_EVENT_LOG_FAILED', error)
  }
}

type AttemptHandle = {
  succeed: () => Promise<void>
  fail: (error?: string) => Promise<void>
}

const ATTEMPT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Un identifiant de tentative valide (UUID), sinon `null`. */
function normalizeAttemptId(value: unknown): string | null {
  const raw = String(value ?? '').trim().toLowerCase()
  return ATTEMPT_ID_PATTERN.test(raw) ? raw : null
}

/**
 * Enregistre le début d'une tentative de confirmation et renvoie de quoi marquer son
 * issue. Le suivi est « au mieux » : un échec d'écriture ne doit jamais bloquer la
 * confirmation elle-même.
 */
async function beginConfirmationAttempt(input: {
  attemptId: string
  storeId: string
  orderId: string
  userId: string
  action: string
}): Promise<AttemptHandle | null> {
  try {
    const { error } = await createAdminClient().from('confirmation_action_attempts').insert({
      attempt_id: input.attemptId,
      store_id: input.storeId,
      order_id: input.orderId,
      actor_user_id: input.userId,
      action: input.action,
      state: 'in_progress',
    })

    // 23505 : la même tentative a déjà été enregistrée (renvoi du client) : on la reprend.
    if (error && error.code !== '23505') {
      console.error('CONFIRMATION_ATTEMPT_START_FAILED', error)
      return null
    }
  } catch (error) {
    console.error('CONFIRMATION_ATTEMPT_START_FAILED', error)
    return null
  }

  const setState = async (state: 'succeeded' | 'failed', message: string | null) => {
    try {
      await createAdminClient()
        .from('confirmation_action_attempts')
        .update({ state, error: message, updated_at: new Date().toISOString() })
        .eq('attempt_id', input.attemptId)
    } catch (error) {
      console.error('CONFIRMATION_ATTEMPT_UPDATE_FAILED', error)
    }
  }

  return {
    succeed: () => setState('succeeded', null),
    fail: (message) => setState('failed', message ? String(message).slice(0, 500) : null),
  }
}

function toNullableString(value: unknown) {
  const text = String(value ?? '').trim()
  return text || null
}

type ConfirmationActionBody = {
  orderId?: string
  action?: string
  callbackAt?: string | null
  reasonCode?: string | null
  note?: string | null
  expectedStatus?: string | null
  expectedAttemptCount?: number | null
  deliveryMode?: 'internal' | 'shipping' | null
  deliveryCompanyId?: string | null
  /** Paramètres colis du transporteur, validés côté serveur avant usage. */
  deliveryOptions?: unknown
  /** Demande un flux de progression (Server-Sent Events) pendant la confirmation. */
  stream?: boolean
  /** Identifiant unique de la tentative (fourni par le client) pour suivre son état. */
  attemptId?: string | null
}

type ProgressReporter = (stage: ConfirmationProgressStage) => void

/** Résultat interne d'une action : statut HTTP + corps JSON renvoyé au client. */
type ActionOutcome = { status: number; payload: Record<string, unknown> }

/** Transporteurs dont la ville est normalisée automatiquement (alias / IA). */
const CITY_NORMALIZED_PROVIDERS: Record<string, string> = {
  'rapid-delivery': 'rapid-delivery',
  'maroc-go-delivery': 'maroc-go-delivery',
  rushliv: 'rushliv',
  digylog: 'digylog',
}

function resolveCityNormalizationSlug(apiProvider: string | null | undefined): string | null {
  const slug = String(apiProvider || '').trim().toLowerCase()
  return CITY_NORMALIZED_PROVIDERS[slug] || null
}

/**
 * Exécute l'action en suivant l'éventuelle tentative de confirmation : son issue
 * (réussite / échec) est consignée pour que la relecture, après une coupure réseau,
 * sache distinguer « en cours » de « jamais appliquée ».
 */
async function runConfirmationAction(
  request: Request,
  body: ConfirmationActionBody,
  report: ProgressReporter
): Promise<ActionOutcome> {
  const attemptRef: { current: AttemptHandle | null } = { current: null }

  const outcome = await runConfirmationActionCore(request, body, report, (handle) => {
    attemptRef.current = handle
  })

  const attempt = attemptRef.current
  if (attempt) {
    if (outcome.status >= 200 && outcome.status < 300) {
      await attempt.succeed()
    } else {
      await attempt.fail(String(outcome.payload?.error || 'CONFIRMATION_ACTION_FAILED'))
    }
  }

  return outcome
}

/**
 * Exécute réellement l'action de confirmation. Le reporter propage les étapes
 * véritablement atteintes (validation, confirmation, recherche ville, IA, colis).
 */
async function runConfirmationActionCore(
  request: Request,
  body: ConfirmationActionBody,
  report: ProgressReporter,
  onAttempt: (handle: AttemptHandle) => void
): Promise<ActionOutcome> {
  try {
    const { supabase, user } = await requireAuthenticatedUser()

    report('validating')

    const orderId = String(body.orderId || '').trim()
    if (!orderId) {
      return { status: 400, payload: { error: 'MISSING_ORDER_ID' } }
    }

    const action = String(body.action || '').trim().toUpperCase() as ConfirmationAction
    if (!ALLOWED_ACTIONS.includes(action)) {
      return { status: 400, payload: { error: 'INVALID_ACTION' } }
    }

    let callbackIso: string | null = null
    if (body.callbackAt) {
      const callbackDate = new Date(body.callbackAt)
      if (Number.isNaN(callbackDate.getTime())) {
        return { status: 400, payload: { error: 'INVALID_CALLBACK_DATETIME' } }
      }
      callbackIso = callbackDate.toISOString()
    }

    // Nombre de tentatives que le client croyait afficher : sert à détecter
    // qu'un autre agent a déjà traité la commande entre-temps.
    const rawExpected = body.expectedAttemptCount
    const parsedExpected = rawExpected === null || rawExpected === undefined ? null : Number(rawExpected)
    const expectedAttemptCount =
      parsedExpected !== null && Number.isFinite(parsedExpected) ? Math.trunc(parsedExpected) : null

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, store_id, status, delivery_company_id, tracking_number, confirmation_agent_id')
      .eq('id', orderId)
      .maybeSingle()

    if (orderError) throw orderError
    if (!order) {
      return { status: 404, payload: { error: 'ORDER_NOT_FOUND' } }
    }

    const member = await verifyStoreAccess(supabase, user.id, order.store_id)
    if (!hasPermission(member.role as Role, 'confirmation.process')) {
      return { status: 403, payload: { error: 'FORBIDDEN' } }
    }

    // Suivi de la tentative : après une coupure réseau, le statut de la commande seul
    // ne dit pas si la confirmation est encore en cours ou n'a jamais été appliquée.
    // On consigne donc le démarrage (puis l'issue) de cette tentative.
    const attemptId = action === 'CONFIRM' ? normalizeAttemptId(body.attemptId) : null
    if (attemptId) {
      const handle = await beginConfirmationAttempt({
        attemptId,
        storeId: order.store_id,
        orderId,
        userId: user.id,
        action,
      })
      if (handle) onAttempt(handle)
    }

    // Garde-fou serveur : la fenêtre de confirmation valide déjà ces informations,
    // mais un appel direct à l'API ne doit pas pouvoir confirmer une commande
    // incomplète (téléphone, ville, au moins un produit).
    if (action === 'CONFIRM') {
      const { data: readiness, error: readinessError } = await supabase
        .from('orders')
        .select('id, phone, city, order_items(id)')
        .eq('id', orderId)
        .maybeSingle()

      if (readinessError) throw readinessError
      if (!readiness) {
        return { status: 404, payload: { error: 'ORDER_NOT_FOUND' } }
      }
      if (!toNullableString(readiness.phone)) {
        return { status: 400, payload: { error: 'MISSING_PHONE' } }
      }
      if (!toNullableString(readiness.city)) {
        return { status: 400, payload: { error: 'MISSING_CITY' } }
      }
      if (((readiness.order_items || []) as unknown[]).length === 0) {
        return { status: 400, payload: { error: 'MISSING_ITEMS' } }
      }
    }

    // Choix de livraison : l'agent doit explicitement opter pour la livraison
    // interne ou pour une société du store au moment de confirmer.
    let resolvedDeliveryMode: 'internal' | 'shipping' = order.delivery_company_id
      ? 'shipping'
      : 'internal'
    let resolvedDeliveryCompanyId: string | null = order.delivery_company_id || null
    let resolvedProvider: ConfirmationDeliveryProvider | null = null
    let resolvedApiProvider: string | null = null
    let deliveryOptions: ConfirmationDeliveryOptions = {}

    if (action === 'CONFIRM') {
      const requestedMode = String(body.deliveryMode || '').trim()

      if (requestedMode === 'internal') {
        resolvedDeliveryMode = 'internal'
        resolvedDeliveryCompanyId = null
      } else if (requestedMode === 'shipping') {
        const companyId = toNullableString(body.deliveryCompanyId)
        if (!companyId) {
          return { status: 400, payload: { error: 'MISSING_DELIVERY_COMPANY' } }
        }

        const { data: company, error: companyError } = await supabase
          .from('delivery_companies')
          .select('id, api_provider')
          .eq('id', companyId)
          .eq('store_id', order.store_id)
          .maybeSingle()

        if (companyError) throw companyError
        if (!company) {
          return { status: 400, payload: { error: 'DELIVERY_COMPANY_NOT_IN_STORE' } }
        }

        resolvedDeliveryMode = 'shipping'
        resolvedDeliveryCompanyId = companyId
        resolvedApiProvider = company.api_provider || null
        resolvedProvider = resolveDeliveryProvider(company.api_provider)
      } else {
        return { status: 400, payload: { error: 'MISSING_DELIVERY_COMPANY' } }
      }

      // Le transporteur réel vient de la base, jamais du client : on ne conserve
      // que les champs de ce transporteur, avec des types sûrs.
      const sanitized = sanitizeDeliveryOptions(resolvedProvider, body.deliveryOptions)
      if (sanitized.error) {
        return { status: 400, payload: { error: sanitized.error } }
      }
      deliveryOptions = sanitized.options

      // Ville obligatoire pour les transporteurs à catalogue : elle doit exister
      // dans `delivery_rates` du provider concerné.
      const catalogueId = deliveryProviderCatalogueId(resolvedProvider)
      const cityKey = deliveryCityKeyOf(resolvedProvider, deliveryOptions)
      if (catalogueId && cityKey) {
        const { data: rate, error: rateError } = await createAdminClient()
          .from('delivery_rates')
          .select('external_city_key')
          .eq('provider_id', catalogueId)
          .eq('external_city_key', cityKey)
          .maybeSingle()

        if (rateError) throw rateError
        if (!rate) {
          return { status: 400, payload: { error: 'DELIVERY_CITY_NOT_AVAILABLE' } }
        }
      }
    }

    const { data: rpcData, error: rpcError } = await supabase.rpc('rpc_order_confirmation_action', {
      p_order_id: orderId,
      p_action: action,
      p_callback_at: callbackIso,
      p_reason_code: toNullableString(body.reasonCode),
      p_note: toNullableString(body.note),
      p_expected_status: toNullableString(body.expectedStatus),
      p_expected_attempt_count: expectedAttemptCount,
    })

    if (rpcError) {
      const message = rpcError.message || 'CONFIRMATION_ACTION_FAILED'
      return { status: resolveConfirmationErrorStatus(message), payload: { error: message } }
    }

    const result = (rpcData || {}) as ConfirmationActionResponse

    // À partir d'ici la commande est confirmée côté base : on l'annonce même si
    // la création du colis échoue ensuite.
    if (action === 'CONFIRM') {
      report('confirmed')
    }

    let parcel: ParcelResult | undefined

    // La confirmation applique toujours le mode de livraison choisi : c'est cette
    // route qui détache un ancien transporteur en livraison interne, et qui crée
    // le colis en mode transporteur externe.
    if (action === 'CONFIRM') {
      const willCreateParcel = resolvedDeliveryMode === 'shipping' && !order.tracking_number
      // Normalisation de la ville faite ici, une seule fois, par le même pipeline que
      // `/api/orders/status` : les étapes rapportées sont donc réelles et le statut
      // réutilise ensuite le résultat au lieu de recalculer la ville.
      let cityNormalized = false

      if (willCreateParcel) {
        const normalizationSlug = resolveCityNormalizationSlug(resolvedApiProvider)
        if (normalizationSlug) {
          report('city_search')
          try {
            await normalizeOrderCityById(orderId, createAdminClient(), normalizationSlug, () =>
              report('city_ai')
            )
            // La ville n'est considérée comme normalisée qu'une fois le pipeline terminé :
            // en cas d'échec, `/api/orders/status` peut relancer la normalisation au lieu
            // de la sauter.
            cityNormalized = true
          } catch (normalizationError) {
            // Non bloquant : `/api/orders/status` gère lui-même l'absence de ville.
            console.error('CONFIRMATION_CITY_NORMALIZATION_FAILED', normalizationError)
          }
        }

        report('parcel')
      }

      parcel = await triggerParcelCreation(
        request,
        orderId,
        toNullableString(body.note) || '',
        resolvedDeliveryCompanyId,
        resolvedDeliveryMode,
        deliveryOptions,
        cityNormalized
      )

      if (willCreateParcel) {
        await logParcelEvent({
          storeId: order.store_id,
          orderId,
          userId: user.id,
          agentId: order.confirmation_agent_id || null,
          status: String(result.status || 'confirmed'),
          parcel,
        })
      }
    }

    return { status: 200, payload: { ...result, parcel } }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CONFIRMATION_ACTION_FAILED'
    return { status: getConfirmationErrorStatus(message), payload: { error: message } }
  }
}

/** Événements diffusés sur le flux SSE de confirmation. */
type ConfirmationStreamEvent =
  | { type: 'progress'; stage: ConfirmationProgressStage }
  | { type: 'result'; result: Record<string, unknown> }
  | { type: 'error'; error: string }

/**
 * Diffuse la progression réelle de la confirmation en Server-Sent Events :
 * chaque étape correspond à un travail effectivement terminé côté serveur,
 * puis un unique événement terminal (`result` ou `error`) clôt le flux.
 */
function buildStreamResponse(request: Request, body: ConfirmationActionBody): Response {
  const encoder = new TextEncoder()
  const queue: string[] = []
  let finished = false
  let notify: (() => void) | null = null

  const emit = (event: ConfirmationStreamEvent) => {
    queue.push(`data: ${JSON.stringify(event)}\n\n`)
    notify?.()
    notify = null
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      void runConfirmationAction(request, body, (stage) => emit({ type: 'progress', stage }))
        .then(({ status, payload }) => {
          if (status >= 200 && status < 300) {
            emit({ type: 'result', result: payload })
          } else {
            emit({ type: 'error', error: String(payload?.error || 'CONFIRMATION_ACTION_FAILED') })
          }
        })
        .catch((error) => {
          emit({
            type: 'error',
            error: error instanceof Error ? error.message : 'CONFIRMATION_ACTION_FAILED',
          })
        })
        .finally(() => {
          finished = true
          notify?.()
          notify = null
        })

      while (!finished || queue.length > 0) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            notify = () => resolve()
          })
          continue
        }
        controller.enqueue(encoder.encode(queue.shift() as string))
      }

      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as ConfirmationActionBody

  const wantsStream =
    body.stream === true || (request.headers.get('accept') || '').includes('text/event-stream')

  if (wantsStream) {
    return buildStreamResponse(request, body)
  }

  const { status, payload } = await runConfirmationAction(request, body, () => {})
  return NextResponse.json(payload, { status })
}

/**
 * Relit l'état réel d'une commande et, si `attemptId` est fourni, l'état de la
 * tentative de confirmation correspondante : utilisé lorsqu'un flux a été coupé sans
 * verdict, pour déterminer si la confirmation a été appliquée, est encore en cours,
 * ou n'a jamais été enregistrée avant d'autoriser (ou non) une nouvelle tentative.
 */
export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const searchParams = new URL(request.url).searchParams
    const orderId = String(searchParams.get('orderId') || '').trim()
    const attemptId = normalizeAttemptId(searchParams.get('attemptId'))

    if (!orderId) {
      return NextResponse.json({ error: 'MISSING_ORDER_ID' }, { status: 400 })
    }

    const { data: order, error } = await supabase
      .from('orders')
      .select('id, store_id, status, tracking_number, confirmation_attempt_count')
      .eq('id', orderId)
      .maybeSingle()

    if (error) throw error
    if (!order) {
      return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 })
    }

    const member = await verifyStoreAccess(supabase, user.id, order.store_id)
    if (!hasPermission(member.role as Role, 'confirmation.view')) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }

    let attempt: { state: string; error: string | null } | null = null
    if (attemptId) {
      const { data: attemptRow, error: attemptError } = await supabase
        .from('confirmation_action_attempts')
        .select('state, error')
        .eq('attempt_id', attemptId)
        .eq('order_id', orderId)
        .maybeSingle()

      if (attemptError) throw attemptError
      attempt = attemptRow || null
    }

    return NextResponse.json({ order, attempt })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CONFIRMATION_STATE_FETCH_FAILED'
    return NextResponse.json({ error: message }, { status: getConfirmationErrorStatus(message) })
  }
}
