'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Mail, Lock, Loader2, Eye, EyeOff } from 'lucide-react'
import { getFirstAllowedRoute, type Role } from '@/lib/auth/permissions'

type AuthFormProps = {
  defaultMode?: 'login' | 'signup' | 'reset-request' | 'recovery'
}

function safeInternalPath(value: string | null) {
  const next = String(value || '').trim()
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return '/dashboard'
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(next)) return '/dashboard'
  return next
}

export default function AuthForm({ defaultMode = 'login' }: AuthFormProps) {
  const [mode, setMode] = useState<'login' | 'signup' | 'reset-request' | 'recovery'>(defaultMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()
  const next = searchParams.get('next')
  const signupHref = next ? `/signup?next=${encodeURIComponent(next)}` : '/signup'

  useEffect(() => {
    setMode(defaultMode)
    setError(null)
    setSuccess(null)
  }, [defaultMode])

  const setFormMode = (nextMode: 'login' | 'signup' | 'reset-request' | 'recovery') => {
    setMode(nextMode)
    setError(null)
    setSuccess(null)
  }

  const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      if (mode === 'recovery') {
        if (password.length < 6) throw new Error('Le mot de passe doit contenir au moins 6 caractères')
        if (password !== confirmPassword) throw new Error('Les mots de passe ne correspondent pas')

        const { error } = await supabase.auth.updateUser({ password })
        if (error) throw error

        if (typeof window !== 'undefined') {
          window.history.replaceState(null, '', '/login')
        }

        setSuccess('Mot de passe mis à jour avec succès. Vous pouvez maintenant vous connecter.')
        setFormMode('login')
        setPassword('')
        setConfirmPassword('')
      } else if (mode === 'reset-request') {
        const trimmedEmail = email.trim()
        if (!trimmedEmail) throw new Error('Veuillez saisir votre adresse email')
        if (!isValidEmail(trimmedEmail)) throw new Error('Veuillez saisir une adresse email valide')

        const redirectTo = `${window.location.origin}/login?recovery=1`
        const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, { redirectTo })
        if (error) throw error

        setSuccess('Si un compte existe pour cet email, un lien de réinitialisation a été envoyé.')
      } else if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        })
        if (error) throw error
      } else {
        if (!isValidEmail(email.trim())) throw new Error('Veuillez saisir une adresse email valide')

        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        })
        if (error) throw error
      }

      if (mode === 'login') {
        // Navigation serveur forcée pour que le middleware lise les cookies
        // correctement après signInWithPassword (évite le flash login)
        const target = safeInternalPath(next)
        window.location.href = target === '/dashboard' ? '/dashboard' : target
      } else if (mode === 'signup') {
        router.refresh()
      }
    } catch (err: any) {
      setError(err.message || 'Une erreur est survenue')
    } finally {
      setLoading(false)
    }
  }

  const isLogin = mode === 'login'
  const isRecovery = mode === 'recovery'
  const isResetRequest = mode === 'reset-request'

  return (
    <div>
      <form onSubmit={handleSubmit} className="space-y-5">
        {!isRecovery && (
        <div className="space-y-1.5">
          <label htmlFor="email" className="block text-sm font-medium text-jisra-cream/80">
            Email
          </label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-jisra-cream/30" />
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full pl-10 pr-4 py-2.5 bg-jisra-ink/50 border border-jisra-green/20 rounded-xl text-jisra-cream placeholder-jisra-cream/30 text-sm focus:outline-none focus:border-jisra-green/50 focus:ring-1 focus:ring-jisra-green/30 transition-all"
              placeholder="votre@email.com"
            />
          </div>
        </div>
        )}

        {!isResetRequest && (
        <div className="space-y-1.5">
          <label htmlFor="password" className="block text-sm font-medium text-jisra-cream/80">
            {isRecovery ? 'Nouveau mot de passe' : 'Mot de passe'}
          </label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-jisra-cream/30" />
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full pl-10 pr-10 py-2.5 bg-jisra-ink/50 border border-jisra-green/20 rounded-xl text-jisra-cream placeholder-jisra-cream/30 text-sm focus:outline-none focus:border-jisra-green/50 focus:ring-1 focus:ring-jisra-green/30 transition-all"
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-jisra-cream/30 hover:text-jisra-cream/60 transition-colors"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
        )}

        {isRecovery && (
          <div className="space-y-1.5">
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-jisra-cream/80">
              Confirmer le mot de passe
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-jisra-cream/30" />
              <input
                id="confirmPassword"
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="w-full pl-10 pr-4 py-2.5 bg-jisra-ink/50 border border-jisra-green/20 rounded-xl text-jisra-cream placeholder-jisra-cream/30 text-sm focus:outline-none focus:border-jisra-green/50 focus:ring-1 focus:ring-jisra-green/30 transition-all"
                placeholder="••••••••"
              />
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-xl text-sm animate-fade-in">
            {error}
          </div>
        )}

        {success && (
          <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-3 rounded-xl text-sm animate-fade-in">
            {success}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-jisra-green text-white py-2.5 px-4 rounded-xl font-medium text-sm hover:bg-jisra-green-dark focus:outline-none focus:ring-2 focus:ring-jisra-green/50 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Chargement...</span>
            </>
          ) : (
            <span>
              {isRecovery
                ? 'Mettre à jour le mot de passe'
                : isResetRequest
                  ? 'Envoyer le lien de réinitialisation'
                  : isLogin
                    ? 'Se connecter'
                    : "S'inscrire"}
            </span>
          )}
        </button>

        {isLogin && (
          <div className="text-right -mt-1">
            <button
              type="button"
              onClick={() => setFormMode('reset-request')}
              className="text-sm text-jisra-green hover:text-jisra-green-light transition-colors"
            >
              Mot de passe oublié ?
            </button>
          </div>
        )}

        {isResetRequest && (
          <p className="text-xs text-jisra-cream/50 leading-5">
            Saisissez votre email pour recevoir un lien sécurisé de réinitialisation.
          </p>
        )}
      </form>

      {!isRecovery && (
      <div className="mt-6 text-center">
        {isLogin ? (
          <Link href={signupHref} className="text-jisra-green hover:text-jisra-green-light text-sm font-medium transition-colors">
            Pas de compte ? S'inscrire
          </Link>
        ) : isResetRequest ? (
          <button
            type="button"
            onClick={() => setFormMode('login')}
            className="text-jisra-green hover:text-jisra-green-light text-sm font-medium transition-colors"
          >
            Retour à la connexion
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              setFormMode('login')
            }}
            className="text-jisra-green hover:text-jisra-green-light text-sm font-medium transition-colors"
          >
            Déjà un compte ? Se connecter
          </button>
        )}
      </div>
      )}
    </div>
  )
}
