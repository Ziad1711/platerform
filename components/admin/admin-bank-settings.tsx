'use client'

import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

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

const btnBase = 'inline-flex min-h-11 items-center justify-center rounded-xl px-5 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50'
const btnPrimary = `${btnBase} bg-jisra-green text-white hover:bg-jisra-green-dark`
const btnOutline = `${btnBase} border border-white/20 bg-white/5 text-jisra-cream hover:bg-white/10`
const btnDanger = `${btnBase} border border-red-400/40 bg-red-400/10 text-red-200 hover:bg-red-400/20`
const inputClass = 'min-h-11 w-full rounded-xl border border-white/15 bg-jisra-ink px-3 text-jisra-cream placeholder:text-jisra-cream/40 focus:border-jisra-green focus:outline-none'

type Field = {
  name: 'beneficiary' | 'bank_name' | 'rib' | 'instructions' | 'reason'
  label: string
  max: number
  required: boolean
  value: string | null
  numeric?: boolean
  minLength?: number
  hint?: string
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
      const reason = String(data.get('reason') ?? '').trim()
      const beneficiary = String(data.get('beneficiary') ?? '').trim()
      const bankName = String(data.get('bank_name') ?? '').trim()
      const rib = String(data.get('rib') ?? '').trim()

      if (reason.length < 10) throw new Error('Le motif doit contenir au moins 10 caractères.')
      if (action === 'publish') {
        if (!approved) throw new Error('Cochez la case d’approbation des conditions commerciales.')
        if (beneficiary.length < 2) throw new Error('Indiquez le bénéficiaire officiel (au moins 2 caractères).')
        if (bankName.length < 2) throw new Error('Indiquez le nom de la banque (au moins 2 caractères).')
        if (!/^\d{24}$/.test(rib)) throw new Error('Le RIB doit contenir exactement 24 chiffres.')
      }

      const response = await fetch('/api/admin/bank-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          beneficiary,
          bank_name: bankName,
          rib,
          instructions: String(data.get('instructions') ?? ''),
          commercial_conditions_approved: approved,
          reason,
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

  if (query.isPending) return <p role="status" className="text-jisra-cream">Vérification des paramètres…</p>
  if (query.isError) return <p role="alert" className="text-red-300">{query.error.message}</p>
  const settings = query.data.settings
  const status = settings.status
  const published = status === 'published'

  const fields: Field[] = [
    { name: 'beneficiary', label: 'Bénéficiaire officiel (nom légal)', max: 200, required: false, value: settings.beneficiary },
    { name: 'bank_name', label: 'Banque', max: 200, required: false, value: settings.bank_name },
    { name: 'rib', label: 'RIB marocain — 24 chiffres', max: 24, required: false, value: settings.rib, numeric: true, hint: '24 chiffres, sans espaces' },
    { name: 'instructions', label: 'Instructions affichées au client', max: 1000, required: false, value: settings.instructions },
    { name: 'reason', label: 'Motif de la modification', max: 300, required: true, value: null, minLength: 10, hint: '10 à 300 caractères' },
  ]

  return (
    <section className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-jisra-cream">Coordonnées bancaires</h1>
        <p className="mt-1 text-sm text-jisra-cream/70">Configurer, publier, suspendre et modifier les coordonnées du virement.</p>
      </div>

      <div role="status" className={`rounded-xl border p-4 ${published
        ? 'border-jisra-green/50 bg-jisra-green/15 text-jisra-green-light'
        : status === 'suspended'
          ? 'border-orange-400/50 bg-orange-400/15 text-orange-200'
          : 'border-amber-400/40 bg-amber-400/10 text-amber-200'}`}>
        <p className="font-semibold">État actuel : {STATUS_LABEL[status]}</p>
        <p className="mt-1 text-sm">
          {published
            ? 'Les coordonnées sont visibles des clients. Vous pouvez les modifier puis les republier, ou suspendre le paiement.'
            : status === 'suspended'
              ? 'Le paiement est suspendu : les nouvelles demandes sont bloquées, les coordonnées restent enregistrées sans être exposées.'
              : 'Le paiement public est verrouillé. Aucune coordonnée n’est exposée tant qu’elle n’est pas publiée.'}
        </p>
      </div>

      <form ref={formRef} className="space-y-4">
        {fields.map((field) => (
          <label key={field.name} className="block space-y-1.5">
            <span className="text-sm font-medium text-jisra-cream">{field.label}</span>
            <input
              name={field.name}
              required={field.required}
              minLength={field.minLength}
              maxLength={field.max}
              defaultValue={field.value ?? ''}
              autoComplete="off"
              inputMode={field.numeric ? 'numeric' : undefined}
              className={inputClass}
            />
            {field.hint && <span className="text-xs text-jisra-cream/50">{field.hint}</span>}
          </label>
        ))}

        <label className="flex items-start gap-3 text-sm text-jisra-cream">
          <input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} className="mt-0.5 h-4 w-4" />
          <span>J’approuve les conditions commerciales et confirme l’exactitude de ces coordonnées (obligatoire pour publier).</span>
        </label>

        <div className="flex flex-wrap gap-3 pt-1">
          {!published ? (
            <>
              <button type="button" disabled={busy} onClick={() => void submitAction('save_draft')} className={btnOutline}>Enregistrer le brouillon</button>
              <button type="button" disabled={busy || !approved} onClick={() => void submitAction('publish')} className={btnPrimary}>Publier et ouvrir le paiement</button>
            </>
          ) : (
            <>
              <button type="button" disabled={busy || !approved} onClick={() => void submitAction('publish')} className={btnPrimary}>Enregistrer et republier</button>
              <button type="button" disabled={busy} onClick={() => void submitAction('suspend')} className={btnDanger}>Suspendre le paiement</button>
            </>
          )}
        </div>
      </form>

      {message && <p role="status" className="rounded-lg border border-jisra-green/40 bg-jisra-green/10 p-3 text-sm text-jisra-green-light">{message}</p>}
      {error && <p role="alert" className="rounded-lg border border-red-400/40 bg-red-400/10 p-3 text-sm text-red-200">{error}</p>}
    </section>
  )
}