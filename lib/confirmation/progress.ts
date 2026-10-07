/**
 * Étapes réellement atteintes par le serveur pendant une confirmation.
 * Miroir exact des événements `progress` diffusés par
 * `/api/orders/confirmation/action` (mode flux).
 */
export type ConfirmationProgressStage =
  | 'validating'
  | 'confirmed'
  | 'city_search'
  | 'city_ai'
  | 'parcel'

/** Ordre d'affichage possible. `city_ai` n'apparaît que si l'IA est réellement sollicitée. */
export const CONFIRMATION_PROGRESS_ORDER: ConfirmationProgressStage[] = [
  'validating',
  'confirmed',
  'city_search',
  'city_ai',
  'parcel',
]

/** Libellé affiché pour chaque étape. */
export const CONFIRMATION_PROGRESS_LABELS: Record<ConfirmationProgressStage, string> = {
  validating: 'Vérification de la commande',
  confirmed: 'Commande confirmée',
  city_search: 'Recherche de la ville auprès du transporteur',
  city_ai: 'Identification de la ville par l’IA',
  parcel: 'Création du colis chez le transporteur',
}

/** Résultat final d'une confirmation, affiché dans la modale au lieu d'un simple toast. */
export type ConfirmOutcome = {
  status: string
  parcel: { created: boolean; trackingNumber: string | null; warning: string | null } | null
  /** Confirmation déduite après une coupure de flux : le résultat colis reste inconnu. */
  parcelUnknown?: boolean
}
