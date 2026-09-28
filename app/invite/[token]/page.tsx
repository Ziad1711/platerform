'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getFirstAllowedRoute } from '@/lib/auth/permissions'
import { Loader2, CheckCircle, AlertTriangle } from 'lucide-react'

export default function InvitePage() {
  const params = useParams()
  const router = useRouter()
  const token = String(params.token || '')
  const supabase = useMemo(() => createClient(), [])

  const [status, setStatus] = useState<'loading' | 'unauthenticated' | 'mismatch' | 'ready' | 'accepting' | 'success' | 'error'>('loading')
  const [invitationEmail, setInvitationEmail] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const [needsPassword, setNeedsPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [pwError, setPwError] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)
  const [retryAccept, setRetryAccept] = useState(false)

  useEffect(() => {
    async function check() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setStatus('unauthenticated')
        return
      }
      setUserEmail(user.email || '')

      const res = await fetch(`/api/team/accept?token=${encodeURIComponent(token)}`)
      const inv = await res.json().catch(() => null)

      if (!res.ok || !inv || inv.status !== 'pending' || new Date(inv.expiresAt) < new Date()) {
        setStatus('error')
        setErrorMsg('Cette invitation est invalide ou a expiré.')
        return
      }

      setInvitationEmail(inv.email)
      if (!inv.matchesCurrentUser) {
        setStatus('mismatch')
        return
      }

      // Seul un compte invité explicitement marqué `password_set === false` doit
      // définir son mot de passe. Ce choix se fait AVANT l'acceptation : sinon
      // l'activation des stores rend `/welcome` inopérant (il renvoie au
      // tableau de bord tout compte ayant déjà un store actif).
      setNeedsPassword(user.user_metadata?.password_set === false)
      setStatus('ready')
    }
    check()
  }, [token, supabase])

  async function handleAccept() {
    setStatus('accepting')
    try {
      const res = await fetch('/api/team/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error || 'ACCEPT_FAILED')

      setStatus('success')
      // Le mot de passe manquant a déjà été défini sur cette page : la
      // destination ne dépend plus que du rôle délivré par l'invitation.
      // Navigation immédiate avec window.location.href pour éviter
      // l'erreur "chrome-error://chromewebdata/" qui survient quand
      // router.push() est appelé depuis un contexte de frame interrompu
      const defaultRoute = getFirstAllowedRoute(payload?.role as any)
      window.location.href = defaultRoute
    } catch (e) {
      setStatus('error')
      setErrorMsg(e instanceof Error ? e.message : 'Erreur')
    }
  }

  async function handleSetPasswordAndAccept(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPwError('')

    if (password.length < 8) {
      setPwError('Le mot de passe doit contenir au moins 8 caractères')
      return
    }

    setSavingPassword(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password,
        data: { password_set: true },
      })
      if (updateError) throw updateError
      // Le marqueur n'est posé qu'après une mise à jour réussie : en cas
      // d'échec le compte reste « à finaliser » et l'invitation n'est pas
      // consommée.
      setRetryAccept(true)
    } catch (err) {
      setPwError(err instanceof Error ? err.message : 'Erreur')
      setPassword('')
      return
    } finally {
      setSavingPassword(false)
    }

    await handleAccept()
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 shadow-xl text-center">
        {status === 'loading' && <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary"/>}

        {status === 'unauthenticated' && (
          <>
            <h1 className="text-xl font-semibold">Connexion requise</h1>
            <p className="mt-2 text-sm text-muted-foreground">Veuillez vous connecter pour accepter cette invitation.</p>
            <button onClick={() => router.push(`/login?next=/invite/${token}`)} className="mt-4 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Se connecter</button>
          </>
        )}

        {status === 'mismatch' && (
          <>
            <AlertTriangle className="h-8 w-8 mx-auto text-amber-500"/>
            <h1 className="mt-3 text-xl font-semibold">Email différent</h1>
            <p className="mt-2 text-sm text-muted-foreground">Cette invitation est destinée à <strong>{invitationEmail}</strong>, mais vous êtes connecté avec <strong>{userEmail}</strong>.</p>
            <button onClick={() => router.push(`/login?next=/invite/${token}`)} className="mt-4 rounded-xl border px-4 py-2 text-sm font-medium">Changer de compte</button>
          </>
        )}

        {status === 'ready' && needsPassword && (
          <form onSubmit={handleSetPasswordAndAccept} className="space-y-4 text-left">
            <div className="text-center">
              <h1 className="text-xl font-semibold">Définir mon mot de passe</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Choisissez votre mot de passe pour vos prochaines connexions, puis rejoignez l&apos;équipe.
              </p>
            </div>

            <label className="block space-y-1.5 text-sm font-medium">
              <span>Mot de passe</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
              />
            </label>

            {pwError ? <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-500">{pwError}</div> : null}

            <button
              type="submit"
              disabled={savingPassword}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {savingPassword ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Définir et rejoindre l&apos;équipe
            </button>
          </form>
        )}

        {status === 'ready' && !needsPassword && (
          <>
            <h1 className="text-xl font-semibold">Invitation reçue</h1>
            <p className="mt-2 text-sm text-muted-foreground">Vous avez été invité à rejoindre une équipe.</p>
            <button onClick={handleAccept} className="mt-6 rounded-xl bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground">Accepter l'invitation</button>
          </>
        )}

        {status === 'accepting' && <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary"/>}

        {status === 'success' && (
          <>
            <CheckCircle className="h-10 w-10 mx-auto text-emerald-500"/>
            <h1 className="mt-3 text-xl font-semibold">Invitation acceptée !</h1>
            <p className="mt-2 text-sm text-muted-foreground">Finalisation de votre accès...</p>
          </>
        )}

        {status === 'error' && (
          <>
            <AlertTriangle className="h-8 w-8 mx-auto text-red-500"/>
            <h1 className="mt-3 text-xl font-semibold">Erreur</h1>
            <p className="mt-2 text-sm text-muted-foreground">{errorMsg}</p>
            {retryAccept ? (
              <button onClick={handleAccept} className="mt-4 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Réessayer</button>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
