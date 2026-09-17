'use client'

import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeftRight, Copy, ExternalLink, ShieldAlert } from 'lucide-react'
import { getExchangeCarrierPageUrl, isExchangeSupportedProvider } from '@/lib/integrations/delivery/exchange-providers'

const PROVIDER_LABELS: Record<string, string> = {
  'rapid-delivery': 'Rapid Delivery',
  'maroc-go-delivery': 'Maroc Go Delivery',
}

const ERROR_MESSAGES: Record<string, string> = {
  MISSING_REQUIRED_FIELDS: 'Veuillez saisir le nouvel ID du colis.',
  ORDER_NOT_FOUND: 'Commande introuvable.',
  EXCHANGE_NOT_SUPPORTED_FOR_PROVIDER: "L'échange n'est disponible que pour Rapid Delivery et Maroc Go Delivery.",
  EXCHANGE_REQUIRES_DELIVERED_ORDER: "L'échange n'est possible que pour une commande livrée.",
  EXCHANGE_ALREADY_LINKED: 'Un échange est déjà enregistré pour cette commande.',
  EXCHANGE_FORBIDDEN: "Vous n'avez pas la permission de déclarer un échange sur cette commande.",
  EXCHANGE_NOT_ALLOWED_ON_REPLACEMENT: "Cette commande est déjà une commande de remplacement d'échange.",
  EXCHANGE_SAME_PARCEL_KEY: "Le nouvel ID de colis est identique à celui du colis d'origine.",
  EXCHANGE_PARCEL_ALREADY_USED: 'Ce nouvel ID de colis est déjà rattaché à un autre échange.',
  DELIVERY_INTEGRATION_NOT_CONNECTED: "L'intégration du transporteur n'est pas connectée.",
  EXCHANGE_NEW_PARCEL_NOT_FOUND:
    "Cet ID de colis est introuvable chez le transporteur. Vérifiez que la demande d'échange a bien été créée.",
}

type ExchangeResult = {
  carrierState?: { rawStatus?: string; orderStatus?: string | null }
  originalOrder?: { id: string; status: string; exchangeStatus: string }
  replacementOrder?: { id: string; status: string } | null
  warning?: string
}

interface ExchangeRequestModalProps {
  order: any | null
  canManage: boolean
  onClose: () => void
}

