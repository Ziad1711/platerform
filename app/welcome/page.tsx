'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export default function WelcomePage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.replace('/login')
        return
      }
      if (user.user_metadata?.password_set === true) {
        router.replace('/dashboard')
        router.refresh()
        return
      }
      setFirstName(String(user.user_metadata?.first_name || ''))
      setLastName(String(user.user_metadata?.last_name || ''))
      setLoading(false)
    }
    load()
  }, [router, supabase])

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

      router.replace('/dashboard')
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
