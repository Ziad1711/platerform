import { NextResponse } from 'next/server'
import { readPublicPlanCatalog } from '@/lib/billing/catalog.server'

export const dynamic = 'force-dynamic'

/** Lecture publique minimale : aucune clé privilégiée, aucun prix de secours. */
export async function GET() {
  try {
    return NextResponse.json({ prices: await readPublicPlanCatalog() }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch {
    return NextResponse.json({ error: 'CATALOG_UNAVAILABLE' }, { status: 503 })
  }
}