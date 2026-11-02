'use client'

import { useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { AssistantStructuredResponse } from '@/lib/assistant/types'

const PIE_COLORS = ['#2563eb', '#7c3aed', '#06b6d4', '#10b981', '#f59e0b', '#ef4444']

function getXAxisKey(data: Array<Record<string, string | number | null>>) {
  const first = data[0] || {}
  if ('date' in first) return 'date'
  if ('name' in first) return 'name'
  return Object.keys(first).find((k) => typeof first[k] === 'string' && k !== 'valueLabel' && k !== 'currency') || 'name'
}

/**
 * Clé de valeur : le contrat analytique publie `value` (numérique, pour
 * l'échelle) et `valueLabel` (décimal exact + devise, pour l'infobulle).
 * Aucun repli silencieux vers une clé absente.
 */
function getPrimaryValueKey(data: Array<Record<string, string | number | null>>) {
  const first = data[0] || {}
  if ('value' in first) return 'value'
  return Object.keys(first).find((k) => typeof first[k] === 'number') ?? null
}

/** Infobulle Recharts : le libellé exact vit dans `item.payload.valueLabel`. */
function renderTooltipValue(
  value: unknown,
  _name: unknown,
  item: { payload?: { valueLabel?: unknown; currency?: unknown } } | undefined,
): string {
  const payload = item?.payload
  if (typeof payload?.valueLabel === 'string' && payload.valueLabel) return payload.valueLabel
  if (value === null || value === undefined) return 'Donnée absente'
  if (typeof value === 'number' && Number.isFinite(value)) {
    return typeof payload?.currency === 'string' ? `${value} ${payload.currency}` : String(value)
  }
  return '—'
}

/** Axe compact : la valeur exacte reste dans l'infobulle, jamais sur l'axe. */
function compactAxisValue(value: number): string {
  const absolute = Math.abs(value)
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} M`
  if (absolute >= 1_000) return `${(value / 1_000).toFixed(1)} k`
  return String(value)
}

/** Libellé d'axe court : un nom de produit long ne doit pas casser la mise en page. */
function compactLabel(value: unknown): string {
  const text = String(value ?? '')
  return text.length > 14 ? `${text.slice(0, 13)}…` : text
}

/** Journée métier `YYYY-MM-DD` → libellé lisible court (`12 nov.`). */
function formatDateAxis(value: unknown): string {
  const text = String(value ?? '')
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!match) return compactLabel(text)
  const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1] ?? match[2]}`
}

