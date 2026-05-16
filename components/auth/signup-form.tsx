'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Eye, EyeOff, Loader2, Lock, Mail, User } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

const passwordLevels = [
  { label: 'Faible', color: 'bg-red-500', test: (v: string) => v.length >= 8 },
  { label: 'Moyen', color: 'bg-amber-400', test: (v: string) => /[A-Z]/.test(v) && /\d/.test(v) },
  { label: 'Fort', color: 'bg-emerald-500', test: (v: string) => /[^A-Za-z0-9]/.test(v) },
]

export default function SignupForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()
  const next = searchParams.get('next')

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pendingEmailConfirmation, setPendingEmailConfirmation] = useState<string | null>(null)

  const passwordStrength = useMemo(() => {
    let score = 0
    passwordLevels.forEach((item) => {
      if (item.test(password)) score += 1
    })
    return score
  }, [password])

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(null)
    setPendingEmailConfirmation(null)

    try {
      if (firstName.trim().length < 2) throw new Error('Le prénom est requis')
      if (lastName.trim().length < 2) throw new Error('Le nom est requis')
      if (password.length < 8) throw new Error('Le mot de passe doit contenir au moins 8 caractères')
      if (password !== confirmPassword) throw new Error('Les mots de passe ne correspondent pas')
      if (!acceptedTerms) throw new Error('Vous devez accepter les conditions d’utilisation')

      const fullName = `${firstName.trim()} ${lastName.trim()}`.trim()
      const nextPath = next || '/dashboard'
      const redirectUrl = `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: redirectUrl,
          data: {
            first_name: firstName.trim(),
            last_name: lastName.trim(),
            full_name: fullName,
          },
        },
      })

      if (error) throw error

      if (data.user && data.session) {
        await fetch('/api/auth/finalize-profile', { method: 'POST' }).catch(() => null)

        router.push(next || '/dashboard?onboarding=1')
        router.refresh()
        return
      }

      setPendingEmailConfirmation(email.trim())
      setSuccess('Compte créé. Vérifiez votre email pour activer votre accès.')
    } catch (err: any) {
      setError(err.message || 'Une erreur est survenue')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {pendingEmailConfirmation ? (
        <div className="rounded-2xl border border-jisra-green/20 bg-jisra-green/10 p-4 text-sm text-jisra-cream/80">
          <p className="font-medium text-jisra-cream">Vérifie ton email</p>
          <p className="mt-1 text-jisra-cream/65">
            Un lien de confirmation a été envoyé à <span className="font-semibold text-jisra-cream">{pendingEmailConfirmation}</span>.
          </p>
        </div>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Prénom" icon={User} value={firstName} onChange={setFirstName} placeholder="Saad" />
        <Field label="Nom" icon={User} value={lastName} onChange={setLastName} placeholder="Benali" />
      </div>

      <Field label="Adresse e-mail" type="email" icon={Mail} value={email} onChange={setEmail} placeholder="vous@business.com" />

      <div className="space-y-1.5">
        <label htmlFor="signup-password" className="block text-sm font-medium text-jisra-cream/80">
          Mot de passe
        </label>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-jisra-cream/30" />
          <input
            id="signup-password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full rounded-xl border border-jisra-green/20 bg-jisra-ink/50 py-2.5 pl-10 pr-10 text-sm text-jisra-cream placeholder-jisra-cream/30 transition-all focus:border-jisra-green/50 focus:outline-none focus:ring-1 focus:ring-jisra-green/30"
            placeholder="Minimum 8 caractères"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-jisra-cream/30 transition-colors hover:text-jisra-cream/60"
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className={`h-1.5 rounded-full ${passwordStrength > index ? passwordLevels[index].color : 'bg-white/10'}`}
              />
            ))}
          </div>
          <p className="text-xs text-jisra-cream/45">
            Force: {passwordStrength === 0 ? 'Très faible' : passwordLevels[passwordStrength - 1].label}
          </p>
        </div>
      </div>

      <Field
        label="Confirmer le mot de passe"
        type={showPassword ? 'text' : 'password'}
        icon={Lock}
        value={confirmPassword}
        onChange={setConfirmPassword}
        placeholder="Répétez votre mot de passe"
      />

      <label className="flex items-start gap-3 rounded-2xl border border-white/8 bg-white/[0.02] p-4 text-sm text-jisra-cream/70">
        <input
          type="checkbox"
          checked={acceptedTerms}
          onChange={(e) => setAcceptedTerms(e.target.checked)}
          className="mt-1 h-4 w-4 rounded border-jisra-green/30 bg-jisra-ink text-jisra-green focus:ring-jisra-green/40"
        />
        <span>
          J'accepte les{' '}
          <Link href="/legal/conditions" className="font-medium text-jisra-green-light hover:text-jisra-green">
            conditions d’utilisation
          </Link>
          {' '}et le traitement des informations nécessaires à mon onboarding.
        </span>
      </label>

      {error ? <MessageBox tone="error" message={error} /> : null}
      {success ? <MessageBox tone="success" message={success} /> : null}

      <button
        type="submit"
        disabled={loading}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-jisra-green px-4 py-3 text-sm font-medium text-white transition-all duration-200 hover:bg-jisra-green-dark focus:outline-none focus:ring-2 focus:ring-jisra-green/50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Création...</span>
          </>
        ) : (
          <span>Créer mon compte</span>
        )}
      </button>

      <p className="text-center text-sm text-jisra-cream/55">
        Déjà un compte ?{' '}
        <Link href={next ? `/login?next=${encodeURIComponent(next)}` : '/login'} className="font-medium text-jisra-green-light transition hover:text-jisra-green">
          Se connecter
        </Link>
      </p>
    </form>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  icon: Icon,
  required = true,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  type?: string
  icon: typeof User
  required?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-jisra-cream/80">{label}</label>
      <div className="relative">
        <Icon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-jisra-cream/30" />
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          className="w-full rounded-xl border border-jisra-green/20 bg-jisra-ink/50 py-2.5 pl-10 pr-4 text-sm text-jisra-cream placeholder-jisra-cream/30 transition-all focus:border-jisra-green/50 focus:outline-none focus:ring-1 focus:ring-jisra-green/30"
          placeholder={placeholder}
        />
      </div>
    </div>
  )
}

function MessageBox({ tone, message }: { tone: 'error' | 'success'; message: string }) {
  const classes =
    tone === 'error'
      ? 'border-red-500/20 bg-red-500/10 text-red-400'
      : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'

  return <div className={`rounded-xl border p-3 text-sm animate-fade-in ${classes}`}>{message}</div>
}