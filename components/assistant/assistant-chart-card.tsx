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

function getXAxisKey(data: Array<Record<string, string | number>>) {
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
function getPrimaryValueKey(data: Array<Record<string, string | number>>) {
  const first = data[0] || {}
  if (typeof first.value === 'number') return 'value'
  return Object.keys(first).find((k) => typeof first[k] === 'number') ?? null
}

/** Infobulle : libellé exact fourni par le serveur, jamais un arrondi local. */
function renderTooltipValue(entry: { valueLabel?: unknown; value?: unknown; currency?: unknown }): string {
  if (typeof entry.valueLabel === 'string' && entry.valueLabel) return entry.valueLabel
  if (typeof entry.value === 'number' && Number.isFinite(entry.value)) {
    return typeof entry.currency === 'string' ? `${entry.value} ${entry.currency}` : String(entry.value)
  }
  return '—'
}

export default function AssistantChartCard({ response }: { response: AssistantStructuredResponse }) {
  if (!response.chart || !response.chart_data?.length) {
    return null
  }

  const xKey = getXAxisKey(response.chart_data)
  const valueKey = getPrimaryValueKey(response.chart_data)

  // Pas de graphique sans clé de valeur exploitable : un axe vide n'est pas un résultat.
  if (!valueKey) return null


  return (
    <div className="mt-3 rounded-xl border bg-card p-3">
      {response.chart_title ? <h4 className="text-sm font-semibold text-foreground">{response.chart_title}</h4> : null}
      {response.chart_description ? <p className="text-xs text-muted-foreground mt-1">{response.chart_description}</p> : null}

      <div className="h-64 mt-3">
        <ResponsiveContainer width="100%" height="100%">
          {response.chart_type === 'line' ? (
            <LineChart data={response.chart_data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={xKey} />
              <YAxis />
              <Tooltip formatter={(entry: unknown) => renderTooltipValue((entry ?? {}) as { valueLabel?: unknown; value?: unknown; currency?: unknown })} />
              <Line type="monotone" dataKey={valueKey} stroke="#2563eb" strokeWidth={2} dot={false} />
            </LineChart>
          ) : response.chart_type === 'area' ? (
            <AreaChart data={response.chart_data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={xKey} />
              <YAxis />
              <Tooltip formatter={(entry: unknown) => renderTooltipValue((entry ?? {}) as { valueLabel?: unknown; value?: unknown; currency?: unknown })} />
              <Area type="monotone" dataKey={valueKey} stroke="#2563eb" fill="#93c5fd" />
            </AreaChart>
          ) : response.chart_type === 'pie' ? (
            <PieChart>
              <Pie data={response.chart_data} dataKey={valueKey} nameKey={xKey} outerRadius={90}>
                {response.chart_data.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(entry: unknown) => renderTooltipValue((entry ?? {}) as { valueLabel?: unknown; value?: unknown; currency?: unknown })} />
              <Legend />
            </PieChart>
          ) : (
            <BarChart data={response.chart_data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={xKey} />
              <YAxis />
              <Tooltip formatter={(entry: unknown) => renderTooltipValue((entry ?? {}) as { valueLabel?: unknown; value?: unknown; currency?: unknown })} />
              <Bar dataKey={valueKey} fill="#2563eb" radius={[6, 6, 0, 0]} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>

      {response.metrics_summary?.length ? (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
          {response.metrics_summary.map((metric) => (
            <div key={metric.label} className="rounded-lg border bg-secondary px-3 py-2">
              <div className="text-[11px] text-muted-foreground">{metric.label}</div>
              <div className="text-sm font-semibold text-foreground">{metric.value}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
