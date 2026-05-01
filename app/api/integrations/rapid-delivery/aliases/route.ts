import { NextResponse } from 'next/server'
import { requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { createAdminClient } from '@/lib/supabase/admin'

function normalizeAlias(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const { searchParams } = new URL(request.url)
    const storeId = String(searchParams.get('storeId') || '').trim()

    if (!storeId) return NextResponse.json({ error: 'MISSING_STORE_ID' }, { status: 400 })
    await verifyStoreAccess(supabase, user.id, storeId)

    const admin = createAdminClient()
    const { data, error } = await admin
      .from('rapid_delivery_city_aliases')
      .select('alias, canonical_city_name, city_key, usage_count, source, learned_at, last_used_at')
      .order('usage_count', { ascending: false })
      .order('alias', { ascending: true })

    if (error) throw error
    return NextResponse.json({ ok: true, data: data || [] })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'RAPID_DELIVERY_ALIASES_GET_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as {
      storeId?: string
      alias?: string
      canonicalCityName?: string
      cityKey?: number | string | null
    }

    const storeId = String(body.storeId || '').trim()
    const alias = normalizeAlias(String(body.alias || ''))
    const canonicalCityName = String(body.canonicalCityName || '').trim()

    if (!storeId) return NextResponse.json({ error: 'MISSING_STORE_ID' }, { status: 400 })
    if (!alias) return NextResponse.json({ error: 'MISSING_ALIAS' }, { status: 400 })
    if (!canonicalCityName) return NextResponse.json({ error: 'MISSING_CANONICAL_CITY_NAME' }, { status: 400 })

    await verifyStoreAccess(supabase, user.id, storeId)

    const admin = createAdminClient()
    let resolvedCityKey = Number(body.cityKey || 0) || 0

    if (!resolvedCityKey) {
      const { data: cityRow, error: cityError } = await admin
        .from('rapid_delivery_cities_standard')
        .select('city_key, city_name')
        .eq('city_name', canonicalCityName)
        .maybeSingle()

      if (cityError) throw cityError
      resolvedCityKey = Number(cityRow?.city_key || 0) || 0
    }

    const payload = {
      alias,
      canonical_city_name: canonicalCityName,
      city_key: resolvedCityKey,
      learned_at: new Date().toISOString(),
      last_used_at: null,
      usage_count: 0,
      source: 'manual',
      confidence_score: 1,
      updated_at: new Date().toISOString(),
    }

    const { error } = await admin
      .from('rapid_delivery_city_aliases')
      .upsert(payload, { onConflict: 'alias' })

    if (error) throw error
    return NextResponse.json({ ok: true, data: payload })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'RAPID_DELIVERY_ALIASES_POST_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as { storeId?: string; alias?: string }

    const storeId = String(body.storeId || '').trim()
    const alias = normalizeAlias(String(body.alias || ''))

    if (!storeId) return NextResponse.json({ error: 'MISSING_STORE_ID' }, { status: 400 })
    if (!alias) return NextResponse.json({ error: 'MISSING_ALIAS' }, { status: 400 })

    await verifyStoreAccess(supabase, user.id, storeId)

    const admin = createAdminClient()
    const { error } = await admin.from('rapid_delivery_city_aliases').delete().eq('alias', alias)

    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'RAPID_DELIVERY_ALIASES_DELETE_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}