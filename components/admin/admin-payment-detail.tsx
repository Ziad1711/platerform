'use client'

import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { formatMad } from '@/lib/billing/presentation'
import { paymentStatusLabels, type PaymentRequest, type PaymentProof, type PaymentEvent } from '@/lib/billing/payments'

type Detail = {
  request: PaymentRequest & { client_name: string | null; user_id: string }
  proofs: PaymentProof[]; events: (PaymentEvent & { reason?: string })[]
  receipt: { bank_account: string; bank_reference: string; amount_minor: number; value_date: string; verified_at: string; started_at: string; expires_at: string } | null
}
export function AdminPaymentDetail({ id }: { id: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [action, setAction] = useState('approve')
  const decisionKey = useRef<string | null>(null)
  const lock = useRef(false)
  const query = useQuery({ queryKey: ['admin-payment', id], retry: false, queryFn: async () => {
    const response = await fetch(`/api/admin/payments/${id}`, { cache: 'no-store' })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error)
    return data as Detail
  } })
  async function decide(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (lock.current) return
    const form = new FormData(event.currentTarget)
    if (form.get('confirmed') !== 'on') return
    lock.current = true; setBusy(true); setError(''); setSuccess('')
    try {
      decisionKey.current ||= crypto.randomUUID()
      const amount = String(form.get('amount') || '').replace(',', '.')
      const payload: Record<string, unknown> = { action, key: decisionKey.current, reason: form.get('reason') }
      if (action === 'approve') {
        if (!/^\d+(\.\d{1,2})?$/.test(amount)) throw new Error('Saisissez le montant réellement crédité avec deux décimales maximum.')
        payload.amountMinor = Math.round(Number(amount) * 100)
        payload.currency = 'MAD'; payload.bankAccount = form.get('bankAccount'); payload.bankReference = form.get('bankReference'); payload.valueDate = form.get('valueDate')
      }
      const response = await fetch(`/api/admin/payments/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      setSuccess(result.replayed ? 'Décision déjà enregistrée, aucun doublon créé.' : 'Décision enregistrée dans une transaction unique.')
      await query.refetch()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Décision indisponible.') }
    finally { lock.current = false; setBusy(false) }
  }
  if (query.isPending) return <p role="status">Chargement de la demande…</p>
  if (query.isError) return <p role="alert">{query.error.message}</p>
  const { request, proofs, events, receipt } = query.data
  return <div className="max-w-4xl space-y-7">
    <h1 className="text-2xl font-bold">Vérification bancaire — {request.plan_name}</h1>
    <section className="space-y-3 rounded-2xl border border-white/15 p-5"><p>{request.client_name || 'Compte client'} — <span className="break-all font-mono text-xs">{request.user_id}</span></p>
      <p className="break-all font-mono text-sm">{request.reference}</p><p className="text-xl font-semibold">{formatMad(request.amount_minor)} — {request.duration_months} mois</p>
      <p>{paymentStatusLabels[request.status]} · version tarifaire {request.price_version}</p><p className="text-sm">Le tarif historique de la demande fait autorité, pas le catalogue actuel. Aucun accès aux opérations des boutiques.</p>
    </section>
    <section className="space-y-3"><h2 className="font-semibold">Justificatifs privés</h2>{proofs.length ? proofs.map((proof, index) => <a key={proof.id} href={`/api/admin/payments/${id}?proof=${proof.id}`} className="block min-h-11 underline">Télécharger le justificatif {index + 1} — accès audité</a>) : <p>Aucun justificatif. Vérifiez directement le relevé bancaire.</p>}</section>
    {receipt && <section className="space-y-2 rounded-xl border border-jisra-green/30 p-5"><h2 className="font-semibold">Encaissement vérifié</h2><p>{formatMad(receipt.amount_minor)} · valeur {receipt.value_date}</p><p className="break-all">{receipt.bank_account} — {receipt.bank_reference}</p><p>Période acquise : {new Date(receipt.started_at).toLocaleString('fr-FR')} → {new Date(receipt.expires_at).toLocaleString('fr-FR')}</p></section>}
    {['pending', 'review'].includes(request.status) && <form onSubmit={(event) => void decide(event)} className="grid gap-4 rounded-2xl border border-white/15 p-5 sm:grid-cols-2">
      <h2 className="font-semibold sm:col-span-2">Décision — permission et TOTP récent requis</h2>
      <label className="space-y-2 sm:col-span-2"><span>Action</span><select value={action} onChange={(event) => { setAction(event.target.value); decisionKey.current = null }} className="min-h-11 w-full rounded-xl border border-white/20 bg-jisra-ink px-3"><option value="approve">Valider après vérification bancaire</option><option value="refuse">Refuser avec motif</option></select></label>
      {action === 'approve' && <>
        <Field name="amount" label="Montant réellement crédité (MAD)" />
        <Field name="valueDate" label="Date de valeur bancaire" type="date" />
        <Field name="bankAccount" label="Identifiant du compte bancaire rapproché" />
        <Field name="bankReference" label="Référence bancaire unique" />
      </>}
      <label className="space-y-2 sm:col-span-2"><span>Motif visible au client — aucune donnée bancaire confidentielle</span><textarea name="reason" required minLength={10} maxLength={300} className="min-h-24 w-full rounded-xl border border-white/20 bg-jisra-ink p-3" /></label>
      <label className="flex gap-3 text-sm sm:col-span-2"><input name="confirmed" type="checkbox" required /><span>Je confirme ma décision après vérification. Un justificatif seul n’est pas une preuve d’encaissement.</span></label>
      <Button size="lg" disabled={busy} type="submit">{busy ? 'Traitement atomique…' : 'Confirmer la décision'}</Button>
    </form>}
    {error && <p role="alert" className="text-red-400">{error}</p>}{success && <p role="status" className="text-jisra-green">{success}</p>}
    <section><h2 className="mb-3 font-semibold">Historique des décisions et événements</h2><ol className="space-y-3 text-sm">{events.map((event) => <li key={event.id} className="rounded-lg border border-white/10 p-3">{new Date(event.created_at).toLocaleString('fr-FR')} — {event.event_type}{event.reason && <p className="mt-2">{event.reason}</p>}</li>)}</ol></section>
  </div>
}
function Field({ name, label, type = 'text' }: { name: string; label: string; type?: string }) {
  return <label className="space-y-2"><span>{label}</span><input required name={name} type={type} maxLength={120} className="min-h-11 w-full min-w-0 rounded-xl border border-white/20 bg-jisra-ink px-3" /></label>
}