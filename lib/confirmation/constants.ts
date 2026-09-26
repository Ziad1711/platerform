/**
 * Constantes du module de confirmation des commandes.
 * Le nombre d'appels géré ici est un affichage : la règle réelle (limite,
 * annulation automatique) est appliquée côté serveur par la RPC
 * `rpc_order_confirmation_action`.
 */

export const DEFAULT_MAX_ATTEMPTS = 6
export const MIN_MAX_ATTEMPTS = 1
export const MAX_MAX_ATTEMPTS = 20

/** Statuts d'une commande encore dans le circuit de confirmation. */
export const CONFIRMATION_PENDING_STATUSES = [
  'new',
  'confirmation_rejected',
  'follow_up_1',
  'follow_up_2',
  'follow_up_3',
  'follow_up_4',
  'follow_up_5',
  'no_answer',
  'wrong_number',
  'voicemail',
] as const

/** Statuts encore modifiables par un agent de confirmation. */
export const CONFIRMATION_PROCESSABLE_STATUSES: string[] = [...CONFIRMATION_PENDING_STATUSES]

export type ConfirmationAction = 'NO_ANSWER' | 'POSTPONE' | 'CANCEL' | 'CONFIRM'

/** Motifs d'annulation proposés à l'agent (alignés sur la contrainte SQL). */
export const CANCELLATION_REASON_OPTIONS: { value: string; label: string }[] = [
  { value: 'not_interested', label: 'Client non intéressé' },
  { value: 'price_refused', label: 'Prix refusé' },
  { value: 'wrong_number', label: 'Mauvais numéro' },
  { value: 'duplicate_order', label: 'Commande en double' },
  { value: 'product_unavailable', label: 'Produit indisponible' },
  { value: 'order_error', label: 'Erreur de commande' },
  { value: 'bought_elsewhere', label: 'Client a acheté ailleurs' },
  { value: 'other', label: 'Autre' },
]

export const CANCELLATION_REASON_LABELS: Record<string, string> = {
  ...Object.fromEntries(CANCELLATION_REASON_OPTIONS.map((option) => [option.value, option.label])),
  max_attempts_reached: 'Nombre maximal de tentatives atteint',
}

/** Motif utilisé par le serveur lors de l'annulation automatique. */
export const MAX_ATTEMPTS_REASON_CODE = 'max_attempts_reached'
export const MAX_ATTEMPTS_REASON_LABEL = 'Nombre maximal de tentatives atteint'

export const CONFIRMATION_EVENT_LABELS: Record<string, string> = {
  no_answer: 'Pas de réponse',
  postponed: 'Reportée',
  confirmed: 'Confirmée',
  cancelled_manual: 'Annulée',
  cancelled_max_attempts: 'Annulation automatique',
  customer_information_updated: 'Coordonnées modifiées',
  order_items_updated: 'Produits modifiés',
  delivery_information_updated: 'Livraison modifiée',
  status_corrected: 'Statut corrigé',
  parcel_creation_succeeded: 'Colis créé',
  parcel_creation_failed: 'Échec création colis',
  assigned: 'Assignée à un agent',
  reassigned: 'Réassignée',
  unassigned: 'Désassignée',
}

/** Libellé lisible d'un numéro d'appel, ex. « Appel 3 ». */
export function formatAttemptLabel(attemptNumber: number | null | undefined): string {
  if (!attemptNumber || attemptNumber < 1) return 'Aucun appel'
  return `Appel ${attemptNumber}`
}

/** Libellé du bouton « Pas de réponse » selon le prochain numéro d'appel. */
export function formatNextAttemptLabel(attemptCount: number, maxAttempts: number): string {
  const next = Math.max(1, Number(attemptCount || 0) + 1)
  const capped = Math.min(next, maxAttempts)
  return `Pas de réponse — Appel ${capped}`
}
