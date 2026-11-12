'use client'

import Image from 'next/image'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'

export function AdminMfa() {
  const [busy, setBusy] = useState(false)
  const [factorId, setFactorId] = useState('')
  const [qr, setQr] = useState('')
  const [secret, setSecret] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  async function prepare() {
    setBusy(true); setError('')
    try {
      const client = createClient()
      const { data: factors, error: listError } = await client.auth.mfa.listFactors()
      if (listError) throw listError
      const existing = factors.totp.find((factor) => factor.status === 'verified')
      if (existing) { setFactorId(existing.id); return }
      const { data, error: enrollError } = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Jisra ${Date.now()}` })
      if (enrollError) throw enrollError
      setFactorId(data.id); setQr(data.totp.qr_code); setSecret(data.totp.secret)
    } catch { setError('Impossible de préparer TOTP. Réessayez ou contactez votre responsable sécurité.') }
    finally { setBusy(false) }
  }
  async function verify(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const { error: verifyError } = await createClient().auth.mfa.challengeAndVerify({ factorId, code })
      if (verifyError) throw verifyError
      setSecret(''); setQr(''); setCode('')
      window.location.replace('/admin')
    } catch { setError('Code refusé ou expiré. Vérifiez votre application d’authentification.') }
    finally { setBusy(false) }
  }
  return <section className="mx-auto max-w-lg space-y-5 rounded-2xl border border-white/15 bg-white/[0.03] p-6">
    <h1 className="text-2xl font-semibold">Vérification renforcée</h1>
    <p className="text-sm leading-6 text-jisra-cream/75">Une vérification TOTP récente est requise. Utilisez votre application d’authentification ; aucun email ni SMS n’est nécessaire.</p>
    {!factorId ? <Button size="lg" onClick={() => void prepare()} disabled={busy}>Configurer ou vérifier TOTP</Button> : <form onSubmit={(event) => void verify(event)} className="space-y-4">
      {qr && <><Image unoptimized src={qr} alt="QR code TOTP privé à scanner avec votre application" width={220} height={220} className="rounded-xl bg-white p-3" />
        <p className="text-sm">Clé manuelle privée — ne la partagez pas :</p><p className="break-all rounded-lg bg-black/20 p-3 font-mono text-sm">{secret}</p></>}
      <label className="block space-y-2"><span>Code à six chiffres</span><input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required maxLength={6} className="min-h-11 w-full rounded-xl border border-white/20 bg-jisra-ink px-4" /></label>
      <Button size="lg" disabled={busy || code.length !== 6} type="submit">Vérifier mon identité</Button>
    </form>}
    {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
  </section>
}