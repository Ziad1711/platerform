'use client'

import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'

type BankStatus = 'draft' | 'published' | 'suspended'
type BankSettings = {
  beneficiary: string | null
  bank_name: string | null
  rib: string | null
  instructions: string | null
  enabled: boolean
  status: BankStatus
  currency: string
  commercial_conditions_approved: boolean
}
type ApiResult = { settings: BankSettings; public_enable_locked: boolean }

const STATUS_LABEL: Record<BankStatus, string> = {
  draft: 'Brouillon',
  published: 'Publié',
  suspended: 'Suspendu',
}

type Field = {
  name: 'beneficiary' | 'bank_name' | 'rib' | 'instructions' | 'reason'
  label: string
  max: number
  required: boolean
  value: string | null
  numeric?: boolean
  minLength?: number
}

export function AdminBankSettings() {
  const formRef = useRef<HTMLFormElement>(null)
  const [busy, setBusy] = useState(false)
  const [approved, setApproved] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const query = useQuery({
    queryKey: ['admin-bank-settings'],
    retry: false,
    queryFn: async () => {
      const response = await fetch('/api/admin/bank-settings', { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      return result as ApiResult
    },
  })

  async function submitAction(action: 'save_draft' | 'publish' | 'suspend') {
    const form = formRef.current
    if (!form) return
    setBusy(true); setMessage(''); setError('')
    try {
      const data = new FormData(form)
      const response = await fetch('/api/admin/bank-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          beneficiary: String(data.get('beneficiary') ?? ''),
          bank_name: String(data.get('bank_name') ?? ''),
          rib: String(data.get('rib') ?? ''),
          instructions: String(data.get('instructions') ?? ''),
          commercial_conditions_approved: approved,
          reason: String(data.get('reason') ?? ''),
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      setApproved(false)
      setMessage(action === 'publish'
        ? 'Coordonnées publiées. Le paiement par virement est désormais ouvert aux clients.'
        : action === 'suspend'
          ? 'Paiement suspendu. Aucun nouveau virement ne peut être initié ; les demandes existantes sont conservées.'
          : 'Brouillon enregistré et historisé. Aucune coordonnée exposée.')
      await query.refetch()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Paramètres indisponibles.')
    } finally {
      setBusy(false)
    }
  }

  if (query.isPending) return <p role="status">Vérification des paramètres…</p>
  if (query.isError) return <p role="alert">{query.error.message}</p>
  const settings = query.data.settings
  const status = settings.status
  const fields: Field[] = [
    { name: 'beneficiary', label: 'Bénéficiaire officiel (nom légal)', max: 200, required: false, value: settings.beneficiary },
    { name: 'bank_name', label: 'Banque', max: 200, required: false, value: settings.bank_name },
    { name: 'rib', label: 'RIB marocain — 24 chiffres', max: 24, required: false, value: settings.rib, numeric: true },
    { name: 'instructions', label: 'Instructions affichées au client', max: 1000, required: false, value: settings.instructions },
    { name: 'reason', label: 'Motif de la modification — sans secret', max: 300, required: true, value: null, minLength: 10 },
  ]

  return (
    <section className="max-w-2xl space-y-5">
      <h1 className="text-2xl font-bold">Coordonnées bancaires — publication contrôlée</h1>

      <div role="status" className={`rounded-xl border p-4 ${status === 'published'
        ? 'border-jisra-green/40 bg-jisra-green/10'
        : status === 'suspended'
          ? 'border-orange-400/40 bg-orange-400/10'
          : 'border-amber-400/30 bg-amber-400/10'}`}>
        <p className="font-semibold">État actuel : {STATUS_LABEL[status]}</p>
        <p className="text-sm text-jisra-cream/80">
          {status === 'published'
            ? 'Les coordonnées officielles sont visibles des clients. Toute modification passe par une suspension préalable.'
            : status === 'suspended'
              ? 'Le paiement est suspendu : les nouvelles demandes sont bloquées, les coordonnées restent enregistrées sans être exposées.'
              : 'Le paiement public est verrouillé. Aucune coordonnée n’est exposée tant qu’elle n’est pas publiée.'}
        </p>
      </div>

      <p className="text-sm text-jisra-cream/70">
        Ne saisissez aucune coordonnée fictive. Chaque action est historisée et réservée à un administrateur authentifié avec vérification récente.
      </p>

      <form ref={formRef} className="space-y-4">
        {fields.map((field) => (
          <label key={field.name} className="block space-y-2">
            <span>{field.label}</span>
            <input
              name={field.name}
              required={field.required}
              minLength={field.minLength}
              maxLength={field.max}
              defaultValue={field.value ?? ''}
              disabled={status === 'published' && field.name !== 'reason'}
              autoComplete="off"
              inputMode={field.numeric ? 'numeric' : undefined}
              className="min-h-11 w-full rounded-xl border border-white/20 bg-jisra-ink px-3 disabled:opacity-60"
            />
          </label>
        ))}

        {status !== 'published' && (
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} className="mt-0.5" />
            <span>J’approuve les conditions commerciales et je confirme que ces coordonnées officielles sont exactes (obligatoire pour publier).</span>
          </label>
        )}

        <div className="flex flex-wrap gap-3">
          {status !== 'published' && (
            <>
              <Button type="button" size="lg" variant="outline" disabled={busy} onClick={() => void submitAction('save_draft')}>Enregistrer le brouillon</Button>
              <Button type="button" size="lg" disabled={busy || !approved} onClick={() => void submitAction('publish')}>Publier et ouvrir le paiement</Button>
            </>
          )}
          {status === 'published' && (
            <Button type="button" size="lg" variant="destructive" disabled={busy} onClick={() => void submitAction('suspend')}>Suspendre le paiement</Button>
          )}
        </div>
      </form>

      {message && <p role="status" className="text-jisra-green">{message}</p>}
      {error && <p role="alert" className="text-red-400">{error}</p>}
    </section>
  )
}