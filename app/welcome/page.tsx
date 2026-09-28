'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { sanitizeRedirectPath } from '@/lib/auth/redirects'

export default function WelcomePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      }
    >
      <WelcomeInner />
    </Suspense>
  )
}

function WelcomeInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = useMemo(() => createClient(), [])

  // Destination à rejouer après la finalisation (ex. `/invite/<token>`).
  // Chemin interne validé uniquement : `/welcome` n'y figure jamais, il ne
  // peut pas être redemandé ici.
  const requestedNext = sanitizeRedirectPath(searchParams.get('next'), '')
  const destination =
    requestedNext && !requestedNext.startsWith('/welcome') ? requestedNext : '/dashboard'
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    async function load() {
      setLoadFailed(false)
      setLoading(true)

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.replace('/login')
        return
      }

      // Règle unique « store accessible et actif » (voir lib/auth/access.ts) :
      // appartenance active ou store possédé, exposée par /api/stores.
      // Une lecture en échec ne conclut à rien : ni « aucun store », ni « compte
      // à finaliser ». Le formulaire reste donc masqué et l'utilisateur peut
      // réessayer — jamais de conclusion tirée d'une lecture ratée.
      const storesResponse = await fetch('/api/stores', { cache: 'no-store' }).catch(() => null)
      if (!storesResponse || !storesResponse.ok) {
        setLoadFailed(true)
        setLoading(false)
        return
      }

      const storesPayload = await storesResponse.json().catch(() => null)
      if (!storesPayload || typeof storesPayload.hasStores !== 'boolean') {
        setLoadFailed(true)
        setLoading(false)
        return
      }

      if (storesPayload.hasStores) {
        router.replace('/dashboard')
        router.refresh()
        return
      }

      // Seul un compte invité explicitement marqué `password_set === false` doit
      // définir son mot de passe. Un marqueur absent (ou `true`) signifie que le
      // mot de passe a déjà été choisi : ce n'est pas un compte à finaliser.
      if (user.user_metadata?.password_set !== false) {
        router.replace('/dashboard')
        router.refresh()
        return
      }

      setFirstName(String(user.user_metadata?.first_name || ''))
      setLastName(String(user.user_metadata?.last_name || ''))
      setLoading(false)
    }
    load()
  }, [router, supabase, reloadKey])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    setError('')

    try {
      if (password.length < 8) throw new Error('Le mot de passe doit contenir au moins 8 caractères')
      const fullName = `${firstName.trim()} ${lastName.trim()}`.trim()

      const { error: updateError } = await supabase.auth.updateUser({
        password,
        data: {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          full_name: fullName,
          password_set: true,
        },
      })
      if (updateError) throw updateError

      await fetch('/api/settings/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName }),
      })

      // Destination validée à l'arrivée : un invité venu d'un lien
      // d'invitation revient sur `/invite/<token>` pour accepter l'invitation.
      router.replace(destination)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>
  }

  if (loadFailed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md rounded-2xl border bg-card p-8 shadow-xl space-y-4 text-center">
          <h1 className="text-xl font-semibold">Vérification impossible</h1>
          <p className="text-sm text-muted-foreground">
            Vos accès n&apos;ont pas pu être vérifiés. Aucune modification n&apos;a été apportée à votre compte.
          </p>
          <button
            onClick={() => setReloadKey((key) => key + 1)}
            className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground"
          >
            Réessayer
          </button>
          <button
            onClick={() => router.replace('/dashboard')}
            className="w-full rounded-xl border px-4 py-3 text-sm font-medium"
          >
            Aller au tableau de bord
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-md rounded-2xl border bg-card p-8 shadow-xl space-y-4">
        <div className="text-center">
          <h1 className="text-2xl font-semibold">Finaliser mon compte</h1>
          <p className="mt-2 text-sm text-muted-foreground">Définissez votre mot de passe pour vos prochaines connexions.</p>
        </div>

        <Input label="Prénom" value={firstName} onChange={setFirstName} />
        <Input label="Nom" value={lastName} onChange={setLastName} />
        <Input label="Mot de passe" type="password" value={password} onChange={setPassword} />

        {error ? <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-500">{error}</div> : null}

        <button disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Continuer
        </button>
      </form>
    </div>
  )
}

function Input({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="block space-y-1.5 text-sm font-medium">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
      />
    </label>
  )
}
