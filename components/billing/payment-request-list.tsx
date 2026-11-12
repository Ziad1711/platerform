'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { formatMad } from '@/lib/billing/presentation'
import { paymentStatusLabels, type PaymentRequest } from '@/lib/billing/payments'

export function PaymentRequestList() {
  const query = useQuery({ queryKey: ['payment-requests'], retry: false, queryFn: async () => {
    const response = await fetch('/api/billing/payment-requests', { cache: 'no-store' })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error)
    return result.requests as PaymentRequest[]
  } })
  return <section className="mx-auto max-w-3xl space-y-5">
    <h1 className="text-2xl font-bold">Mes demandes de paiement</h1>
    <p>Aucune déclaration client ne peut activer un abonnement. Seule une future vérification bancaire autorisée le permettra.</p>
    {query.isPending ? <p role="status">Chargement…</p> : query.isError ? <p role="alert">{query.error.message}</p>
      : query.data?.length === 0 ? <p>Aucune demande. <Link href="/pricing" className="underline">Choisir un forfait</Link></p>
        : query.data?.map((row) => <Link key={row.id} href={`/payment-requests/${row.id}`} className="block space-y-2 rounded-xl border border-white/15 p-5">
          <p className="font-semibold">{row.plan_name} — {formatMad(row.amount_minor)} / {row.duration_months} mois</p>
          <p>{paymentStatusLabels[row.status]}</p>
          <p className="break-all font-mono text-xs">{row.reference}</p>
        </Link>)}
  </section>
}