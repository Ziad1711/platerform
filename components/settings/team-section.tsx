'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Users, Plus, Trash2, Loader2, X, Mail, Shield } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { usePermissions } from '@/lib/auth/use-permissions'
import { INVITABLE_ROLES, ROLE_LABELS } from '@/lib/auth/permissions'

interface Member {
  store_id: string
  store_name: string
  user_id: string
  email: string
  role: string
  status: string
  accepted_at: string | null
}

interface Invitation {
  id: string
  email: string
  status: string
  created_at: string
  assignments: { store_id: string; store_name: string; role: string }[]
}

async function toJson(res: Response) {
  const payload = await res.json().catch(() => null)
  if (!res.ok) throw new Error(payload?.error || 'REQUEST_FAILED')
  return payload
}

export default function TeamSection() {
  const queryClient = useQueryClient()
  const supabase = createClient()
  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [assignments, setAssignments] = useState<{ storeId: string; role: string }[]>([])
  const [saving, setSaving] = useState(false)

  const currentStoreId = typeof window !== 'undefined' ? localStorage.getItem('current-store-id') : null
  const { can } = usePermissions(currentStoreId)

  const { data: membersPayload, isLoading: membersLoading } = useQuery({
    queryKey: ['team-members'],
    queryFn: async () => toJson(await fetch('/api/team/members')),
  })

  const { data: invitesPayload, isLoading: invitesLoading } = useQuery({
    queryKey: ['team-invitations'],
    queryFn: async () => toJson(await fetch('/api/team/invitations')),
  })

  const members: Member[] = membersPayload?.members || []
  const invitations: Invitation[] = invitesPayload?.invitations || []

  const { data: storesPayload } = useQuery({
    queryKey: ['my-stores'],
    queryFn: async () => toJson(await fetch('/api/stores/list')),
  })
  const myStores = (storesPayload?.stores || []).filter((s: any) => s.role === 'owner' || s.role === 'admin')

  async function handleInvite() {
    if (!inviteEmail.trim() || assignments.length === 0) return
    setSaving(true)
    try {
      await toJson(await fetch('/api/team/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim(), assignments }),
      }))
      await queryClient.invalidateQueries({ queryKey: ['team-invitations'] })
      setShowInvite(false)
      setInviteEmail('')
      setAssignments([])
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Erreur')
    } finally { setSaving(false) }
  }

  async function revokeInvitation(id: string) {
    if (!confirm('Révoquer cette invitation ?')) return
    try {
      await toJson(await fetch(`/api/team/invitations/${id}`, { method: 'DELETE' }))
      await queryClient.invalidateQueries({ queryKey: ['team-invitations'] })
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Erreur')
    }
  }

  async function changeRole(storeId: string, userId: string, newRole: string) {
    try {
      await toJson(await fetch(`/api/team/members/${storeId}/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      }))
      await queryClient.invalidateQueries({ queryKey: ['team-members'] })
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Erreur')
    }
  }

  async function removeMember(storeId: string, userId: string) {
    if (!confirm('Retirer ce membre ?')) return
    try {
      await toJson(await fetch(`/api/team/members/${storeId}/${userId}`, { method: 'DELETE' }))
      await queryClient.invalidateQueries({ queryKey: ['team-members'] })
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Erreur')
    }
  }

  if (!can('team.view')) return null

  return (
    <section id="team" className="rounded-2xl border bg-card p-6 scroll-mt-32">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Users className="h-5 w-5"/>Équipe</h2>
        {can('team.invite') && (
          <button onClick={() => setShowInvite(true)} className="inline-flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
            <Plus className="h-4 w-4"/>Inviter
          </button>
        )}
      </div>

      {/* Members */}
      <div className="mt-4">
        <h3 className="text-sm font-medium text-muted-foreground mb-2">Membres</h3>
        {membersLoading ? <Loader2 className="h-4 w-4 animate-spin"/> : members.length === 0 ? (
          <div className="text-sm text-muted-foreground">Aucun membre.</div>
        ) : (
          <div className="space-y-2">
            {members.map((m) => (
              <div key={`${m.store_id}-${m.user_id}`} className="flex items-center justify-between rounded-xl border px-4 py-3 text-sm">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0"><Mail className="h-4 w-4 text-primary"/></div>
                  <div className="min-w-0">
                    <div className="font-medium truncate">{m.email}</div>
                    <div className="text-xs text-muted-foreground">{m.store_name} · {ROLE_LABELS[m.role as keyof typeof ROLE_LABELS] || m.role}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {can('team.change_role') && m.role !== 'owner' && (
                    <select value={m.role} onChange={e => changeRole(m.store_id, m.user_id, e.target.value)} className="rounded-lg border bg-background px-2 py-1 text-xs">
                      {INVITABLE_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  )}
                  {can('team.remove') && m.role !== 'owner' && (
                    <button onClick={() => removeMember(m.store_id, m.user_id)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-600"><Trash2 className="h-4 w-4"/></button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pending Invitations */}
      {invitations.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-medium text-muted-foreground mb-2">Invitations en attente</h3>
          <div className="space-y-2">
            {invitations.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between rounded-xl border px-4 py-3 text-sm">
                <div className="flex items-center gap-3">
                  <Shield className="h-4 w-4 text-amber-500"/>
                  <div>
                    <div className="font-medium">{inv.email}</div>
                    <div className="text-xs text-muted-foreground">
                      {inv.assignments.map(a => `${a.store_name} (${ROLE_LABELS[a.role as keyof typeof ROLE_LABELS] || a.role})`).join(', ')}
                    </div>
                  </div>
                </div>
                <button onClick={() => revokeInvitation(inv.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-600"><X className="h-4 w-4"/></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Invite Modal */}
      {showInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl border bg-card p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold">Inviter un membre</h3>
            <div className="mt-4 space-y-4">
              <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground ml-1">Email</label><input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="collegue@exemple.com" className="w-full rounded-xl border bg-background px-4 py-3 text-sm"/></div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground ml-1">Stores & rôles</label>
                {myStores.map((s: any) => {
                  const existing = assignments.find(a => a.storeId === s.id)
                  const isChecked = !!existing
                  return (
                    <div key={s.id} className={`flex items-center gap-3 rounded-xl border px-3 py-2 transition-colors ${isChecked ? 'bg-primary/5 border-primary/20' : 'hover:bg-secondary/50'}`}>
                      <input type="checkbox" checked={isChecked} onChange={e => {
                        if (e.target.checked) setAssignments([...assignments, { storeId: s.id, role: 'viewer' }])
                        else setAssignments(assignments.filter(a => a.storeId !== s.id))
                      }} className="h-4 w-4 accent-primary"/>
                      <span className="text-sm flex-1 font-medium">{s.name}</span>
                      <select
                        value={existing?.role || ''}
                        disabled={!isChecked}
                        onChange={e => {
                          if (!isChecked) return
                          setAssignments(assignments.map(a => a.storeId === s.id ? { ...a, role: e.target.value } : a))
                        }}
                        className={`rounded-lg border px-2 py-1 text-xs transition-all ${isChecked ? 'bg-background border-primary/30 text-foreground' : 'bg-muted text-muted-foreground cursor-not-allowed opacity-60'}`}
                      >
                        <option value="" disabled>{isChecked ? 'Choisir un rôle…' : '—'}</option>
                        {INVITABLE_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button onClick={() => setShowInvite(false)} className="rounded-xl border px-4 py-2 text-sm font-medium">Annuler</button>
              <button onClick={handleInvite} disabled={saving || !inviteEmail.trim() || assignments.length === 0} className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">{saving ? 'Envoi...' : 'Envoyer l\'invitation'}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
