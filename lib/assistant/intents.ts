import type { AnalyticsRange, AssistantIntent, ComparisonRange } from '@/lib/assistant/types'

const GREETINGS = ['bonjour', 'salut', 'bonsoir', 'hello', 'coucou']

/**
 * Mapping des noms de mois avec tolérance orthographique.
 * Inclut les fautes courantes : fevrier, fervrier, fev, fév, etc.
 */
const MONTH_NAMES: Record<string, number> = {
  janvier: 1, janv: 1,
  février: 2, fevrier: 2, fervrier: 2, fev: 2, fév: 2, févr: 2,
  mars: 3,
  avril: 4, avr: 4,
  mai: 5,
  juin: 6,
  juillet: 7, juil: 7, juill: 7,
  août: 8, aout: 8,
  septembre: 9, sept: 9, sep: 9,
  octobre: 10, oct: 10,
  novembre: 11, nov: 11,
  décembre: 12, dec: 12, decembre: 12,
}

/**
 * Mémoire conversationnelle analytique par thread.
 * Permet de conserver le contexte entre les messages.
 */
export interface ThreadAnalyticMemory {
  last_range: AnalyticsRange | null
  last_range_explicit: boolean
  last_dimension: string | null
  last_metric_family: string | null
  last_store_scope: string[] | null
}

export function createEmptyMemory(): ThreadAnalyticMemory {
  return {
    last_range: null,
    last_range_explicit: false,
    last_dimension: null,
    last_metric_family: null,
    last_store_scope: null,
  }
}

