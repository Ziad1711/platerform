import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { apiFetchRaw, DigylogConfig } from '@/lib/integrations/digylog'

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
      .select('id, access_token')
      .eq('user_id', user.id)
      .eq('provider_id', 'eeeb5b4f-741b-4d53-b4dd-72a7bd26f9cf')
      .eq('status', 'connected')
      .maybeSingle()

    if (!integration?.access_token) {
      return NextResponse.json({ error: 'Intégration Digylog introuvable' }, { status: 404 })
    }

    const cfg: DigylogConfig = { token: integration.access_token, referer: 'https://apiseller.digylog.com' }

    // Construire le body selon que le code est un BL ID (nombre) ou un tracking
    const blId = parseInt(code, 10)
    const isBlId = !isNaN(blId) && String(blId) === code
    const body = isBlId ? JSON.stringify({ bl: blId }) : JSON.stringify({ orders: [code] })

    // Appel brut à l'API /labels de Digylog
    const rawRes = await apiFetchRaw(cfg, '/labels', {
      method: 'POST',
      body,
    })

    const contentType = rawRes.headers.get('content-type') || ''

    // Cas 1 : l'API retourne directement un PDF
    if (contentType.includes('application/pdf') || contentType.includes('application/octet-stream')) {
      const pdfBuffer = await rawRes.arrayBuffer()
      return new NextResponse(pdfBuffer, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="digylog-label-${code}.pdf"`,
        },
      })
    }

    // Cas 2 : l'API retourne un JSON avec une URL de PDF
    const json = await rawRes.json().catch(() => null)
    if (json?.url) {
      const pdfRes = await fetch(json.url)
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
