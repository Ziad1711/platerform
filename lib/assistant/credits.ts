import type { WalletSnapshot } from '@/lib/assistant/types'
import { createClient } from '@/lib/supabase/server'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

/**
 * Crédits d'une requête.
 *
 * Un usage strictement nul ne produit **aucun** crédit : l'ancien plancher à
 * `1` transformait un échec fournisseur (0 token) en débit réel. Le plancher ne
 * subsiste que pour un usage non nul, afin de conserver la tarification
 * commerciale existante (1 crédit minimum par échange consommé).
 */
export function computeCreditsUsed(inputTokens: number, outputTokens: number) {
  const input = Math.max(0, Math.trunc(Number(inputTokens) || 0))
  const output = Math.max(0, Math.trunc(Number(outputTokens) || 0))
  const total = input + output
  if (total <= 0) return 0
  return Math.max(1, Math.ceil(total / 25))
}

/**
 * Nature réelle d'un tour de conversation, telle que décidée par l'orchestrateur.
 *
 * - `provider`      : le fournisseur a répondu, usage mesuré ;
 * - `deterministic` : réponse calculée localement, aucun appel fournisseur ;
 * - `provider_failed`: appel tenté, aucune réponse exploitable ;
 * - `cancelled`     : requête abandonnée (timeout, déconnexion) avant réponse.
 */
export type AssistantUsageKind = 'provider' | 'deterministic' | 'provider_failed' | 'cancelled'

export interface AssistantUsageInput {
  kind: AssistantUsageKind
  inputTokens?: number | null
  outputTokens?: number | null
  /** `false` dès qu'une valeur de token n'est pas un entier mesuré. */
  usageKnown?: boolean
}

export interface AssistantUsageBilling {
  kind: AssistantUsageKind
  /** Consommation réelle retenue pour le journal (jamais inventée). */
  creditsConsumed: number
  /** `true` seulement si un débit est justifié par un usage mesuré. */
  billable: boolean
  /** `false` quand les tokens sont inconnus : à ne jamais lire comme « zéro ». */
  usageKnown: boolean
  reason: 'measured' | 'no_provider_call' | 'no_usage' | 'usage_unknown' | 'cancelled'
}

const MEASURED_INTEGER = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/**
 * Décide ce qui est consommé et ce qui est facturable.
 *
 * Règles conservatrices, sans nouvelle tarification :
 * 1. annulation ⇒ rien n'est consommé ni facturé ;
 * 2. réponse déterministe ⇒ aucun crédit (aucun appel fournisseur) ;
 * 3. fournisseur avec usage mesuré ⇒ crédits calculés sur les tokens réels ;
 * 4. fournisseur avec usage inconnu ⇒ rien n'est facturé, la consommation reste
 *    nulle mais `usageKnown = false` interdit de la présenter comme un zéro ;
 * 5. échec fournisseur sans réponse ⇒ rien n'est facturé.
 */
export function resolveUsageBilling(input: AssistantUsageInput): AssistantUsageBilling {
  if (input.kind === 'cancelled') {
    return { kind: input.kind, creditsConsumed: 0, billable: false, usageKnown: false, reason: 'cancelled' }
  }
  if (input.kind === 'deterministic') {
    return { kind: input.kind, creditsConsumed: 0, billable: false, usageKnown: true, reason: 'no_provider_call' }
  }
  if (input.kind === 'provider_failed') {
    return { kind: input.kind, creditsConsumed: 0, billable: false, usageKnown: input.usageKnown === true, reason: 'no_usage' }
  }

  const measured = MEASURED_INTEGER(input.inputTokens) && MEASURED_INTEGER(input.outputTokens)
  if (input.usageKnown === false || !measured) {
    return { kind: input.kind, creditsConsumed: 0, billable: false, usageKnown: false, reason: 'usage_unknown' }
  }

  const creditsConsumed = computeCreditsUsed(input.inputTokens ?? 0, input.outputTokens ?? 0)
  if (creditsConsumed === 0) {
    return { kind: input.kind, creditsConsumed: 0, billable: false, usageKnown: true, reason: 'no_usage' }
  }
  return { kind: input.kind, creditsConsumed, billable: true, usageKnown: true, reason: 'measured' }
}

