'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  INVOICE_PAYMENT_METHODS,
  VAT_REGIME_LABELS,
  type InvoiceIssueBuyerInput,
  type InvoiceIssueResult,
  type StoreInvoiceSettings,
} from '@/lib/invoices/types'
import type { InvoiceCalcLine, InvoiceCalcTotals } from '@/lib/invoices/calc'
import { formatCurrency, formatDate } from '@/lib/utils'

interface InvoicePreviewOrder {
  id: string
  status: string
  customerName: string
  phone: string | null
  address: string | null
  city: string | null
  orderDate: string
  totalSellingPrice: number
  discountAmount: number
  deliveryChargeToCustomer: number
}

interface InvoicePreviewResponse {
  invoiceable: boolean
  settingsComplete: boolean
  settings: StoreInvoiceSettings
  order: InvoicePreviewOrder
  lines: InvoiceCalcLine[]
  totals: InvoiceCalcTotals
  vatRate: number
  totalMismatch: boolean
  alreadyIssued: {
    id: string
    invoice_number: string
    status: string
    issue_date: string
    total_ttc: number
    currency: string
  } | null
}

const ERROR_LABELS: Record<string, string> = {
  INVOICE_SETTINGS_MISSING: "Complétez d'abord les paramètres de facturation du store.",
  INVOICE_SETTINGS_INCOMPLETE: 'Renseignez la raison sociale dans Paramètres > Facturation.',
  ORDER_NOT_INVOICEABLE: 'Cette commande est annulée : aucune facture ne peut être émise.',
  ORDER_HAS_NO_ITEMS: 'Cette commande ne contient aucune ligne facturable.',
  INVOICE_LINE_MISMATCH: "Les lignes de la commande ont changé. Fermez et réouvrez l'aperçu.",
  INVOICE_TOTAL_MISMATCH:
    "Les lignes de la commande ne reproduisent plus son total enregistré. Corrigez la commande avant d'émettre la facture.",
  INVOICE_CANCEL_FAILED: "L'annulation de la facture a échoué.",
  FORBIDDEN: "Vous n'avez pas la permission d'émettre une facture.",
  UNAUTHORIZED: 'Session expirée, reconnectez-vous.',
}

function describeInvoiceError(code: string): string {
  return ERROR_LABELS[code] ?? code
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}


interface InvoiceGenerateModalProps {
  storeId: string | null
  orderId: string
  canIssue: boolean
  onClose: () => void
  onIssued?: (result: InvoiceIssueResult) => void
  onCancelled?: (invoiceId: string) => void
}

