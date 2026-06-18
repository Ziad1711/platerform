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
    await requireAuthenticatedUser()

    const { code } = await params
    if (!code) return NextResponse.json({ error: 'MISSING_PARCEL_CODE' }, { status: 400 })

    const url = new URL(request.url)
    const integrationId = url.searchParams.get('integrationId') || ''

    if (!integrationId) return NextResponse.json({ error: 'MISSING_INTEGRATION_ID' }, { status: 400 })

    const admin = createAdminClient()
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