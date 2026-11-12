import { NextResponse } from 'next/server'
import { adminError, requireAdmin } from '@/lib/admin/access.server'
import { readGaConfig, reportWindow, type AnalyticsOverview } from '@/lib/admin/analytics'

/** Aucun identifiant GA4, aucune réponse Google brute dans la réponse HTTP. */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const window = reportWindow.parse({ from: searchParams.get('from'), until: searchParams.get('until'), source: searchParams.get('source') || 'ga4' })
    const { supabase } = await requireAdmin('analytics.read')
    const read = async () => { const result = await supabase.rpc('rpc_admin_analytics_read', { p_from: window.from, p_until: window.until, p_source: window.source }); if (result.error) throw new Error('ADMIN_UNAVAILABLE'); return result.data as { error?: unknown; reports: { fresh: boolean }[]; [key: string]: unknown } }
    const cache = await read()
    if (cache.error) throw new Error(String(cache.error))
    // Synchronisation paresseuse uniquement hors qualification et quand le cache
    // GA4 est absent ou périmé : jamais un appel Google à chaque chargement.
    if (process.env.JISRA_QUALIFICATION !== '1' && readGaConfig() && process.env.GA4_EXTERNAL_CALLS === 'enabled'
      && (cache.reports.length === 0 || cache.reports.every((report) => !report.fresh))) {
      const { syncGa4 } = await import('@/lib/admin/ga4')
      await syncGa4(window.from, window.until)
      const refreshed = await read() as typeof cache
      if (!refreshed.error) Object.assign(cache, refreshed)
    }
    const funnel = await supabase.rpc('rpc_admin_commercial_funnel', { p_from: window.from, p_until: window.until })
    if (funnel.error) { console.error('[admin/analytics] funnel', funnel.error.message); throw new Error('ADMIN_UNAVAILABLE') }
    const commercial = funnel.data as AnalyticsOverview['commercial']
    const funnelError = commercial && 'error' in commercial ? String(commercial.error) : null
    if (funnelError) throw new Error(funnelError)
    return NextResponse.json({ ...cache, commercial, configured: Boolean(readGaConfig()) },
      { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return adminError(error) }
}
