import { NextResponse } from 'next/server'
import { requireAuthenticatedUser } from '@/lib/assistant/security'
import * as digylog from '@/lib/integrations/digylog'

export async function POST(request: Request) {
  try {
    const { supabase } = await requireAuthenticatedUser()
    const body = (await request.json()) as {
      integrationId: string
      tracking: string
    }

    const { integrationId, tracking } = body
    if (!integrationId || !tracking) {
      return NextResponse.json({ error: 'MISSING_REQUIRED_FIELDS' }, { status: 400 })
    }

    // Récupérer le token
    const { data: integration } = await supabase
      .from('integrations')
      .select('token')
      .eq('id', integrationId)
      .maybeSingle()

    if (!integration?.token) {
      return NextResponse.json({ error: 'INTEGRATION_NOT_FOUND' }, { status: 404 })
    }

    const cfg: digylog.DigylogConfig = { token: integration.token }
    const infos = await digylog.getOrderInfos(cfg, tracking)

    return NextResponse.json({ ok: true, data: infos })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'DIGYLOG_TRACK_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
