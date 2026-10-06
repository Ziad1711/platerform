// ============================================================
// Statuts AMEEX -> statuts internes (source de verite unique)
//
// Le mapping est volontairement STRICT : la comparaison se fait par
// egalite exacte apres normalisation. L'ancienne comparaison partielle
// (`includes`) provoquait des faux positifs (ex: "PRESENT" matchait "SENT").
// ============================================================

export type AmeexStatusMapEntry = {
  /** Couples (STATUT / STATUT_S) reconnus, compares par egalite exacte. */
  matches: Array<{ statut: string; statut_s?: string }>
  orderStatus: string | null
  deliveryStatus: string | null
  statusDateField: string | null
}

/**
 * Normalise une valeur de statut AMEEX : sans accents, minuscules,
 * ponctuation remplacee par des espaces.
 */
export function normalizeAmeexStatusValue(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Table de correspondance. L'ordre fait foi (priorite) : les entrees les
 * plus specifiques (STATUT + STATUT_S) doivent précéder l'entree generique
 * IN_PROGRESS.
 *
 * Valeurs STATUT connues d'apres la documentation AMEEX : IN_PROGRESS,
 * DELIVERED, DISTRIBUTION. Les variantes francaises sont conservees pour
 * tolerance. Un statut absent de cette table est considere comme inconnu et
 * n'entraine AUCUNE modification de statut (raw conserve pour diagnostic).
 */
export const AMEEX_STATUS_MAP: AmeexStatusMapEntry[] = [
  { matches: [{ statut: 'DELIVERED' }, { statut: 'LIVRE' }], orderStatus: 'delivered', deliveryStatus: 'delivered', statusDateField: 'delivered_at' },
  { matches: [{ statut: 'DISTRIBUTION' }, { statut: 'OUT_FOR_DELIVERY' }], orderStatus: 'dl_out_for_delivery', deliveryStatus: 'in_transit', statusDateField: 'dl_out_for_delivery_at' },
  { matches: [{ statut: 'IN_PROGRESS', statut_s: 'POSTPONED' }, { statut: 'REPORTE' }], orderStatus: 'dl_postponed', deliveryStatus: 'in_transit', statusDateField: 'dl_postponed_at' },
  { matches: [{ statut: 'IN_PROGRESS', statut_s: 'NO_ANSWER_TEAM' }], orderStatus: 'dl_no_answer', deliveryStatus: 'in_transit', statusDateField: 'dl_no_answer_at' },
  { matches: [{ statut: 'IN_PROGRESS', statut_s: 'NO_ANSWER' }], orderStatus: 'dl_no_answer', deliveryStatus: 'in_transit', statusDateField: 'dl_no_answer_at' },
  { matches: [{ statut: 'IN_PROGRESS', statut_s: 'UNREACHABLE' }], orderStatus: 'dl_unreachable', deliveryStatus: 'in_transit', statusDateField: 'dl_unreachable_at' },
  { matches: [{ statut: 'REFUSED' }, { statut: 'REFUSE' }], orderStatus: 'refused', deliveryStatus: 'refused', statusDateField: 'refused_at' },
  { matches: [{ statut: 'CANCELLED' }, { statut: 'ANNULE' }], orderStatus: 'cancelled', deliveryStatus: 'cancelled', statusDateField: 'cancelled_at' },
  { matches: [{ statut: 'RETURNED' }, { statut: 'RETOUR' }], orderStatus: 'returned_not_stocked', deliveryStatus: 'returned', statusDateField: 'returned_not_stocked_at' },
  { matches: [{ statut: 'PICKED_UP' }, { statut: 'RAMASSE' }], orderStatus: 'picked_up', deliveryStatus: 'picked_up', statusDateField: 'picked_up_at' },
  { matches: [{ statut: 'SENT' }, { statut: 'ENVOYE' }, { statut: 'SHIPPED' }], orderStatus: 'sent', deliveryStatus: 'in_transit', statusDateField: 'sent_at' },
  // Entree generique en dernier : IN_PROGRESS sans sous-statut reconnu.
  { matches: [{ statut: 'IN_PROGRESS' }], orderStatus: null, deliveryStatus: 'in_transit', statusDateField: null },
]

/**
 * Etapes du cycle de livraison utilisees pour interdire les regressions
 * (notifications en retard ou dans le desordre).
 * Une etape non listee vaut 0 (statut hors cycle de livraison).
 */
export const AMEEX_ORDER_STATUS_STAGE: Record<string, number> = {
  confirmed: 1,
  dl_pickup_pending: 1,
  picked_up: 2,
  sent: 3,
  dl_out_for_delivery: 4,
  dl_no_answer: 4,
  dl_unreachable: 4,
  dl_out_of_zone: 4,
  dl_client_interested: 4,
  dl_postponed: 4,
  dl_address_change: 4,
  dl_follow_up_request: 4,
  dl_billing_error: 4,
  dl_refund: 4,
  delivered: 5,
  refused: 5,
  cancelled: 5,
  returned_not_stocked: 6,
  returned_stocked: 6,
}

/**
 * Etapes du cycle de `delivery_status` (valeurs autorisees par la contrainte
 * `orders_delivery_status_check`). Sert a refuser les reculs du statut de
 * livraison : le statut commande porte la granularite metier, mais le suivi
 * transporteur ne doit jamais reouvrir une livraison terminee. Une valeur
 * inconnue vaut 0 et n'est jamais bloquee.
 */
export const AMEEX_DELIVERY_STATUS_STAGE: Record<string, number> = {
  pending: 1,
  pickup_pending: 1,
  picked_up: 2,
  deposited: 2,
  in_transit: 3,
  delivered: 5,
  refused: 5,
  cancelled: 5,
  returned: 6,
}

/** Etapes considerees comme terminales (plus de progression normale). */
export const AMEEX_TERMINAL_STAGE = 5

export type AmeexResolvedStatus = {
  /** Statut brut compose, conserve pour diagnostic. */
  rawStatus: string
  /** true si le statut a ete reconnu explicitement dans AMEEX_STATUS_MAP. */
  recognized: boolean
  orderStatus: string | null
  deliveryStatus: string | null
  statusDateField: string | null
}

/**
 * Resout un statut AMEEX brut vers les statuts internes.
 * Retourne `recognized: false` (sans aucun statut cible) si le statut
 * n'est pas connu : l'appelant ne doit alors modifier aucun statut.
 */
export function resolveAmeexStatus(rawStatut: string, rawStatutS?: string): AmeexResolvedStatus {
  const normalizedStatut = normalizeAmeexStatusValue(rawStatut)
  const normalizedStatutS = rawStatutS ? normalizeAmeexStatusValue(rawStatutS) : ''

  for (const entry of AMEEX_STATUS_MAP) {
    for (const match of entry.matches) {
      if (normalizeAmeexStatusValue(match.statut) !== normalizedStatut) continue

      const statutSMatch = match.statut_s ? normalizeAmeexStatusValue(match.statut_s) : null
      if (statutSMatch !== null && statutSMatch !== normalizedStatutS) continue

      return {
        rawStatus: statutSMatch
          ? `${rawStatut} (${rawStatutS})`
          : String(rawStatut || '').trim(),
        recognized: true,
        orderStatus: entry.orderStatus,
        deliveryStatus: entry.deliveryStatus,
        statusDateField: entry.statusDateField,
      }
    }
  }

  return {
    rawStatus: String(rawStatut || '').trim(),
    recognized: false,
    orderStatus: null,
    deliveryStatus: null,
    statusDateField: null,
  }
}
