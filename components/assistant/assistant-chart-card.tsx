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
  return Object.keys(first).find((k) => typeof first[k] === 'string') || 'name'
}

function getPrimaryValueKey(data: Array<Record<string, string | number>>) {
  const first = data[0] || {}
  return Object.keys(first).find((k) => typeof first[k] === 'number') || 'value'
}

export default function AssistantChartCard({ response }: { response: AssistantStructuredResponse }) {
  if (!response.chart || !response.chart_data?.length) {
    return null
  }

  const xKey = getXAxisKey(response.chart_data)
  const valueKey = getPrimaryValueKey(response.chart_data)

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
              <Tooltip />
              <Line type="monotone" dataKey={valueKey} stroke="#2563eb" strokeWidth={2} dot={false} />
            </LineChart>
          ) : response.chart_type === 'area' ? (
            <AreaChart data={response.chart_data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={xKey} />
              <YAxis />
              <Tooltip />
              <Area type="monotone" dataKey={valueKey} stroke="#2563eb" fill="#93c5fd" />
            </AreaChart>
          ) : response.chart_type === 'pie' ? (
            <PieChart>
              <Pie data={response.chart_data} dataKey={valueKey} nameKey={xKey} outerRadius={90}>
                {response.chart_data.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          ) : (
            <BarChart data={response.chart_data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={xKey} />
              <YAxis />
              <Tooltip />
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
