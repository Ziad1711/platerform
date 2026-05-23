import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ keyId: string }> }
) {
  try {
    const { keyId } = await params
    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Lire le store_id depuis le query param ou le cookie
    const { searchParams } = new URL(request.url)
    let storeId = searchParams.get('store_id') || request.cookies.get('current-store-id')?.value || null

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

    const { error } = await supabase
      .from('public_api_keys')
      .update({ is_active: false, revoked_at: new Date().toISOString() })
      .eq('id', keyId)
      .eq('store_id', storeId)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[CUSTOM_SITE_KEYS_DELETE]', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