/** Un usage fournisseur réellement mesuré (jamais un repli interne). */
export function isMeasuredProviderUsage(usage: {
  providerName?: string | null
  inputTokens?: number | null
  outputTokens?: number | null
}): boolean {
  const provider = String(usage.providerName ?? '').trim().toLowerCase()
  if (!provider || provider === 'engine' || provider === 'none') return false
  return MEASURED_INTEGER(usage.inputTokens) && MEASURED_INTEGER(usage.outputTokens)
}

/** Nature du tour, déduite du résultat réellement produit par l'orchestrateur. */
export function resolveUsageKind(input: {
  cancelled: boolean
  providerName?: string | null
  providerFailed?: boolean
}): AssistantUsageKind {
  if (input.cancelled) return 'cancelled'
  if (input.providerFailed) return 'provider_failed'
  const provider = String(input.providerName ?? '').trim().toLowerCase()
  if (!provider || provider === 'engine' || provider === 'none') return 'deterministic'
  return 'provider'
}

export function estimateCreditsForPrompt(parts: string[], expectedOutputTokens = 500) {
  const inputChars = parts.join(' ').length
  const estimatedInputTokens = Math.ceil(inputChars / 4)
  return computeCreditsUsed(estimatedInputTokens, expectedOutputTokens)
}

/**
 * Pré-réservation d'une requête complète : message, historique et réserve pour
 * le prompt système et les résultats d'outils (non mesurables avant l'appel).
 * Cette estimation sert uniquement de garde-fou avant l'appel IA ; le débit
 * final reste calculé sur les tokens réellement consommés.
 */
export function estimateCreditsForRequest(input: {
  message: string
  history: string[]
  reserveInputTokens?: number
  expectedOutputTokens?: number
}) {
  const chars =
    String(input.message || '').length +
    (input.history || []).reduce((sum, item) => sum + String(item || '').length, 0)
  const estimatedInputTokens =
    Math.ceil(chars / 4) + Math.max(0, Math.trunc(input.reserveInputTokens || 0))
  const expectedOutputTokens = Math.max(1, Math.trunc(input.expectedOutputTokens || 500))

  return computeCreditsUsed(estimatedInputTokens, expectedOutputTokens)
}

/**
 * Portefeuille de crédits IA : création, recharge mensuelle et débit passent
 * exclusivement par les fonctions serveur (`rpc_ensure_ai_credit_wallet`,
 * `rpc_debit_ai_credits`). Le client n'a plus le droit d'écrire directement dans
 * `ai_credit_wallets` (voir migration 20260928020200).
 */
export async function getOrCreateWallet(supabase: SupabaseServerClient) {
  const { data, error } = await supabase.rpc('rpc_ensure_ai_credit_wallet')

  if (error) {
    throw new Error('WALLET_FETCH_FAILED')
  }

  const row = Array.isArray(data) ? data[0] : data

  if (!row) {
    throw new Error('WALLET_CREATE_FAILED')
  }

  return {
    id: String(row.wallet_id),
    monthly_credits: Number(row.monthly_credits || 0),
    credits_used: Number(row.credits_used || 0),
  }
}

export function toWalletSnapshot(wallet: { monthly_credits: number; credits_used: number }): WalletSnapshot {
  const monthlyCredits = Number(wallet.monthly_credits || 0)
  const creditsUsed = Number(wallet.credits_used || 0)
  const remainingCredits = Math.max(0, monthlyCredits - creditsUsed)

  return {
    monthlyCredits,
    creditsUsed,
    remainingCredits,
  }
}

