'use client'

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import StoreSelector from '@/components/dashboard/store-selector'
import { useStore } from '@/lib/store-context'
import { usePermissions } from '@/lib/auth/use-permissions'
import {
  DEFAULT_MAX_ATTEMPTS,
  MAX_MAX_ATTEMPTS,
  MIN_MAX_ATTEMPTS,
} from '@/lib/confirmation/constants'
import type { ConfirmationSettings } from '@/lib/confirmation/types'

type FormState = {
  maxAttempts: number
  autoCancelOnMaxAttempts: boolean
  requireCancellationReason: boolean
  requireCallbackDatetime: boolean
  commissionEnabled: boolean
  defaultCommissionAmount: number
  defaultCommissionTrigger: 'confirmed' | 'delivered'
}

const DEFAULT_FORM: FormState = {
  maxAttempts: DEFAULT_MAX_ATTEMPTS,
  autoCancelOnMaxAttempts: true,
  requireCancellationReason: true,
  requireCallbackDatetime: true,
  commissionEnabled: false,
  defaultCommissionAmount: 0,
  defaultCommissionTrigger: 'delivered',
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="flex items-start gap-3 rounded-lg border border-border p-3 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4"
      />
      <span className="space-y-0.5">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </label>
  )
}

export default function ConfirmationSettingsSection() {
  const { currentStoreId } = useStore()
  const { can } = usePermissions(currentStoreId)
  const queryClient = useQueryClient()
  const canManage = can('confirmation.settings')

  const [form, setForm] = useState<FormState>(DEFAULT_FORM)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [saving, setSaving] = useState(false)

  const { data, isLoading } = useQuery<{ settings: ConfirmationSettings }>({
    queryKey: ['confirmation-settings', currentStoreId],
    enabled: Boolean(currentStoreId),
    queryFn: async () => {
      const response = await fetch(
        `/api/orders/confirmation/settings?storeId=${encodeURIComponent(String(currentStoreId))}`
      )
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'CONFIRMATION_SETTINGS_FETCH_FAILED')
      return payload as { settings: ConfirmationSettings }
    },
  })

  useEffect(() => {
    const settings = data?.settings
    if (!settings) return
    setForm({
      maxAttempts: Number(settings.max_attempts || DEFAULT_MAX_ATTEMPTS),
      autoCancelOnMaxAttempts: settings.auto_cancel_on_max_attempts !== false,
      requireCancellationReason: settings.require_cancellation_reason !== false,
      requireCallbackDatetime: settings.require_callback_datetime !== false,
      commissionEnabled: settings.commission_enabled === true,
      defaultCommissionAmount: Number(settings.default_commission_amount || 0),
      defaultCommissionTrigger:
        settings.default_commission_trigger === 'confirmed' ? 'confirmed' : 'delivered',
    })
  }, [data?.settings])

  async function save() {
    if (!currentStoreId) return
    setSaving(true)
    setMessage(null)
    try {
      const response = await fetch('/api/orders/confirmation/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId: currentStoreId, ...form }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'CONFIRMATION_SETTINGS_SAVE_FAILED')

      await queryClient.invalidateQueries({ queryKey: ['confirmation-settings'] })
      await queryClient.invalidateQueries({ queryKey: ['confirmation-queue'] })
      setMessage({ type: 'success', text: 'Paramètres de confirmation enregistrés.' })
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'CONFIRMATION_SETTINGS_SAVE_FAILED',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section id="confirmation" className="rounded-2xl border bg-card p-6 scroll-mt-32 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Confirmation des commandes</h2>
          <p className="text-sm text-muted-foreground">
            Réglages appliqués au store sélectionné : nombre d’appels et comportement final.
          </p>
        </div>
        <StoreSelector />
      </div>

      {!currentStoreId ? (
        <p className="text-sm text-muted-foreground">
          Sélectionnez un store pour configurer le module de confirmation.
        </p>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Chargement des paramètres...</p>
      ) : (
        <div className="space-y-4">
          <div className="max-w-xs space-y-1">
            <label className="text-sm font-medium text-foreground" htmlFor="confirmation-max-attempts">
              Nombre maximal d’appels sans réponse
            </label>
            <input
              id="confirmation-max-attempts"
              type="number"
              min={MIN_MAX_ATTEMPTS}
              max={MAX_MAX_ATTEMPTS}
              disabled={!canManage}
              value={form.maxAttempts}
              onChange={(event) =>
                setForm((current) => ({ ...current, maxAttempts: Number(event.target.value) }))
              }
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Après le dernier appel, la commande est annulée automatiquement avec le motif
              « Nombre maximal de tentatives atteint ».
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <Toggle
              label="Annulation automatique à la limite"
              hint="La commande passe à « Annulée » dès que la limite d’appels est atteinte."
              checked={form.autoCancelOnMaxAttempts}
              onChange={(value) =>
                setForm((current) => ({ ...current, autoCancelOnMaxAttempts: value }))
              }
            />
            <Toggle
              label="Motif d’annulation obligatoire"
              hint="L’agent doit choisir un motif avant d’annuler une commande."
              checked={form.requireCancellationReason}
              onChange={(value) =>
                setForm((current) => ({ ...current, requireCancellationReason: value }))
              }
            />
            <Toggle
              label="Date et heure de rappel obligatoires"
              hint="L’action « Reporter » exige une date et une heure de rappel."
              checked={form.requireCallbackDatetime}
              onChange={(value) =>
                setForm((current) => ({ ...current, requireCallbackDatetime: value }))
              }
            />
          </div>

          <div className="rounded-xl border border-border p-4 space-y-3">
            <div className="text-sm font-medium text-foreground">Commission des agents</div>
            <p className="text-xs text-muted-foreground">
              Coût appliqué à chaque commande traitée par un agent de confirmation. Priorité : réglage individuel de l’agent, sinon cette règle par défaut.
            </p>

            <Toggle
              label="Activer la commission"
              hint="Applique un coût automatique aux commandes confirmées ou livrées."
              checked={form.commissionEnabled}
              onChange={(value) =>
                setForm((current) => ({ ...current, commissionEnabled: value }))
              }
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm space-y-1">
                <span className="font-medium text-foreground">Montant par commande</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  disabled={!canManage || !form.commissionEnabled}
                  value={form.defaultCommissionAmount}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      defaultCommissionAmount: Number(event.target.value),
                    }))
                  }
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
              </label>

              <label className="text-sm space-y-1">
                <span className="font-medium text-foreground">Déclenchement</span>
                <select
                  disabled={!canManage || !form.commissionEnabled}
                  value={form.defaultCommissionTrigger}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      defaultCommissionTrigger:
                        event.target.value === 'confirmed' ? 'confirmed' : 'delivered',
                    }))
                  }
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                >
                  <option value="confirmed">À la confirmation</option>
                  <option value="delivered">À la livraison</option>
                </select>
              </label>
            </div>
          </div>

          {message ? (
            <div
              className={`rounded-xl border px-4 py-3 text-sm ${
                message.type === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-red-200 bg-red-50 text-red-800'
              }`}
            >
              {message.text}
            </div>
          ) : null}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={saving || !canManage}
              className="rounded-lg bg-[#1fa971] px-4 py-2 text-sm font-medium text-white hover:bg-[#178a5a] disabled:opacity-50"
            >
              {saving ? 'Enregistrement...' : 'Enregistrer'}
            </button>
            {!canManage ? (
              <span className="text-xs text-muted-foreground">
                Seuls le propriétaire et l’administrateur peuvent modifier ces réglages.
              </span>
            ) : null}
          </div>
        </div>
      )}
    </section>
  )
}

