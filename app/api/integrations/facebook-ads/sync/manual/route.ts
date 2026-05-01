import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { processPendingFacebookSyncJobs } from '@/lib/integrations/facebook-ads-connect'

export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request)
    const { supabase, user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as { storeId?: string }
    const storeId = String(body.storeId || '').trim()
    if (!storeId) return NextResponse.json({ error: 'MISSING_STORE_ID' }, { status: 400 })
    await verifyStoreAccess(supabase, user.id, storeId)

    const admin = createAdminClient()
    const { data: integration, error: integrationError } = await admin
      .from('integrations')
      .select('id')
      .eq('user_id', user.id)
      .eq('provider', 'facebook-ads')
      .maybeSingle()

    if (integrationError) throw integrationError
    if (!integration?.id) return NextResponse.json({ error: 'FACEBOOK_INTEGRATION_NOT_FOUND' }, { status: 404 })

    const today = new Date()
    const j0 = today.toISOString().slice(0, 10)
    const currentYear = today.getFullYear()
    const syncFrom = `${currentYear}-01-01`

    const { data: job, error } = await admin.from('facebook_sync_jobs').insert({
      integration_id: integration.id,
      user_id: user.id,
      store_id: storeId,
      job_type: 'manual',
      sync_from: syncFrom,
      sync_to: j0,
      status: 'pending',
    })
    .select('id')
    .single()

    if (error) throw error

    const results = await processPendingFacebookSyncJobs(admin, user.id, String(job.id))
    return NextResponse.json({ ok: true, results })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'FACEBOOK_MANUAL_SYNC_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}