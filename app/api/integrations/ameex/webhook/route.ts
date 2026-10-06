// ============================================================
// Webhook de suivi AMEEX
//
// Recoit les notifications de changement de statut de colis envoyees par
// AMEEX et met a jour la commande correspondante via la fonction metier
// partagee `applyAmeexStatusToOrder`.
//
// Politique de securite :
//  - AUCUNE ecriture (hors journal d'evenements) n'a lieu avant validation
//    de la signature HMAC ;
//  - si aucun secret n'est configure pour le store, l'evenement est refuse
//    (fail-closed) : le webhook reste inerte tant que le secret n'est pas
//    renseigne ;
//  - les erreurs ne sont jamais silencieuses : chaque evenement est journalise
//    dans `ameex_webhook_events` sans secret ni donnee personnelle.
//
// Role du journal : il est DIAGNOSTIQUE. L'idempotence reelle d'un evenement
// rejoue (et la protection des corrections manuelles) est assuree par
// l'ecriture conditionnelle de `applyAmeexStatusToOrder`, jamais par le
// journal : l'index unique `(integration_id, event_key)` se contente de ne pas
// dupliquer la ligne de trace.
// ============================================================

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAmeexWebhookSecret } from '@/lib/integrations/ameex-credentials'
import { resolveAmeexStatus } from '@/lib/integrations/ameex-status'
import {
  AMEEX_TRACKING_ORDER_COLUMNS,
  applyAmeexStatusToOrder,
  type AmeexTrackingOrder,
} from '@/lib/integrations/ameex-parcel-status'
import {
  verifyAmeexWebhookSignature,
  type AmeexSignatureCheck,
} from '@/lib/integrations/ameex-webhook-signature'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_BODY_BYTES = 64 * 1024

type AmeexWebhookFields = Record<string, string>

/** Recupere un champ sans tenir compte de la casse. */
function readField(fields: AmeexWebhookFields, name: string): string {
  const target = name.toUpperCase()
  for (const [key, value] of Object.entries(fields)) {
    if (key.toUpperCase() === target) return String(value || '').trim()
  }
  return ''
}

/** AMEEX peut encapsuler le payload dans un objet imbrique (ex: { payload: "{...}" }). */
function flattenPayload(input: unknown, depth = 0): AmeexWebhookFields | null {
  if (depth > 2 || input === null || typeof input !== 'object') return null
  const record = input as Record<string, unknown>

  const hasCodeField = Object.keys(record).some((key) => key.toUpperCase() === 'CODE')

  if (hasCodeField) {
    const fields: AmeexWebhookFields = {}
    for (const [key, value] of Object.entries(record)) {
      if (value === null || value === undefined || typeof value === 'object') continue
      fields[key] = String(value)
    }
    return fields
  }

  for (const value of Object.values(record)) {
    if (typeof value === 'string' && value.trim().startsWith('{')) {
      try {
        const nested = flattenPayload(JSON.parse(value), depth + 1)
        if (nested) return nested
      } catch {
        // valeur non JSON : ignoree
      }
    } else if (value && typeof value === 'object') {
      const nested = flattenPayload(value, depth + 1)
      if (nested) return nested
    }
  }

  return null
}

/**
 * Parse le corps du webhook. Le format documente est
 * `application/x-www-form-urlencoded` ; JSON est accepte par tolerance.
 */
function parseWebhookBody(rawBody: string, contentType: string): AmeexWebhookFields | null {
  const trimmed = rawBody.trim()
  if (!trimmed) return null

  if (contentType.includes('application/json') || trimmed.startsWith('{')) {
    try {
      return flattenPayload(JSON.parse(trimmed))
    } catch {
      return null
    }
  }

  const params = new URLSearchParams(trimmed)
  const fields: AmeexWebhookFields = {}
  params.forEach((value, key) => {
    fields[key] = value
  })

  return Object.keys(fields).length > 0 ? flattenPayload(fields) : null
}

type AdminClient = ReturnType<typeof createAdminClient>

type WebhookLogEntry = {
  integrationId?: string | null
  storeId?: string | null
  orderId?: string | null
  parcelCode: string
  statut?: string | null
  statutS?: string | null
  statusDate?: string | null
  eventKey?: string | null
  outcome: string
  signaturePresent: boolean
  signatureValid: boolean
  detail?: string | null
}

/** Date au format AAAA-MM-JJ (colonne `date`), sinon null. */
function toDateOnly(value: string): string | null {
  const raw = String(value || '').trim()
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null
}

