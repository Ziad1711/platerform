'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ClipboardCopy, Copy } from 'lucide-react'
import { formatMad } from '@/lib/billing/presentation'
import { paymentUxLabels, paymentUxState, type PaymentDetail } from '@/lib/billing/payments'

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    let ok = false
    try { ok = document.execCommand('copy') } catch { ok = false }
    document.body.removeChild(area)
    return ok
  }
}

const toneClass: Record<string, string> = {
  amber: 'border-amber-400/30 bg-amber-400/10 text-amber-100',
  blue: 'border-sky-400/30 bg-sky-400/10 text-sky-100',
  red: 'border-red-400/30 bg-red-400/10 text-red-100',
  green: 'border-jisra-green/40 bg-jisra-green/10 text-jisra-green-light',
}

function CopyField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    if (!(await copyText(value))) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <div className="min-w-0">
        <p className="text-xs text-jisra-cream/60">{label}</p>
        <p className={`break-all ${mono ? 'font-mono text-sm' : 'text-sm'}`}>{value}</p>
      </div>
      <button type="button" onClick={() => void copy()} aria-label={`Copier ${label}`}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/15 text-jisra-cream/70 transition hover:border-white/30 hover:text-jisra-cream">
        {copied ? <Check className="h-4 w-4 text-jisra-green" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  )
}

