import { NextResponse } from 'next/server'
import { getOrCreateWallet, toWalletSnapshot } from '@/lib/assistant/credits'
import { assertAssistantAccess } from '@/lib/assistant/access'
import { requireAssistantPermission, requireAuthenticatedUser, toPublicError } from '@/lib/assistant/security'

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    // Pilote privé : verrou global + allowlist AVANT toute lecture de portefeuille.
    assertAssistantAccess(user.id)

    const { searchParams } = new URL(request.url)
    const storeId = (searchParams.get('storeId') || '').trim() || null

    // Le portefeuille est informatif : la permission d'usage suffit, le niveau
    // financier n'est pas requis pour afficher un solde de crédits.
    await requireAssistantPermission(supabase, user.id, storeId)

    const wallet = await getOrCreateWallet(supabase)
    const snapshot = toWalletSnapshot(wallet)

    return NextResponse.json({ wallet: snapshot })
  } catch (error) {
    const publicError = toPublicError(error)
    return NextResponse.json(
      { error: publicError.code, message: publicError.message },
      { status: publicError.status }
    )
  }
}
