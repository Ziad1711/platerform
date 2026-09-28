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
