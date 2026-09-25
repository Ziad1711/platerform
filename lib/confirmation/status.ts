/** Libellés et couleurs des statuts affichés dans la vue de confirmation. */

export const CONFIRMATION_STATUS_LABELS: Record<string, string> = {
  new: 'Nouvelle',
  confirmation_rejected: 'Non confirmé',
  follow_up_1: 'Rappel 1',
  follow_up_2: 'Rappel 2',
  follow_up_3: 'Rappel 3',
  follow_up_4: 'Rappel 4',
  follow_up_5: 'Rappel 5',
  no_answer: 'Pas de réponse',
  wrong_number: 'Mauvais numéro',
  voicemail: 'Boîte vocale',
  confirmed: 'Confirmée',
  picked_up: 'Ramassée',
  sent: 'Envoyée',
  delivered: 'Livrée',
  cancelled: 'Annulée',
  refused: 'Refusée',
  returned_not_stocked: 'Retour non stocké',
  returned_stocked: 'Retour stocké',
}

export const CONFIRMATION_STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-100 text-blue-800',
  confirmation_rejected: 'bg-slate-100 text-slate-800',
  follow_up_1: 'bg-cyan-100 text-cyan-800',
  follow_up_2: 'bg-cyan-100 text-cyan-800',
  follow_up_3: 'bg-cyan-100 text-cyan-800',
  follow_up_4: 'bg-cyan-100 text-cyan-800',
  follow_up_5: 'bg-cyan-100 text-cyan-800',
  no_answer: 'bg-amber-100 text-amber-800',
  wrong_number: 'bg-orange-100 text-orange-800',
  voicemail: 'bg-teal-100 text-teal-800',
  confirmed: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-gray-100 text-gray-800',
  refused: 'bg-rose-100 text-rose-800',
  returned_not_stocked: 'bg-red-100 text-red-800',
  returned_stocked: 'bg-orange-100 text-orange-800',
}

export function getConfirmationStatusLabel(status: string | null | undefined) {
  const value = String(status || '')
  return CONFIRMATION_STATUS_LABELS[value] || value || '-'
}

export function getConfirmationStatusColor(status: string | null | undefined) {
  return CONFIRMATION_STATUS_COLORS[String(status || '')] || 'bg-secondary text-foreground'
}
