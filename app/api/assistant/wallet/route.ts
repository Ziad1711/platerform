import { NextResponse } from 'next/server'
import { getOrCreateWallet, toWalletSnapshot } from '@/lib/assistant/credits'
import { getErrorStatus, requireAuthenticatedUser } from '@/lib/assistant/security'

export async function GET() {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const wallet = await getOrCreateWallet(supabase, user.id)
    const snapshot = toWalletSnapshot(wallet)

    return NextResponse.json({ wallet: snapshot })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'UNKNOWN_ERROR' },
      { status: getErrorStatus(error) }
    )
  }
}
