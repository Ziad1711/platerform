import { NextResponse } from 'next/server'
import { requireAuthenticatedUser } from '@/lib/assistant/security'

export async function GET() {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const { data, error } = await supabase
      .from('exchange_rates')
      .select('id, base_currency, target_currency, rate, rate_date, source_type, created_at')
      .eq('owner_user_id', user.id)
      .order('rate_date', { ascending: false })
      .order('created_at', { ascending: false })

    if (error) throw error
    return NextResponse.json({ rates: data || [] })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'EXCHANGE_RATES_FETCH_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as {
      baseCurrency?: string
      targetCurrency?: string
      rate?: number
    }

    const baseCurrency = String(body.baseCurrency || '').trim().toUpperCase()
    const targetCurrency = String(body.targetCurrency || '').trim().toUpperCase()
    const rate = Number(body.rate || 0)

    if (!baseCurrency || !targetCurrency) return NextResponse.json({ error: 'MISSING_CURRENCY' }, { status: 400 })
    if (rate <= 0) return NextResponse.json({ error: 'INVALID_RATE' }, { status: 400 })
    if (baseCurrency === targetCurrency) return NextResponse.json({ error: 'IDENTICAL_CURRENCY_PAIR' }, { status: 400 })

    const rateDate = new Date().toISOString().slice(0, 10)
    const { error } = await supabase
      .from('exchange_rates')
      .upsert(
        {
          owner_user_id: user.id,
          base_currency: baseCurrency,
          target_currency: targetCurrency,
          rate,
          rate_date: rateDate,
          source_type: 'manual',
        },
        {
          onConflict: 'owner_user_id,base_currency,target_currency,rate_date',
          ignoreDuplicates: false,
        }
      )

    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'EXCHANGE_RATE_SAVE_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const { searchParams } = new URL(request.url)
    const id = String(searchParams.get('id') || '').trim()

    if (!id) return NextResponse.json({ error: 'MISSING_RATE_ID' }, { status: 400 })

    const { error } = await supabase
      .from('exchange_rates')
      .delete()
      .eq('id', id)
      .eq('owner_user_id', user.id)

    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'EXCHANGE_RATE_DELETE_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
