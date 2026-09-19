export type ParsedCsv = {
  columns: string[]
  rows: Array<Record<string, string>>
  delimiter: string | null
}

export type NumberLocale = 'eu' | 'us'

const CANDIDATE_DELIMITERS = [',', ';', '\t', '|']

export const delimiterLabels: Record<string, string> = {
  ',': 'virgule',
  ';': 'point-virgule',
  '\t': 'tabulation',
  '|': 'barre verticale',
}

function countOutsideQuotes(line: string, delimiter: string) {
  let count = 0
  let inQuotes = false

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        i += 1
        continue
      }
      inQuotes = !inQuotes
      continue
    }
    if (!inQuotes && char === delimiter) count += 1
  }

  return count
}

export function detectCsvDelimiter(text: string): string | null {
  const sampleLines = text
    .split(/\r\n|\r|\n/)
    .filter((line) => line.trim() !== '')
    .slice(0, 10)

  if (sampleLines.length === 0) return null

  let bestDelimiter: string | null = null
  let bestScore = -1

  for (const delimiter of CANDIDATE_DELIMITERS) {
    const counts = sampleLines.map((line) => countOutsideQuotes(line, delimiter))
    const linesWithDelimiter = counts.filter((count) => count > 0).length
    if (linesWithDelimiter === 0) continue

    const total = counts.reduce((sum, count) => sum + count, 0)
    const consistent = counts.every((count) => count === counts[0]) ? 1 : 0
    const score = consistent * 100000 + linesWithDelimiter * 1000 + total

    if (score > bestScore) {
      bestScore = score
      bestDelimiter = delimiter
    }
  }

  return bestDelimiter
}

function normalizeCsvContent(text: string) {
  let content = text.replace(/^\uFEFF/, '')

  // Excel peut ajouter une ligne de configuration du séparateur.
  const sepMatch = content.match(/^sep=(.)\r?\n?/i)
  if (sepMatch) {
    content = content.slice(sepMatch[0].length)
    return { content, forcedDelimiter: sepMatch[1] }
  }

  return { content, forcedDelimiter: null as string | null }
}

export function parseCsvText(text: string): ParsedCsv {
  const { content, forcedDelimiter } = normalizeCsvContent(text)
  const delimiter = forcedDelimiter || detectCsvDelimiter(content) || ','

  const rows: string[][] = []
  let currentCell = ''
  let currentRow: string[] = []
  let inQuotes = false

  const pushCell = () => {
    currentRow.push(currentCell)
    currentCell = ''
  }

  const pushRow = () => {
    if (currentRow.length === 0) return
    if (currentRow.every((cell) => String(cell || '').trim() === '')) {
      currentRow = []
      return
    }
    rows.push(currentRow)
    currentRow = []
  }

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i]
    const nextChar = content[i + 1]

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentCell += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === delimiter && !inQuotes) {
      pushCell()
      continue
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') i += 1
      pushCell()
      pushRow()
      continue
    }

    currentCell += char
  }

  pushCell()
  pushRow()

  if (rows.length === 0) {
    return { columns: [] as string[], rows: [] as Array<Record<string, string>>, delimiter: null }
  }

  const columns = rows[0].map((col) => String(col || '').trim())
  const dataRows = rows.slice(1).map((row) => {
    const record: Record<string, string> = {}
    columns.forEach((col, index) => {
      record[col] = String(row[index] || '').trim()
    })
    return record
  })

  return { columns, rows: dataRows, delimiter }
}

export function normalizeCsvHeader(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function detectNumberLocale(values: Array<unknown>): NumberLocale {
  let euThousands = 0
  let usThousands = 0
  let euDecimal = 0
  let usDecimal = 0

  for (const value of values) {
    const raw = String(value ?? '').trim()
    if (!raw || !/\d/.test(raw)) continue

    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(raw)) euThousands += 1
    else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(raw)) usThousands += 1
    else if (/^\d+,\d{1,2}$/.test(raw)) euDecimal += 1
    else if (/^\d+\.\d{1,2}$/.test(raw)) usDecimal += 1
  }

  if (euThousands > usThousands) return 'eu'
  if (usThousands > euThousands) return 'us'
  if (euDecimal > usDecimal) return 'eu'
  if (usDecimal > euDecimal) return 'us'

  return 'eu'
}

export function parseCsvNumber(value: unknown, locale: NumberLocale = 'eu'): number | null {
  let raw = String(value ?? '').trim()
  if (!raw) return null

  raw = raw
    .replace(/[\u00a0\u202f\u2009]/g, ' ')
    .replace(/[€$£]/g, '')
    .replace(/\b(mad|usd|eur|dh|dhs|dirhams?|dollars?|euros?)\b/gi, '')
    .trim()

  if (!raw || !/\d/.test(raw)) return null

  const negative = raw.startsWith('-') || /^\(.*\)$/.test(raw)
  const digits = raw.replace(/[^0-9.,]/g, '')
  if (!digits) return null

  const hasDot = digits.includes('.')
  const hasComma = digits.includes(',')
  let normalized = digits

  if (hasDot && hasComma) {
    normalized =
      locale === 'eu'
        ? digits.replace(/\./g, '').replace(/,/g, '.')
        : digits.replace(/,/g, '')
  } else if (hasComma) {
    normalized = locale === 'us' && /^\d{1,3}(,\d{3})+$/.test(digits) ? digits.replace(/,/g, '') : digits.replace(/,/g, '.')
  } else if (hasDot) {
    normalized = locale === 'eu' && /^\d{1,3}(\.\d{3})+$/.test(digits) ? digits.replace(/\./g, '') : digits
  }

  const firstDot = normalized.indexOf('.')
  if (firstDot !== -1) {
    normalized = normalized.slice(0, firstDot + 1) + normalized.slice(firstDot + 1).replace(/\./g, '')
  }

  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) return null

  return negative ? -Math.abs(parsed) : parsed
}
