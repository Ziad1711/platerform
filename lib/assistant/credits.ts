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

export async function getOrCreateWallet(supabase: SupabaseServerClient, userId: string) {
  const { data: existing, error } = await supabase
    .from('ai_credit_wallets')
    .select('id, monthly_credits, credits_used')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    throw new Error('WALLET_FETCH_FAILED')
  }

  if (existing) {
    return existing
  }

  const { data: created, error: createError } = await supabase
    .from('ai_credit_wallets')
    .insert({
      user_id: userId,
      monthly_credits: 0,
      credits_used: 0,
    })
    .select('id, monthly_credits, credits_used')
    .single()

  if (createError || !created) {
    throw new Error('WALLET_CREATE_FAILED')
  }

  return created
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

export async function ensureCreditsAvailable(supabase: SupabaseServerClient, userId: string, requiredCredits: number) {
  const wallet = await getOrCreateWallet(supabase, userId)
  const snapshot = toWalletSnapshot(wallet)

  if (snapshot.remainingCredits < requiredCredits) {
    throw new Error('INSUFFICIENT_CREDITS')
  }

  return { wallet, snapshot }
}

export async function debitCredits(supabase: SupabaseServerClient, walletId: string, currentCreditsUsed: number, creditsUsed: number) {
  const newCreditsUsed = Number(currentCreditsUsed || 0) + Number(creditsUsed || 0)

  const { error } = await supabase
    .from('ai_credit_wallets')
    .update({
      credits_used: newCreditsUsed,
      updated_at: new Date().toISOString(),
    })
    .eq('id', walletId)

  if (error) {
    throw new Error('WALLET_DEBIT_FAILED')
  }
}
