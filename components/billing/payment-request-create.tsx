'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { sendPixel } from '@/lib/analytics/meta-browser'

export function PaymentRequestCreate({ priceId }: { priceId: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const router = useRouter()
  async function create() {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      const storageKey = `jisra-payment-request:${priceId}`
      let key = sessionStorage.getItem(storageKey)
      if (!key) { key = crypto.randomUUID(); sessionStorage.setItem(storageKey, key) }
      const response = await fetch('/api/billing/payment-requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceId, idempotencyKey: key }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      if (result.metaEventId) sendPixel('InitiateCheckout', result.metaEventId)
      sessionStorage.removeItem(storageKey)
      router.push(`/payment-requests/${result.id}`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Demande indisponible.') }
    finally { lock.current = false; setBusy(false) }
  }
  return <div className="space-y-3">
    <p className="text-sm text-jisra-cream/70">Aucun paiement n&apos;est encaissé à cette étape. Votre abonnement sera confirmé après vérification bancaire.</p>
    <button onClick={() => void create()} disabled={busy} className="min-h-11 w-full rounded-xl bg-jisra-green px-5 py-3 font-semibold text-white disabled:opacity-50">
      {busy ? 'Préparation…' : 'Continuer vers le paiement'}
    </button>
    {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
  </div>
}