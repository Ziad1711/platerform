'use client'

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import StoreSelector from '@/components/dashboard/store-selector'
import { useStore } from '@/lib/store-context'
import { usePermissions } from '@/lib/auth/use-permissions'
import {
  VAT_REGIME_LABELS,
  type InvoiceVatRegime,
  type StoreInvoiceSettings,
} from '@/lib/invoices/types'

type TextKey =
  | 'legal_name'
  | 'legal_form'
  | 'activity'
  | 'address'
  | 'city'
  | 'phone'
  | 'email'
  | 'website'
  | 'ice'
  | 'if_number'
  | 'rc_number'
  | 'tp_number'
  | 'invoice_prefix'
  | 'bank_name'
  | 'bank_rib'
  | 'payment_terms'
  | 'legal_mentions'

type FieldDef = { key: TextKey; label: string; placeholder?: string; maxLength?: number }

const IDENTITY_FIELDS: FieldDef[] = [
  { key: 'legal_name', label: 'Raison sociale *', placeholder: 'Ma Société SARL', maxLength: 150 },
  { key: 'legal_form', label: 'Forme juridique', placeholder: 'SARL', maxLength: 60 },
  { key: 'activity', label: "Activité", placeholder: 'Vente en ligne', maxLength: 120 },
  { key: 'address', label: 'Adresse', placeholder: '123, rue Exemple', maxLength: 300 },
  { key: 'city', label: 'Ville', placeholder: 'Casablanca', maxLength: 100 },
  { key: 'phone', label: 'Téléphone', placeholder: '06 12 34 56 78', maxLength: 40 },
  { key: 'email', label: 'E-mail', placeholder: 'contact@societe.ma', maxLength: 150 },
  { key: 'website', label: 'Site web', placeholder: 'https://societe.ma', maxLength: 200 },
]

const LEGAL_FIELDS: FieldDef[] = [
  { key: 'ice', label: 'ICE', placeholder: '000000000000000', maxLength: 40 },
  { key: 'if_number', label: 'Identifiant fiscal', maxLength: 40 },
  { key: 'rc_number', label: 'Registre de commerce', maxLength: 40 },
  { key: 'tp_number', label: 'Taxe professionnelle', maxLength: 40 },
]

