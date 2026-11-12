'use client'

import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import type { FinanceReport, Expense } from '@/lib/admin/finance'

const actions = [
  ['expense', 'Nouvelle dépense'], ['account', 'Compte de trésorerie'], ['category', 'Catégorie'],
  ['settle', 'Régler une dépense'], ['expense_refund', 'Remboursement fournisseur'], ['credit', 'Avoir intégral de charge'],
  ['transfer', 'Virement interne'], ['movement', 'Autre mouvement'], ['reverse', 'Compenser un mouvement'],
] as const

export function AdminFinanceForm({ report, editing, onDone }: { report: FinanceReport; editing: Expense | null; onDone: () => Promise<void> }) {
  const [action, setAction] = useState<string>(editing ? 'expense_update' : 'expense')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const key = useRef<string | null>(null)
  const previousPayload = useRef('')
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return
    setBusy(true); setMessage('')
    try {
      const form = new FormData(event.currentTarget)
      const data: Record<string, unknown> = Object.fromEntries(form)
      for (const name of ['amountMinor', 'taxMinor']) if (name in data) {
        const value = String(data[name]).replace(',', '.')
        if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error('Montant invalide : deux décimales maximum.')
        data[name] = Math.round(Number(value) * 100)
      }
      if (editing && action === 'expense_update') { data.id = editing.id; data.version = editing.version }
      if (action === 'category' && data.id === '') delete data.id
      if (action === 'category') data.active = data.active === 'true'
      if (data.paymentId === '') delete data.paymentId
      const payload = JSON.stringify({ action, data })
      if (previousPayload.current !== payload) { key.current = crypto.randomUUID(); previousPayload.current = payload }
      const response = await fetch('/api/admin/finance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, data, key: key.current }) })
      const result = await response.json(); if (!response.ok) throw new Error(result.error)
      setMessage(result.replayed ? 'Opération déjà enregistrée, sans doublon.' : 'Opération enregistrée et auditée.')
      await onDone()
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Opération indisponible.') }
    finally { setBusy(false) }
  }
  const expense = action === 'expense' || action === 'expense_update'
  const settlement = action === 'settle' || action === 'expense_refund'
  return <section className="rounded-2xl border border-white/15 p-5">
    <h2 className="mb-4 text-lg font-semibold">{editing ? 'Modifier le brouillon' : 'Enregistrer une opération'}</h2>
    {!editing && <select aria-label="Type d’opération" value={action} onChange={(event) => { setAction(event.target.value); setMessage('') }} className="mb-5 min-h-11 w-full rounded-xl border border-white/20 bg-jisra-ink px-3">{actions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>}
    <form key={`${action}-${editing?.id || ''}`} onSubmit={(event) => void submit(event)} className="grid gap-4 sm:grid-cols-2">
      {expense && <>
        <Select name="categoryId" label="Catégorie" value={editing?.category_id} options={report.categories.filter((c) => c.active).map((c) => [c.id, c.name])} />
        <Field name="beneficiary" label="Bénéficiaire" value={editing?.beneficiary} />
        <Field name="description" label="Description" value={editing?.description} />
        <Field name="invoiceReference" label="Référence facture unique" value={editing?.invoice_reference} />
        <Field name="taxMinor" label="Taxe incluse dans le total (devise)" value={String((editing?.tax_minor || 0) / 100)} />
      </>}
      {(expense || settlement || action === 'transfer' || action === 'movement') && <Field name="amountMinor" label="Montant total dans la devise (ex. 125,50)" value={editing ? String(editing.amount_minor / 100) : undefined} />}
      {(expense || action === 'account') && <Select name="currency" label="Devise — aucune conversion" value={editing?.currency} options={['MAD', 'EUR', 'USD', 'GBP', 'CAD', 'AED'].map((c) => [c, c])} />}
      {action === 'account' && <><Field name="code" label="Code bancaire (identique au rapprochement 4B)" /><Field name="name" label="Libellé du compte" /></>}
      {action === 'category' && <><Field name="name" label="Nom de catégorie" /><Field name="id" label="UUID catégorie existante (facultatif)" required={false} /><Select name="active" label="État" options={[["true", 'Active'], ['false', 'Désactivée']]} /></>}
      {(settlement || action === 'credit') && <Select name="id" label="Dépense comptabilisée" options={report.expenses.filter((e) => e.status === 'posted' && e.kind === 'charge').map((e) => [e.id, `${e.beneficiary} — ${e.invoice_reference} (${e.currency})`])} />}
      {(settlement || action === 'transfer' || action === 'movement') && <Select name="accountId" label="Compte de trésorerie" options={report.accounts.map((a) => [a.id, `${a.name} (${a.currency})`])} />}
      {action === 'transfer' && <Select name="targetAccountId" label="Compte destinataire — même devise" options={report.accounts.map((a) => [a.id, `${a.name} (${a.currency})`])} />}
      {action === 'movement' && <><Select name="kind" label="Nature du flux" options={[["opening", 'Solde initial rapproché'], ['contribution', 'Apport'], ['withdrawal', 'Retrait'], ['payment_refund', 'Remboursement client']]} /><Field name="paymentId" label="UUID encaissement 4B (remboursement client uniquement)" required={false} /></>}
      {action === 'reverse' && <Select name="id" label="Mouvement à compenser (virement interne : deux côtés)" options={report.movements.filter((m) => !['subscription_receipt', 'opening', 'correction'].includes(m.kind)).map((m) => [m.id, `${m.reference} — ${m.kind} (${m.currency})`])} />}
      {!['account', 'category'].includes(action) && <Field name="date" label={expense ? 'Date d’engagement' : 'Date de valeur'} type="date" value={editing?.incurred_on} />}
      {['settle', 'expense_refund', 'transfer', 'movement', 'reverse'].includes(action) && <Field name="reference" label="Référence unique du mouvement" />}
      <div className="sm:col-span-2"><Field name="reason" label="Motif obligatoire (10 caractères minimum, sans secret)" minLength={10} /></div>
      <Button size="lg" disabled={busy} type="submit">{busy ? 'Enregistrement…' : 'Enregistrer sans opération bancaire'}</Button>
    </form>{message && <p role="status" className="mt-4 text-sm">{message}</p>}
  </section>
}
function Field({ name, label, value, type = 'text', required = true, minLength }: { name: string; label: string; value?: string; type?: string; required?: boolean; minLength?: number }) {
  return <label className="block space-y-2 text-sm"><span>{label}</span><input name={name} defaultValue={value} type={type} required={required} minLength={minLength} maxLength={500} className="min-h-11 w-full min-w-0 rounded-xl border border-white/20 bg-jisra-ink px-3" /></label>
}
function Select({ name, label, options, value }: { name: string; label: string; options: string[][]; value?: string }) {
  return <label className="block space-y-2 text-sm"><span>{label}</span><select name={name} defaultValue={value} required className="min-h-11 w-full min-w-0 rounded-xl border border-white/20 bg-jisra-ink px-3"><option value="">Sélectionner</option>{options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select></label>
}