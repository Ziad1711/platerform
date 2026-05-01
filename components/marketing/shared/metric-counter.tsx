'use client'

import { useEffect, useMemo, useState } from 'react'

type MetricCounterProps = {
  value: string
  label: string
}

function extractNumber(value: string) {
  const matched = value.match(/[\d.]+/)
  return matched ? Number(matched[0]) : null
}

export function MetricCounter({ value, label }: MetricCounterProps) {
  const numericValue = useMemo(() => extractNumber(value), [value])
  const [displayValue, setDisplayValue] = useState(numericValue ?? 0)

  useEffect(() => {
    if (numericValue === null) return
    let frame = 0
    const duration = 900
    const startedAt = performance.now()

    const tick = (now: number) => {
      const progress = Math.min((now - startedAt) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplayValue(Number((numericValue * eased).toFixed(numericValue % 1 ? 1 : 0)))
      if (progress < 1) frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [numericValue])

  const rendered = numericValue === null ? value : value.replace(/[\d.]+/, String(displayValue))

  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur-xl">
      <p className="font-mono text-2xl font-semibold text-jisra-green-light">{rendered}</p>
      <p className="mt-1 text-sm text-jisra-cream/58">{label}</p>
    </div>
  )
}