const eventLabels: Record<string, string> = {
  created: 'Demande créée', expired: 'Demande expirée', cancelled: 'Demande annulée',
  declared: 'Virement déclaré — en attente de vérification', proof_added: 'Justificatif ajouté',
  validated: 'Encaissement vérifié et période accordée', refused: 'Paiement refusé après vérification',
}
export function PaymentRequestDetail({ id }: { id: string }) {
  const client = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [copiedAll, setCopiedAll] = useState(false)
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

  async function refresh() {
    await client.invalidateQueries({ queryKey: ['payment-request', id] })
    await client.invalidateQueries({ queryKey: ['payment-requests'] })
  }

  async function post(action: 'declare' | 'cancel') {
    const response = await fetch(`/api/billing/payment-requests/${id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error)
  }

  async function uploadProof() {
    if (!file) throw new Error('Sélectionnez un justificatif.')
    const form = new FormData()
    form.set('file', file)
    const response = await fetch(`/api/billing/payment-requests/${id}/proofs`, { method: 'POST', body: form })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error)
  }

  async function submitProof() {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try {
      await uploadProof()
      await post('declare')
      setFile(null)
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Opération indisponible.') }
    finally { lock.current = false; setBusy(false) }
  }

  async function declareOnly() {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try { await post('declare'); await refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Opération indisponible.') }
    finally { lock.current = false; setBusy(false) }
  }

  async function cancelRequest() {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try { await post('cancel'); await refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Opération indisponible.') }
    finally { lock.current = false; setBusy(false) }
  }

  if (query.isPending) return <p role="status" className="mx-auto max-w-2xl py-10">Chargement de votre paiement…</p>
  if (!query.data) return <div role="alert" className="mx-auto max-w-2xl py-10"><p>{query.error?.message || 'Paiement indisponible.'}</p><Link href="/payment-requests" className="underline">Mes paiements</Link></div>
  const { request, bank, proofs, events, receipt } = query.data
  const ux = paymentUxState(request.status, receipt?.started_at)
  const uxLabel = paymentUxLabels[ux]
  const allCopyText = [
    `Bénéficiaire : ${bank.beneficiary}`,
    `Banque : ${bank.bank_name}`,
    `RIB : ${bank.rib}`,
    `Référence du virement : ${request.reference}`,
    `Montant exact : ${formatMad(request.amount_minor)}`,
  ].join('\n')
  async function copyAll() {
    if (!(await copyText(allCopyText))) return
    setCopiedAll(true)
    window.setTimeout(() => setCopiedAll(false), 1600)
  }
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-1">
        <p className="text-sm uppercase tracking-wider text-jisra-green">Paiement par virement</p>
        <h1 className="text-2xl font-bold">Régler votre abonnement {request.plan_name}</h1>
        <p className="text-jisra-cream/70">{formatMad(request.amount_minor)} pour {request.duration_months} mois · {request.billing_period === 'yearly' ? 'annuel' : 'mensuel'}</p>
      </header>

      <div role="status" className={`rounded-2xl border p-4 ${toneClass[uxLabel.tone]}`}>
        <p className="font-semibold">{uxLabel.title}</p>
        {ux === 'awaiting_payment' && <p className="mt-1 text-sm">Effectuez le virement ci-dessous puis envoyez votre justificatif.</p>}
        {ux === 'in_review' && <p className="mt-1 text-sm">Votre virement est en cours de vérification administrative. Vous recevrez un e-mail après décision.</p>}
        {ux === 'refused' && <p className="mt-1 text-sm">Le motif figure dans l&apos;historique ci-dessous. Vous pouvez initier un nouveau paiement.</p>}
        {ux === 'activated' && <p className="mt-1 text-sm">Votre abonnement est actif{receipt?.expires_at ? ` jusqu&apos;au ${new Date(receipt.expires_at).toLocaleDateString('fr-FR')}` : ''}.</p>}
        {ux === 'scheduled' && receipt && <p className="mt-1 text-sm">Période accordée du {new Date(receipt.started_at).toLocaleDateString('fr-FR')}{receipt.expires_at ? ` au ${new Date(receipt.expires_at).toLocaleDateString('fr-FR')}` : ''}.</p>}
        {ux === 'expired' && <p className="mt-1 text-sm">Cette demande a expiré sans encaissement vérifié. Choisissez à nouveau une offre.</p>}
      </div>

      {!bank.enabled ? (
        <div role="status" className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm">
          Le paiement par virement est momentanément indisponible : les coordonnées bancaires officielles ne sont pas encore publiées. N&apos;effectuez aucun virement.
        </div>
      ) : (
        <section className="space-y-4 rounded-2xl border border-white/15 p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">Effectuez votre virement</h2>
            <button type="button" onClick={() => void copyAll()} disabled={copiedAll}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-jisra-green/40 bg-jisra-green/10 px-4 text-sm font-medium text-jisra-green-light disabled:opacity-60">
              {copiedAll ? <Check className="h-4 w-4" /> : <ClipboardCopy className="h-4 w-4" />}
              {copiedAll ? 'Copié !' : 'Tout copier'}
            </button>
          </div>
          {bank.instructions && <p className="text-sm text-jisra-cream/70">{bank.instructions}</p>}
          <div className="grid gap-2 sm:grid-cols-2">
            <CopyField label="Bénéficiaire" value={bank.beneficiary ?? ''} />
            <CopyField label="Banque" value={bank.bank_name ?? ''} />
            <CopyField label="RIB" value={bank.rib ?? ''} mono />
            <CopyField label="Référence du virement" value={request.reference} mono />
            <CopyField label="Montant exact" value={formatMad(request.amount_minor)} />
          </div>
          <p className="text-xs text-jisra-cream/50">Vous pouvez privilégier le virement instantané si votre banque le propose. L&apos;activation reste soumise à la vérification de l&apos;encaissement.</p>
        </section>
      )}
      {ux === 'awaiting_payment' && bank.enabled && (
        <section className="space-y-4 rounded-2xl border border-white/15 p-5">
          <h2 className="font-semibold">Envoyez votre justificatif</h2>
          <label className="block space-y-2">
            <span className="text-sm text-jisra-cream/70">PDF, PNG ou JPEG — 5 Mo maximum</span>
            <input key={proofs.length} type="file" accept="application/pdf,image/png,image/jpeg" disabled={busy}
              className="block w-full min-w-0 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-jisra-green/15 file:px-4 file:py-2 file:text-sm file:font-medium file:text-jisra-green-light"
              onChange={(event) => setFile(event.target.files?.[0] || null)} />
          </label>
          {file && <p className="text-sm text-jisra-cream/70">Fichier sélectionné : {file.name} ({(file.size / 1024).toFixed(0)} Ko)</p>}
          <button type="button" disabled={busy || !file} onClick={() => void submitProof()}
            className="min-h-11 w-full rounded-xl bg-jisra-green px-5 py-3 font-semibold text-white disabled:opacity-40">
            {busy ? 'Envoi en cours…' : 'Envoyer mon justificatif'}
          </button>
          <div className="flex items-center gap-3 text-sm">
            <span className="h-px flex-1 bg-white/10" /><span className="text-jisra-cream/50">ou</span><span className="h-px flex-1 bg-white/10" />
          </div>
          <button type="button" disabled={busy} onClick={() => void declareOnly()}
            className="min-h-11 w-full rounded-xl border border-white/20 px-5 py-3 text-sm font-medium disabled:opacity-40">
            J&apos;ai effectué le virement sans justificatif
          </button>
          <button type="button" disabled={busy} onClick={() => void cancelRequest()}
            className="min-h-11 w-full rounded-lg text-sm text-jisra-cream/60 underline disabled:opacity-40">
            Annuler cette demande
          </button>
          <p className="text-xs text-jisra-cream/50">Envoyer le justificatif ne déclenche jamais l&apos;activation : seule la vérification administrative de l&apos;encaissement la permet.</p>
        </section>
      )}

      {ux === 'in_review' && (
        <div role="status" className="rounded-2xl border border-jisra-green/40 bg-jisra-green/10 p-5 text-center">
          <p className="text-lg font-semibold">Votre demande a bien été reçue</p>
          <p className="mt-1 text-sm text-jisra-cream/70">La vérification de votre virement est en cours. Nous vous informerons par e-mail après la décision.</p>
        </div>
      )}

      {error && <p role="alert" className="rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">{error}</p>}

      <section className="space-y-3">
        <h2 className="font-semibold">Justificatifs privés</h2>
        {proofs.length === 0 ? <p className="text-sm text-jisra-cream/60">Aucun justificatif déposé.</p>
          : proofs.map((proof, index) => <a key={proof.id} href={`/api/billing/payment-requests/${id}/proofs?proof=${proof.id}`} className="block min-h-11 text-sm underline">Télécharger le justificatif {index + 1}</a>)}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Historique</h2>
        <ol className="space-y-2 text-sm">{events.map((event) => <li key={event.id}>{new Date(event.created_at).toLocaleString('fr-FR')} — {eventLabels[event.event_type] || 'Mise à jour'}{event.reason && <p className="text-jisra-cream/70">{event.reason}</p>}</li>)}</ol>
      </section>

      <div className="flex flex-wrap gap-5 text-sm">
        <Link href="/payment-requests" className="underline">Tous mes paiements</Link>
        <Link href="/pricing" className="underline">Choisir une offre</Link>
        <button className="underline" onClick={() => void query.refetch()}>Actualiser</button>
      </div>
    </div>
  )
}