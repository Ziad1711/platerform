'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { formatMad } from '@/lib/billing/presentation'
import { paymentStatusLabels, type PaymentDetail } from '@/lib/billing/payments'

const eventLabels: Record<string, string> = {
  created: 'Demande créée', expired: 'Demande expirée', cancelled: 'Demande annulée',
  declared: 'Virement déclaré par le client — non validé', proof_added: 'Justificatif ajouté — non vérifié',
  validated: 'Encaissement vérifié et période accordée', refused: 'Demande refusée après vérification',
}
export function PaymentRequestDetail({ id }: { id: string }) {
  const client = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const lock = useRef(false)
  const query = useQuery({
    queryKey: ['payment-request', id],
    retry: false,
    queryFn: async () => {
      const response = await fetch(`/api/billing/payment-requests/${id}`, { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      return result as PaymentDetail
    },
  })
  async function mutate(action: 'declare' | 'cancel' | 'upload') {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try {
      const body = action === 'upload' ? new FormData() : JSON.stringify({ action })
      if (body instanceof FormData) {
        if (!file) throw new Error('Sélectionnez un justificatif.')
        body.set('file', file)
      }
      const response = await fetch(`/api/billing/payment-requests/${id}${action === 'upload' ? '/proofs' : ''}`, {
        method: 'POST', body, headers: action === 'upload' ? undefined : { 'Content-Type': 'application/json' },
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      setFile(null)
      await client.invalidateQueries({ queryKey: ['payment-request', id] })
      await client.invalidateQueries({ queryKey: ['payment-requests'] })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Opération indisponible.') }
    finally { lock.current = false; setBusy(false) }
  }
  if (query.isPending) return <p role="status">Chargement de votre demande…</p>
  if (!query.data) return <div role="alert"><p>{query.error?.message || 'Demande indisponible.'}</p><Link href="/payment-requests" className="underline">Mes demandes</Link></div>
  const { request, bank, proofs, events } = query.data
  const open = request.status === 'pending' || request.status === 'review'
  return <div className="mx-auto max-w-2xl space-y-6">
    <h1 className="text-2xl font-bold">Demande {request.plan_name}</h1>
    <div className="space-y-3 rounded-2xl border border-white/15 p-5">
      <p className="font-semibold">{paymentStatusLabels[request.status]}</p>
      <p className="text-xl font-semibold">{formatMad(request.amount_minor)} — {request.duration_months} mois</p>
      <p className="text-sm">Tarif figé à la création, version {request.price_version}. Aucun changement ultérieur du catalogue ne modifie ce montant.</p>
      <p className="text-sm">Référence à mentionner dans le virement :</p>
      <p className="break-all font-mono text-sm">{request.reference}</p>
      <button type="button" className="min-h-11 rounded-lg border px-4" onClick={() => void navigator.clipboard.writeText(request.reference).catch(() => setError('Copiez la référence affichée ci-dessus.'))}>Copier la référence</button>
      <p className="text-sm">Validité de la demande : {new Date(request.expires_at).toLocaleString('fr-FR')}.</p>
      <p className="text-sm">Cette demande, votre déclaration et un justificatif ne valent jamais confirmation bancaire ni activation d’abonnement.</p>
    </div>
    {!bank.enabled ? <div role="status" className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4">
      Paiement indisponible : les coordonnées bancaires officielles ne sont pas configurées. N’effectuez aucun virement. Le dépôt et la déclaration sont désactivés.
    </div> : <section className="space-y-2 rounded-xl border p-5">
      <h2 className="font-semibold">Instructions de virement</h2>
      <p>Bénéficiaire : {bank.beneficiary}</p><p>Banque : {bank.bank_name}</p>
      <p className="break-all">RIB : {bank.rib}</p><p>{bank.instructions}</p>
      <p>Montant exact : {formatMad(request.amount_minor)}. Indiquez la référence ci-dessus.</p>
    </section>}
    {open && <section className="space-y-4 rounded-xl border p-5">
      <h2 className="font-semibold">Justificatif facultatif</h2>
      <label className="block space-y-2"><span>PDF, PNG ou JPEG — 5 Mo maximum, trois fichiers maximum</span>
        <input key={proofs.length} type="file" accept="application/pdf,image/png,image/jpeg" disabled={busy || !bank.enabled}
          className="block w-full min-w-0 text-sm" onChange={(event) => setFile(event.target.files?.[0] || null)} />
      </label>
      <button disabled={busy || !bank.enabled || !file || proofs.length >= 3} onClick={() => void mutate('upload')} className="min-h-11 rounded-xl border px-4 disabled:opacity-40">Déposer le justificatif</button>
      <p className="text-sm">Ne transmettez pas de données non nécessaires. Les fichiers sont privés et ne sont pas analysés par l’IA.</p>
      {request.status === 'pending' && <button disabled={busy || !bank.enabled} onClick={() => void mutate('declare')} className="min-h-11 w-full rounded-xl bg-jisra-green px-5 py-3 text-white disabled:opacity-40">Virement effectué — demander une vérification</button>}
      {request.status === 'pending' && <button disabled={busy} onClick={() => void mutate('cancel')} className="min-h-11 rounded-xl border px-4 disabled:opacity-40">Annuler ma demande</button>}
    </section>}
    {error && <p role="alert" className="text-red-400">{error}</p>}
    <section className="space-y-3"><h2 className="font-semibold">Justificatifs privés</h2>
      {proofs.length === 0 ? <p>Aucun justificatif déposé.</p> : proofs.map((proof, index) => <a key={proof.id}
        href={`/api/billing/payment-requests/${id}/proofs?proof=${proof.id}`} className="block min-h-11 underline">Télécharger le justificatif {index + 1}</a>)}
    </section>
    <section className="space-y-3"><h2 className="font-semibold">Historique</h2>
      <ol className="space-y-2 text-sm">{events.map((event) => <li key={event.id}>{new Date(event.created_at).toLocaleString('fr-FR')} — {eventLabels[event.event_type] || 'Mise à jour de la demande'}{event.reason && <p>{event.reason}</p>}</li>)}</ol>
    </section>
    <div className="flex flex-wrap gap-5"><Link href="/payment-requests" className="underline">Toutes mes demandes</Link><Link href="/pricing" className="underline">Choisir une offre actuelle</Link>
      <button className="underline" onClick={() => void query.refetch()}>Actualiser le statut</button></div>
  </div>
}