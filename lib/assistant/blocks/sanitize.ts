/**
 * Nettoyage des textes publiés.
 *
 * Objectif unique : aucun code technique interne ne doit jamais atteindre
 * l'interface. Les valeurs chiffrées, elles, sont conservées telles quelles —
 * un avertissement utile peut citer une période ou un nombre de jours.
 */

/** Codes produits par le moteur et le lecteur (`COMPARISON_…`, `KPI_reader…`). */
const INTERNAL_CODE = /\b(?:[A-Z][A-Z0-9]*_){1,}[A-Z0-9]+\b/g

/**
 * Codes multi-segments en minuscules (`kpi_reader_timeout`). Le français
 * n'utilise pas `_` : ce motif ne retire donc aucun texte métier légitime.
 */
const INTERNAL_SNAKE = /\b(?:[A-Za-z0-9]+_){2,}[A-Za-z0-9]+\b/g

/** Identifiants techniques des fonctions de base de données. */
const RPC_REFERENCE = /\brpc_[a-z0-9_]+\b/gi

/** Fragments internes hérités du moteur précédent. */
const LEGACY_FRAGMENTS: ReadonlyArray<RegExp> = [
  /scan de secours/gi,
  /pr[ée]cision de transport/gi,
  /expression num[ée]rique non v[ée]rifiable/gi,
  /\bjson\b/gi,
  /\bnull\b/gi,
]

export interface SanitizedText {
  text: string
  /** Vrai si un code interne a été retiré (observabilité, jamais publié). */
  removedCode: boolean
}

/**
 * Retire les codes internes d'un texte destiné à l'utilisateur.
 * Ne supprime ni les nombres, ni les dates, ni les unités.
 */
export function sanitizePublicText(input: string): SanitizedText {
  const source = String(input ?? '')
  let text = source
  let removedCode = false

  const codeFree = text.replace(INTERNAL_CODE, () => {
    removedCode = true
    return ' '
  })
  text = codeFree

  const snakeFree = text.replace(INTERNAL_SNAKE, () => {
    removedCode = true
    return ' '
  })
  text = snakeFree

  const rpcFree = text.replace(RPC_REFERENCE, () => {
    removedCode = true
    return ' '
  })
  text = rpcFree

  for (const fragment of LEGACY_FRAGMENTS) {
    text = text.replace(fragment, ' ')
  }

  text = text
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/^[\s.,;:]+/, '')
    .replace(/[\s.,;:]+$/, '')
    .trim()

  return { text, removedCode }
}

/** Variante courte : renvoie directement le texte nettoyé. */
export function cleanPublicText(input: string): string {
  return sanitizePublicText(input).text
}

/** Vrai si le texte contient encore un code interne après nettoyage. */
export function containsInternalCode(input: string): boolean {
  const text = String(input ?? '')
  INTERNAL_CODE.lastIndex = 0
  RPC_REFERENCE.lastIndex = 0
  return INTERNAL_CODE.test(text) || RPC_REFERENCE.test(text)
}

/**
 * Nettoyage d'une liste d'avertissements : codes retirés, doublons supprimés,
 * entrées vides écartées. L'ordre d'origine est conservé.
 */
export function sanitizeWarnings(warnings: ReadonlyArray<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const warning of warnings) {
    const cleaned = sanitizePublicText(String(warning ?? '')).text
    if (!cleaned) continue
    const key = cleaned.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(cleaned)
  }
  return result
}
