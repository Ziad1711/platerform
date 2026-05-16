import { NextResponse } from 'next/server'
import { requireAuth, getServerClient } from '@/lib/auth/require-permission'

export async function GET() {
  try {
    const user = await requireAuth()
    const supabase = await getServerClient()

    const { data, error } = await supabase.rpc('get_my_stores')
    if (error) throw error

    return NextResponse.json({ stores: data || [] })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'FETCH_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
