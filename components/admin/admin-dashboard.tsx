'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button } from '@/components/ui/button'
import { dashboardMoney, type SaaSReport } from '@/lib/admin/dashboard'

const ranges = [{ days: 30, label: '30 jours' }, { days: 90, label: '90 jours' }, { days: 365, label: '12 mois' }] as const
const planColors = ['#1fa971', '#f3efe6', '#60a5fa']
function isoDate(date: Date) { return date.toISOString().slice(0, 10) }
function rangeFor(days: number) {
  const until = new Date(); until.setUTCHours(0, 0, 0, 0); until.setUTCDate(until.getUTCDate() + 1)
  const from = new Date(until); from.setUTCDate(from.getUTCDate() - days)
  return { from: isoDate(from), until: isoDate(until) }
}
function delta(current: number, previous: number) {
  if (previous === 0) return null
  return `${current >= previous ? '+' : ''}${Math.round((current - previous) / previous * 1000) / 10} %`
}
export function AdminDashboard() {
  const [days, setDays] = useState<30 | 90 | 365>(30)
  const range = rangeFor(days)
  const query = useQuery({ queryKey: ['saas-dashboard', days], retry: false, staleTime: 60_000, queryFn: async () => {
    const response = await fetch(`/api/admin/dashboard?from=${range.from}&until=${range.until}`, { cache: 'no-store' })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error)
    return result as SaaSReport
  } })
  return <div className="min-w-0 space-y-7">
    <header className="min-w-0"><p className="text-sm text-jisra-green">Administration Jisra</p><h1 className="mt-2 text-3xl font-bold">Vue d’ensemble</h1>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-jisra-cream/70">Pilotage commercial de l’entreprise Jisra uniquement. Aucun accès aux commandes ou aux clients des boutiques. Les indicateurs non disponibles sont signalés ; aucun chiffre n’est estimé.</p></header>
    <div role="group" aria-label="Période du tableau de bord" className="flex flex-wrap gap-2">{ranges.map((r) => <Button key={r.days} size="lg" variant={days === r.days ? 'default' : 'outline'} aria-pressed={days === r.days} onClick={() => setDays(r.days)}>{r.label}</Button>)}</div>
    {query.isPending ? <p role="status" aria-live="polite">Chargement des indicateurs…</p> : query.isError ? <div role="alert" className="space-y-3 rounded-2xl border border-red-400/30 p-5"><p>{query.error.message}</p><Button size="lg" variant="outline" onClick={() => void query.refetch()}>Réessayer</Button></div> : <Report data={query.data} />}
  </div>
}
function Report({ data }: { data: SaaSReport }) {
  const planMix = ['free', 'pro', 'ultimate'].map((code) => ({ name: code === 'free' ? 'Free' : code === 'pro' ? 'Pro' : 'Ultimate', value: data.plans[code] || 0 }))
  const payingPlanMix = planMix.filter((item) => item.name !== 'Free')
  const empty = data.series.every((point) => point.accounts === 0 && point.paid_starts === 0)
  return <div className="space-y-8">
    <section aria-label="Indicateurs principaux" className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi label="Nouveaux comptes" value={String(data.accounts_created)} note={`${delta(data.accounts_created, data.accounts_previous) || 'Référence précédente à zéro'} vs période précédente`} />
      <Kpi label="Clients propriétaires" value={String(data.customers)} note={`${data.stores} boutique(s) au total, indépendamment des offres`} />
      <Kpi label="Comptes payants" value={String(data.paying_accounts)} note={`${data.paying_start} en début de période · rétention ${data.retention_rate === null ? 'indisponible' : Math.round(data.retention_rate * 1000) / 10 + ' %'}`} />
      <Kpi label="Expirations sous 30 jours" value={String(data.expiring_30d)} note={`${data.renewals} renouvellement(s) commencé(s) sur la période`} />
    </section>
    <section className="grid min-w-0 gap-4 lg:grid-cols-2">
      <article className="min-w-0 rounded-2xl border border-white/12 p-5"><h2 className="font-semibold">Répartition des comptes par offre</h2>
        {data.customers === 0 ? <Empty /> : <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-[150px_minmax(0,1fr)]">
          <div className="h-[150px] w-full"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={planMix} dataKey="value" nameKey="name" innerRadius={40} outerRadius={70}>{planMix.map((entry, i) => <Cell key={entry.name} fill={planColors[i]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer></div>
          <ul className="space-y-3">{planMix.map((item, i) => <li key={item.name} className="flex items-center justify-between gap-3 text-sm"><span className="flex items-center gap-2"><span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: planColors[i] }} />{item.name}</span><strong>{item.value}</strong></li>)}</ul>
        </div>}
      </article>
      <article className="min-w-0 rounded-2xl border border-white/12 p-5"><h2 className="font-semibold">Revenus récurrents normalisés</h2>
        {data.mrr_state === 'unavailable' || !data.mrr ? <div role="status" className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm">{data.mrr_reason || 'MRR indisponible.'}<p className="mt-2">Distinct des encaissements réels et de la trésorerie ; non comptable.</p></div>
          : <div className="mt-4 space-y-3">{data.mrr.map((row) => <div key={row.currency} className="rounded-xl border border-white/10 p-3 text-sm"><p>MRR normalisé : {dashboardMoney(row.mrr_minor, row.currency)}</p><p>ARR normalisé : {dashboardMoney(row.arr_minor, row.currency)}</p></div>)}</div>}
        <p className="mt-4 text-xs leading-5 text-jisra-cream/60">Split payant : {payingPlanMix.map((item) => `${item.name} ${item.value}`).join(' · ') || 'aucun'}. Un abonnement annuel n’est pas compté comme douze encaissements.</p>
      </article>
    </section>
    <section className="grid min-w-0 gap-4 lg:grid-cols-2">
      <CurrencyTable title="Encaissements vérifiés" rows={data.receipts} field="receipts_minor" empty="Aucun encaissement vérifié sur la période." />
      <CurrencyTable title="Charges engagées (devise d’origine)" rows={data.expenses_committed} field="committed_gross_minor" empty="Aucune charge comptabilisée sur la période." note="Charges nettes d’avoirs et de remboursements fournisseurs. Ni revenu reconnu, ni bénéfice." />
    </section>
    <section className="min-w-0 rounded-2xl border border-white/12 p-5"><h2 className="font-semibold">Évolution quotidienne</h2><p className="mt-1 text-xs text-jisra-cream/60">Nouveaux comptes et débuts de période payante — dates UTC, fin de période exclue.</p>
      {empty ? <Empty /> : <div className="mt-4 h-[260px] w-full min-w-0"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data.series} margin={{ left: -20, right: 8, top: 8 }}><CartesianGrid stroke="rgba(243,239,230,.08)" /><XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(value: string) => value.slice(5)} minTickGap={28} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} /><Tooltip labelFormatter={(value) => `Jour ${value}`} /><Area type="monotone" dataKey="accounts" name="Nouveaux comptes" stroke="#1fa971" fill="#1fa97133" /><Area type="monotone" dataKey="paid_starts" name="Débuts payants" stroke="#60a5fa" fill="#60a5fa22" /></AreaChart></ResponsiveContainer></div>}
    </section>
    <section className="rounded-2xl border border-white/12 p-5"><h2 className="font-semibold">Couverture et limites</h2><dl className="mt-4 grid gap-4 md:grid-cols-2">{Object.entries(data.coverage).map(([key, value]) => <div key={key} className="min-w-0"><dt className="text-xs uppercase tracking-wider text-jisra-cream/55">{key}</dt><dd className="mt-1 break-words text-sm text-jisra-cream/75">{value}</dd></div>)}</dl>
      <ul className="mt-5 space-y-2 text-sm text-jisra-cream/65">{data.notes.map((note) => <li key={note}>• {note}</li>)}</ul></section>
  </div>
}
function Kpi({ label, value, note }: { label: string; value: string; note: string }) {
  return <article className="min-w-0 rounded-2xl border border-white/12 bg-white/[0.03] p-5"><p className="text-sm text-jisra-cream/65">{label}</p><p className="mt-2 break-words text-3xl font-bold">{value}</p><p className="mt-2 text-xs leading-5 text-jisra-cream/60">{note}</p></article>
}
function CurrencyTable({ title, rows, field, empty, note }: { title: string; rows: { currency: string; receipts_minor?: number; committed_gross_minor?: number }[]; field: 'receipts_minor' | 'committed_gross_minor'; empty: string; note?: string }) {
  return <article className="min-w-0 rounded-2xl border border-white/12 p-5"><h2 className="font-semibold">{title}</h2>
    {rows.length === 0 ? <p className="mt-4 text-sm text-jisra-cream/60">{empty}</p> : <ul className="mt-4 divide-y divide-white/10">{rows.map((row) => <li key={row.currency} className="flex min-w-0 justify-between gap-3 py-3 text-sm"><span>{row.currency}</span><strong className="break-words text-right">{dashboardMoney(row[field] || 0, row.currency)}</strong></li>)}</ul>}
    {note && <p className="mt-3 text-xs leading-5 text-jisra-cream/60">{note}</p>}
  </article>
}
function Empty() { return <p role="status" className="mt-4 rounded-xl border border-dashed border-white/15 p-5 text-sm text-jisra-cream/60">Aucune donnée sur cette période. Aucun volume n’est supposé.</p> }
