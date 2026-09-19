'use client'

import { useMemo, useRef, useState } from 'react'
import { CheckCircle2, Loader2, RefreshCw, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { delimiterLabels, parseCsvText } from '@/lib/imports/csv'
import {
  autoMapSpendColumns,
  buildSpendImportRows,
  createEmptySpendMapping,
  spendDateInputFormats,
  spendFieldDefinitions,
  type SpendDateInputFormat,
  type SpendFieldKey,
  type SpendImportMode,
} from '@/lib/ads/spend-csv'

type ImportResult = {
  inserted: number
  mode: SpendImportMode
  fileCurrency: string
  dateFrom: string | null
  dateTo: string | null
}

export default function SpendImportModal({
  storeId,
  storeCurrency,
  onClose,
  onImported,
}: {
  storeId: string
  storeCurrency: string
  onClose: () => void
  onImported: (result: ImportResult) => void
}) {
  const [mode, setMode] = useState<SpendImportMode>('simple')
  const [step, setStep] = useState<1 | 2>(1)
  const [fileName, setFileName] = useState('')
  const [delimiter, setDelimiter] = useState<string | null>(null)
  const [columns, setColumns] = useState<string[]>([])
  const [rows, setRows] = useState<Array<Record<string, string>>>([])
  const [mapping, setMapping] = useState<Record<SpendFieldKey, string>>(createEmptySpendMapping)
  const [dateFormat, setDateFormat] = useState<SpendDateInputFormat>('auto')
  const [fileCurrency, setFileCurrency] = useState(storeCurrency)
  const [isImporting, setIsImporting] = useState(false)
  const [error, setError] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const activeFields = useMemo(() => spendFieldDefinitions.filter((field) => field.modes.includes(mode)), [mode])

  const preview = useMemo(
    () => buildSpendImportRows({ rows, mapping, mode, dateFormat }),
    [rows, mapping, mode, dateFormat]
  )

  const missingRequired = useMemo(
    () => activeFields.filter((field) => field.required && !mapping[field.key]),
    [activeFields, mapping]
  )

  const labelFor = (field: (typeof spendFieldDefinitions)[number]) => {
    if (mode !== 'simple') return field.label
    if (field.key === 'date') return 'Date de dépense'
    if (field.key === 'spend') return `Montant de dépense (${storeCurrency})`
    return field.label
  }

  const importErrorMessage = (raw: string) => {
    if (!raw) return 'Import impossible.'
    const rowMatch = raw.match(/_ROW_(\d+)$/)
    const rowNumber = rowMatch ? rowMatch[1] : null

    if (raw.startsWith('INVALID_DATE_ROW_')) return `Date invalide à la ligne ${rowNumber}.`
    if (raw.startsWith('FUTURE_DATE_ROW_')) return `La ligne ${rowNumber} contient une date future.`
    if (raw.startsWith('INVALID_SPEND_ROW_')) return `Montant de dépense invalide à la ligne ${rowNumber}.`
    if (raw.startsWith('EXCHANGE_RATE_NOT_FOUND')) {
      return 'Taux de change manquant : ajoutez-le dans Paramètres → Taux de change.'
    }
    if (raw === 'FORBIDDEN') return 'Vous n’avez pas la permission de gérer la publicité sur ce store.'
    if (raw === 'NO_ROWS_TO_IMPORT') return 'Aucune ligne de dépense à importer.'
    if (raw === 'TOO_MANY_ROWS') return 'Trop de lignes : limitez le fichier à 20 000 lignes.'
    if (raw === 'MISSING_STORE_ID') return 'Sélectionnez un store avant l’import.'
    return raw
  }

  const resetFile = () => {
    setFileName('')
    setDelimiter(null)
    setColumns([])
    setRows([])
    setMapping(createEmptySpendMapping())
    setError('')
    setResult(null)
    setStep(1)
  }

  const changeMode = (nextMode: SpendImportMode) => {
    setMode(nextMode)
    setMapping(columns.length > 0 ? autoMapSpendColumns(columns, nextMode) : createEmptySpendMapping())
    setError('')
    setResult(null)
  }

  const handleFile = async (file: File | null | undefined) => {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('Fichier non supporté. Choisissez un fichier CSV.')
      return
    }

    try {
      const parsed = parseCsvText(await file.text())
      if (parsed.columns.length === 0) {
        setError(
          'Impossible de lire ce fichier. Séparateurs acceptés : virgule, point-virgule et tabulation.'
        )
        return
      }
      if (parsed.rows.length === 0) {
        setError('Le fichier contient des colonnes, mais aucune ligne de données détectée.')
        return
      }

      setFileName(file.name)
      setDelimiter(parsed.delimiter)
      setColumns(parsed.columns)
      setRows(parsed.rows)
      setMapping(autoMapSpendColumns(parsed.columns, mode))
      setDateFormat('auto')
      setError('')
      setResult(null)
      setStep(2)
    } catch {
      setError('Impossible de lire ce fichier CSV.')
    }
  }

  const runImport = async () => {
    if (!storeId) {
      setError('Sélectionnez un store avant l’import.')
      return
    }
    if (missingRequired.length > 0) {
      setError(`Champs obligatoires non mappés : ${missingRequired.map((field) => field.label).join(', ')}.`)
      return
    }
    if (preview.rows.length === 0) {
      setError('Aucune ligne valide détectée dans ce fichier.')
      return
    }

    setIsImporting(true)
    setError('')

    try {
      const response = await fetch('/api/ads/spend-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId, mode, platform: 'facebook', fileCurrency, rows: preview.rows }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.hint || payload?.error || 'SPEND_IMPORT_FAILED')

      const importResult: ImportResult = {
        inserted: Number(payload?.inserted || 0),
        mode,
        fileCurrency: String(payload?.fileCurrency || fileCurrency),
        dateFrom: payload?.dateFrom || null,
        dateTo: payload?.dateTo || null,
      }

      setResult(importResult)
      toast.success(`${importResult.inserted} ligne(s) de dépenses importées`)
      onImported(importResult)
    } catch (err) {
      const message = importErrorMessage(err instanceof Error ? err.message : '')
      setError(message)
      toast.error(message)
    } finally {
      setIsImporting(false)
    }
  }

  const formatDate = (value: string) =>
    new Date(`${value}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

  const renderStepTwo = () => (
    <>
      {result ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
          <div className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="h-4 w-4" />
            Import terminé
          </div>
          <p className="mt-2">
            {result.inserted} ligne(s) enregistrée(s)
            {result.dateFrom && result.dateTo ? ` du ${formatDate(result.dateFrom)} au ${formatDate(result.dateTo)}` : ''}.
          </p>
          <p className="mt-1 text-xs">
            Les dépenses de ces journées ont été recalculées et réparties sur les ventes marquées « Ads ».
          </p>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm font-medium text-foreground">
          Fichier
          <input
            value={fileName}
            readOnly
            className="mt-1 w-full rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
          />
        </label>

        {mode === 'simple' ? (
          <label className="text-sm font-medium text-foreground">
            Devise du store
            <input
              value={storeCurrency}
              readOnly
              className="mt-1 w-full rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
            />
          </label>
        ) : (
          <label className="text-sm font-medium text-foreground">
            Devise du fichier
            <input
              value={fileCurrency}
              onChange={(event) => setFileCurrency(event.target.value.toUpperCase())}
              maxLength={3}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
        )}

        {mode === 'simple' ? (
          <div className="text-sm font-medium text-foreground">
            Détection automatique
            <p className="mt-1 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              {rows.length} ligne(s) • séparateur : {delimiter ? delimiterLabels[delimiter] || delimiter : 'inconnu'} • date
              lue automatiquement
            </p>
          </div>
        ) : (
          <label className="text-sm font-medium text-foreground">
            Format de date
            <select
              value={dateFormat}
              onChange={(event) => setDateFormat(event.target.value as SpendDateInputFormat)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              {spendDateInputFormats.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="rounded-xl border border-border">
        <div className="grid grid-cols-12 gap-3 border-b border-border bg-secondary/50 px-4 py-2 text-xs font-medium text-muted-foreground">
          <div className="col-span-5">Champ</div>
          <div className="col-span-7">Colonne du fichier</div>
        </div>
        <div className="max-h-64 overflow-y-auto">
          {activeFields.map((field) => (
            <div key={field.key} className="grid grid-cols-12 items-center gap-3 border-b border-border px-4 py-2 last:border-b-0">
              <div className="col-span-5 text-sm text-foreground">
                {labelFor(field)}
                {field.required ? <span className="ml-1 text-red-600">*</span> : null}
                <span className="mt-0.5 block text-xs text-muted-foreground">{field.hint}</span>
              </div>
              <div className="col-span-7">
                <select
                  value={mapping[field.key]}
                  onChange={(event) => setMapping((prev) => ({ ...prev, [field.key]: event.target.value }))}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
                >
                  <option value="">-- Non mappé --</option>
                  {columns.map((column, index) => (
                    <option key={`${field.key}-${column}-${index}`} value={column}>
                      {column}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-border p-3">
          <p className="text-xs text-muted-foreground">Lignes retenues</p>
          <p className="text-lg font-semibold text-foreground">{preview.rows.length}</p>
        </div>
        <div className="rounded-xl border border-border p-3">
          <p className="text-xs text-muted-foreground">Total dépense</p>
          <p className="text-lg font-semibold text-foreground">
            {preview.totalSpend.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} {fileCurrency}
          </p>
        </div>
        <div className="rounded-xl border border-border p-3">
          <p className="text-xs text-muted-foreground">Période</p>
          <p className="text-sm font-medium text-foreground">
            {preview.minDate && preview.maxDate ? `${formatDate(preview.minDate)} → ${formatDate(preview.maxDate)}` : '—'}
          </p>
        </div>
        <div className="rounded-xl border border-border p-3">
          <p className="text-xs text-muted-foreground">Campagnes</p>
          <p className="text-lg font-semibold text-foreground">{preview.campaigns}</p>
        </div>
      </div>

      {preview.invalidRows.length > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
          {preview.invalidRows.length} ligne(s) ignorée(s) automatiquement :{' '}
          {preview.invalidRows
            .slice(0, 5)
            .map((row) => `ligne ${row.rowNumber} (${row.reason})`)
            .join(', ')}
          {preview.invalidRows.length > 5 ? '…' : ''}
        </div>
      ) : null}

      {rows.length > 0 && preview.rows.length === 0 ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Aucune ligne exploitable. Vérifiez le mapping des champs obligatoires et que le fichier contient des montants
          supérieurs à zéro.
        </div>
      ) : null}
    </>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={isImporting ? undefined : onClose} />
      <div className="relative z-10 flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-start justify-between border-b border-border p-5">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Importer des dépenses publicitaires</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Fichier CSV exporté depuis Ads Manager, ou fichier simple (date + dépense en {storeCurrency}).
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isImporting}
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {step === 1 ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => changeMode('simple')}
                  className={`rounded-xl border p-4 text-left transition ${
                    mode === 'simple' ? 'border-primary bg-primary/5' : 'border-border hover:bg-secondary/40'
                  }`}
                >
                  <span className="block text-sm font-semibold text-foreground">Simple</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Deux colonnes : date et dépense en {storeCurrency}.
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => changeMode('advanced')}
                  className={`rounded-xl border p-4 text-left transition ${
                    mode === 'advanced' ? 'border-primary bg-primary/5' : 'border-border hover:bg-secondary/40'
                  }`}
                >
                  <span className="block text-sm font-semibold text-foreground">Avancé</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Colonnes Ads Manager : impressions, clics, CTR, CPC, CPM, achats, valeur de conversion, campagne.
                  </span>
                </button>
              </div>

              <div
                onDragOver={(event) => {
                  event.preventDefault()
                  setDragActive(true)
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(event) => {
                  event.preventDefault()
                  setDragActive(false)
                  void handleFile(event.dataTransfer?.files?.[0])
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition ${
                  dragActive ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/60 hover:bg-secondary/40'
                }`}
              >
                <Upload className="mx-auto h-6 w-6 text-muted-foreground" />
                <p className="mt-2 text-sm font-medium text-foreground">
                  {dragActive ? 'Déposez le fichier CSV ici' : 'Glissez-déposez votre fichier CSV ici'}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {mode === 'simple'
                    ? `Colonnes attendues : date, dépense (${storeCurrency}) — séparateur virgule, point-virgule ou tabulation`
                    : 'Export Ads Manager, colonnes françaises ou anglaises'}
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.currentTarget.value = ''
                    void handleFile(file)
                  }}
                />
              </div>
            </>
          ) : (
            renderStepTwo()
          )}

          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>

        <div className="flex items-center justify-between border-t border-border p-5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isImporting}
              className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-secondary disabled:opacity-40"
            >
              {result ? 'Fermer' : 'Annuler'}
            </button>
            {step === 2 && !result ? (
              <button
                type="button"
                onClick={resetFile}
                disabled={isImporting}
                className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-secondary disabled:opacity-40"
              >
                Changer de fichier
              </button>
            ) : null}
          </div>
          {step === 2 && !result ? (
            <button
              type="button"
              onClick={() => void runImport()}
              disabled={isImporting || preview.rows.length === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {isImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {isImporting ? 'Import en cours' : `Importer ${preview.rows.length} ligne(s)`}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}