export default function InvoiceGenerateModal({
  storeId,
  orderId,
  canIssue,
  onClose,
  onIssued,
  onCancelled,
}: InvoiceGenerateModalProps) {
  const [buyer, setBuyer] = useState<InvoiceIssueBuyerInput>({})
  const [buyerTouched, setBuyerTouched] = useState(false)
  const [descriptions, setDescriptions] = useState<Record<string, string>>({})
  const [paymentMethod, setPaymentMethod] = useState<string>(INVOICE_PAYMENT_METHODS[0].value)
  const [paymentReference, setPaymentReference] = useState('')
  const [issueDate, setIssueDate] = useState(todayIso)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [result, setResult] = useState<InvoiceIssueResult | null>(null)

  const previewQuery = useQuery<InvoicePreviewResponse>({
    queryKey: ['invoice-preview', storeId, orderId],
    enabled: Boolean(storeId && orderId),
    staleTime: 0,
    queryFn: async () => {
      const response = await fetch('/api/invoices/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId, orderId }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'INVOICE_PREVIEW_FAILED')
      return payload as InvoicePreviewResponse
    },
  })

  const preview = previewQuery.data

  useEffect(() => {
    if (!preview || buyerTouched) return
    setBuyer({
      name: preview.order.customerName ?? '',
      ice: '',
      phone: preview.order.phone ?? '',
      address: preview.order.address ?? '',
      city: preview.order.city ?? '',
    })
  }, [preview, buyerTouched])

  useEffect(() => {
    if (!preview) return
    setDescriptions(
      Object.fromEntries(preview.lines.map((line) => [line.orderItemId, line.description]))
    )
  }, [preview])

  function updateBuyer(key: keyof InvoiceIssueBuyerInput, value: string) {
    setBuyerTouched(true)
    setBuyer((current) => ({ ...current, [key]: value }))
  }

  function updateDescription(orderItemId: string, value: string) {
    setDescriptions((current) => ({ ...current, [orderItemId]: value }))
  }

  async function submit() {
    if (!preview || !storeId) return

    setSubmitting(true)
    setSubmitError('')

    try {
      const response = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId,
          orderId,
          buyer,
          lines: preview.lines.map((line) => ({
            orderItemId: line.orderItemId,
            description: descriptions[line.orderItemId] ?? line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
          })),
          options: { issueDate, paymentMethod, paymentReference, notes },
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'INVOICE_ISSUE_FAILED')

      const invoice = payload.invoice as InvoiceIssueResult
      setResult(invoice)
      onIssued?.(invoice)
    } catch (error) {
      setSubmitError(
        error instanceof Error ? describeInvoiceError(error.message) : 'INVOICE_ISSUE_FAILED'
      )
    } finally {
      setSubmitting(false)
    }
  }

  async function cancelInvoice(invoiceId: string, invoiceNumber: string) {
    const reason = window.prompt(
      `Motif d'annulation de la facture ${invoiceNumber} (facultatif)`
    )
    if (reason === null) return

    setCancelling(true)
    setSubmitError('')

    try {
      const response = await fetch(`/api/invoices/${invoiceId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'INVOICE_CANCEL_FAILED')

      await previewQuery.refetch()
      onCancelled?.(invoiceId)
    } catch (error) {
      setSubmitError(
        error instanceof Error ? describeInvoiceError(error.message) : 'INVOICE_CANCEL_FAILED'
      )
    } finally {
      setCancelling(false)
    }
  }

  const currency = result?.currency || 'MAD'
  const total: InvoiceCalcTotals | null = preview?.totals ?? null
  const lines: InvoiceCalcLine[] = preview?.lines ?? []
  const cannotIssue =
    !preview || !preview.invoiceable || !preview.settingsComplete || Boolean(preview.alreadyIssued)

  return (
    <div
      className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-2xl shadow-2xl border border-border w-full max-w-3xl max-h-[90vh] flex flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="p-5 border-b border-border flex items-start justify-between shrink-0 gap-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Générer la facture</h3>
            <p className="text-xs text-muted-foreground">
              Les montants sont recalculés depuis la commande et figés à l’émission. Le numéro est
              attribué définitivement, même en cas d’annulation ultérieure.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Fermer
          </button>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto">
          {previewQuery.isLoading ? (
            <div className="text-sm text-muted-foreground">Chargement de l’aperçu…</div>
          ) : null}

          {previewQuery.error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {describeInvoiceError(
                previewQuery.error instanceof Error
                  ? previewQuery.error.message
                  : 'INVOICE_PREVIEW_FAILED'
              )}
            </div>
          ) : null}

          {result ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 space-y-3">
              <div className="text-sm font-semibold text-emerald-900">
                Facture {result.invoiceNumber} {result.duplicate ? 'déjà émise' : 'émise'}
              </div>
              <div className="text-xs text-emerald-800 space-y-1">
                {result.issueDate ? <div>Date : {formatDate(result.issueDate)}</div> : null}
                {typeof result.totalTtc === 'number' ? (
                  <div>Total TTC : {formatCurrency(result.totalTtc, currency)}</div>
                ) : null}
              </div>
              {result.totalMismatch ? (
                <div className="text-xs text-amber-800">
                  Le total de la facture diffère du total enregistré sur la commande.
                </div>
              ) : null}
              <a
                href={`/api/invoices/${result.invoiceId}/pdf`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center rounded-lg bg-[#1fa971] px-4 py-2 text-sm font-medium text-white hover:bg-[#178a5a]"
              >
                Ouvrir le PDF
              </a>
            </div>
          ) : null}

          {!result && preview ? (
            <>
              {!preview.settingsComplete ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  Paramètres de facturation incomplets : renseignez la raison sociale dans
                  Paramètres &gt; Facturation.
                </div>
              ) : null}

              {preview.alreadyIssued ? (
                <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 space-y-2">
                  <div>
                    Une facture existe déjà pour cette commande : {preview.alreadyIssued.invoice_number}
                    {preview.alreadyIssued.status === 'cancelled' ? ' (annulée)' : ''}.
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={`/api/invoices/${preview.alreadyIssued.id}/pdf`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center rounded-lg border border-sky-300 px-3 py-1.5 text-xs font-medium text-sky-900 hover:bg-sky-100"
                    >
                      Ouvrir la facture existante
                    </a>
                    {canIssue && preview.alreadyIssued.status !== 'cancelled' ? (
                      <button
                        type="button"
                        onClick={() =>
                          cancelInvoice(
                            preview.alreadyIssued!.id,
                            preview.alreadyIssued!.invoice_number
                          )
                        }
                        disabled={cancelling}
                        className="inline-flex items-center rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        {cancelling ? 'Annulation…' : 'Annuler la facture'}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {!preview.invoiceable ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                  Cette commande ne peut pas être facturée (annulée ou sans ligne).
                </div>
              ) : null}

              {preview.totalMismatch ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  Le total calculé ({formatCurrency(preview.totals.totalTtc, currency)}) diffère du
                  total enregistré sur la commande (
                  {formatCurrency(preview.order.totalSellingPrice, currency)}). Vérifiez les lignes
                  avant d’émettre.
                </div>
              ) : null}
            </>
          ) : null}

          {!result && preview ? (
            <>
              <div className="border border-border rounded-lg p-4 space-y-3">
                <div className="text-sm font-medium text-foreground">Client facturé</div>
                <p className="text-xs text-muted-foreground">
                  Repris tel quel sur la facture. L’ICE du client est requis uniquement s’il est
                  assujetti à la TVA.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm space-y-1">
                    <span className="text-muted-foreground">Nom / raison sociale</span>
                    <input
                      type="text"
                      maxLength={150}
                      value={buyer.name ?? ''}
                      onChange={(event) => updateBuyer('name', event.target.value)}
                      className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
                    />
                  </label>
                  <label className="text-sm space-y-1">
                    <span className="text-muted-foreground">ICE client</span>
                    <input
                      type="text"
                      maxLength={40}
                      value={buyer.ice ?? ''}
                      onChange={(event) => updateBuyer('ice', event.target.value)}
                      className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
                    />
                  </label>
                  <label className="text-sm space-y-1">
                    <span className="text-muted-foreground">Téléphone</span>
                    <input
                      type="text"
                      maxLength={40}
                      value={buyer.phone ?? ''}
                      onChange={(event) => updateBuyer('phone', event.target.value)}
                      className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
                    />
                  </label>
                  <label className="text-sm space-y-1">
                    <span className="text-muted-foreground">Ville</span>
                    <input
                      type="text"
                      maxLength={100}
                      value={buyer.city ?? ''}
                      onChange={(event) => updateBuyer('city', event.target.value)}
                      className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
                    />
                  </label>
                  <label className="text-sm space-y-1 sm:col-span-2">
                    <span className="text-muted-foreground">Adresse</span>
                    <input
                      type="text"
                      maxLength={300}
                      value={buyer.address ?? ''}
                      onChange={(event) => updateBuyer('address', event.target.value)}
                      className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
                    />
                  </label>
                </div>
              </div>

              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Désignation</th>
                      <th className="px-3 py-2 text-right">Qté</th>
                      <th className="px-3 py-2 text-right">P.U. TTC</th>
                      <th className="px-3 py-2 text-right">Remise</th>
                      <th className="px-3 py-2 text-right">Total TTC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line) => (
                      <tr key={line.orderItemId} className="border-t border-border align-middle">
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            maxLength={200}
                            value={descriptions[line.orderItemId] ?? line.description}
                            onChange={(event) =>
                              updateDescription(line.orderItemId, event.target.value)
                            }
                            className="w-full rounded-lg border border-border bg-card px-2 py-1 text-sm text-foreground"
                          />
                        </td>
                        <td className="px-3 py-2 text-right text-muted-foreground">
                          {line.quantity}
                        </td>
                        <td className="px-3 py-2 text-right text-muted-foreground">
                          {formatCurrency(line.unitPrice, currency)}
                        </td>
                        <td className="px-3 py-2 text-right text-muted-foreground">
                          {line.discountTtc > 0
                            ? `- ${formatCurrency(line.discountTtc, currency)}`
                            : '—'}
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-foreground">
                          {formatCurrency(line.netTtc, currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="border border-border rounded-lg p-4 space-y-2 text-sm">
                  <div className="font-medium text-foreground">Récapitulatif</div>
                  {total ? (
                    <div className="space-y-1 text-muted-foreground">
                      <div className="flex justify-between">
                        <span>
                          {preview.settings.prices_include_vat ? 'Articles TTC' : 'Articles HT'}
                        </span>
                        <span>{formatCurrency(total.itemsTtc, currency)}</span>
                      </div>
                      {total.discountTtc > 0 ? (
                        <div className="flex justify-between">
                          <span>Remise commande</span>
                          <span>- {formatCurrency(total.discountTtc, currency)}</span>
                        </div>
                      ) : null}
                      {total.shippingTtc > 0 ? (
                        <div className="flex justify-between">
                          <span>Livraison</span>
                          <span>{formatCurrency(total.shippingTtc, currency)}</span>
                        </div>
                      ) : null}
                      <div className="flex justify-between border-t border-border pt-1">
                        <span>Total HT</span>
                        <span>{formatCurrency(total.totalHt, currency)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>
                          TVA {preview.vatRate > 0 ? `(${preview.vatRate}%)` : '(exonérée)'}
                        </span>
                        <span>{formatCurrency(total.totalVat, currency)}</span>
                      </div>
                      <div className="flex justify-between font-semibold text-foreground">
                        <span>Total TTC</span>
                        <span>{formatCurrency(total.totalTtc, currency)}</span>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="border border-border rounded-lg p-4 space-y-3">
                  <div className="text-sm font-medium text-foreground">Options d’émission</div>
                  <label className="text-sm space-y-1 block">
                    <span className="text-muted-foreground">Date de facture</span>
                    <input
                      type="date"
                      value={issueDate}
                      onChange={(event) => setIssueDate(event.target.value)}
                      className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
                    />
                  </label>
                  <label className="text-sm space-y-1 block">
                    <span className="text-muted-foreground">Mode de règlement</span>
                    <select
                      value={paymentMethod}
                      onChange={(event) => setPaymentMethod(event.target.value)}
                      className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
                    >
                      {INVOICE_PAYMENT_METHODS.map((method) => (
                        <option key={method.value} value={method.value}>
                          {method.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm space-y-1 block">
                    <span className="text-muted-foreground">Référence de paiement</span>
                    <input
                      type="text"
                      maxLength={100}
                      value={paymentReference}
                      onChange={(event) => setPaymentReference(event.target.value)}
                      placeholder="N° virement, chèque…"
                      className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
                    />
                  </label>
                  <label className="text-sm space-y-1 block">
                    <span className="text-muted-foreground">Note sur la facture</span>
                    <textarea
                      rows={2}
                      maxLength={1000}
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
                    />
                  </label>
                </div>
              </div>
              <div className="rounded-lg bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
                Vendeur : {preview.settings.legal_name || '—'} —{' '}
                {VAT_REGIME_LABELS[preview.settings.vat_regime]}
                {preview.settings.ice ? ` — ICE ${preview.settings.ice}` : ''}
                {preview.settings.city ? ` — ${preview.settings.city}` : ''}
              </div>
            </>
          ) : null}
        </div>

        <div className="p-5 border-t border-border flex items-center justify-end gap-3 shrink-0">
          {submitError ? (
            <span className="mr-auto text-xs font-medium text-red-600">{submitError}</span>
          ) : null}
          {result ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
            >
              Fermer
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={submitting || cannotIssue || !canIssue}
                className="rounded-lg bg-[#1fa971] px-4 py-2 text-sm font-medium text-white hover:bg-[#178a5a] disabled:opacity-50"
              >
                {submitting ? 'Émission…' : 'Générer la facture'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
