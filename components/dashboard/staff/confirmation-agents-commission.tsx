'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useStore } from '@/lib/store-context'

type Agent = {
  id: string
  store_id: string
  name: string
  commission_per_order: number
  commission_enabled: boolean
  commission_trigger: 'confirmed' | 'delivered' | null
  use_store_commission_settings: boolean
  is_active: boolean
}

export default function ConfirmationAgentsCommission() {
  const { currentStoreId } = useStore()
  const queryClient = useQueryClient()
  const [editingId, setEditingId] = useState<string | null>(null)

  const { data: agents = [], isLoading } = useQuery<Agent[]>({
    queryKey: ['confirmation-agents-commission', currentStoreId],
    enabled: Boolean(currentStoreId),
    queryFn: async () => {
      const response = await fetch(
        `/api/team/confirmation-agents?storeId=${encodeURIComponent(String(currentStoreId))}`
      )
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'CONFIRMATION_AGENTS_FETCH_FAILED')
      return payload.agents as Agent[]
    },
  })

  const updateMutation = useMutation({
    mutationFn: async (input: {
      agentId: string
      commissionEnabled: boolean
      commissionAmount: number
      commissionTrigger: 'confirmed' | 'delivered'
      useStoreSettings: boolean
    }) => {
      const response = await fetch('/api/team/confirmation-agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId: currentStoreId, ...input }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'CONFIRMATION_AGENT_UPDATE_FAILED')
      return payload
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['confirmation-agents-commission'] })
      setEditingId(null)
      toast.success('Commission enregistrée.')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'CONFIRMATION_AGENT_UPDATE_FAILED')
    },
  })

  if (!currentStoreId) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        Sélectionnez un store pour configurer les commissions des agents.
      </div>
    )
  }

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Chargement...</div>
  }

  if (agents.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        Aucun agent de confirmation dans ce store.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {agents.map((agent) => (
        <AgentCommissionRow
          key={agent.id}
          agent={agent}
          editing={editingId === agent.id}
          busy={updateMutation.isPending}
          onEdit={() => setEditingId(agent.id)}
          onCancel={() => setEditingId(null)}
          onSave={(values) => updateMutation.mutate({ agentId: agent.id, ...values })}
        />
      ))}
    </div>
  )
}

type SaveValues = {
  commissionEnabled: boolean
  commissionAmount: number
  commissionTrigger: 'confirmed' | 'delivered'
  useStoreSettings: boolean
}

function AgentCommissionRow({
  agent,
  editing,
  busy,
  onEdit,
  onCancel,
  onSave,
}: {
  agent: Agent
  editing: boolean
  busy: boolean
  onEdit: () => void
  onCancel: () => void
  onSave: (values: SaveValues) => void
}) {
  const [commissionEnabled, setCommissionEnabled] = useState(agent.commission_enabled === true)
  const [commissionAmount, setCommissionAmount] = useState(Number(agent.commission_per_order || 0))
  const [commissionTrigger, setCommissionTrigger] = useState<'confirmed' | 'delivered'>(
    agent.commission_trigger === 'confirmed' ? 'confirmed' : 'delivered'
  )
  const [useStoreSettings, setUseStoreSettings] = useState(
    agent.use_store_commission_settings === true
  )

  useEffect(() => {
    setCommissionEnabled(agent.commission_enabled === true)
    setCommissionAmount(Number(agent.commission_per_order || 0))
    setCommissionTrigger(agent.commission_trigger === 'confirmed' ? 'confirmed' : 'delivered')
    setUseStoreSettings(agent.use_store_commission_settings === true)
  }, [agent])

  const label = useStoreSettings
    ? 'Utilise les réglages du store'
    : commissionEnabled
      ? `${commissionAmount} DH — ${commissionTrigger === 'confirmed' ? 'à la confirmation' : 'à la livraison'}`
      : 'Commission désactivée'

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-foreground">{agent.name}</div>
          <div className="text-xs text-muted-foreground">
            {agent.is_active ? 'Actif' : 'Inactif'} • {label}
          </div>
        </div>
        {!editing ? (
          <button
            type="button"
            onClick={onEdit}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary"
          >
            Configurer
          </button>
        ) : (
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary disabled:opacity-50"
          >
            Annuler
          </button>
        )}
      </div>

      {editing ? (
        <div className="mt-4 space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={useStoreSettings}
              onChange={(event) => setUseStoreSettings(event.target.checked)}
              className="h-4 w-4"
            />
            Utiliser les réglages par défaut du store
          </label>

          {!useStoreSettings ? (
            <>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={commissionEnabled}
                  onChange={(event) => setCommissionEnabled(event.target.checked)}
                  className="h-4 w-4"
                />
                Commission active
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm space-y-1">
                  <span className="font-medium text-foreground">Montant par commande</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    disabled={!commissionEnabled}
                    value={commissionAmount}
                    onChange={(event) => setCommissionAmount(Number(event.target.value))}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  />
                </label>

                <label className="text-sm space-y-1">
                  <span className="font-medium text-foreground">Déclenchement</span>
                  <select
                    disabled={!commissionEnabled}
                    value={commissionTrigger}
                    onChange={(event) =>
                      setCommissionTrigger(
                        event.target.value === 'confirmed' ? 'confirmed' : 'delivered'
                      )
                    }
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  >
                    <option value="confirmed">À la confirmation</option>
                    <option value="delivered">À la livraison</option>
                  </select>
                </label>
              </div>
            </>
          ) : null}

          <button
            type="button"
            disabled={busy}
            onClick={() =>
              onSave({ commissionEnabled, commissionAmount, commissionTrigger, useStoreSettings })
            }
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
