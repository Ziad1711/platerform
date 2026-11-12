'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

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
      sessionStorage.removeItem(storageKey)
      router.push(`/payment-requests/${result.id}`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Demande indisponible.') }
    finally { lock.current = false; setBusy(false) }
  }
  return <div className="space-y-3">
    <p className="text-sm">Créer une demande réserve une référence et le tarif affiché, sans payer ni activer un abonnement. Le virement reste indisponible tant que les coordonnées officielles ne sont pas configurées.</p>
    <button onClick={() => void create()} disabled={busy} className="min-h-11 w-full rounded-xl bg-jisra-green px-5 py-3 font-semibold text-white disabled:opacity-50">
      {busy ? 'Création en cours…' : 'Créer ou reprendre ma demande'}
    </button>
    {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
  </div>
}