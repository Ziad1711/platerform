import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, requireAuthenticatedUser } from '@/lib/assistant/security'
import { getSenditLabels } from '@/lib/integrations/sendit'
import { getSenditCredentials } from '@/lib/integrations/sendit-credentials'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    assertTrustedOrigin(request)
    const { supabase, user } = await requireAuthenticatedUser()

    const { code } = await params
    if (!code) return NextResponse.json({ error: 'MISSING_PARCEL_CODE' }, { status: 400 })

    const url = new URL(request.url)
    let integrationId = url.searchParams.get('integrationId') || ''
    const storeId = url.searchParams.get('storeId') || ''
    const printFormat = Number(url.searchParams.get('printFormat') || '1')

    const admin = createAdminClient()

    // Résoudre integrationId depuis le store si non fourni
    if (!integrationId && storeId) {
      const { data: senditConfig } = await admin
        .from('sendit_configs')
        .select('integration_id')
        .eq('store_id', storeId)
        .maybeSingle()

      if (senditConfig?.integration_id) {
        integrationId = senditConfig.integration_id
      } else {
        const { data: company } = await admin
          .from('delivery_companies')
          .select('integration_id')
          .eq('store_id', storeId)
          .eq('api_provider', 'sendit')
          .maybeSingle()

        if (company?.integration_id) {
          integrationId = company.integration_id
        }
      }
    }

    if (!integrationId) return NextResponse.json({ error: 'MISSING_INTEGRATION_ID' }, { status: 400 })

    const credentials = await getSenditCredentials(admin, integrationId)

    const raw = await getSenditLabels(credentials.token, [code], printFormat)
    const fileUrl = String((raw as any)?.fileUrl || (raw as any)?.data?.fileUrl || '').trim()

    if (!fileUrl) return NextResponse.json({ error: 'SENDIT_LABEL_URL_NOT_FOUND' }, { status: 404 })

    // Rediriger vers l'URL de l'étiquette Sendit
    return NextResponse.redirect(fileUrl)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SENDIT_LABEL_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
