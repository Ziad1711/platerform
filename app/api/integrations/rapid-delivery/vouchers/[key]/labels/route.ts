import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuthenticatedUser } from '@/lib/assistant/security'
import { downloadRapidDeliveryFile } from '@/lib/integrations/rapid-delivery'
import { getRapidDeliveryIntegrationCredentials } from '@/lib/integrations/rapid-delivery-connect'

const LABEL_VERSIONS = ['v1', 'v2', 'v3']

export async function GET(_request: Request, context: { params: Promise<{ key: string }> }) {
  try {
    const { user } = await requireAuthenticatedUser()
    const { key } = await context.params
    const voucherKey = String(key || '').trim()
    if (!voucherKey) {
      return NextResponse.json({ error: 'MISSING_VOUCHER_KEY' }, { status: 400 })
    }

    const admin = createAdminClient()
    const { data: mapping, error: mappingError } = await admin
      .from('rapid_delivery_entity_mappings')
      .select('integration_id, rapid_delivery_id')
      .eq('entity_type', 'voucher')
      .eq('rapid_delivery_id', voucherKey)
      .eq('user_id', user.id)
      .maybeSingle()

    if (mappingError) throw mappingError
    if (!mapping?.integration_id) {
      return NextResponse.json({ error: 'VOUCHER_NOT_FOUND' }, { status: 404 })
    }

    const { token, baseUrl } = await getRapidDeliveryIntegrationCredentials(admin, mapping.integration_id)
    let downloaded: Awaited<ReturnType<typeof downloadRapidDeliveryFile>> | null = null
    let selectedVersion = ''
    const errors: string[] = []

    for (const version of LABEL_VERSIONS) {
      const path = `/vouchers/${encodeURIComponent(voucherKey)}/labels/${version}/download`
      try {
        const file = await downloadRapidDeliveryFile(token, path, baseUrl)
        console.info('Rapid Delivery voucher labels download result', {
          voucherKey,
          version,
          contentType: file.contentType,
          byteLength: file.byteLength,
        })

        if (file.byteLength > 0) {
          downloaded = file
          selectedVersion = version
          break
        }

        errors.push(`${version}:EMPTY_RESPONSE`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.warn('Rapid Delivery voucher labels version failed', { voucherKey, version, message })
        errors.push(`${version}:${message}`)
      }
    }

    if (!downloaded) {
      return NextResponse.json({ error: 'RAPID_DELIVERY_LABELS_EMPTY', details: errors }, { status: 502 })
    }

    return new NextResponse(downloaded.body, {
      status: 200,
      headers: {
        'Content-Type': downloaded.contentType,
        'Content-Disposition': downloaded.contentDisposition || `attachment; filename="rapid-delivery-voucher-${voucherKey}-labels-${selectedVersion}.html"`,
        'Content-Length': String(downloaded.byteLength),
      },
    })
  } catch (error) {
    console.error('Rapid Delivery voucher labels download error:', error)
    const message = error instanceof Error ? error.message : 'RAPID_DELIVERY_VOUCHER_LABELS_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}