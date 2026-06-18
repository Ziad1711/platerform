import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, requireAuthenticatedUser } from '@/lib/assistant/security'
import { downloadForceLogSticker } from '@/lib/integrations/forcelog'
import { getDecryptedIntegrationToken } from '@/lib/integrations/rapid-delivery-connect'
import { PDFDocument } from 'pdf-lib'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ pickupKey: string }> }
) {
  try {
    assertTrustedOrigin(request)
    await requireAuthenticatedUser()

    const { pickupKey } = await params
    if (!pickupKey) return NextResponse.json({ error: 'MISSING_PICKUP_KEY' }, { status: 400 })

    const admin = createAdminClient()

    // Récupérer le mapping pour ce pickup
    const { data: mapping, error: mappingError } = await admin
      .from('delivery_entity_mappings')
      .select('integration_id, payload')
      .eq('provider_entity_id', pickupKey)
      .eq('entity_type', 'voucher')
      .maybeSingle()

    if (mappingError) throw mappingError
    if (!mapping) return NextResponse.json({ error: 'PICKUP_NOT_FOUND' }, { status: 404 })

    const parcels: string[] = mapping.payload?.parcels || []
    if (parcels.length === 0) {
      return NextResponse.json({ error: 'NO_PARCELS_IN_PICKUP' }, { status: 400 })
    }

    const integrationId = mapping.integration_id
    const apiKey = await getDecryptedIntegrationToken(admin, integrationId)

    // Télécharger tous les stickers en parallèle
    const stickerBuffers = await Promise.all(
      parcels.map((parcelCode) => downloadForceLogSticker(apiKey, parcelCode))
    )

    // Fusionner tous les PDFs en un seul
    const mergedPdf = await PDFDocument.create()

    for (const buffer of stickerBuffers) {
      const stickerPdf = await PDFDocument.load(buffer)
      const pages = await mergedPdf.copyPages(stickerPdf, stickerPdf.getPageIndices())
      for (const page of pages) {
        mergedPdf.addPage(page)
      }
    }

    const mergedBytes = await mergedPdf.save()
    const pdfBuffer = Buffer.from(mergedBytes)

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="forcelog-stickers-${pickupKey}.pdf"`,
        'Content-Length': String(mergedBytes.length),
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'FORCELOG_PICKUP_LABELS_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
