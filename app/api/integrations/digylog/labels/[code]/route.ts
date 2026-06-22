import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { downloadBlLabels, downloadLabels, DigylogConfig } from '@/lib/integrations/digylog'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params
    if (!code) {
      return NextResponse.json({ error: 'Code requis' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    }

    // Récupérer l'intégration Digylog active pour ce user
    const { data: integration } = await supabase
      .from('integrations')
      .select('id, config')
      .eq('user_id', user.id)
      .eq('provider_id', 'eeeb5b4f-741b-4d53-b4dd-72a7bd26f9cf')
      .eq('status', 'active')
      .maybeSingle()

    if (!integration) {
      return NextResponse.json({ error: 'Intégration Digylog introuvable' }, { status: 404 })
    }

    const cfg: DigylogConfig = integration.config as DigylogConfig

    // Essayer d'abord avec downloadLabels (par tracking numbers)
    // Si le code est un BL ID (nombre), utiliser downloadBlLabels
    const blId = parseInt(code, 10)
    if (!isNaN(blId) && String(blId) === code) {
      const result = await downloadBlLabels(cfg, blId)
      // L'API retourne un JSON avec l'URL du PDF
      if (result?.url) {
        const pdfRes = await fetch(result.url)
        const pdfBuffer = await pdfRes.arrayBuffer()
        return new NextResponse(pdfBuffer, {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="digylog-label-${code}.pdf"`,
          },
        })
      }
    }

    // Fallback: downloadLabels par tracking numbers
    const result = await downloadLabels(cfg, [code])
    if (result?.url) {
      const pdfRes = await fetch(result.url)
      const pdfBuffer = await pdfRes.arrayBuffer()
      return new NextResponse(pdfBuffer, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="digylog-label-${code}.pdf"`,
        },
      })
    }

    return NextResponse.json({ error: 'Étiquette non trouvée' }, { status: 404 })
  } catch (error) {
    console.error('Digylog label error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur lors de la récupération de l\'étiquette' },
      { status: 500 }
    )
  }
}
