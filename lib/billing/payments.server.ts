import 'server-only'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { z } from 'zod'

export const paymentId = z.string().uuid()
export const requestFields = 'id,reference,plan_name,billing_period,duration_months,price_version,amount_minor,currency,status,created_at,expires_at,declared_at'
const slots = new Map<string, { at: number; count: number }>()

export async function paymentContext(request: Request, mutation = false) {
  if (mutation) {
    const expected = new URL(process.env.NEXT_PUBLIC_APP_URL || request.url).origin
    if (request.headers.get('origin') !== expected || request.headers.get('sec-fetch-site') === 'cross-site') {
      throw new Error('PAYMENT_ORIGIN')
    }
  }
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) throw new Error('PAYMENT_AUTH')
  if (mutation) {
    const now = Date.now()
    const key = data.user.id
    const slot = slots.get(key)
    if (slot && now - slot.at < 60_000) {
      if (++slot.count > 20) throw new Error('PAYMENT_RATE_LIMIT')
    } else slots.set(key, { at: now, count: 1 })
    if (slots.size > 2000) for (const [id, value] of slots) if (now - value.at >= 60_000) slots.delete(id)
  }
  return { user: data.user, supabase, backend: createAdminClient() }
}

/** Lecture bornée réelle, y compris si Content-Length est absent ou falsifié. */
export async function paymentBody(request: Request, maxBytes: number) {
  if (Number(request.headers.get('content-length') || 0) > maxBytes) throw new Error('PAYMENT_TOO_LARGE')
  const reader = request.body?.getReader()
  if (!reader) throw new Error('PAYMENT_INVALID')
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) { await reader.cancel(); throw new Error('PAYMENT_TOO_LARGE') }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

export async function paymentJson(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Error('PAYMENT_INVALID')
  try { return JSON.parse((await paymentBody(request, 4096)).toString('utf8')) as unknown }
  catch (error) { if (error instanceof Error && error.message === 'PAYMENT_TOO_LARGE') throw error; throw new Error('PAYMENT_INVALID') }
}

export async function paymentAction(backend: ReturnType<typeof createAdminClient>, userId: string, id: string, action: string, proof?: object) {
  paymentId.parse(id)
  const { data, error } = await backend.rpc('rpc_payment_action', {
    p_user: userId, p_request: id, p_action: action, p_proof: proof || null,
  })
  if (error) throw new Error(error.message)
  return data
}

export async function bankInstructions(backend: ReturnType<typeof createAdminClient>) {
  const { data, error } = await backend.from('billing_bank_settings').select('enabled,beneficiary,bank_name,rib,instructions').eq('id', true).single()
  if (error) throw error
  if (!data?.enabled || !data.beneficiary || !data.bank_name || !/^\d{24}$/.test(data.rib || '')) return { enabled: false as const }
  return data
}

export function paymentError(error: unknown) {
  const raw = error instanceof Error ? error.message : ''
  const code = error instanceof z.ZodError ? 'PAYMENT_INVALID' : raw
  const messages: Record<string, [number, string]> = {
    PAYMENT_AUTH: [401, 'Connectez-vous pour accéder à vos demandes.'],
    PAYMENT_ORIGIN: [403, 'Origine de la requête refusée.'],
    PAYMENT_NOT_FOUND: [404, 'Demande introuvable.'],
    PAYMENT_PRICE_UNAVAILABLE: [409, 'Ce tarif n’est plus disponible. Consultez les offres actuelles.'],
    PAYMENT_IDEMPOTENCY_CONFLICT: [409, 'Cette référence de soumission correspond à une autre sélection.'],
    PAYMENT_UNAVAILABLE: [409, 'Paiement indisponible : coordonnées bancaires officielles non configurées.'],
    PAYMENT_CLOSED: [409, 'Cette demande est fermée ou expirée.'],
    PAYMENT_RATE_LIMIT: [429, 'Trop de demandes. Réessayez ultérieurement.'],
    PAYMENT_PROOF_LIMIT: [429, 'Trois justificatifs maximum par demande.'],
    PAYMENT_TOO_LARGE: [413, 'Le justificatif doit faire au maximum 5 Mo.'],
    PAYMENT_INVALID: [400, 'Données ou fichier invalides. Formats autorisés : PDF, PNG ou JPEG.'],
  }
  const [status, message] = messages[code] || [503, 'Service de paiement temporairement indisponible.']
  return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } })
}

export function paymentResponse(data: object) {
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
}