function normalizeIntentText(message: string) {
  return message
    .toLowerCase()
    .replace(/[^a-zàâäçéèêëîïôöùûüÿñæœ0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tryParseAbsoluteMonth(text: string): AnalyticsRange | null {
  // "mois 2 2026", "mois 02 2026"
  const moisPattern = /mois\s+(\d{1,2})\s*(\d{4})?/
  const moisMatch = text.match(moisPattern)
  if (moisMatch) {
    const month = parseInt(moisMatch[1], 10)
    const year = moisMatch[2] ? parseInt(moisMatch[2], 10) : new Date().getFullYear()
    if (month >= 1 && month <= 12) {
      const start = new Date(Date.UTC(year, month - 1, 1))
      const end = new Date(Date.UTC(year, month, 1))
      return { start: start.toISOString(), end: end.toISOString() }
    }
  }

  // "février 2026", "janvier 2025"
  for (const [name, monthNum] of Object.entries(MONTH_NAMES)) {
    const namePattern = new RegExp(`${name}\\s*(\\d{4})?`)
    const nameMatch = text.match(namePattern)
    if (nameMatch) {
      const year = nameMatch[1] ? parseInt(nameMatch[1], 10) : new Date().getFullYear()
      const start = new Date(Date.UTC(year, monthNum - 1, 1))
      const end = new Date(Date.UTC(year, monthNum, 1))
      return { start: start.toISOString(), end: end.toISOString() }
    }
  }

  // "02/2026", "02-2026"
  const slashPattern = /(\d{1,2})\s*[/-]\s*(\d{4})/
  const slashMatch = text.match(slashPattern)
  if (slashMatch) {
    const month = parseInt(slashMatch[1], 10)
    const year = parseInt(slashMatch[2], 10)
    if (month >= 1 && month <= 12) {
      const start = new Date(Date.UTC(year, month - 1, 1))
      const end = new Date(Date.UTC(year, month, 1))
      return { start: start.toISOString(), end: end.toISOString() }
    }
  }

  return null
}

/**
 * Vérifie si le message contient une période explicite.
 */
function hasExplicitRange(text: string): boolean {
  if (text.includes('hier')) return true
  if (text.includes('30 derniers jours') || text.includes('30 jours')) return true
  if (text.includes('mois dernier')) return true
  if (text.includes('ce mois') || text.includes('mois en cours')) return true
  if (tryParseAbsoluteMonth(text)) return true
  return false
}

export function resolveRangeFromQuestion(message: string, memory?: ThreadAnalyticMemory | null): AnalyticsRange {
  const text = message.toLowerCase()

  const absolute = tryParseAbsoluteMonth(text)
  if (absolute) return absolute

  if (text.includes('hier')) return 'yesterday'
  if (text.includes('30 derniers jours') || text.includes('30 jours')) return '30d'
  if (text.includes('mois dernier')) return 'last_month'
  if (text.includes('ce mois') || text.includes('mois en cours')) return 'month'

  // Si le message courant n'a pas de période explicite mais qu'on a une mémoire
  // avec une période explicite précédente, on la réutilise
  if (memory?.last_range && memory.last_range_explicit) {
    return memory.last_range
  }

  return '7d'
}

/**
 * Met à jour la mémoire analytique après résolution de l'intent et du range.
 */
export function updateMemoryFromAnalysis(
  memory: ThreadAnalyticMemory,
  message: string,
  resolvedRange: AnalyticsRange,
  resolvedIntent: AssistantIntent
): ThreadAnalyticMemory {
  const text = message.toLowerCase()
  const hasExplicit = hasExplicitRange(text)

  return {
    last_range: resolvedRange,
    last_range_explicit: hasExplicit,
    last_dimension: resolveDimensionFromMessage(text, resolvedIntent),
    last_metric_family: resolveMetricFamily(resolvedIntent),
    last_store_scope: memory.last_store_scope,
  }
}

/**
 * Extrait la dimension métier du message.
 */
function resolveDimensionFromMessage(text: string, intent: AssistantIntent): string | null {
  if (text.includes('ville') || text.includes('casa') || text.includes('rabat') || text.includes('marrakech')) return 'city'
  if (text.includes('produit') || text.includes('article')) return 'product'
  if (text.includes('publicité') || text.includes('ads') || text.includes('campagne')) return 'ads'
  if (text.includes('stock')) return 'stock'
  if (text.includes('fournisseur')) return 'supplier'
  if (text.includes('livraison') || text.includes('livré')) return 'delivery'
  if (text.includes('confirmation') || text.includes('agent')) return 'confirmation'
  if (text.includes('dépense') || text.includes('charge')) return 'expense'
  if (intent === 'dashboard_summary' || intent === 'performance_request') return 'overview'
  return null
}

/**
 * Résout la famille métrique à partir de l'intent.
 */
function resolveMetricFamily(intent: AssistantIntent): string | null {
  const map: Partial<Record<AssistantIntent, string>> = {
    dashboard_summary: 'performance',
    top_products: 'products',
    ads_analysis: 'ads',
    profit_analysis: 'profit',
    stock_analysis: 'stock',
    supplier_summary: 'suppliers',
    recent_orders: 'orders',
    comparison_request: 'comparison',
    chart_request: 'chart',
    performance_request: 'performance',
  }
  return map[intent] || null
}

/**
 * Extrait deux périodes distinctes d'un message de comparaison.
 * Ex: "comparer février 2025 et février 2026" → { rangeA: fév2025, rangeB: fév2026 }
 */
export function extractComparisonRanges(message: string): ComparisonRange | null {
  const text = message.toLowerCase()

  // Pattern: "comparer <périodeA> et <périodeB>"
  // On cherche deux mentions de mois/année distinctes
  const monthMatches: Array<{ month: number; year: number; index: number }> = []

  // Chercher tous les patterns de mois dans le texte
  for (const [name, monthNum] of Object.entries(MONTH_NAMES)) {
    const re = new RegExp(`${name}\\s*(\\d{4})`, 'gi')
    let match
    while ((match = re.exec(text)) !== null) {
      monthMatches.push({
        month: monthNum,
        year: parseInt(match[1], 10),
        index: match.index,
      })
    }
  }

  // Pattern slash: "02/2025 et 02/2026"
  const slashRe = /(\d{1,2})\s*[/-]\s*(\d{4})/g
  let slashMatch
  while ((slashMatch = slashRe.exec(text)) !== null) {
    const month = parseInt(slashMatch[1], 10)
    if (month >= 1 && month <= 12) {
      monthMatches.push({
        month,
        year: parseInt(slashMatch[2], 10),
        index: slashMatch.index,
      })
    }
  }

  // Si on a au moins 2 périodes distinctes, on les prend
  if (monthMatches.length >= 2) {
    // Trier par position dans le texte
    monthMatches.sort((a, b) => a.index - b.index)

    const first = monthMatches[0]
    const second = monthMatches[1]

    // Éviter les doublons (même mois/même année)
    if (first.month === second.month && first.year === second.year) {
      // Chercher une 3e occurrence ou ignorer
      if (monthMatches.length >= 3) {
        const third = monthMatches[2]
        return buildComparisonRange(first, third, text)
      }
      return null
    }

    return buildComparisonRange(first, second, text)
  }

  return null
}

function buildComparisonRange(
  a: { month: number; year: number },
  b: { month: number; year: number },
  text: string
): ComparisonRange {
  const startA = new Date(Date.UTC(a.year, a.month - 1, 1))
  const endA = new Date(Date.UTC(a.year, a.month, 1))
  const startB = new Date(Date.UTC(b.year, b.month - 1, 1))
  const endB = new Date(Date.UTC(b.year, b.month, 1))

  const monthNames = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

  return {
    rangeA: { start: startA.toISOString(), end: endA.toISOString() },
    rangeB: { start: startB.toISOString(), end: endB.toISOString() },
    labelA: `${monthNames[a.month - 1]} ${a.year}`,
    labelB: `${monthNames[b.month - 1]} ${b.year}`,
  }
}

export function resolveIntent(message: string): AssistantIntent {
  const text = message.toLowerCase()
  const normalized = normalizeIntentText(message)

  if (GREETINGS.some((g) => normalized === g || normalized.startsWith(`${g} `))) {
    return 'greeting'
  }

  if (text.includes('ça va') || text.includes('merci')) {
    return 'small_talk'
  }

  // Détection de comparaison de périodes (2 dates distinctes)
  if (text.includes('compar') || text.includes('vs') || text.includes('versus')) {
    const comparisonRanges = extractComparisonRanges(message)
    if (comparisonRanges) {
      return 'period_comparison'
    }
    return 'comparison_request'
  }

  if (text.includes('graph') || text.includes('courbe') || text.includes('chart')) {
    return 'chart_request'
  }

  if (text.includes('performance') || text.includes('performances')) {
    return 'performance_request'
  }

  if (
    text.includes('analyse mon business') ||
    text.includes('résumé') ||
    text.includes('tableau de bord')
  ) {
    return 'dashboard_summary'
  }

  if (text.includes('meilleur produit') || text.includes('top produit') || text.includes('plus rentable')) {
    return 'top_products'
  }

  if (text.includes('publicité') || text.includes('ads') || text.includes('roas')) {
    return 'ads_analysis'
  }

  if (text.includes('profit') || text.includes('gagné') || text.includes('marge')) {
    return 'profit_analysis'
  }

  if (text.includes('stock')) {
    return 'stock_analysis'
  }

  if (text.includes('fournisseur')) {
    return 'supplier_summary'
  }

  if (text.includes('commande récente') || text.includes('dernières commandes')) {
    return 'recent_orders'
  }

  return 'generic_business_chat'
}

export function asksForOtherStore(message: string) {
  const text = message.toLowerCase()
  return (
    text.includes('autre store') ||
    text.includes('autre magasin') ||
    text.includes('autre boutique') ||
    text.includes('un autre store')
  )
}
