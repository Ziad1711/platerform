'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { formatMad } from '@/lib/billing/presentation'
import { paymentStatusLabels, type PaymentRequest } from '@/lib/billing/payments'
import { Button } from '@/components/ui/button'

export function AdminPayments() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [offset, setOffset] = useState(0)
  const query = useQuery({ queryKey: ['admin-payments', search, status, offset], retry: false, queryFn: async () => {
    const response = await fetch(`/api/admin/payments?${new URLSearchParams({ search, status, offset: String(offset) })}`, { cache: 'no-store' })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error)
    return data.requests as (PaymentRequest & { client_name: string | null; user_id: string })[]
  } })
  return <div className="space-y-6">
    <h1 className="text-3xl font-bold">Paiements et rapprochements</h1>
    <p className="text-sm text-jisra-cream/70">Une preuve déposée n’est pas un encaissement. Vérifiez le crédit bancaire avant toute décision.</p>
    <form className="flex flex-col gap-3 sm:flex-row" onSubmit={(event) => { event.preventDefault(); setSearch(String(new FormData(event.currentTarget).get('search') || '')); setOffset(0) }}>
      <input name="search" maxLength={100} placeholder="Référence, nom ou UUID du client" aria-label="Rechercher une demande" className="min-h-11 min-w-0 flex-1 rounded-xl border border-white/20 bg-jisra-ink px-4" />
      <select value={status} aria-label="Statut de la demande" onChange={(event) => { setStatus(event.target.value); setOffset(0) }} className="min-h-11 rounded-xl border border-white/20 bg-jisra-ink px-3"><option value="">Tous les statuts</option>{Object.entries(paymentStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <Button size="lg" type="submit">Rechercher</Button>
    </form>
    {query.isPending ? <p role="status">Chargement sécurisé…</p> : query.isError ? <p role="alert">{query.error.message}</p> : query.data.length === 0 ? <p>Aucune demande correspondant aux filtres.</p> : <div className="space-y-3">{query.data.map((row) => <Link key={row.id} href={`/admin/paiements/${row.id}`} className="block rounded-2xl border border-white/15 p-5 hover:border-jisra-green/40">
      <div className="flex flex-wrap justify-between gap-3"><p className="font-semibold">{row.client_name || 'Compte client'} — {row.plan_name}</p><p>{formatMad(row.amount_minor)} / {row.duration_months} mois</p></div>
      <p className="mt-2 text-sm text-jisra-green">{paymentStatusLabels[row.status]}</p><p className="mt-2 break-all font-mono text-xs">{row.reference}</p>
    </Link>)}</div>}
    <div className="flex gap-3"><Button variant="outline" size="lg" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Précédent</Button><Button variant="outline" size="lg" disabled={!query.data || query.data.length < 50} onClick={() => setOffset(offset + 50)}>Suivant</Button></div>
  </div>
}