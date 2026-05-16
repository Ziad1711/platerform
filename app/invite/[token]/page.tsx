'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Loader2, CheckCircle, AlertTriangle } from 'lucide-react'

export default function InvitePage() {
  const params = useParams()
  const router = useRouter()
  const token = String(params.token || '')
  const supabase = createClient()

  const [status, setStatus] = useState<'loading' | 'unauthenticated' | 'mismatch' | 'ready' | 'accepting' | 'success' | 'error'>('loading')
  const [invitationEmail, setInvitationEmail] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [userEmail, setUserEmail] = useState('')

  useEffect(() => {
    async function check() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setStatus('unauthenticated')
        return
      }
      setUserEmail(user.email || '')

      // Fetch invitation details to verify email match
      const { data: inv } = await supabase
        .from('team_invitations')
        .select('email, status, expires_at')
        .eq('token', token)
        .maybeSingle()

      if (!inv || inv.status !== 'pending' || new Date(inv.expires_at) < new Date()) {
        setStatus('error')
        setErrorMsg('Cette invitation est invalide ou a expiré.')
        return
      }

      setInvitationEmail(inv.email)
      if (inv.email.toLowerCase() !== (user.email || '').toLowerCase()) {
        setStatus('mismatch')
        return
      }

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
      setTimeout(() => router.push('/dashboard'), 1500)
    } catch (e) {
      setStatus('error')
      setErrorMsg(e instanceof Error ? e.message : 'Erreur')
    }
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

        {status === 'ready' && (
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
            <p className="mt-2 text-sm text-muted-foreground">Redirection vers le tableau de bord...</p>
          </>
        )}

        {status === 'error' && (
          <>
            <AlertTriangle className="h-8 w-8 mx-auto text-red-500"/>
            <h1 className="mt-3 text-xl font-semibold">Erreur</h1>
            <p className="mt-2 text-sm text-muted-foreground">{errorMsg}</p>
          </>
        )}
      </div>
    </div>
  )
}
