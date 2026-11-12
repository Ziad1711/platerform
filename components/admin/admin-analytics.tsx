'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import type { AnalyticsOverview, CachedReport } from '@/lib/admin/analytics'

const ranges = [7, 30, 90] as const
function isoDate(date: Date) { return date.toISOString().slice(0, 10) }
function rangeFor(days: number) {
  const until = new Date(); until.setUTCHours(0, 0, 0, 0); until.setUTCDate(until.getUTCDate() + 1)
  const from = new Date(until); from.setUTCDate(from.getUTCDate() - days)
  return { from: isoDate(from), until: isoDate(until) }
}
const labels: Record<string, string> = {
  audience: 'Utilisateurs et sessions', sources: 'Sources de trafic', campaigns: 'Campagnes',
  pages: 'Pages publiques', events: 'Événements',
}
const metricLabels: Record<string, string> = {
  totalUsers: 'Utilisateurs', newUsers: 'Nouveaux', sessions: 'Sessions', engagedSessions: 'Sessions engagées',
  keyEvents: 'Événements clés', screenPageViews: 'Vues de page', eventCount: 'Occurrences',
}
export function AdminAnalytics() {
  const [days, setDays] = useState<7 | 30 | 90>(30)
  const range = rangeFor(days)
  const query = useQuery({ queryKey: ['admin-analytics', days], retry: false, staleTime: 60_000, queryFn: async () => {
    const response = await fetch(`/api/admin/analytics?from=${range.from}&until=${range.until}`, { cache: 'no-store' })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error)
    return result as AnalyticsOverview
  } })
  return <div className="min-w-0 space-y-7">
    <h1 className="text-3xl font-bold">Acquisition et tunnel</h1>
    <p className="max-w-3xl text-sm leading-6 text-jisra-cream/70">GA4 mesure uniquement les visiteurs consentants. Le tunnel commercial provient exclusivement de la base Jisra. Aucun taux ne combine ces deux populations faute d’identifiant commun.</p>
    <div role="group" aria-label="Période des rapports" className="flex flex-wrap gap-2">{ranges.map((value) => <Button key={value} size="lg" aria-pressed={days === value} variant={days === value ? 'default' : 'outline'} onClick={() => setDays(value)}>{value} jours</Button>)}</div>
    {query.isPending ? <p role="status">Chargement des rapports…</p> : query.isError ? <div role="alert" className="space-y-3 rounded-2xl border border-red-400/30 p-5"><p>{query.error.message}</p><Button size="lg" variant="outline" onClick={() => void query.refetch()}>Réessayer</Button></div> : <Overview data={query.data} />}
  </div>
}
function Overview({ data }: { data: AnalyticsOverview }) {
  return <div className="space-y-8">
    {!data.configured ? <section role="status" className="space-y-2 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-5">
      <h2 className="font-semibold">Google Analytics non configuré</h2>
      <p className="text-sm">Aucun rapport GA4 n’est affiché et aucun appel Google n’est effectué. Le tunnel commercial interne reste consultable ci-dessous.</p>
    </section> : null}
    <section className="min-w-0 rounded-2xl border border-white/12 p-5"><h2 className="font-semibold">Tunnel commercial Jisra — données internes</h2>
      <p className="mt-1 text-xs leading-5 text-jisra-cream/60">{data.coverage.commercial}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Kpi label="Inscriptions" value={data.commercial.accounts_created} />
        <Kpi label="Demandes de paiement" value={data.commercial.payment_requests_created} />
        <Kpi label="Activations vérifiées" value={data.commercial.paid_activations} />
      </div>
      {data.commercial.paid_activations_currency.length > 0 && <ul className="mt-4 space-y-2 text-sm">{data.commercial.paid_activations_currency.map((row) => <li key={row.currency}>{row.count} encaissement(s) — {(row.amount_minor / 100).toLocaleString('fr-FR')} {row.currency}</li>)}</ul>}
      <p className="mt-4 text-xs leading-5 text-jisra-cream/60">{data.coverage.mixed_rate}</p>
    </section>
    {data.configured && data.reports.length === 0 ? <p role="status">Rapports GA4 en attente de première synchronisation serveur.</p> : null}
    {data.reports.map((report) => <Report key={report.report} report={report} />)}
    <section className="rounded-2xl border border-white/12 p-5"><h2 className="font-semibold">Couverture</h2>
      <p className="mt-2 break-words text-sm">{data.coverage.ga4}</p>
      <p className="mt-2 text-sm">Dernière synchronisation : {data.last_sync ? new Date(data.last_sync).toLocaleString('fr-FR') : 'jamais'} · appels externes : désactivés.</p></section>
  </div>
}
function Kpi({ label, value }: { label: string; value: number }) {
  return <div className="min-w-0 rounded-xl border border-white/10 p-4"><p className="text-sm text-jisra-cream/65">{label}</p><p className="mt-2 text-2xl font-bold">{value}</p></div>
}
function Report({ report }: { report: CachedReport }) {
  const data = report.payload as { dimensions: string[]; metrics: string[]; rows: { dimensions: string[]; metrics: number[] }[]; totalRows: number } | null
  return <section className="min-w-0 rounded-2xl border border-white/12 p-5"><div className="flex flex-wrap items-baseline justify-between gap-2">
    <h2 className="font-semibold">{labels[report.report] || report.report}{report.source === 'synthetic' ? ' — données simulées Q4' : ''}</h2>
    <p className="text-xs text-jisra-cream/55">{report.status === 'ok' ? `${data?.totalRows || 0} ligne(s)` : report.status} · {new Date(report.fetched_at).toLocaleString('fr-FR')}{report.fresh ? '' : ' · périmé'}</p></div>
    {report.status !== 'ok' || !data ? <p role="status" className="mt-3 text-sm">Rapport indisponible ({report.error_code || report.status}). Aucune valeur n’est supposée.</p>
      : data.rows.length === 0 ? <p className="mt-3 text-sm">Aucune donnée GA4 sur cette période.</p>
        : <div className="mt-4 overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr>{data.dimensions.map((dimension) => <th key={dimension} className="p-3">{dimension}</th>)}{data.metrics.map((metric) => <th key={metric} className="p-3 text-right">{metricLabels[metric] || metric}</th>)}</tr></thead>
          <tbody>{data.rows.map((row, index) => <tr key={index} className="border-t border-white/10">{row.dimensions.map((value, cell) => <td key={cell} className="max-w-[220px] break-words p-3">{value}</td>)}{row.metrics.map((value, cell) => <td key={cell} className="whitespace-nowrap p-3 text-right">{value.toLocaleString('fr-FR')}</td>)}</tr>)}</tbody></table></div>}
  </section>
}

