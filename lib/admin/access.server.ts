import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { ZodError } from 'zod'

export type AdminContext = { allowed: boolean; permissions?: string[]; strong?: boolean }

/** Aucun cache inter-requêtes : la base relit l'habilitation à chaque appel. */
export async function adminContext() {
  const supabase = await createClient()
  const { data: identity, error: identityError } = await supabase.auth.getUser()
  if (identityError || !identity.user) throw new Error('ADMIN_AUTH')
  const { data, error } = await supabase.rpc('rpc_saas_admin_context')
  if (error) throw new Error('ADMIN_UNAVAILABLE')
  const context = data as AdminContext
  if (!context?.allowed) throw new Error('ADMIN_FORBIDDEN')
  return { supabase, context }
}

export async function requireAdmin(permission: string, sensitive = true) {
  const result = await adminContext()
  if (!result.context.permissions?.includes(permission)) throw new Error('ADMIN_FORBIDDEN')
  if (sensitive && !result.context.strong) throw new Error('ADMIN_MFA_REQUIRED')
  return result
}

export function assertAdminOrigin(request: Request) {
  const origin = new URL(process.env.NEXT_PUBLIC_APP_URL || request.url).origin
  if (request.headers.get('origin') !== origin || request.headers.get('sec-fetch-site') === 'cross-site') throw new Error('ADMIN_FORBIDDEN')
}

export function adminError(error: unknown) {
  const code = error instanceof ZodError || (error instanceof Error && error.message === 'invalid_period') ? 'ADMIN_INVALID' : error instanceof Error ? error.message : ''
  const conflicts: Record<string, string> = {
    FINANCE_CURRENCY: 'Les devises ne correspondent pas. Aucune conversion automatique n’est autorisée.',
    FINANCE_OVERPAYMENT: 'Le règlement ou remboursement dépasse le montant disponible.',
    FINANCE_IMMUTABLE: 'Écriture comptabilisée non modifiable. Utilisez une écriture compensatrice.',
    FINANCE_VERSION: 'Ce brouillon a changé ou est comptabilisé. Rechargez les données.',
    FINANCE_DUPLICATE: 'Référence déjà utilisée ou opération déjà compensée.',
    FINANCE_IDEMPOTENCY: 'Cette clé correspond à une autre opération.',
    FINANCE_PROOF_LIMIT: 'Trois justificatifs maximum par dépense.',
    PAYMENT_AMOUNT_MISMATCH: 'Le montant ou la devise ne correspond pas à la demande.',
    PAYMENT_BANK_REFERENCE_USED: 'Cette transaction bancaire est déjà rapprochée.',
    PAYMENT_IDEMPOTENCY_CONFLICT: 'Décision incompatible avec un traitement déjà enregistré.',
    PAYMENT_CLOSED: 'Cette demande est fermée ou expirée.',
    PAYMENT_SUBSCRIPTION_CONFLICT: 'Un abonnement existant nécessite un traitement manuel ; aucune période n’a été modifiée.',
    PAYMENT_SELF_APPROVAL: 'Vous ne pouvez pas valider votre propre demande.',
    BANK_PUBLIC_ENABLE_NOT_AUTHORIZED: 'L’activation publique du paiement n’est pas autorisée.',
  }
  if (conflicts[code]) return NextResponse.json({ error: conflicts[code] }, { status: 409, headers: { 'Cache-Control': 'no-store' } })
  const status = code === 'ADMIN_AUTH' ? 401 : code === 'PAYMENT_NOT_FOUND' || code === 'FINANCE_NOT_FOUND' ? 404 : code === 'ADMIN_RATE_LIMIT' ? 429 : code === 'ADMIN_FORBIDDEN' || code === 'ADMIN_MFA_REQUIRED' ? 403 : code === 'ADMIN_INVALID' ? 400 : 503
  const message = status === 401 ? 'Session absente ou expirée.' : code === 'ADMIN_MFA_REQUIRED' ? 'Vérification TOTP récente requise.' : status === 403 ? 'Accès plateforme refusé.' : status === 400 ? 'Paramètres invalides.' : 'Administration temporairement indisponible.'
  return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } })
}