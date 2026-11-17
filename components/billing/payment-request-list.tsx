'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { formatMad } from '@/lib/billing/presentation'
import { paymentStatusLabels, paymentUxLabels, paymentUxState, type PaymentRequest } from '@/lib/billing/payments'

const toneClass: Record<string, string> = {
  amber: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
  blue: 'border-sky-400/30 bg-sky-400/10 text-sky-200',
  red: 'border-red-400/30 bg-red-400/10 text-red-200',
  green: 'border-jisra-green/40 bg-jisra-green/10 text-jisra-green-light',
}

export function PaymentRequestList() {
  const query = useQuery({ queryKey: ['payment-requests'], retry: false, queryFn: async () => {
    const response = await fetch('/api/billing/payment-requests', { cache: 'no-store' })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error)
    return result.requests as PaymentRequest[]
  } })
  return <section className="mx-auto max-w-3xl space-y-5">
    <h1 className="text-2xl font-bold">Mes paiements</h1>
    <p className="text-sm text-jisra-cream/70">Votre abonnement est activé uniquement après vérification bancaire de l&apos;encaissement.</p>
    {query.isPending ? <p role="status">Chargement…</p> : query.isError ? <p role="alert">{query.error.message}</p>
      : query.data?.length === 0 ? <p>Aucun paiement. <Link href="/pricing" className="underline">Choisir un forfait</Link></p>
        : query.data?.map((row) => {
          const ux = paymentUxState(row.status)
          const label = paymentUxLabels[ux]
          return <Link key={row.id} href={`/payment-requests/${row.id}`} className="block space-y-3 rounded-xl border border-white/15 p-5 hover:border-white/30">
            <div className="flex items-center justify-between gap-3">
              <p className="font-semibold">{row.plan_name} — {formatMad(row.amount_minor)}</p>
              <span className={`rounded-full border px-3 py-1 text-xs ${toneClass[label.tone]}`}>{label.title}</span>
            </div>
            <p className="text-sm text-jisra-cream/60">{paymentStatusLabels[row.status]} · {row.duration_months} mois · {new Date(row.created_at).toLocaleDateString('fr-FR')}</p>
          </Link>
        })}
  </section>
}