import { NextResponse } from 'next/server'
import { requireAuthenticatedUser } from '@/lib/assistant/security'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  try {
    const { user } = await requireAuthenticatedUser()
    const admin = createAdminClient()
    const { data: owned, error: ownedErr } = await admin
      .from('stores')
      .select('id')
      .eq('owner_user_id', user.id)
      .limit(1)

    if (ownedErr) throw ownedErr

    const { data: member, error: memberErr } = await admin
      .from('store_members')
      .select('store_id')
      .eq('user_id', user.id)
      .limit(1)

    if (memberErr) throw memberErr

    const hasStores = (owned?.length || 0) + (member?.length || 0) > 0
    return NextResponse.json({ hasStores })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'STORE_FETCH_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as {
      storeName?: string
      category?: string
      logoUrl?: string
      website?: string
      country?: string
      timezone?: string
      currency?: string
    }

    const storeName = String(body.storeName || '').trim()
    const category = String(body.category || '').trim()
    const logoUrl = String(body.logoUrl || '').trim()
    const website = String(body.website || '').trim()
    const country = String(body.country || '').trim().toUpperCase()
    const timezone = String(body.timezone || 'Africa/Casablanca').trim()
    const currency = String(body.currency || 'MAD').trim().toUpperCase()

    if (!storeName) {
      return NextResponse.json({ error: 'STORE_NAME_REQUIRED' }, { status: 400 })
    }

    if (currency.length !== 3) {
      return NextResponse.json({ error: 'INVALID_CURRENCY' }, { status: 400 })
    }

    const { data: store, error: storeError } = await supabase
      .from('stores')
      .insert({
        owner_user_id: user.id,
        name: storeName,
        category: category || null,
        currency,
        country: country || null,
        logo_url: logoUrl || null,
        website: website || null,
      })
      .select('id, name')
      .single()

    if (storeError) throw storeError

    const { error: memberError } = await supabase
      .from('store_members')
      .insert({
        store_id: store.id,
        user_id: user.id,
        role: 'owner',
      })

    if (memberError) throw memberError

    const { error: profileError } = await supabase
      .from('profiles')
      .update({
        company: storeName,
        country: country || null,
        timezone,
        main_currency: currency,
        preferred_currency: currency,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)

    if (profileError) throw profileError

    return NextResponse.json({ store })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'STORE_CREATE_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}