/** Journée métier → libellé complet pour l'infobulle (`12 novembre 2025`). */
function formatDateTooltip(value: unknown): string {
  const text = String(value ?? '')
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!match) return text
  const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1] ?? match[2]} ${match[1]}`
}

/**
 * Infobulle compacte et accessible : taille réduite, jamais plus large que
 * l'écran, sans anneau de focus, pour ne pas recouvrir les barres sur mobile.
 */
function CompactTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ value?: unknown; name?: unknown; payload?: Record<string, unknown> }>
  label?: unknown
}) {
  if (!active || !payload || payload.length === 0) return null
  const title = formatDateTooltip(label)
  return (
    <div className="max-w-[16rem] rounded-md border border-border bg-background/95 px-2.5 py-1.5 text-xs shadow-sm">
      {title ? <div className="mb-0.5 font-medium text-muted-foreground">{title}</div> : null}
      {payload.map((entry, index) => (
        <div key={index} className="flex items-baseline justify-between gap-2 text-foreground">
          {typeof entry.name === 'string' && entry.name ? <span className="text-muted-foreground">{entry.name}</span> : null}
          <span className="font-semibold tabular-nums">
            {renderTooltipValue(entry.value, entry.name, {
              payload: entry.payload as { valueLabel?: unknown; currency?: unknown } | undefined,
            })}
          </span>
        </div>
      ))}
    </div>
  )
}

/** Nom de série lisible pour l'infobulle, à partir de l'unité du graphique. */
function seriesNameForUnit(unit?: string): string {
  if (unit === 'currency') return 'Chiffre d’affaires'
  if (unit === 'count') return 'Commandes'
  if (unit === 'percent') return 'Taux'
  return 'Valeur'
}

export default function AssistantChartCard({ response }: { response: AssistantStructuredResponse }) {
  const [selectedPoint, setSelectedPoint] = useState<number | null>(null)
  if (!response.chart || !response.chart_data?.length) {
    return null
  }

  const xKey = getXAxisKey(response.chart_data)
  const valueKey = getPrimaryValueKey(response.chart_data)
  const seriesName = seriesNameForUnit(response.chart_unit)

  // Pas de graphique sans clé de valeur exploitable : un axe vide n'est pas un résultat.
  if (!valueKey) return null

  const axisProps = {
    tick: { fontSize: 11 },
    tickLine: false,
    axisLine: false,
  } as const

  const tooltipProps = {
    content: <CompactTooltip />,
    cursor: { stroke: '#94a3b8', strokeDasharray: '3 3' },
    wrapperStyle: { outline: 'none', zIndex: 30 },
  } as const

  const isDaily = xKey === 'date'
  const selected = selectedPoint === null ? null : response.chart_data[selectedPoint]

  return (
    <div dir="ltr" className="mt-3 min-w-0 max-w-full overflow-hidden rounded-xl border bg-card p-3">
      {response.chart_title ? <h4 dir="auto" className="text-sm font-semibold text-foreground"><bdi dir="auto">{response.chart_title}</bdi></h4> : null}
      {response.chart_description ? <p dir="auto" className="text-xs text-muted-foreground mt-1"><bdi dir="auto">{response.chart_description}</bdi></p> : null}

      <div className="mt-3 h-56 w-full min-w-0 min-h-[14rem] sm:h-64" role="img" aria-label={response.chart_title || 'Graphique'}>
        <ResponsiveContainer width="100%" height="100%">
          {response.chart_type === 'line' ? (
            <LineChart data={response.chart_data} accessibilityLayer>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={xKey} {...axisProps} minTickGap={16} interval="preserveStartEnd" tickFormatter={isDaily ? formatDateAxis : compactLabel} />
              <YAxis {...axisProps} width={44} tickFormatter={compactAxisValue} />
              <Tooltip {...tooltipProps} />
              <Line type="linear" name={seriesName} dataKey={valueKey} stroke="#2563eb" strokeWidth={2} dot={isDaily ? { r: 2 } : false} connectNulls={false} />
            </LineChart>
          ) : response.chart_type === 'area' ? (
            <AreaChart data={response.chart_data} accessibilityLayer>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={xKey} {...axisProps} minTickGap={16} interval="preserveStartEnd" tickFormatter={isDaily ? formatDateAxis : compactLabel} />
              <YAxis {...axisProps} width={44} tickFormatter={compactAxisValue} />
              <Tooltip {...tooltipProps} />
              <Area type="linear" name={seriesName} dataKey={valueKey} stroke="#2563eb" fill="#93c5fd" connectNulls={false} />
            </AreaChart>
          ) : response.chart_type === 'pie' ? (
            <PieChart>
              <Pie data={response.chart_data} dataKey={valueKey} nameKey={xKey} outerRadius={90}>
                {response.chart_data.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip content={<CompactTooltip />} wrapperStyle={{ outline: 'none', zIndex: 30 }} />
              <Legend />
            </PieChart>
          ) : (
            <BarChart data={response.chart_data} accessibilityLayer onClick={(event) => {
              if (typeof event?.activeTooltipIndex === 'number') setSelectedPoint(event.activeTooltipIndex)
            }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={xKey} {...axisProps} minTickGap={16} interval="preserveStartEnd" tickFormatter={isDaily ? formatDateAxis : compactLabel} />
              <YAxis {...axisProps} width={44} tickFormatter={compactAxisValue} />
              <Tooltip {...tooltipProps} wrapperStyle={{ display: 'none' }} />
              <Bar name={seriesName} dataKey={valueKey} fill="#2563eb" radius={[6, 6, 0, 0]}>
                {response.chart_data.length <= 4 ? <LabelList dataKey="value" position="top" className="fill-foreground" fontSize={10} formatter={(value: unknown) => typeof value === 'number' ? compactAxisValue(value) : ''} /> : null}
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      {response.chart_type === 'bar' ? (
        <div className="mt-2 space-y-1 text-xs text-foreground" aria-live="polite">
          {selected ? <div className="rounded-md bg-secondary p-2"><bdi dir="auto">{String(selected[xKey] ?? '')}</bdi> : <bdi dir="ltr">{String(selected.valueLabel ?? selected[valueKey] ?? '')}</bdi></div> : null}
          {response.chart_data.map((point, index) => (
            <button key={index} type="button" onClick={() => setSelectedPoint(index)} className="flex w-full min-w-0 items-baseline justify-between gap-2 rounded px-1 py-1 text-left hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
              <bdi dir="auto" className="min-w-0 truncate">{String(point[xKey] ?? '')}</bdi>
              <bdi dir="ltr" className="shrink-0 tabular-nums font-medium">{String(point.valueLabel ?? point[valueKey] ?? '')}</bdi>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