export default function ExchangeRequestModal({ order, canManage, onClose }: ExchangeRequestModalProps) {
  const queryClient = useQueryClient()
  const [newParcelKey, setNewParcelKey] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [result, setResult] = useState<ExchangeResult | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    // Un échange resté en « requested » reprend le nouvel ID déjà enregistré.
    setNewParcelKey(String(order?.exchange_new_parcel_key || '').trim())
    setIsSubmitting(false)
    setErrorMessage('')
    setResult(null)
    setCopied(false)
  }, [order?.id, order?.exchange_new_parcel_key])

  if (!order) return null

  const providerSlug = String(order?.delivery_companies?.api_provider || '').trim()
  const providerLabel = PROVIDER_LABELS[providerSlug] || providerSlug || 'Transporteur'
  const carrierUrl = isExchangeSupportedProvider(providerSlug) ? getExchangeCarrierPageUrl(providerSlug) : null
  const orderShortId = String(order?.id || '').slice(0, 8)
  const originalParcelKey = String(
    (providerSlug === 'maroc-go-delivery'
      ? order?.maroc_go_delivery_parcel_key
      : order?.rapid_delivery_parcel_key) || order?.tracking_number || ''
  ).trim()

  const handleCopyRequest = async () => {
    const summary = [
      `Commande : #${orderShortId}`,
      `Transporteur : ${providerLabel}`,
      `Colis d'origine : ${originalParcelKey || '—'}`,
      `Statut actuel : ${String(order?.status || '—')}`,
    ].join('\n')

    try {
      await navigator.clipboard.writeText(summary)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      setCopied(false)
    }
  }

  const handleSubmit = async () => {
    const parcelKey = String(newParcelKey || '').trim()
    if (!parcelKey) {
      setErrorMessage(ERROR_MESSAGES.MISSING_REQUIRED_FIELDS)
      return
    }

    setIsSubmitting(true)
    setErrorMessage('')

    try {
      const response = await fetch('/api/orders/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id, newParcelKey: parcelKey }),
      })

      const payload = (await response.json().catch(() => null)) as any

      if (!response.ok) {
        const code = String(payload?.error || '')
        throw new Error(ERROR_MESSAGES[code] || code || "Échec de l'enregistrement de l'échange.")
      }

      setResult(payload as ExchangeResult)
      await queryClient.invalidateQueries({ queryKey: ['orders'] })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Échec de l'enregistrement de l'échange.")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
              <ArrowLeftRight className="h-4 w-4" />
              {order.exchange_status === 'requested' ? "Terminer l'échange" : 'Demander un échange'}
            </h3>
            <p className="text-sm text-muted-foreground">
              Commande #{orderShortId} — {providerLabel}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground">
            Fermer
          </button>
        </div>

        {!canManage ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="space-y-1">
                <div className="font-medium">Autorisation requise</div>
                <div>
                  La demande d&apos;échange doit être effectuée par un administrateur ou un responsable de livraison.
                  Veuillez contacter votre administrateur en lui indiquant la commande concernée.
                </div>
              </div>
            </div>

            <div className="space-y-1 rounded-lg border border-border bg-secondary/40 p-4 text-sm text-foreground">
              <div>Commande : #{orderShortId}</div>
              <div>Transporteur : {providerLabel}</div>
              <div>Colis d&apos;origine : {originalParcelKey || '—'}</div>
              <div>Statut actuel : {String(order.status || '—')}</div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-border px-4 py-2 text-sm text-foreground hover:bg-secondary"
              >
                Fermer
              </button>
              <button
                type="button"
                onClick={handleCopyRequest}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Copy className="h-3.5 w-3.5" />
                {copied ? 'Informations copiées' : 'Copier les informations'}
              </button>
            </div>
          </div>
        ) : result ? (
          <div className="space-y-4">
            <div className="space-y-1 rounded-lg border border-border bg-secondary/40 p-4 text-sm text-foreground">
              <div>
                État du nouveau colis chez {providerLabel} :{' '}
                <span className="font-medium">{result.carrierState?.rawStatus || '—'}</span>
              </div>
              {result.originalOrder?.status === 'returned_not_stocked' ? (
                <div>L&apos;ancien colis a été passé en « Retour non stocké ».</div>
              ) : (
                <div>
                  L&apos;ancien colis reste « Livrée ». Il passera automatiquement en « Retour non stocké » dès que le
                  transporteur affichera l&apos;état « Retour/Echange ».
                </div>
              )}
              {result.replacementOrder ? (
                <div>
                  Commande de remplacement créée : #{String(result.replacementOrder.id).slice(0, 8)} — son colis est
                  suivi automatiquement.
                </div>
              ) : (
                <div className="text-amber-700">
                  Le nouvel ID est enregistré mais la commande de remplacement n&apos;a pas pu être créée
                  {result.warning ? ` (${result.warning})` : ''}.
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Terminer
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2 rounded-lg border border-border bg-secondary/40 p-4 text-sm text-foreground">
              <div className="font-medium">Étapes à suivre chez {providerLabel}</div>
              <ol className="list-decimal space-y-1 pl-4 text-muted-foreground">
                <li>Ouvrez les colis livrés, puis les 3 points de la ligne concernée.</li>
                <li>Choisissez « demande d&apos;échange ».</li>
                <li>Remplissez le formulaire : un nouveau colis est créé avec un nouvel ID.</li>
                <li>Collez cet ID ci-dessous.</li>
              </ol>
              {carrierUrl ? (
                <a
                  href={carrierUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary"
                >
                  Ouvrir les colis livrés {providerLabel}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : null}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Nouvel ID du colis</label>
              <input
                type="text"
                value={newParcelKey}
                onChange={(event) => setNewParcelKey(event.target.value)}
                placeholder="ID du colis créé par l'échange"
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
              />
            </div>

            {errorMessage ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{errorMessage}</div>
            ) : null}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-border px-4 py-2 text-sm text-foreground hover:bg-secondary"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {isSubmitting ? 'Enregistrement...' : "Enregistrer l'échange"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
