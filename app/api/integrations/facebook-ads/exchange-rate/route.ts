import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'

export async function POST(request: Request) {
  try {
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

    // Upsert le taux de change manuel
    const { error } = await admin.from('exchange_rates').upsert({
      owner_user_id: user.id,
      base_currency: baseCurrency,
      target_currency: targetCurrency,
      rate,
      rate_date: new Date().toISOString().slice(0, 10),
      source_type: 'manual',
    }, {
      onConflict: 'owner_user_id,base_currency,target_currency,rate_date',
      ignoreDuplicates: false,
    })

    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'EXCHANGE_RATE_SAVE_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
