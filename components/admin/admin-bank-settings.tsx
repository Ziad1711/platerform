'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'

export function AdminBankSettings() {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const query = useQuery({ queryKey: ['admin-bank-settings'], retry: false, queryFn: async () => {
    const response = await fetch('/api/admin/bank-settings', { cache: 'no-store' }); const result = await response.json()
    if (!response.ok) throw new Error(result.error)
    return result as { settings: { beneficiary: string | null; bank_name: string | null; rib: string | null; instructions: string | null; enabled: boolean } }
  } })
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage('')
    try {
      const form = new FormData(event.currentTarget)
      const response = await fetch('/api/admin/bank-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(form)) })
      const result = await response.json(); if (!response.ok) throw new Error(result.error)
      setMessage('Brouillon enregistré et historisé. Paiement public toujours désactivé.'); await query.refetch()
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Paramètres indisponibles.') }
    finally { setBusy(false) }
  }
  if (query.isPending) return <p role="status">Vérification des paramètres…</p>
  if (query.isError) return <p role="alert">{query.error.message}</p>
  return <section className="max-w-2xl space-y-5"><h1 className="text-2xl font-bold">Coordonnées bancaires — brouillon sécurisé</h1>
    <p className="rounded-xl border border-amber-400/30 p-4">Le paiement public est verrouillé. Ne saisissez aucune coordonnée fictive. L’approbation des conditions commerciales et l’ouverture réelle nécessitent une autorisation distincte.</p>
    <form onSubmit={(event) => void save(event)} className="space-y-4">{([
      ['beneficiary', 'Bénéficiaire officiel'], ['bank_name', 'Banque'], ['rib', 'RIB officiel — 24 chiffres'], ['instructions', 'Instructions'], ['reason', 'Motif de modification — sans secret'],
    ] as const).map(([name, label]) => <label key={name} className="block space-y-2"><span>{label}</span><input name={name} required={name !== 'instructions'} minLength={name === 'reason' ? 10 : undefined} maxLength={name === 'instructions' ? 1000 : name === 'reason' ? 300 : 200}
      defaultValue={name === 'reason' ? '' : query.data.settings[name] || ''} autoComplete="off" className="min-h-11 w-full rounded-xl border border-white/20 bg-jisra-ink px-3" /></label>)}
      <Button size="lg" disabled={busy} type="submit">Enregistrer sans activer le paiement</Button>
    </form>{message && <p role="status">{message}</p>}
  </section>
}