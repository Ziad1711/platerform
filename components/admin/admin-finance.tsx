'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { AdminFinanceForm } from './admin-finance-form'
import { financeMoney, type FinanceReport, type Expense } from '@/lib/admin/finance'

export function AdminFinance() {
  const [filters, setFilters] = useState(() => {
    const now = new Date(); return { from: `${now.getUTCFullYear()}-01-01`, until: `${now.getUTCFullYear()+1}-01-01`, currency: '', category: '', account: '', status: '', offset: '0' }
  })
  const [editing, setEditing] = useState<Expense | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const params = new URLSearchParams(filters).toString()
  const query = useQuery({ queryKey: ['saas-finance', filters], retry: false, queryFn: async () => {
    const response = await fetch(`/api/admin/finance?${params}`, { cache: 'no-store' }); const result = await response.json()
    if (!response.ok) throw new Error(result.error)
    return result as FinanceReport
  } })
  async function refresh() { await query.refetch(); setEditing(null) }
  async function action(action: string, id: string) {
    const reason = window.prompt('Motif de la décision (10 caractères minimum, sans secret)')
    if (!reason) return
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/admin/finance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: crypto.randomUUID(), action, data: { id, reason } }) })
      const result = await response.json(); if (!response.ok) throw new Error(result.error)
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Opération indisponible.') }
    finally { setBusy(false) }
  }
  async function upload(expense: string, file: File | undefined) {
    if (!file) return
    setBusy(true); setError('')
    try {
      const form = new FormData(); form.set('file', file)
      const response = await fetch(`/api/admin/finance/proofs/${expense}`, { method: 'POST', body: form })
      const result = await response.json(); if (!response.ok) throw new Error(result.error)
      await query.refetch()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Justificatif indisponible.') }
    finally { setBusy(false) }
  }
  return <div className="space-y-7">
    <h1 className="text-3xl font-bold">Finances Jisra</h1>
    <p className="max-w-3xl text-sm leading-6 text-jisra-cream/70">Registre interne du SaaS, indépendant des boutiques. Les écritures ne déclenchent aucune opération bancaire. Montants séparés par devise, sans taux inventé. Périodes : début inclus, fin exclue, dates de valeur enregistrées.</p>
    <div role="status" className="rounded-xl border border-amber-400/30 p-4 text-sm">Les indicateurs de gestion ne sont pas des comptes officiels. Sans politique fiscale/comptable approuvée, revenu reconnu et résultat restent indisponibles ; le flux de trésorerie reste utilisable et n’est pas un bénéfice.</div>
    <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); setFilters({ from: String(data.get('from')), until: String(data.get('until')), currency: String(data.get('currency')), category: String(data.get('category')), account: String(data.get('account')), status: String(data.get('status')), offset: '0' }) }} className="grid gap-3 rounded-xl border border-white/10 p-4 sm:grid-cols-2 xl:grid-cols-4">
      <Filter name="from" label="Du (inclus)" type="date" value={filters.from} /><Filter name="until" label="Au (exclu)" type="date" value={filters.until} />
      <Choice name="currency" label="Devise" options={['MAD', 'EUR', 'USD', 'GBP', 'CAD', 'AED'].map((c) => [c, c])} />
      <Choice name="status" label="Statut dépense" options={[["draft", 'Brouillon'], ['posted', 'Comptabilisée'], ['cancelled', 'Annulée']]} />
      <Choice name="category" label="Catégorie" options={query.data?.categories.map((c) => [c.id, c.name]) || []} />
      <Choice name="account" label="Compte (flux / dépenses réglées)" options={query.data?.accounts.map((a) => [a.id, a.name]) || []} />
      <Button size="lg" type="submit">Appliquer les filtres</Button>
    </form>
    {query.isPending ? <p role="status">Chargement des registres financiers…</p> : query.isError ? <p role="alert">{query.error.message}</p> : <>
      <section className="space-y-3"><h2 className="text-xl font-semibold">Revenus et résultat de gestion</h2>
        <p className="text-sm text-jisra-cream/70">{query.data.recognition.scope} Dates de service UTC. Aucune somme multidevise.</p>
        {query.data.recognition.rows.length === 0 && <p role="status">{query.data.recognition.no_policy_reason}</p>}
        <div className="grid gap-3 md:grid-cols-2">{query.data.recognition.rows.map((r) => <article key={r.currency} className="min-w-0 space-y-2 rounded-xl border border-white/15 p-4"><h3 className="font-semibold">Gestion {r.currency} — non comptable</h3>
          {r.available ? <><p>Revenu reconnu : {financeMoney(r.recognized_revenue_minor!, r.currency)}</p><p>Charges attribuables : {financeMoney(r.attributable_charges_minor!, r.currency)}</p><p>Résultat de gestion : {financeMoney(r.management_result_minor!, r.currency)}</p><p className="text-xs">{r.method}</p></> : <p role="status">Indisponible : {r.reason}</p>}
        </article>)}</div>
      </section>
      <section className="grid gap-4 md:grid-cols-2">{query.data.summary.map((s) => <article key={s.currency} className="min-w-0 space-y-3 rounded-2xl border border-white/15 p-5"><h2 className="font-semibold">Synthèse {s.currency}</h2>
        <p>Charges engagées TTC nettes d’avoirs : {financeMoney(s.committed_gross_minor, s.currency)}</p>
        <p>Encaissements abonnements : {financeMoney(s.receipts_minor, s.currency)}</p>
        <p>Flux net hors virements internes / soldes initiaux : {financeMoney(s.net_cash_flow_minor, s.currency)}</p>
        <p className="text-xs text-jisra-cream/60">{s.unassigned_receipts} encaissement(s) sans compte rapproché. Synthèse des flux filtrée par compte/devise ; charges par catégorie/devise, indépendantes du règlement.</p>
        <div aria-label="Comparaison engagements et encaissements" className="space-y-2"><Bar label="Charges nettes" value={s.committed_gross_minor} max={Math.max(Math.abs(s.committed_gross_minor), s.receipts_minor, 1)} /><Bar label="Encaissements" value={s.receipts_minor} max={Math.max(Math.abs(s.committed_gross_minor), s.receipts_minor, 1)} /></div>
      </article>)}</section>
      {query.data.summary.length === 0 && <p>Aucune donnée financière enregistrée. Aucun solde n’est supposé.</p>}
      <section className="space-y-3"><h2 className="text-xl font-semibold">Comptes de trésorerie — solde à la fin de période</h2><div className="grid gap-3 sm:grid-cols-2">{query.data.accounts.map((a) => <div key={a.id} className="rounded-xl border border-white/15 p-4"><p>{a.name} · {a.code}</p><p className="font-semibold">{financeMoney(a.balance_minor, a.currency)}</p></div>)}</div></section>
      <AdminFinanceForm key={editing?.id || 'new'} report={query.data} editing={editing} onDone={refresh} />
      {editing && <Button variant="outline" onClick={() => setEditing(null)}>Fermer l’édition</Button>}
      <section className="space-y-4"><div className="flex flex-wrap justify-between gap-3"><h2 className="text-xl font-semibold">Dépenses et avoirs</h2><a href={`/api/admin/finance/export?${params}&type=expenses`} className="underline">Export CSV autorisé (1 000 lignes maximum)</a></div>
        {query.data.expenses.map((e) => <article key={e.id} className="space-y-3 rounded-xl border border-white/15 p-5"><div className="flex flex-wrap justify-between gap-3"><h3 className="font-semibold">{e.beneficiary} — {e.description}</h3><p>{financeMoney(e.amount_minor, e.currency)}</p></div>
          <p className="text-sm">{e.incurred_on} · {e.category_name} · {e.status} · {e.kind} · référence {e.invoice_reference}</p><p>Règlements nets : {financeMoney(e.paid_minor, e.currency)}</p>
          {e.status === 'draft' && <div className="flex flex-wrap gap-3"><Button variant="outline" disabled={busy} onClick={() => setEditing(e)}>Modifier le brouillon</Button><Button disabled={busy} onClick={() => void action('post', e.id)}>Comptabiliser</Button><Button variant="outline" disabled={busy} onClick={() => void action('cancel', e.id)}>Annuler le brouillon</Button></div>}
          <label className="block space-y-2 text-sm"><span>Justificatif privé — PDF/PNG/JPEG, 5 Mo, trois maximum</span><input type="file" accept="application/pdf,image/png,image/jpeg" disabled={busy || e.proofs.length >= 3} onChange={(event) => void upload(e.id, event.target.files?.[0])} className="block w-full min-w-0" /></label>
          {e.proofs.map((p, index) => <a key={p.id} href={`/api/admin/finance/proofs/${e.id}?proof=${p.id}`} className="block underline">Justificatif privé {index + 1}</a>)}
        </article>)}
      </section>
      <section className="space-y-4"><div className="flex flex-wrap justify-between gap-3"><h2 className="text-xl font-semibold">Encaissements et mouvements de trésorerie</h2><a href={`/api/admin/finance/export?${params}&type=cash`} className="underline">Export CSV des flux</a></div>
        <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr>{['Date', 'Compte', 'Nature', 'Montant signé', 'Référence'].map((t) => <th key={t} className="p-3">{t}</th>)}</tr></thead><tbody>{query.data.movements.map((m) => <tr key={m.id} className="border-t border-white/10"><td className="whitespace-nowrap p-3">{m.occurred_on}</td><td className="p-3">{m.account_name || 'Non affecté'}</td><td className="p-3">{m.kind}</td><td className="whitespace-nowrap p-3">{financeMoney(m.amount_minor*m.direction, m.currency)}</td><td className="break-all p-3">{m.reference}</td></tr>)}</tbody></table></div>
      </section>
      <div className="flex gap-3"><Button variant="outline" disabled={filters.offset === '0'} onClick={() => setFilters({ ...filters, offset: String(Math.max(0, Number(filters.offset)-50)) })}>Précédent</Button><Button variant="outline" disabled={query.data.expenses.length < 50 && query.data.movements.length < 50} onClick={() => setFilters({ ...filters, offset: String(Number(filters.offset)+50) })}>Suivant</Button></div>
      <section className="space-y-3 rounded-xl border border-white/15 p-4"><h2 className="text-xl font-semibold">Conservation des justificatifs — inventaire sans suppression</h2><p className="text-sm">{query.data.retention.rules}</p>
        {query.data.retention.rows.map((r) => <div key={r.bucket} className="break-words text-sm"><p>{r.bucket} : {r.configured ? `${r.retention_months} mois ; délai orphelins ${r.orphan_grace_hours} h` : 'durées non approuvées — purge désactivée'}</p><p>Orphelins : {r.orphan_objects} · pièces liées manquantes : {r.missing_objects} · candidats théoriques : {r.purge_candidates ?? 'non calculés'}</p></div>)}
      </section>
      <section><h2 className="mb-3 text-xl font-semibold">Historique audité récent</h2><ol className="space-y-2 break-words text-sm">{query.data.history.map((h) => <li key={h.id}>{new Date(h.created_at).toLocaleString('fr-FR')} — {h.action} · {h.outcome}</li>)}</ol></section>
    </>}{error && <p role="alert" className="text-red-400">{error}</p>}
  </div>
}
function Filter({ name, label, type, value }: { name: string; label: string; type: string; value: string }) {
  return <label className="space-y-2 text-sm"><span>{label}</span><input name={name} type={type} required defaultValue={value} className="min-h-11 w-full rounded-xl border border-white/20 bg-jisra-ink px-3" /></label>
}
function Choice({ name, label, options }: { name: string; label: string; options: string[][] }) {
  return <label className="space-y-2 text-sm"><span>{label}</span><select name={name} className="min-h-11 w-full min-w-0 rounded-xl border border-white/20 bg-jisra-ink px-3"><option value="">Tous</option>{options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select></label>
}
function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  return <div><p className="text-xs">{label}</p><div className="mt-1 h-2 rounded bg-white/10"><div style={{ width: `${Math.min(100, Math.abs(value)/max*100)}%` }} className="h-2 rounded bg-jisra-green" /></div></div>
}