import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, getErrorStatus, requireAuthenticatedUser } from '@/lib/assistant/security'
import { processPendingFacebookSyncJobs } from '@/lib/integrations/facebook-ads-sync'

export const maxDuration = 300

export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request)
    const { user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as { jobId?: string }
    const jobId = String(body.jobId || '').trim() || undefined

    const admin = createAdminClient()
    const results = await processPendingFacebookSyncJobs(admin, user.id, jobId)

    return NextResponse.json({ ok: true, results })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'FACEBOOK_SYNC_PROCESS_FAILED'
    return NextResponse.json({ error: message }, { status: getErrorStatus(error) })
  }
}
