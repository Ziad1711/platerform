import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, getErrorStatus, requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'

export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request)
    const { supabase, user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as {
      storeId?: string
      baseCurrency?: string
      targetCurrency?: string
      rate?: number
    }
    const storeId = String(body.storeId || '').trim()
    const baseCurrency = String(body.baseCurrency || '').trim().toUpperCase()
    const targetCurrency = String(body.targetCurrency || '').trim().toUpperCase()
    const rate = Number(body.rate || 0)

    if (!storeId) return NextResponse.json({ error: 'MISSING_STORE_ID' }, { status: 400 })
    if (!baseCurrency || !targetCurrency) return NextResponse.json({ error: 'MISSING_CURRENCY' }, { status: 400 })
    if (rate <= 0) return NextResponse.json({ error: 'INVALID_RATE' }, { status: 400 })

    await verifyStoreAccess(supabase, user.id, storeId)

    const admin = createAdminClient()
    const { data: store, error: storeError } = await admin
      .from('stores')
      .select('owner_user_id')
      .eq('id', storeId)
      .single()

    if (storeError) throw storeError

    // Le taux est global au propriétaire du store, y compris si un membre autorisé le configure.
    const { error } = await admin.from('exchange_rates').upsert({
      owner_user_id: store.owner_user_id,
      base_currency: baseCurrency,
      target_currency: targetCurrency,
      rate,
      // La première sync remonte au 1er janvier: le taux doit couvrir toute la période importée.
      rate_date: `${new Date().getUTCFullYear() - 1}-01-01`,
      source_type: 'manual',
    }, {
      onConflict: 'owner_user_id,base_currency,target_currency,rate_date',
      ignoreDuplicates: false,
    })

    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'EXCHANGE_RATE_SAVE_FAILED'
    return NextResponse.json({ error: message }, { status: getErrorStatus(error) })
  }
}