function TextInput({
  label,
  value,
  onChange,
  disabled,
  placeholder,
  maxLength,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
  maxLength?: number
}) {
  return (
    <label className="text-sm space-y-1">
      <span className="font-medium text-foreground">{label}</span>
      <input
        type="text"
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm disabled:opacity-60"
      />
    </label>
  )
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className="flex items-start gap-3 rounded-lg border border-border p-3 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
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


export default function InvoicingSettingsSection() {
  const { currentStoreId } = useStore()
  const { can } = usePermissions(currentStoreId)
  const queryClient = useQueryClient()
  const canManage = can('invoices.settings')

  const [form, setForm] = useState<StoreInvoiceSettings | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [saving, setSaving] = useState(false)

  const { data, isLoading, isError, error, refetch } = useQuery<{
    settings: StoreInvoiceSettings
    configured: boolean
  }>({
    queryKey: ['invoicing-settings', currentStoreId],
    enabled: Boolean(currentStoreId),
    queryFn: async () => {
      const response = await fetch(
        `/api/settings/invoicing?storeId=${encodeURIComponent(String(currentStoreId))}`
      )
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'INVOICE_SETTINGS_FETCH_FAILED')
      if (!payload?.settings) throw new Error('INVOICE_SETTINGS_FETCH_FAILED')
      return payload as { settings: StoreInvoiceSettings; configured: boolean }
    },
  })

  useEffect(() => {
    if (data?.settings) setForm(data.settings)
  }, [data])

  const errorMessage = error instanceof Error ? error.message : null
  const forbidden = errorMessage === 'FORBIDDEN' || errorMessage === 'UNAUTHORIZED'

  function updateText(key: TextKey, value: string) {
    setForm((current) => (current ? { ...current, [key]: value } : current))
  }

  async function save() {
    if (!form || !currentStoreId) return

    setSaving(true)
    setMessage(null)

    try {
      const response = await fetch('/api/settings/invoicing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, storeId: currentStoreId }),
      })
      const payload = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(payload?.error || 'INVOICE_SETTINGS_SAVE_FAILED')
      }

      await queryClient.invalidateQueries({ queryKey: ['invoicing-settings', currentStoreId] })
      setMessage({ type: 'success', text: 'Paramètres de facturation client enregistrés.' })
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'INVOICE_SETTINGS_SAVE_FAILED',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section id="invoicing" className="rounded-2xl border bg-card p-6 scroll-mt-32 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">Factures clients</h2>
        <StoreSelector />
      </div>

      <p className="text-sm text-muted-foreground">
        Factures que vous émettez pour vos propres clients. Ces paramètres sont indépendants de
        votre abonnement Jisra.
      </p>

      {!currentStoreId ? (
        <p className="text-sm text-muted-foreground">
          Sélectionnez un store pour configurer vos factures clients.
        </p>
      ) : isError ? (
        <div className="space-y-3">
          <p className="text-sm text-red-600">
            {forbidden
              ? 'Votre rôle ne donne pas accès aux paramètres de factures clients.'
              : 'Impossible de charger les paramètres de factures clients.'}
          </p>
          {forbidden ? null : (
            <button
              type="button"
              onClick={() => void refetch()}
              className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-secondary"
            >
              Réessayer
            </button>
          )}
        </div>
      ) : isLoading || !form ? (
        <p className="text-sm text-muted-foreground">Chargement des paramètres de factures clients…</p>
      ) : (
      <div className="space-y-6">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            Mentions légales et règles de TVA appliquées aux factures générées depuis les commandes.
            Ces informations sont figées sur chaque facture au moment de son émission.
          </p>
        </div>

        <div className="rounded-xl border border-border p-4 space-y-3">
          <div className="text-sm font-medium text-foreground">Identité du vendeur</div>
          <div className="grid gap-3 sm:grid-cols-2">
            {IDENTITY_FIELDS.map((field) => (
              <TextInput
                key={field.key}
                label={field.label}
                value={(form[field.key] as string | null) ?? ''}
                maxLength={field.maxLength}
                placeholder={field.placeholder}
                disabled={!canManage}
                onChange={(value) => updateText(field.key, value)}
              />
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-border p-4 space-y-3">
          <div className="text-sm font-medium text-foreground">Mentions légales obligatoires</div>
          <p className="text-xs text-muted-foreground">
            Reprises discrètement en pied de facture. L’ICE est obligatoire pour une entreprise
            assujettie à la TVA au Maroc.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {LEGAL_FIELDS.map((field) => (
              <TextInput
                key={field.key}
                label={field.label}
                value={(form[field.key] as string | null) ?? ''}
                maxLength={field.maxLength}
                placeholder={field.placeholder}
                disabled={!canManage}
                onChange={(value) => updateText(field.key, value)}
              />
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-border p-4 space-y-3">
          <div className="text-sm font-medium text-foreground">TVA</div>
          <p className="text-xs text-muted-foreground">
            Un seul taux est appliqué au store. Les prix des commandes sont ceux payés par le
            client : en TTC par défaut, le montant hors taxe est recalculé à l’émission.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm space-y-1">
              <span className="font-medium text-foreground">Régime</span>
              <select
                disabled={!canManage}
                value={form.vat_regime}
                onChange={(event) =>
                  setForm((current) =>
                    current
                      ? { ...current, vat_regime: event.target.value as InvoiceVatRegime }
                      : current
                  )
                }
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                {(Object.keys(VAT_REGIME_LABELS) as InvoiceVatRegime[]).map((regime) => (
                  <option key={regime} value={regime}>
                    {VAT_REGIME_LABELS[regime]}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm space-y-1">
              <span className="font-medium text-foreground">Taux de TVA (%)</span>
              <input
                type="number"
                min={0}
                max={100}
                step="0.01"
                disabled={!canManage || form.vat_regime !== 'assujetti'}
                value={form.vat_rate}
                onChange={(event) =>
                  setForm((current) =>
                    current ? { ...current, vat_rate: Number(event.target.value) } : current
                  )
                }
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm disabled:opacity-60"
              />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <Toggle
              label="Prix saisis en TTC"
              hint="Décochez si vos prix unitaires sont hors taxe."
              checked={form.prices_include_vat}
              disabled={!canManage}
              onChange={(value) =>
                setForm((current) => (current ? { ...current, prices_include_vat: value } : current))
              }
            />
            <Toggle
              label="Frais de livraison soumis à TVA"
              hint="Décoché par défaut : le port est facturé sans TVA."
              checked={form.delivery_taxable}
              disabled={!canManage}
              onChange={(value) =>
                setForm((current) => (current ? { ...current, delivery_taxable: value } : current))
              }
            />
          </div>
        </div>

        <div className="rounded-xl border border-border p-4 space-y-3">
          <div className="text-sm font-medium text-foreground">Numérotation</div>
          <p className="text-xs text-muted-foreground">
            Format {form.invoice_prefix || 'FAC'}-ANNÉE-000001. Le compteur repart à 1 chaque année
            civile et un numéro n’est jamais réutilisé, même après annulation.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput
              label="Préfixe (majuscules et chiffres)"
              value={form.invoice_prefix}
              maxLength={8}
              placeholder="FAC"
              disabled={!canManage}
              onChange={(value) =>
                updateText('invoice_prefix', value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
              }
            />
          </div>
        </div>

        <div className="rounded-xl border border-border p-4 space-y-3">
          <div className="text-sm font-medium text-foreground">Règlement et coordonnées bancaires</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput
              label="Banque"
              value={form.bank_name ?? ''}
              maxLength={120}
              placeholder="Attijariwafa Bank"
              disabled={!canManage}
              onChange={(value) => updateText('bank_name', value)}
            />
            <TextInput
              label="RIB / IBAN"
              value={form.bank_rib ?? ''}
              maxLength={60}
              placeholder="MA64 0111 0000 0000 0000 0000 000"
              disabled={!canManage}
              onChange={(value) => updateText('bank_rib', value)}
            />
          </div>
          <TextInput
            label="Conditions de règlement"
            value={form.payment_terms ?? ''}
            maxLength={200}
            placeholder="Paiement à réception"
            disabled={!canManage}
            onChange={(value) => updateText('payment_terms', value)}
          />
          <label className="text-sm space-y-1 block">
            <span className="font-medium text-foreground">Mentions complémentaires</span>
            <textarea
              value={form.legal_mentions ?? ''}
              maxLength={1000}
              rows={3}
              disabled={!canManage}
              onChange={(event) => updateText('legal_mentions', event.target.value)}
              placeholder="Ex. Tout retard de paiement entraîne des pénalités de retard."
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm disabled:opacity-60"
            />
          </label>
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
