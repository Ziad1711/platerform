'use client'

import { useMemo, useState } from 'react'
import { formatCurrency } from '@/lib/utils'

interface TimeSeriesPoint {
  date: string
  spend: number
  impressions: number
  clicks: number
  reach: number
  conversions: number
  conversionValue: number
  purchases: number
  ctr: number
  cpc: number
  cpm: number
}

interface AdsTimeSeriesProps {
  data: TimeSeriesPoint[]
  isLoading?: boolean
}

type SeriesKey = 'spend' | 'clicks' | 'ctr' | 'cpc'

const seriesConfig: Record<SeriesKey, { label: string; color: string; format: (v: number) => string }> = {
  spend: { label: 'Dépenses', color: '#2563eb', format: (v) => formatCurrency(v) },
  clicks: { label: 'Clics', color: '#16a34a', format: (v) => v.toLocaleString() },
  ctr: { label: 'CTR', color: '#9333ea', format: (v) => v.toFixed(2) + '%' },
  cpc: { label: 'CPC', color: '#ea580c', format: (v) => formatCurrency(v) },
}

function formatAxisValue(value: number) {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`
  if (value >= 1) return value.toFixed(0)
  return value.toFixed(2)
}

export default function AdsTimeSeries({ data, isLoading }: AdsTimeSeriesProps) {
  const [visibleSeries, setVisibleSeries] = useState<Record<SeriesKey, boolean>>({
    spend: true,
    clicks: false,
    ctr: false,
    cpc: false,
  })
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  const activeKeys = (Object.keys(visibleSeries) as SeriesKey[]).filter((k) => visibleSeries[k])

  const { yMin, yMax, yTicks } = useMemo(() => {
    if (data.length === 0) return { yMin: 0, yMax: 1, yTicks: [1, 0.75, 0.5, 0.25, 0] }

    const values = data.flatMap((p) =>
      activeKeys.map((k) => {
        if (k === 'spend') return p.spend
        if (k === 'clicks') return p.clicks
        if (k === 'ctr') return p.ctr
        return p.cpc
      })
    )

    const maxVal = Math.max(...values, 0)
    const max = maxVal === 0 ? 1 : maxVal * 1.1
    const ticks = Array.from({ length: 5 }, (_, i) => max - (i * max) / 4)
    return { yMin: 0, yMax: max, yTicks: ticks }
  }, [data, activeKeys])

  const valueToY = (value: number) => {
    if (yMax === yMin) return 50
    return 95 - ((value - yMin) / (yMax - yMin)) * 90
  }

  const buildPath = (key: SeriesKey) => {
    if (data.length === 0) return ''
    return data
      .map((point, index) => {
        const x = data.length === 1 ? 0 : (index / (data.length - 1)) * 100
        const raw = key === 'spend' ? point.spend : key === 'clicks' ? point.clicks : key === 'ctr' ? point.ctr : point.cpc
        const y = valueToY(raw)
        return `${index === 0 ? 'M' : 'L'} ${x} ${y}`
      })
      .join(' ')
  }

  const labelStep = data.length > 0 ? Math.max(1, Math.ceil(data.length / 8)) : 1
  const labelTicks = data.filter((_, index) => index % labelStep === 0 || index === data.length - 1)

  const toggleSeries = (key: SeriesKey) => {
    setVisibleSeries((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      const enabledCount = Object.values(next).filter(Boolean).length
      return enabledCount === 0 ? prev : next
    })
  }

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="h-56 flex items-center justify-center text-gray-400">Chargement...</div>
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="h-56 flex items-center justify-center text-gray-400">Pas de données pour cette période</div>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Évolution des métriques</h2>
        <div className="flex gap-2">
          {(Object.keys(seriesConfig) as SeriesKey[]).map((key) => (
            <button
              key={key}
              onClick={() => toggleSeries(key)}
              className={`px-2 py-1 text-xs rounded border transition-colors ${
                visibleSeries[key]
                  ? 'bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300'
                  : 'text-gray-400 border-gray-200 dark:border-gray-700'
              }`}
            >
              <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ backgroundColor: seriesConfig[key].color }} />
              {seriesConfig[key].label}
            </button>
          ))}
        </div>
      </div>

      <div className="h-56 w-full border border-gray-200 dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-800 overflow-hidden">
        <div className="relative w-full h-full pl-10">
          <div className="absolute left-0 top-0 bottom-0 w-9 flex flex-col justify-between text-[10px] text-gray-400">
            {yTicks.map((tick, idx) => (
              <span key={idx}>{formatAxisValue(tick)}</span>
            ))}
          </div>

          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full overflow-visible">
            {yTicks.map((tick, idx) => (
              <line
                key={idx}
                x1="0"
                y1={valueToY(tick)}
                x2="100"
                y2={valueToY(tick)}
                stroke="var(--border)"
                strokeWidth="0.4"
              />
            ))}

            {(Object.keys(seriesConfig) as SeriesKey[]).map((key) =>
              visibleSeries[key] ? (
                <path
                  key={key}
                  d={buildPath(key)}
                  fill="none"
                  stroke={seriesConfig[key].color}
                  strokeWidth="1.4"
                  vectorEffect="non-scaling-stroke"
                />
              ) : null
            )}

            {hoveredIndex !== null && data[hoveredIndex] && (
              <line
                x1={data.length === 1 ? 0 : (hoveredIndex / (data.length - 1)) * 100}
                x2={data.length === 1 ? 0 : (hoveredIndex / (data.length - 1)) * 100}
                y1="0"
                y2="100"
                stroke="var(--muted-foreground)"
                strokeDasharray="2 2"
                strokeWidth="0.5"
              />
            )}
          </svg>

          {data.length > 1 && (
            <div className="absolute inset-0 flex">
              {data.map((_, index) => (
                <div
                  key={index}
                  className="flex-1 h-full"
                  onMouseEnter={() => setHoveredIndex(index)}
                  onMouseLeave={() => setHoveredIndex(null)}
                />
              ))}
            </div>
          )}

          {hoveredIndex !== null && data[hoveredIndex] && (
            <div
              className="absolute top-2 z-20 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs rounded px-3 py-2 shadow-lg pointer-events-none border border-gray-700 dark:border-gray-300"
              style={{
                left: `${data.length === 1 ? 0 : (hoveredIndex / (data.length - 1)) * 100}%`,
                transform: 'translateX(-50%)',
              }}
            >
              <div className="font-semibold mb-1">{data[hoveredIndex].date}</div>
              <div>Dépenses: {formatCurrency(data[hoveredIndex].spend)}</div>
              <div>Clics: {data[hoveredIndex].clicks.toLocaleString()}</div>
              <div>CTR: {(data[hoveredIndex].ctr).toFixed(2)}%</div>
              <div>CPC: {formatCurrency(data[hoveredIndex].cpc)}</div>
              <div>Impressions: {data[hoveredIndex].impressions.toLocaleString()}</div>
              <div>Conversions: {data[hoveredIndex].purchases}</div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-2 flex justify-between text-xs text-gray-400 gap-2">
        {labelTicks.map((p, i) => (
          <span key={`${p.date}-${i}`} className="text-center">{p.date}</span>
        ))}
      </div>
    </div>
  )
}
