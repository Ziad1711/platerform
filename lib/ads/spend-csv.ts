import { detectNumberLocale, normalizeCsvHeader, parseCsvNumber } from '@/lib/imports/csv'

export type SpendImportMode = 'simple' | 'advanced'

export type SpendFieldKey =
  | 'date'
  | 'spend'
  | 'campaign_name'
  | 'impressions'
  | 'clicks'
  | 'reach'
  | 'frequency'
  | 'ctr'
  | 'cpc'
  | 'cpm'
  | 'purchases'
  | 'conversion_value'

export type SpendDateInputFormat = 'auto' | 'dd/mm/yyyy' | 'mm/dd/yyyy' | 'yyyy-mm-dd'

export type SpendFieldDefinition = {
  key: SpendFieldKey
  label: string
  hint: string
  required: boolean
  modes: SpendImportMode[]
  synonyms: string[]
}

export const spendFieldDefinitions: SpendFieldDefinition[] = [
  {
    key: 'date',
    label: 'Date',
    hint: 'Jour de la dépense',
    required: true,
    modes: ['simple', 'advanced'],
    synonyms: ['date', 'day', 'jour', 'reporting starts', 'reporting start', 'date start', 'date de debut', 'date debut', 'date de depense', 'date depense'],
  },
  {
    key: 'spend',
    label: 'Dépense',
    hint: 'Montant dépensé',
    required: true,
    modes: ['simple', 'advanced'],
    synonyms: [
      'amount spent',
      'amount_spent',
      'spend',
      'spent',
      'cost',
      'depense',
      'depenses',
      'montant depense',
      'montant de depense',
      'depense publicitaire',
      'depenses publicitaires',
      'ad spend',
      'cout',
      'budget consomme',
    ],
  },
  {
    key: 'campaign_name',
    label: 'Campagne',
    hint: 'Optionnel : détail par campagne',
    required: false,
    modes: ['advanced'],
    synonyms: ['campaign name', 'campaign', 'campagne', 'nom de la campagne', 'nom campagne'],
  },
  {
    key: 'impressions',
    label: 'Impressions',
    hint: 'Nombre d’impressions',
    required: false,
    modes: ['advanced'],
    synonyms: ['impressions', 'impression'],
  },
  {
    key: 'clicks',
    label: 'Clics',
    hint: 'Clics sur le lien',
    required: false,
    modes: ['advanced'],
    synonyms: ['link clicks', 'clicks', 'clic', 'clics', 'clics sur le lien', 'clicks all', 'outbound clicks'],
  },
  {
    key: 'reach',
    label: 'Portée',
    hint: 'Reach',
    required: false,
    modes: ['advanced'],
    synonyms: ['reach', 'portee', 'couverture'],
  },
  {
    key: 'frequency',
    label: 'Fréquence',
    hint: 'Impressions / portée',
    required: false,
    modes: ['advanced'],
    synonyms: ['frequency', 'frequence'],
  },
  {
    key: 'ctr',
    label: 'CTR (%)',
    hint: 'Taux de clics',
    required: false,
    modes: ['advanced'],
    synonyms: ['ctr', 'ctr link click through rate', 'taux de clics', 'ctr all'],
  },
  {
    key: 'cpc',
    label: 'CPC',
    hint: 'Coût par clic',
    required: false,
    modes: ['advanced'],
    synonyms: ['cpc', 'cost per link click', 'cout par clic', 'cost per click'],
  },
  {
    key: 'cpm',
    label: 'CPM',
    hint: 'Coût pour 1 000 impressions',
    required: false,
    modes: ['advanced'],
    synonyms: ['cpm', 'cost per 1000 impressions', 'cout pour 1000 impressions'],
  },
  {
    key: 'purchases',
    label: 'Achats',
    hint: 'Achats / résultats',
    required: false,
    modes: ['advanced'],
    synonyms: ['purchases', 'purchase', 'results', 'resultats', 'achats', 'website purchases', 'conversions'],
  },
  {
    key: 'conversion_value',
    label: 'Valeur conversions',
    hint: 'Chiffre d’affaires attribué',
    required: false,
    modes: ['advanced'],
    synonyms: [
      'purchase conversion value',
      'purchases conversion value',
      'conversion value',
      'valeur de conversion',
      'revenue',
      'website purchase roas',
    ],
  },
]

export const spendDateInputFormats: Array<{ value: SpendDateInputFormat; label: string }> = [
  { value: 'auto', label: 'Auto-détecter (recommandé)' },
  { value: 'dd/mm/yyyy', label: 'DD/MM/YYYY' },
  { value: 'mm/dd/yyyy', label: 'MM/DD/YYYY' },
  { value: 'yyyy-mm-dd', label: 'YYYY-MM-DD' },
]

