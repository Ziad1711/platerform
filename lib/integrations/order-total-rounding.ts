import { createAdminClient } from '@/lib/supabase/admin'

type SupabaseLike = ReturnType<typeof createAdminClient>

/**
 * Arrondi du total encaissé d'une commande reçue (option par boutique, désactivée par défaut).
 *
 * Règle métier : un total entier se terminant par 9 (49 -> 50, 99 -> 100, 189 -> 190) et un
 * total dont les centimes valent exactement 99 (48,99 -> 49, 199,99 -> 200) sont arrondis à
 * l'unité supérieure. Tout autre montant reste inchangé.
 *
 * Le calcul est fait une seule fois, à la réception, sur le total d'origine : il est donc
 * idempotent (une resynchronisation qui renvoie le même total redonne le même arrondi) et
 * jamais rétroactif sur les commandes existantes.
 */
export type OrderTotalRoundingResult = {
  /** Total réellement à encaisser (total d'origine + écart). */
  total: number
  /** Écart appliqué : 0, 0.01 ou 1. */
  adjustment: number
}

export const ORDER_TOTAL_ROUNDING_CENT = 0.01

function toCents(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 100)
}

function round2(value: number): number {
  return toCents(value) / 100
}

/** Écart d'arrondi à appliquer à un total (0 désactive tout arrondi). */
export function computeOrderTotalRoundingAdjustment(total: number): number {
  const cents = toCents(total)
  if (cents <= 0) return 0

  const centsRemainder = cents % 100

  // Total entier se terminant par 9 : 49, 99, 189...
  if (centsRemainder === 0 && cents / 100 % 10 === 9) return 1

  // Centimes exactement égaux à 99 : 48,99 ; 199,99...
  if (centsRemainder === 99) return ORDER_TOTAL_ROUNDING_CENT

  return 0
}

/** Applique l'arrondi au total d'origine. `enabled` faux => total renvoyé tel quel. */
export function applyOrderTotalRounding(total: number, enabled: boolean): OrderTotalRoundingResult {
  const safeTotal = Number.isFinite(total) ? total : 0
  if (!enabled) return { total: safeTotal, adjustment: 0 }

  const adjustment = computeOrderTotalRoundingAdjustment(safeTotal)
  if (adjustment === 0) return { total: safeTotal, adjustment: 0 }

  return { total: round2(safeTotal + adjustment), adjustment }
}

/** Option d'arrondi de la boutique, lue au moment de la réception. */
export async function isStoreOrderTotalRoundingEnabled(
  storeId: string,
  supabase: SupabaseLike = createAdminClient()
): Promise<boolean> {
  if (!storeId) return false

  const { data } = await supabase
    .from('stores')
    .select('round_order_total')
    .eq('id', storeId)
    .maybeSingle()

  return Boolean((data as { round_order_total?: boolean } | null)?.round_order_total)
}
