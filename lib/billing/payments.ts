export type PaymentStatus = 'pending' | 'review' | 'validated' | 'refused' | 'cancelled' | 'expired'
export const paymentStatusLabels: Record<PaymentStatus, string> = {
  pending: 'En attente de virement', review: 'En vérification', validated: 'Validé',
  refused: 'Refusé', cancelled: 'Annulé', expired: 'Expiré',
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
export type PaymentDetail = {
  request: PaymentRequest; proofs: PaymentProof[]; events: PaymentEvent[]; bank: BankInstructions
}