function buildUtcDateKey(year: number, month: number, day: number) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null
  }
  return date.toISOString().slice(0, 10)
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
  janv: 1,
  fevr: 2,
  mars: 3,
  avr: 4,
  mai: 5,
  juin: 6,
  juil: 7,
  aout: 8,
  sept: 9,
}

function parseNamedMonthDate(value: string) {
  const match = value.match(/^(\d{1,2})?\s*([a-zA-Zéûôà]{3,5})\.?\s*(\d{1,2})?,?\s*(\d{4})$/)
  if (!match) return null

  const first = match[1] ? Number(match[1]) : null
  const rawMonth = normalizeCsvHeader(match[2]).slice(0, 4)
  const month = MONTHS[rawMonth] ?? MONTHS[rawMonth.slice(0, 3)]
  const second = match[3] ? Number(match[3]) : null
  const year = Number(match[4])

  if (!month || !Number.isFinite(year)) return null

  const day = first && first <= 31 ? first : second
  if (!day) return null

  return buildUtcDateKey(year, month, day)
}

export function parseSpendDate(value: unknown, format: SpendDateInputFormat = 'auto'): string | null {
  const raw = String(value || '').trim()
  if (!raw) return null

  const isoMatch = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (isoMatch && (format === 'auto' || format === 'yyyy-mm-dd')) {
    return buildUtcDateKey(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]))
  }

  const numericMatch = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/)
  if (numericMatch) {
    const first = Number(numericMatch[1])
    const second = Number(numericMatch[2])
    const year = Number(numericMatch[3])

    if (format === 'dd/mm/yyyy') return buildUtcDateKey(year, second, first)
    if (format === 'mm/dd/yyyy') return buildUtcDateKey(year, first, second)

    if (first > 12) return buildUtcDateKey(year, second, first)
    if (second > 12) return buildUtcDateKey(year, first, second)
    return buildUtcDateKey(year, second, first)
  }

  return parseNamedMonthDate(raw)
}

export function autoMapSpendColumns(columns: string[], mode: SpendImportMode) {
  const mapping = {} as Record<SpendFieldKey, string>
  const normalizedColumns = columns.map((column) => ({ original: column, normalized: normalizeCsvHeader(column) }))
  const usedColumns = new Set<string>()
  const fields = spendFieldDefinitions.filter((field) => field.modes.includes(mode))

  // 1) Correspondances exactes d'abord (évite les faux positifs du type CPM → Impressions).
  for (const field of fields) {
    const synonyms = field.synonyms.map((synonym) => normalizeCsvHeader(synonym))
    const exact = normalizedColumns.find(
      (column) => !usedColumns.has(column.original) && synonyms.includes(column.normalized)
    )
    mapping[field.key] = exact?.original || ''
    if (exact) usedColumns.add(exact.original)
  }

  // 2) Correspondances partielles, chaque colonne ne pouvant servir qu'à un seul champ.
  for (const field of fields) {
    if (mapping[field.key]) continue
    const synonyms = field.synonyms.map((synonym) => normalizeCsvHeader(synonym))
    const partial = normalizedColumns.find(
      (column) => !usedColumns.has(column.original) && synonyms.some((synonym) => column.normalized.includes(synonym))
    )
    if (partial) {
      mapping[field.key] = partial.original
      usedColumns.add(partial.original)
    }
  }

  return mapping
}

export function createEmptySpendMapping() {
  return spendFieldDefinitions.reduce((acc, field) => {
    acc[field.key] = ''
    return acc
  }, {} as Record<SpendFieldKey, string>)
}

export type SpendImportRow = {
  date: string
  campaignKey: string
  campaignName: string | null
  spend: number
  impressions: number
  clicks: number
  reach: number
  frequency: number
  ctr: number
  cpc: number
  cpm: number
  purchases: number
  conversion_value: number
}

export type SpendBuildResult = {
  rows: SpendImportRow[]
  invalidRows: Array<{ rowNumber: number; reason: string }>
  totalSpend: number
  minDate: string | null
  maxDate: string | null
  campaigns: number
}

type GroupedSpendRow = {
  date: string
  campaignKey: string
  campaignName: string | null
  spend: number
  impressions: number
  clicks: number
  reach: number
  purchases: number
  conversionValue: number
  frequency: number | null
  ctr: number | null
  cpc: number | null
  cpm: number | null
}

