/**
 * Arithmétique décimale exacte pour les indicateurs dérivés.
 *
 * Les montants restent des chaînes décimales de bout en bout : aucune valeur
 * monétaire ne transite par un `number` flottant. Les divisions sont arrondies
 * en `BigInt` (demi vers le haut), jamais par IEEE-754.
 */

interface ParsedDecimal {
  negative: boolean
  digits: number
  scale: number
}

const DECIMAL_PATTERN = /^-?\d+(?:\.\d+)?$/

function parseDecimal(value: string): ParsedDecimal | null {
  const cleaned = String(value ?? '').trim().replace(/[\s\u00a0\u202f]/g, '').replace(',', '.')
  if (!DECIMAL_PATTERN.test(cleaned)) return null
  const negative = cleaned.startsWith('-')
  const digitsOnly = negative ? cleaned.slice(1) : cleaned
  const [integerPart, fractionPart = ''] = digitsOnly.split('.')
  const digits = Number(`${integerPart}${fractionPart}` || '0')
  if (!Number.isSafeInteger(digits)) return null
  return { negative, digits, scale: fractionPart.length }
}

function pow10(exponent: number): number {
  return 10 ** Math.max(0, exponent)
}

/** Division entière arrondie au plus proche (demi vers le haut), signe géré. */
function roundDivide(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(denominator) || denominator === 0) return null
  const negative = (numerator < 0) !== (denominator < 0)
  const absNumerator = Math.abs(numerator)
  const absDenominator = Math.abs(denominator)
  const scaled = absNumerator * 2 + absDenominator
  const divisor = absDenominator * 2
  if (!Number.isSafeInteger(scaled) || !Number.isSafeInteger(divisor)) return null
  const quotient = Math.floor(scaled / divisor)
  return negative ? -quotient : quotient
}

function formatScaled(value: number, scale: number): string | null {
  if (!Number.isSafeInteger(value)) return null
  const negative = value < 0
  const absolute = Math.abs(value)
  const text = String(absolute).padStart(scale + 1, '0')
  const integerPart = scale === 0 ? text : text.slice(0, text.length - scale)
  const fractionPart = scale === 0 ? '' : text.slice(text.length - scale)
  const sign = negative ? '-' : ''
  return fractionPart ? `${sign}${integerPart}.${fractionPart}` : `${sign}${integerPart}`
}

/**
 * `value / divisor`, arrondi à `scale` décimales.
 * `null` dès qu'une entrée n'est pas un décimal exploitable ou que le diviseur
 * est nul : aucun indicateur dérivé n'est inventé.
 */
export function divideDecimal(value: string | null | undefined, divisor: number, scale = 2): string | null {
  if (value === null || value === undefined) return null
  if (!Number.isFinite(divisor) || divisor <= 0) return null
  const parsed = parseDecimal(String(value))
  if (!parsed) return null

  const scaledNumerator = parsed.digits * pow10(scale)
  const denominator = Math.trunc(divisor) * pow10(parsed.scale)
  if (denominator === 0 || !Number.isSafeInteger(denominator)) return null
  if (!Number.isSafeInteger(scaledNumerator)) return null

  const quotient = roundDivide(parsed.negative ? -scaledNumerator : scaledNumerator, denominator)
  if (quotient === null) return null
  return formatScaled(quotient, scale)
}

/**
 * Ratio en pourcentage exact (`numerator / denominator × 100`).
 * `null` si le dénominateur est nul : jamais « 0 % » pour une population vide.
 */
export function ratioPercent(
  numerator: number | string | null | undefined,
  denominator: number | string | null | undefined,
  scale = 2,
): string | null {
  const num = Number(numerator)
  const den = Number(denominator)
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return null
  return divideDecimal(String(num * 100), den, scale)
}

/** Compare deux décimaux textuels sans conversion flottante. */
export function compareDecimalText(a: string, b: string): number | null {
  const left = parseDecimal(a)
  const right = parseDecimal(b)
  if (!left || !right) return null
  const scale = Math.max(left.scale, right.scale)
  const leftScaled = (left.negative ? -left.digits : left.digits) * pow10(scale - left.scale)
  const rightScaled = (right.negative ? -right.digits : right.digits) * pow10(scale - right.scale)
  if (leftScaled === rightScaled) return 0
  return leftScaled > rightScaled ? 1 : -1
}

/** Somme de décimaux textuels hétérogènes, sans perte de précision. */
export function sumDecimalText(values: ReadonlyArray<string | null | undefined>): string | null {
  if (values.length === 0) return null
  const parsed = values.map((value) =>
    value === null || value === undefined ? null : parseDecimal(String(value)),
  )
  if (parsed.some((entry) => entry === null)) return null
  const scale = Math.max(...parsed.map((entry) => entry!.scale), 0)
  let total = 0
  for (const entry of parsed) {
    const signed = (entry!.negative ? -entry!.digits : entry!.digits) * pow10(scale - entry!.scale)
    total += signed
    if (!Number.isSafeInteger(total)) return null
  }
  return formatScaled(total, scale)
}

/** Différence exacte `a - b`. */
export function subtractDecimalText(a: string, b: string): string | null {
  const left = parseDecimal(a)
  const right = parseDecimal(b)
  if (!left || !right) return null
  const scale = Math.max(left.scale, right.scale)
  const leftScaled = (left.negative ? -left.digits : left.digits) * pow10(scale - left.scale)
  const rightScaled = (right.negative ? -right.digits : right.digits) * pow10(scale - right.scale)
  const difference = leftScaled - rightScaled
  if (!Number.isSafeInteger(difference)) return null
  return formatScaled(difference, scale)
}
