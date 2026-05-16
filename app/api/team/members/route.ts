import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/require-permission'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  try {
    const user = await requireAuth()
    const admin = createAdminClient()

    // 1) Find all stores where current user is owner/admin
    const { data: adminStores, error: adminStoresError } = await admin
      .from('store_members')
      .select('store_id')
      .eq('user_id', user.id)
      .in('role', ['owner', 'admin'])
      .eq('status', 'active')

    if (adminStoresError) throw adminStoresError
    if (!adminStores || adminStores.length === 0) {
      return NextResponse.json({ members: [] })
    }

    const storeIds = adminStores.map((s) => s.store_id)

    // 2) Fetch all members for those stores with joined profiles/users info
    const { data: members, error: membersError } = await admin
      .from('store_members')
      .select(`
        id,
        store_id,
        role,
        status,
        created_at,
        updated_at,
        profiles:profiles(id, full_name, avatar_url),
        stores:stores(id, name, logo_url)
      `)
      .in('store_id', storeIds)
      .order('created_at', { ascending: false })

    if (membersError) throw membersError

    // 3) Fetch auth.users emails for those members
    const userIds = [...new Set((members || []).map((m: any) => m.profiles?.id || m.id).filter(Boolean))]
    const userEmailMap: Record<string, string> = {}
    if (userIds.length > 0) {
      const { data: usersData, error: usersError } = await admin.auth.admin.listUsers()
      if (usersError) throw usersError
      for (const u of usersData?.users || []) {
        if (userIds.includes(u.id)) {
          userEmailMap[u.id] = u.email || ''
        }
      }
    }

    // Flat list with store info and user details
    const result = (members || []).map((m: any) => ({
      id: m.id,
      store_id: m.store_id,
      store_name: m.stores?.name || null,
      store_logo_url: m.stores?.logo_url || null,
      role: m.role,
      status: m.status,
      user_id: m.profiles?.id || null,
      email: userEmailMap[m.profiles?.id] || null,
      full_name: m.profiles?.full_name || null,
      avatar_url: m.profiles?.avatar_url || null,
      created_at: m.created_at,
      updated_at: m.updated_at,
    }))

    // Grouped by store
    const grouped: Record<string, typeof result> = {}
    for (const m of result) {
      if (!grouped[m.store_id]) grouped[m.store_id] = []
      grouped[m.store_id].push(m)
    }

    return NextResponse.json({
      members: result,
      grouped,
      meta: {
        total: result.length,
        stores: storeIds.length,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'MEMBERS_FETCH_FAILED'
    const status =
      message === 'UNAUTHORIZED' ? 401 : message === 'FORBIDDEN' ? 403 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
