export type ParsedCsv = {
  columns: string[]
  rows: Array<Record<string, string>>
}

export function parseCsvText(text: string): ParsedCsv {
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

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const nextChar = text[i + 1]

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentCell += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
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
    return { columns: [] as string[], rows: [] as Array<Record<string, string>> }
  }

  const columns = rows[0].map((col) => String(col || '').trim())
  const dataRows = rows.slice(1).map((row) => {
    const record: Record<string, string> = {}
    columns.forEach((col, index) => {
      record[col] = String(row[index] || '').trim()
    })
    return record
  })

  return { columns, rows: dataRows }
}

export function normalizeCsvHeader(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function parseCsvNumber(value: unknown): number | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null

  const cleaned = raw
    .replace(/\u00a0/g, '')
    .replace(/\s+/g, '')
    .replace(/[€$£]/g, '')
    .replace(/(mad|usd|eur|dh|dhs)$/i, '')
    .replace(/,/g, '.')
    .replace(/[^0-9.-]/g, '')

  if (!cleaned) return null
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}