export function buildSpendImportRows(params: {
  rows: Array<Record<string, string>>
  mapping: Record<SpendFieldKey, string>
  mode: SpendImportMode
  dateFormat: SpendDateInputFormat
}): SpendBuildResult {
  const { mapping, mode, dateFormat } = params
  const invalidRows: Array<{ rowNumber: number; reason: string }> = []
  const grouped = new Map<string, GroupedSpendRow>()
  let minDate: string | null = null
  let maxDate: string | null = null

  const numericKeys = (Object.keys(mapping) as SpendFieldKey[]).filter(
    (key) => key !== 'date' && key !== 'campaign_name' && mapping[key]
  )
  const numberLocale = detectNumberLocale(params.rows.flatMap((row) => numericKeys.map((key) => row[mapping[key]])))

  const readNumber = (row: Record<string, string>, key: SpendFieldKey) => {
    const column = mapping[key]
    if (!column) return null
    return parseCsvNumber(row[column], numberLocale)
  }

  params.rows.forEach((row, index) => {
    const rowNumber = index + 2
    const date = parseSpendDate(mapping.date ? row[mapping.date] : '', dateFormat)
    if (!date) {
      invalidRows.push({ rowNumber, reason: 'Date invalide' })
      return
    }

    const spend = readNumber(row, 'spend')
    if (spend === null || spend < 0) {
      invalidRows.push({ rowNumber, reason: 'Dépense invalide' })
      return
    }

    const impressionsValue = readNumber(row, 'impressions') || 0
    const clicksValue = readNumber(row, 'clicks') || 0
    const reachValue = readNumber(row, 'reach') || 0
    const purchasesValue = Math.round(readNumber(row, 'purchases') || 0)
    const conversionValueValue = readNumber(row, 'conversion_value') || 0

    // Une ligne sans dépense et sans aucune métrique n'apporte rien : elle est ignorée automatiquement.
    const hasAnyValue =
      spend > 0 ||
      impressionsValue > 0 ||
      clicksValue > 0 ||
      reachValue > 0 ||
      purchasesValue > 0 ||
      conversionValueValue > 0

    if (!hasAnyValue) {
      invalidRows.push({ rowNumber, reason: 'Aucune dépense ni métrique sur cette ligne' })
      return
    }

    const campaignRaw = mode === 'advanced' && mapping.campaign_name ? String(row[mapping.campaign_name] || '').trim() : ''
    const campaignKey = campaignRaw || 'csv_daily'
    const key = `${date}::${campaignKey.toLowerCase()}`

    const current: GroupedSpendRow =
      grouped.get(key) || {
        date,
        campaignKey,
        campaignName: campaignRaw || null,
        spend: 0,
        impressions: 0,
        clicks: 0,
        reach: 0,
        purchases: 0,
        conversionValue: 0,
        frequency: null,
        ctr: null,
        cpc: null,
        cpm: null,
      }

    current.spend += spend
    current.impressions += impressionsValue
    current.clicks += clicksValue
    current.reach += reachValue
    current.purchases += purchasesValue
    current.conversionValue += conversionValueValue

    const providedFrequency = readNumber(row, 'frequency')
    if (providedFrequency !== null) current.frequency = providedFrequency
    const providedCtr = readNumber(row, 'ctr')
    if (providedCtr !== null) current.ctr = providedCtr
    const providedCpc = readNumber(row, 'cpc')
    if (providedCpc !== null) current.cpc = providedCpc
    const providedCpm = readNumber(row, 'cpm')
    if (providedCpm !== null) current.cpm = providedCpm

    grouped.set(key, current)

    if (!minDate || date < minDate) minDate = date
    if (!maxDate || date > maxDate) maxDate = date
  })

  const rows = Array.from(grouped.values()).map((entry) => {
    const spend = Number(entry.spend.toFixed(2))
    const impressions = Math.round(entry.impressions)
    const clicks = Math.round(entry.clicks)
    const reach = Math.round(entry.reach)

    return {
      date: entry.date,
      campaignKey: entry.campaignKey,
      campaignName: entry.campaignName,
      spend,
      impressions,
      clicks,
      reach,
      frequency: entry.frequency ?? (reach > 0 ? Number((impressions / reach).toFixed(4)) : 0),
      ctr: entry.ctr ?? (impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(4)) : 0),
      cpc: entry.cpc ?? (clicks > 0 ? Number((spend / clicks).toFixed(4)) : 0),
      cpm: entry.cpm ?? (impressions > 0 ? Number(((spend / impressions) * 1000).toFixed(4)) : 0),
      purchases: entry.purchases,
      conversion_value: Number(entry.conversionValue.toFixed(2)),
    }
  })

  return {
    rows,
    invalidRows,
    totalSpend: Number(rows.reduce((sum, row) => sum + row.spend, 0).toFixed(2)),
    minDate,
    maxDate,
    campaigns: new Set(rows.map((row) => row.campaignKey.toLowerCase())).size,
  }
}

