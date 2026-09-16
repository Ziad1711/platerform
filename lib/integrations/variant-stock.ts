/**
 * Stock des variantes: certaines variantes importées (YouCan, etc.) ne sont pas des
 * variantes physiques (couleur, taille) mais des packs de quantité.
 * Ex: "1 pièce", "2 pièces", "3 pièces" => la variante vendue consomme 1, 2 ou 3 unités
 * physiques du même stock produit.
 * `stock_multiplier` porte cette information (1 par défaut).
 */

const QUANTITY_KEYWORD_PATTERN = /(\d{1,2})\s*(?:pi[eè]ces?|unit[ée]s?|units?|pcs?|articles?|morceaux?|flacons?|sachets?|coffrets?)\b/i
const PACK_KEYWORD_PATTERN = /\b(?:pack|lot|ensemble|coffret|set)\s*(?:de\s*)?(\d{1,2})\b/i
const MULTIPLIER_SUFFIX_PATTERN = /\bx\s?(\d{1,2})\b/i
const MULTIPLIER_PREFIX_PATTERN = /\b(\d{1,2})\s?x\b/i

const PATTERNS = [
  QUANTITY_KEYWORD_PATTERN,
  PACK_KEYWORD_PATTERN,
  MULTIPLIER_PREFIX_PATTERN,
  MULTIPLIER_SUFFIX_PATTERN,
]

const MIN_MULTIPLIER = 1
const MAX_MULTIPLIER = 999

function normalizeLabel(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

function clampMultiplier(value: number) {
  if (!Number.isFinite(value)) return MIN_MULTIPLIER
  const rounded = Math.trunc(value)
  if (rounded < MIN_MULTIPLIER) return MIN_MULTIPLIER
  if (rounded > MAX_MULTIPLIER) return MAX_MULTIPLIER
  return rounded
}

export function normalizeStockMultiplier(value: unknown) {
  return clampMultiplier(Number(value ?? MIN_MULTIPLIER))
}

/**
 * Déduit le multiplicateur de stock depuis le libellé d'une variante et/ou
 * les valeurs d'options fournies par la source (ex: { Pack: "2 unités" }).
 * Retourne toujours un entier >= 1. Les libellés ambigus (ex: "Pack: 289")
 * restent à 1 et doivent être ajustés manuellement dans la fiche produit.
 */
export function detectStockMultiplier(params: {
  name?: string | null
  optionValues?: Record<string, unknown> | null
}) {
  const name = normalizeLabel(params.name)
  const optionValues = params.optionValues || {}

  const candidates: string[] = []
  if (name) candidates.push(name)

  for (const [key, rawValue] of Object.entries(optionValues)) {
    const value = normalizeLabel(rawValue)
    if (!value) continue

    candidates.push(value)

    // Évite d'interpréter un prix (valeur purement numérique) comme une quantité.
    if (!/^\d+$/.test(value)) {
      candidates.push(`${normalizeLabel(key)} ${value}`)
    }
  }

  for (const candidate of candidates) {
    for (const pattern of PATTERNS) {
      const match = candidate.match(pattern)
      if (match?.[1]) return clampMultiplier(Number(match[1]))
    }
  }

  return MIN_MULTIPLIER
}

/**
 * Quantité physique réellement consommée par une ligne de commande.
 */
export function resolveConsumedQuantity(params: {
  quantity: unknown
  stockMultiplier?: unknown
}) {
  const quantity = Number(params.quantity || 0)
  const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? Math.trunc(quantity) : 0
  return safeQuantity * normalizeStockMultiplier(params.stockMultiplier)
}
