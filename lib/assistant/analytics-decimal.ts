/**
 * Arithmétique décimale exacte pour les montants Jisra.
 *
 * Les montants PostgreSQL sont des `numeric` : ils ne doivent jamais passer par
 * `Number` (perte de précision, notation exponentielle, arrondi binaire).
 * Toutes les opérations reposent sur `BigInt` et une échelle décimale explicite.
 *
 * Contrat :
 * - `null` en entrée ⇒ `null` en sortie (jamais 0) ;
 * - une chaîne invalide ⇒ `null` (jamais 0) ;
 * - aucune fonction ne renvoie d'exposant ni de `number`.
 */

interface ParsedDecimal {
  negative: boolean
  digits: bigint
  scale: number
}

const DECIMAL_PATTERN = /^([+-]?)(\d+(?:\.\d*)?|\.\d+)(?:[eE]([+-]?\d+))?$/

function parseDecimal(value: string): ParsedDecimal | null {
  const trimmed = value.trim()
  const match = DECIMAL_PATTERN.exec(trimmed)
  if (!match) return null

  const sign = match[1] === '-'
  const mantissa = match[2]
  const exponent = match[3] ? Number.parseInt(match[3], 10) : 0

  const [integerPart = '0', fractionPart = ''] = mantissa.split('.')
  let digitsText = `${integerPart === '' ? '0' : integerPart}${fractionPart}`
  let scale = fractionPart.length - exponent

  if (scale < 0) {
    digitsText += '0'.repeat(-scale)
    scale = 0
  }

  let digits = BigInt(digitsText === '' ? '0' : digitsText)
  const negative = sign && digits !== BigInt(0)
  if (digits === BigInt(0)) scale = 0

  while (digits !== BigInt(0) && scale > 0 && digits % BigInt(10) === BigInt(0)) {
    digits /= BigInt(10)
    scale -= 1
  }

  return { negative, digits, scale }
}

function align(a: ParsedDecimal, b: ParsedDecimal): { a: bigint; b: bigint; scale: number } {
  const scale = Math.max(a.scale, b.scale)
  const aScaled = a.digits * BigInt(10) ** BigInt(scale - a.scale)
  const bScaled = b.digits * BigInt(10) ** BigInt(scale - b.scale)
  return {
    a: a.negative ? -aScaled : aScaled,
    b: b.negative ? -bScaled : bScaled,
    scale,
  }
}

function render(signedDigits: bigint, scale: number): string {
  const negative = signedDigits < BigInt(0)
  const absolute = negative ? -signedDigits : signedDigits
  let text = absolute.toString()

  if (scale > 0) {
    if (text.length <= scale) text = text.padStart(scale + 1, '0')
    const cut = text.length - scale
    const integerPart = text.slice(0, cut)
    const fractionPart = text.slice(cut).replace(/0+$/, '')
    text = fractionPart === '' ? integerPart : `${integerPart}.${fractionPart}`
  }

  return negative ? `-${text}` : text
}

/**
 * Convertit une valeur `numeric` en texte décimal canonique. Un `number` n'est
 * accepté que comme repli : la valeur a déjà été arrondie par le transport.
 */
export function toDecimalText(value: unknown): string | null {
  const read = decimalFromRpc(value)
  return read.exact ? read.value : null
}

export interface DecimalRead {
  /** Texte canonique, `null` si la valeur n'est pas un décimal exploitable. */
  value: string | null
  /** `false` = précision potentiellement perdue par le transport JSON. */
  exact: boolean
}

/**
 * Lit un montant provenant d'une RPC.
 *
 * - chaîne décimale et `bigint` : exacts ;
 * - nombre JavaScript : jamais déclaré exact. Même une valeur apparemment
 *   simple peut provenir d'un `numeric` déjà arrondi par le transport JSON.
 *   La valeur canonique est conservée pour diagnostic, mais toute métrique qui
 *   l'utilise devient `partial` et porte une limite de précision.
 */
export function decimalFromRpc(value: unknown): DecimalRead {
  if (typeof value === 'string') {
    const parsed = parseDecimal(value)
    if (!parsed) return { value: null, exact: false }
    return { value: render(parsed.negative ? -parsed.digits : parsed.digits, parsed.scale), exact: true }
  }

  if (typeof value === 'bigint') {
    return { value: render(value, 0), exact: true }
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { value: null, exact: false }
    const text = String(value)
    const parsed = parseDecimal(text)
    if (!parsed) return { value: null, exact: false }
    return {
      value: render(parsed.negative ? -parsed.digits : parsed.digits, parsed.scale),
      exact: false,
    }
  }

  return { value: null, exact: false }
}

export function addDecimals(a: string | null, b: string | null): string | null {
  if (a === null || b === null) return null
  const left = parseDecimal(a)
  const right = parseDecimal(b)
  if (!left || !right) return null
  const aligned = align(left, right)
  return render(aligned.a + aligned.b, aligned.scale)
}

export function subtractDecimals(a: string | null, b: string | null): string | null {
  if (a === null || b === null) return null
  const left = parseDecimal(a)
  const right = parseDecimal(b)
  if (!left || !right) return null
  const aligned = align(left, right)
  return render(aligned.a - aligned.b, aligned.scale)
}

/** Somme exacte : un seul terme invalide rend le total indisponible (`null`). */
export function sumDecimals(values: ReadonlyArray<string | null>): string | null {
  if (values.length === 0) return null

  let signedTotal = BigInt(0)
  let scale = 0

  for (const value of values) {
    if (value === null) return null
    const parsed = parseDecimal(value)
    if (!parsed) return null

    const targetScale = Math.max(scale, parsed.scale)
    const signed = parsed.negative ? -parsed.digits : parsed.digits
    signedTotal = signedTotal * BigInt(10) ** BigInt(targetScale - scale) + signed * BigInt(10) ** BigInt(targetScale - parsed.scale)
    scale = targetScale
  }

  return render(signedTotal, scale)
}

export function compareDecimals(a: string, b: string): number | null {
  const left = parseDecimal(a)
  const right = parseDecimal(b)
  if (!left || !right) return null
  const aligned = align(left, right)
  if (aligned.a === aligned.b) return 0
  return aligned.a > aligned.b ? 1 : -1
}

export function isZeroDecimal(value: string | null): boolean {
  if (value === null) return false
  const parsed = parseDecimal(value)
  return parsed !== null && parsed.digits === BigInt(0)
}

/** `true` uniquement pour un montant strictement positif valide. */
export function isPositiveDecimal(value: string | null): boolean {
  if (value === null) return false
  const parsed = parseDecimal(value)
  return parsed !== null && parsed.digits !== BigInt(0) && !parsed.negative
}

/**
 * Pourcentage exact d'un ratio de compteurs entiers (taux, couverture).
 * `null` dès qu'un dénominateur est nul ou qu'une valeur est invalide :
 * aucun taux n'est inventé pour une population vide.
 */
export function percentOfCounts(
  numerator: number | null,
  denominator: number | null,
  fractionDigits = 2,
): string | null {
  if (numerator === null || denominator === null) return null
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator)) return null
  if (denominator <= 0 || numerator < 0) return null

  const factor = BigInt(10) ** BigInt(fractionDigits)
  const scaled = (BigInt(numerator) * BigInt(100) * factor) / BigInt(denominator)
  return render(scaled, fractionDigits)
}
