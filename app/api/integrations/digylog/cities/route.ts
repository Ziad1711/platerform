import { NextResponse } from 'next/server'
import { requireAuthenticatedUser } from '@/lib/assistant/security'
import * as digylog from '@/lib/integrations/digylog'

export async function POST(request: Request) {
  try {
    const { supabase } = await requireAuthenticatedUser()
    const body = (await request.json()) as { integrationId: string }
    const { integrationId } = body

    if (!integrationId) {
      return NextResponse.json({ error: 'MISSING_INTEGRATION_ID' }, { status: 400 })
    }

    const { data: integration } = await supabase
      .from('integrations')
      .select('access_token')
      .eq('id', integrationId)
      .maybeSingle()

    if (!integration?.access_token) {
      return NextResponse.json({ error: 'INTEGRATION_NOT_FOUND' }, { status: 404 })
    }

    const cfg: digylog.DigylogConfig = { token: integration.access_token, referer: 'https://apiseller.digylog.com' }
    const cities = await digylog.getCities(cfg)

    return NextResponse.json({ ok: true, data: cities })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'DIGYLOG_CITIES_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
