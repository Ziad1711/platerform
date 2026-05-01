'use client'

import { motion } from 'framer-motion'
import { connectionDraw } from './workflow-variants'

type WorkflowConnectionProps = {
  from: { x: number; y: number }
  to: { x: number; y: number }
  label?: string
  isVisible?: boolean
  delay?: number
  className?: string
  gridSize?: { width: number; height: number }
}

function buildPath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const cx1 = from.x + dx * 0.4
  const cy1 = from.y + dy * 0.1
  const cx2 = from.x + dx * 0.6
  const cy2 = from.y + dy * 0.9
  return `M ${from.x} ${from.y} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${to.x} ${to.y}`
}

function midpoint(
  from: { x: number; y: number },
  to: { x: number; y: number },
): { x: number; y: number } {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const cx1 = from.x + dx * 0.4
  const cy1 = from.y + dy * 0.1
  const cx2 = from.x + dx * 0.6
  const cy2 = from.y + dy * 0.9
  const t = 0.5
  const mt = 1 - t
  return {
    x:
      mt * mt * mt * from.x +
      3 * mt * mt * t * cx1 +
      3 * mt * t * t * cx2 +
      t * t * t * to.x,
    y:
      mt * mt * mt * from.y +
      3 * mt * mt * t * cy1 +
      3 * mt * t * t * cy2 +
      t * t * t * to.y,
  }
}

export function WorkflowConnection({
  from,
  to,
  label,
  isVisible = true,
  delay = 0,
  className,
  gridSize = { width: 1400, height: 600 }
}: WorkflowConnectionProps) {
  const path = buildPath(from, to)
  const mid = midpoint(from, to)
  const gradientId = `conn-grad-${from.x}-${from.y}-${to.x}-${to.y}`

  return (
    <svg
      className={className}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        overflow: 'visible',
      }}
      viewBox={`0 0 ${gridSize.width} ${gridSize.height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="rgba(31, 169, 113, 0.05)" />
          <stop offset="50%" stopColor="rgba(31, 169, 113, 0.3)" />
          <stop offset="100%" stopColor="rgba(31, 169, 113, 0.05)" />
        </linearGradient>
      </defs>

      <motion.path
        d={path}
        stroke="rgba(31, 169, 113, 0.04)"
        strokeWidth={12}
        fill="none"
        strokeLinecap="round"
        initial={{ opacity: 0 }}
        animate={isVisible ? { opacity: 1 } : { opacity: 0 }}
        transition={{ duration: 0.8, delay }}
      />

      <motion.path
        d={path}
        stroke={`url(#${gradientId})`}
        strokeWidth={2}
        fill="none"
        strokeLinecap="round"
        variants={connectionDraw}
        initial="hidden"
        animate={isVisible ? 'visible' : 'hidden'}
        transition={{ delay: delay + 0.2 }}
      />

      {isVisible && (
        <motion.circle
          r={2.5}
          fill="#2dd18f"
          style={{ offsetPath: `path("${path}")` }}
          initial={{ offsetDistance: '0%' }}
          animate={{ offsetDistance: ['0%', '100%'] }}
          transition={{
            duration: 4,
            repeat: Infinity,
            ease: 'linear',
            delay,
          }}
        />
      )}

      {label && (
        <foreignObject
          x={mid.x - 40}
          y={mid.y - 12}
          width={80}
          height={24}
          style={{ overflow: 'visible' }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.8, y: 5 }}
            animate={isVisible ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.8, y: 5 }}
            transition={{ duration: 0.4, delay: delay + 0.8 }}
            className="flex items-center justify-center"
          >
            <span className="whitespace-nowrap rounded-full bg-jisra-ink/90 border border-white/5 px-2.5 py-1 text-[9px] font-medium tracking-wide text-jisra-cream/40 backdrop-blur-md">
              {label.toUpperCase()}
            </span>
          </motion.div>
        </foreignObject>
      )}
    </svg>
  )
}
