import type { WalletSnapshot } from '@/lib/assistant/types'
import { createClient } from '@/lib/supabase/server'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

export function computeCreditsUsed(inputTokens: number, outputTokens: number) {
  return Math.max(1, Math.ceil((Math.max(0, inputTokens) + Math.max(0, outputTokens)) / 25))
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