/** Journalise l'evenement sans jamais faire echouer le webhook. */
async function logWebhookEvent(admin: AdminClient, entry: WebhookLogEntry): Promise<void> {
  try {
    const { error } = await admin.from('ameex_webhook_events').upsert(
      {
        integration_id: entry.integrationId ?? null,
        store_id: entry.storeId ?? null,
        order_id: entry.orderId ?? null,
        parcel_code: entry.parcelCode || '(inconnu)',
        statut: entry.statut ?? null,
        statut_s: entry.statutS ?? null,
        status_date: toDateOnly(entry.statusDate || ''),
        event_key: entry.eventKey ?? null,
        outcome: entry.outcome,
        signature_present: entry.signaturePresent,
        signature_valid: entry.signatureValid,
        error: entry.detail ?? null,
        processed_at: new Date().toISOString(),
      },
      { onConflict: 'integration_id,event_key', ignoreDuplicates: true },
    )

    if (error) console.error('AMEEX webhook log error:', error)
  } catch (error) {
    console.error('AMEEX webhook log error:', error)
  }
}

/** Verification de disponibilite (aucun acces base de donnees). */
export async function GET() {
  return NextResponse.json({ ok: true, provider: 'ameex', kind: 'tracking-webhook' })
}

export async function POST(request: Request) {
  const admin = createAdminClient()
  const contentType = (request.headers.get('content-type') || '').toLowerCase()

  // 1. Lecture du corps brut : indispensable pour verifier la signature.
  let rawBody = ''
  try {
    rawBody = await request.text()
  } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 })
  }

  if (rawBody.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE' }, { status: 413 })
  }

  // 2. Extraction des champs (aucune ecriture).
  const fields = parseWebhookBody(rawBody, contentType)
  const parcelCode = fields ? readField(fields, 'CODE') : ''
  const rawStatut = fields ? readField(fields, 'STATUT') : ''
  const rawStatutS = fields ? readField(fields, 'STATUT_S') : ''
  const statusDate = fields ? readField(fields, 'DATE') : ''

  if (!fields || !parcelCode) {
    await logWebhookEvent(admin, {
      parcelCode,
      statut: rawStatut || null,
      statutS: rawStatutS || null,
      statusDate,
      outcome: 'invalid_payload',
      signaturePresent: false,
      signatureValid: false,
      detail: `Payload AMEEX illisible ou CODE manquant (content-type: ${contentType || 'absent'})`,
    })
    return NextResponse.json({ error: 'INVALID_PAYLOAD' }, { status: 400 })
  }

  try {
    // 3. Recherche des commandes portant ce code colis (lecture seule).
    const { data: orderRows, error: orderError } = await admin
      .from('orders')
      .select(AMEEX_TRACKING_ORDER_COLUMNS)
      .eq('ameex_parcel_code', parcelCode)

    if (orderError) throw orderError

    const candidates = (orderRows || []) as unknown as AmeexTrackingOrder[]

    if (candidates.length === 0) {
      await logWebhookEvent(admin, {
        parcelCode,
        statut: rawStatut || null,
        statutS: rawStatutS || null,
        statusDate,
        outcome: 'parcel_not_found',
        signaturePresent: false,
        signatureValid: false,
        detail: 'Aucune commande associee a ce code colis',
      })
      return NextResponse.json({ ok: true })
    }

    // 4. Ne conserver que les commandes rattachees a un transporteur AMEEX
    //    (tolerance si la commande n'a pas encore de transporteur renseigne).
    const companyIds = Array.from(
      new Set(candidates.map((order) => String(order.delivery_company_id || '')).filter(Boolean)),
    )
    const ameexCompanyIds = new Set<string>()
    if (companyIds.length > 0) {
      const { data: companies, error: companiesError } = await admin
        .from('delivery_companies')
        .select('id, api_provider')
        .in('id', companyIds)

      if (companiesError) throw companiesError

      for (const company of companies || []) {
        if (String(company.api_provider || '').toLowerCase() === 'ameex') {
          ameexCompanyIds.add(String(company.id))
        }
      }
    }

    const ameexCandidates = candidates.filter(
      (order) =>
        !order.delivery_company_id || ameexCompanyIds.has(String(order.delivery_company_id)),
    )

    if (ameexCandidates.length === 0) {
      await logWebhookEvent(admin, {
        parcelCode,
        statut: rawStatut || null,
        statutS: rawStatutS || null,
        statusDate,
        outcome: 'not_delivery_company',
        signaturePresent: false,
        signatureValid: false,
        detail: 'La commande liee a ce colis n\'appartient pas a un transporteur AMEEX',
      })
      return NextResponse.json({ ok: true })
    }

    // 5. Verification de la signature, store par store (aucune ecriture).
    const storeIds = Array.from(new Set(ameexCandidates.map((order) => order.store_id)))

    const { data: integrations, error: integrationsError } = await admin
      .from('integrations')
      .select('id, store_id')
      .eq('provider', 'ameex')
      .in('store_id', storeIds)

    if (integrationsError) throw integrationsError

    const integrationByStore = new Map<string, string>()
    for (const integration of integrations || []) {
      integrationByStore.set(String(integration.store_id), String(integration.id))
    }

    const verified: Array<{ storeId: string; integrationId: string }> = []
    let anySecret = false
    let lastCheck: AmeexSignatureCheck | null = null

    for (const storeId of storeIds) {
      const integrationId = integrationByStore.get(storeId)
      if (!integrationId) continue

      const secret = await getAmeexWebhookSecret(admin, storeId)
      if (!secret) continue

      anySecret = true
      const check = verifyAmeexWebhookSignature({ rawBody, headers: request.headers, secret })
      lastCheck = check
      if (check.valid) verified.push({ storeId, integrationId })
    }

    if (!anySecret) {
      await logWebhookEvent(admin, {
        parcelCode,
        statut: rawStatut || null,
        statutS: rawStatutS || null,
        statusDate,
        outcome: 'no_secret_configured',
        signaturePresent: false,
        signatureValid: false,
        detail: 'Aucun secret de webhook AMEEX configure : evenement refuse',
      })
      return NextResponse.json({ error: 'WEBHOOK_NOT_CONFIGURED' }, { status: 503 })
    }

    if (verified.length === 0) {
      await logWebhookEvent(admin, {
        parcelCode,
        statut: rawStatut || null,
        statutS: rawStatutS || null,
        statusDate,
        outcome: lastCheck?.present ? 'signature_invalid' : 'signature_missing',
        signaturePresent: Boolean(lastCheck?.present),
        signatureValid: false,
        detail: lastCheck?.reason || 'Signature AMEEX absente ou invalide',
      })
      return NextResponse.json({ error: 'INVALID_SIGNATURE' }, { status: 401 })
    }

    if (verified.length > 1) {
      await logWebhookEvent(admin, {
        parcelCode,
        statut: rawStatut || null,
        statutS: rawStatutS || null,
        statusDate,
        outcome: 'parcel_ambiguous',
        signaturePresent: true,
        signatureValid: true,
        detail: 'Code colis present dans plusieurs stores : aucune mise a jour appliquee',
      })
      return NextResponse.json({ ok: true })
    }

    const target = verified[0]
    const targets = ameexCandidates.filter((order) => order.store_id === target.storeId)

    if (targets.length !== 1) {
      await logWebhookEvent(admin, {
        integrationId: target.integrationId,
        storeId: target.storeId,
        parcelCode,
        statut: rawStatut || null,
        statutS: rawStatutS || null,
        statusDate,
        outcome: 'parcel_ambiguous',
        signaturePresent: true,
        signatureValid: true,
        detail: `Code colis present sur ${targets.length} commandes du store : aucune mise a jour appliquee`,
      })
      return NextResponse.json({ ok: true })
    }

    // 6. Application du statut via la fonction metier partagee.
    const order = targets[0]
    const resolved = resolveAmeexStatus(rawStatut, rawStatutS || undefined)
    const result = await applyAmeexStatusToOrder({ admin, order, resolved, statusDate })

    await logWebhookEvent(admin, {
      integrationId: target.integrationId,
      storeId: target.storeId,
      orderId: order.id,
      parcelCode,
      statut: rawStatut || null,
      statutS: rawStatutS || null,
      statusDate,
      eventKey: [parcelCode, rawStatut, rawStatutS, statusDate].join('|'),
      outcome: result.outcome,
      signaturePresent: true,
      signatureValid: true,
      detail: result.detail,
    })

    await admin
      .from('ameex_configs')
      .update({ last_webhook_at: new Date().toISOString() })
      .eq('store_id', target.storeId)

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('AMEEX webhook error:', error)
    return NextResponse.json({ error: 'WEBHOOK_PROCESSING_FAILED' }, { status: 500 })
  }
}
