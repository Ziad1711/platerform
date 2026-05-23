import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateApiKey } from '@/lib/integrations/custom-api/auth'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Lire le store_id depuis le cookie
    let storeId = request.cookies.get('current-store-id')?.value || null

    if (!storeId) {
      // Fallback : premier store où l'utilisateur est owner
      const { data: members } = await supabase
        .from('store_members')
        .select('store_id')
        .eq('user_id', user.id)
        .eq('role', 'owner')
        .limit(1)

      if (!members?.length) {
        return NextResponse.json({ error: 'No store found' }, { status: 404 })
      }

      storeId = members[0].store_id
    }

    const { data: keys, error } = await supabase
      .from('public_api_keys')
      .select('id, name, key_prefix, is_active, last_used_at, created_at, revoked_at')
      .eq('store_id', storeId)
      .order('created_at', { ascending: false })

    if (error) throw error

    return NextResponse.json({ keys: keys || [] })
  } catch (error) {
    console.error('[CUSTOM_SITE_KEYS_GET]', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Lire le store_id depuis le cookie ou le body
    const body = await request.json().catch(() => ({}))
    let storeId = body.store_id || request.cookies.get('current-store-id')?.value || null

    if (!storeId) {
      // Fallback : premier store où l'utilisateur est owner
      const { data: members } = await supabase
        .from('store_members')
        .select('store_id')
        .eq('user_id', user.id)
        .eq('role', 'owner')
        .limit(1)

      if (!members?.length) {
        return NextResponse.json({ error: 'No store found' }, { status: 404 })
      }

      storeId = members[0].store_id
    }

    // Vérifier que l'utilisateur a accès à ce store
    const { data: membership } = await supabase
      .from('store_members')
      .select('store_id')
      .eq('user_id', user.id)
      .eq('store_id', storeId)
      .eq('status', 'active')
      .maybeSingle()

    if (!membership) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const keyName = body.name || 'Clé API site web'

    const { raw, prefix, hash } = generateApiKey()

    const { error: insertError } = await supabase
      .from('public_api_keys')
      .insert({
        store_id: storeId,
        name: keyName,
        key_prefix: prefix,
        key_hash: hash,
        is_active: true,
      })

    if (insertError) throw insertError

    return NextResponse.json({
      key: raw,
      prefix,
      message: 'Conservez cette clé, elle ne sera plus affichée',
    })
  } catch (error) {
    console.error('[CUSTOM_SITE_KEYS_POST]', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
