export type PaymentStatus = 'pending' | 'review' | 'validated' | 'refused' | 'cancelled' | 'expired'
export const paymentStatusLabels: Record<PaymentStatus, string> = {
  pending: 'En attente de paiement', review: 'En vérification', validated: 'Validé',
  refused: 'Refusé', cancelled: 'Annulé', expired: 'Expiré',
}

/** État présenté au client, distinct de la valeur brute de `status`. */
export type PaymentUxState =
  | 'awaiting_payment' | 'in_review' | 'refused' | 'activated' | 'scheduled' | 'cancelled' | 'expired'

/** Distingue « activé » (période effective) de « programmé » (début futur). */
export function paymentUxState(status: PaymentStatus, startedAt?: string | null): PaymentUxState {
  if (status === 'pending') return 'awaiting_payment'
  if (status === 'review') return 'in_review'
  if (status === 'refused') return 'refused'
  if (status === 'validated') {
    return startedAt && new Date(startedAt).getTime() > Date.now() ? 'scheduled' : 'activated'
  }
  if (status === 'cancelled') return 'cancelled'
  return 'expired'
}

export const paymentUxLabels: Record<PaymentUxState, { title: string; tone: 'amber' | 'blue' | 'red' | 'green' }> = {
  awaiting_payment: { title: 'En attente de paiement', tone: 'amber' },
  in_review: { title: 'Vérification en cours', tone: 'blue' },
  refused: { title: 'Paiement non validé', tone: 'red' },
  activated: { title: 'Abonnement activé', tone: 'green' },
  scheduled: { title: 'Abonnement programmé', tone: 'green' },
  cancelled: { title: 'Demande annulée', tone: 'red' },
  expired: { title: 'Demande expirée', tone: 'red' },
}

export type PaymentRequest = {
  id: string; reference: string; plan_name: string; billing_period: 'monthly' | 'yearly'
  duration_months: number; price_version: number; amount_minor: number; currency: 'MAD'
  status: PaymentStatus; created_at: string; expires_at: string; declared_at: string | null
}
export type PaymentProof = { id: string; mime_type: string; size_bytes: number; created_at: string }
export type PaymentEvent = { id: number; event_type: string; created_at: string; reason?: string | null }
export type BankInstructions = {
  enabled: boolean; beneficiary?: string; bank_name?: string; rib?: string; instructions?: string | null
}
export type PaymentReceipt = { started_at: string; expires_at: string | null } | null
export type PaymentDetail = {
  request: PaymentRequest; proofs: PaymentProof[]; events: PaymentEvent[]; bank: BankInstructions; receipt?: PaymentReceipt
}