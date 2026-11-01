'use client'

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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

export default function AssistantChartCard({ response }: { response: AssistantStructuredResponse }) {
  if (!response.chart || !response.chart_data?.length) {
    return null
  }

  const xKey = getXAxisKey(response.chart_data)
  const valueKey = getPrimaryValueKey(response.chart_data)

  // Pas de graphique sans clé de valeur exploitable : un axe vide n'est pas un résultat.
  if (!valueKey) return null

  const axisProps = {
    tick: { fontSize: 11 },
    tickLine: false,
    axisLine: false,
  } as const

  return (
    <div dir="ltr" className="mt-3 rounded-xl border bg-card p-3">
      {response.chart_title ? <h4 dir="auto" className="text-sm font-semibold text-foreground"><bdi dir="auto">{response.chart_title}</bdi></h4> : null}
      {response.chart_description ? <p dir="auto" className="text-xs text-muted-foreground mt-1"><bdi dir="auto">{response.chart_description}</bdi></p> : null}

      <div className="mt-3 h-56 w-full min-h-[14rem] sm:h-64" role="img" aria-label={response.chart_title || 'Graphique'}>
        <ResponsiveContainer width="100%" height="100%">
          {response.chart_type === 'line' ? (
            <LineChart data={response.chart_data} accessibilityLayer>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={xKey} {...axisProps} minTickGap={16} interval="preserveStartEnd" tickFormatter={compactLabel} />
              <YAxis {...axisProps} width={44} tickFormatter={compactAxisValue} />
              <Tooltip formatter={renderTooltipValue} />
              <Line type="monotone" dataKey={valueKey} stroke="#2563eb" strokeWidth={2} dot={false} connectNulls={false} />
            </LineChart>
          ) : response.chart_type === 'area' ? (
            <AreaChart data={response.chart_data} accessibilityLayer>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={xKey} {...axisProps} minTickGap={16} interval="preserveStartEnd" tickFormatter={compactLabel} />
              <YAxis {...axisProps} width={44} tickFormatter={compactAxisValue} />
              <Tooltip formatter={renderTooltipValue} />
              <Area type="monotone" dataKey={valueKey} stroke="#2563eb" fill="#93c5fd" />
            </AreaChart>
          ) : response.chart_type === 'pie' ? (
            <PieChart>
              <Pie data={response.chart_data} dataKey={valueKey} nameKey={xKey} outerRadius={90}>
                {response.chart_data.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={renderTooltipValue} />
              <Legend />
            </PieChart>
          ) : (
            <BarChart data={response.chart_data} accessibilityLayer>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={xKey} {...axisProps} minTickGap={16} interval="preserveStartEnd" tickFormatter={compactLabel} />
              <YAxis {...axisProps} width={44} tickFormatter={compactAxisValue} />
              <Tooltip formatter={renderTooltipValue} />
              <Bar dataKey={valueKey} fill="#2563eb" radius={[6, 6, 0, 0]} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>

      {response.metrics_summary?.length ? (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
          {response.metrics_summary.map((metric) => (
            <div key={metric.label} className="rounded-lg border bg-secondary px-3 py-2">
              <div dir="auto" className="text-[11px] text-muted-foreground"><bdi dir="auto">{metric.label}</bdi></div>
              <div dir="ltr" className="text-sm font-semibold text-foreground"><bdi dir="ltr">{metric.value}</bdi></div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
