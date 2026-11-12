'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'

type SecurityData = {
  members: { user_id: string; role: string; active: boolean; updated_at: string }[]
  events: { id: number; actor_id: string | null; action: string; outcome: string; created_at: string }[]
}

export function AdminSecurity() {
  const cache = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const query = useQuery({ queryKey: ['saas-admin-security'], retry: false, staleTime: 0, queryFn: async () => {
    const response = await fetch('/api/admin/security', { cache: 'no-store' })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error)
    return result as SecurityData
  } })
  async function change(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    const form = new FormData(event.currentTarget)
    try {
      const response = await fetch('/api/admin/security', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        userId: form.get('userId'), role: form.get('role'), active: form.get('active') === 'true', reason: form.get('reason'),
      }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      await cache.invalidateQueries({ queryKey: ['saas-admin-security'] })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Action indisponible.') }
    finally { setBusy(false) }
  }
  if (query.isPending) return <p role="status">Chargement sécurisé des habilitations…</p>
  if (query.isError) return <div role="alert"><p>{query.error.message}</p><Button variant="outline" size="lg" onClick={() => void query.refetch()}>Réessayer</Button></div>
  return <div className="space-y-8">
    <section className="rounded-2xl border border-white/10 p-5"><h2 className="mb-4 font-semibold">Administrateurs plateforme</h2>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Compte UUID</th><th className="p-2">Rôle</th><th className="p-2">État</th></tr></thead><tbody>
        {query.data.members.map((member) => <tr key={member.user_id} className="border-t border-white/10"><td className="break-all p-2 font-mono text-xs">{member.user_id}</td><td className="p-2">{member.role}</td><td className="p-2">{member.active ? 'Actif' : 'Révoqué'}</td></tr>)}
      </tbody></table></div>
    </section>
    <section className="rounded-2xl border border-white/10 p-5"><h2 className="font-semibold">Attribuer ou révoquer une habilitation</h2>
      <p className="mt-2 text-sm text-jisra-cream/70">Réservé au responsable plateforme, avec TOTP vérifié depuis moins de 15 minutes. Aucun rôle de boutique n’est utilisé. Votre propre habilitation ne peut pas être modifiée ici.</p>
      <form onSubmit={(event) => void change(event)} className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="space-y-2 sm:col-span-2"><span>UUID du compte existant vérifié</span><input required name="userId" autoComplete="off" className="min-h-11 w-full rounded-xl border border-white/20 bg-jisra-ink px-3" /></label>
        <label className="space-y-2"><span>Rôle plateforme</span><select name="role" className="min-h-11 w-full rounded-xl border border-white/20 bg-jisra-ink px-3"><option value="commercial_reader">Lecture commerciale</option><option value="security_admin">Sécurité en lecture</option><option value="platform_owner">Responsable plateforme</option></select></label>
        <label className="space-y-2"><span>État</span><select name="active" className="min-h-11 w-full rounded-xl border border-white/20 bg-jisra-ink px-3"><option value="true">Actif</option><option value="false">Révoqué</option></select></label>
        <label className="space-y-2 sm:col-span-2"><span>Motif obligatoire — sans secret ni donnée bancaire</span><input name="reason" required minLength={10} maxLength={300} className="min-h-11 w-full rounded-xl border border-white/20 bg-jisra-ink px-3" /></label>
        <Button size="lg" disabled={busy} type="submit">{busy ? 'Vérification…' : 'Enregistrer la décision'}</Button>
      </form>{error && <p role="alert" className="mt-4 text-red-400">{error}</p>}
    </section>
    <section className="rounded-2xl border border-white/10 p-5"><h2 className="mb-4 font-semibold">Journal d’audit — 100 événements récents</h2>
      <ol className="space-y-3 text-sm">{query.data.events.map((event) => <li key={event.id} className="border-b border-white/10 pb-3"><p>{event.action} — {event.outcome}</p><p className="text-xs text-jisra-cream/60">{new Date(event.created_at).toLocaleString('fr-FR')}</p></li>)}</ol>
    </section>
  </div>
}