export async function ensureCreditsAvailable(supabase: SupabaseServerClient, requiredCredits: number) {
  const wallet = await getOrCreateWallet(supabase)
  const snapshot = toWalletSnapshot(wallet)

  if (snapshot.remainingCredits < requiredCredits) {
    throw new Error('INSUFFICIENT_CREDITS')
  }

  return { wallet, snapshot }
}

export async function debitCredits(supabase: SupabaseServerClient, creditsUsed: number) {
  const { error } = await supabase.rpc('rpc_debit_ai_credits', {
    p_credits: Math.max(0, Math.round(Number(creditsUsed || 0))),
  })

  if (error) {
    throw new Error(error.message?.includes('INSUFFICIENT_CREDITS') ? 'INSUFFICIENT_CREDITS' : 'WALLET_DEBIT_FAILED')
  }
}

export type CreditChargeStatus = 'charged' | 'insufficient' | 'failed'

/** Réservation de crédits persistante — activable uniquement après migration. */
export const ASSISTANT_CREDIT_RESERVATION_ENABLED =
  (process.env.ASSISTANT_CREDIT_RESERVATION || '').trim().toLowerCase() === 'enabled'

export const ASSISTANT_CREDIT_RPC = {
  reserve: 'rpc_assistant_reserve_credits',
  release: 'rpc_assistant_release_credits',
} as const

export type CreditReservationStatus = 'reserved' | 'unavailable'

/**
 * Réserve un montant de crédits pour une requête identifiée.
 *
 * Sans la migration correspondante, la fonction ne fait aucun appel et renvoie
 * `unavailable` : le pré-contrôle existant reste la seule protection, et
 * l'absence de garantie inter-instances est explicite.
 */
/**
 * Réservation de crédits — INFORMATIVE, jamais un verrou financier.
 *
 * Elle exige le jeton de tentative du registre (identité + bail vérifiés en
 * base) et n'immobilise aucun solde : seule la finalisation atomique débite.
 * Sans jeton, la réservation est refusée (`unavailable`) : aucun chemin ne peut
 * présenter un solde « réservé » comme garantie.
 */
export async function reserveCreditsForRequest(
  supabase: SupabaseServerClient,
  credits: number,
  identity: { requestId: string; attemptToken: string | null }
): Promise<{ status: CreditReservationStatus }> {
  const amount = Math.max(0, Math.round(Number(credits || 0)))
  if (!ASSISTANT_CREDIT_RESERVATION_ENABLED || amount === 0) return { status: 'unavailable' }
  if (!identity.attemptToken) return { status: 'unavailable' }

  const { error } = await supabase.rpc(ASSISTANT_CREDIT_RPC.reserve, {
    p_request_id: identity.requestId,
    p_attempt_token: identity.attemptToken,
    p_credits: amount,
  })

  return error ? { status: 'unavailable' } : { status: 'reserved' }
}

/** Libère une réservation lorsque la requête n'a pas produit de réponse facturable. */
export async function releaseCreditReservation(
  supabase: SupabaseServerClient,
  identity: { requestId: string; attemptToken: string | null }
): Promise<boolean> {
  if (!ASSISTANT_CREDIT_RESERVATION_ENABLED || !identity.attemptToken) return false

  const { error } = await supabase.rpc(ASSISTANT_CREDIT_RPC.release, {
    p_request_id: identity.requestId,
    p_attempt_token: identity.attemptToken,
  })
  return !error
}

/**
 * Débit non bloquant pour la réponse : le statut réel est remonté au client au
 * lieu d'être masqué. Le débit reste atomique côté base (`rpc_debit_ai_credits`).
 */
export async function chargeCredits(
  supabase: SupabaseServerClient,
  creditsUsed: number
): Promise<{ status: CreditChargeStatus }> {
  const amount = Math.max(0, Math.round(Number(creditsUsed || 0)))
  if (amount === 0) return { status: 'charged' }

  try {
    await debitCredits(supabase, amount)
    return { status: 'charged' }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'INSUFFICIENT_CREDITS') return { status: 'insufficient' }
    return { status: 'failed' }
  }
}
