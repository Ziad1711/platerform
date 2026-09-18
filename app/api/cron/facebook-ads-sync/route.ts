import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { enqueueFacebookDailySyncJobs, processFacebookSyncJob } from '@/lib/integrations/facebook-ads-sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET || ''
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET_NOT_CONFIGURED' }, { status: 503 })
  }

  const authorization = request.headers.get('authorization') || ''
  if (authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }

  try {
    const admin = createAdminClient()
    const jobs = await enqueueFacebookDailySyncJobs(admin)

    const { data: pendingJobs, error: pendingJobsError } = await admin
      .from('facebook_sync_jobs')
      .select('id')
      .in('status', ['pending', 'failed'])
      .lt('attempts', 3)
      .order('created_at', { ascending: true })
      .limit(50)

    if (pendingJobsError) throw pendingJobsError
    const jobIds = Array.from(new Set([
      ...jobs.map((job) => job.jobId),
      ...(pendingJobs || []).map((job: any) => String(job.id)),
    ]))
    const results: Array<Record<string, unknown>> = []

    for (const jobId of jobIds) {
      try {
        results.push({ jobId, ...(await processFacebookSyncJob(admin, jobId)) })
      } catch (error) {
        results.push({
          jobId,
          error: error instanceof Error ? error.message : 'FACEBOOK_SYNC_JOB_FAILED',
        })
      }
    }

    return NextResponse.json({ ok: true, enqueued: jobs.length, processed: jobIds.length, results })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'FACEBOOK_CRON_SYNC_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
