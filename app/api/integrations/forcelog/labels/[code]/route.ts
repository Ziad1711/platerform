import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, requireAuthenticatedUser } from '@/lib/assistant/security'
import { downloadForceLogSticker } from '@/lib/integrations/forcelog'
import { getDecryptedIntegrationToken } from '@/lib/integrations/rapid-delivery-connect'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    assertTrustedOrigin(request)
    const { user } = await requireAuthenticatedUser()

    const { code } = await params
    if (!code) return NextResponse.json({ error: 'MISSING_PARCEL_CODE' }, { status: 400 })

    const url = new URL(request.url)
    const integrationId = url.searchParams.get('integrationId') || ''

    if (!integrationId) return NextResponse.json({ error: 'MISSING_INTEGRATION_ID' }, { status: 400 })

    const admin = createAdminClient()

    const { data: integration } = await admin
      .from('integrations')
      .select('store_id')
      .eq('id', integrationId)
      .maybeSingle()
    if (!integration?.store_id) return NextResponse.json({ error: 'INTEGRATION_NOT_FOUND' }, { status: 404 })

    const { data: membership, error: membershipError } = await admin
      .from('store_members')
      .select('store_id')
      .eq('user_id', user.id)
      .eq('store_id', integration.store_id)
      .eq('status', 'active')
      .maybeSingle()

    if (membershipError) throw membershipError
    if (!membership) return NextResponse.json({ error: 'STORE_ACCESS_DENIED' }, { status: 403 })

    const apiKey = await getDecryptedIntegrationToken(admin, integrationId)
    const pdfBuffer = await downloadForceLogSticker(apiKey, code)

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="forcelog-${code}.pdf"`,
        'Content-Length': String(pdfBuffer.byteLength),
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'FORCELOG_LABEL_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}