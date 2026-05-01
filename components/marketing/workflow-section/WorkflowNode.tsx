'use client'

import Image from 'next/image'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { nodeReveal } from './workflow-variants'
import type { WorkflowNode as WorkflowNodeType } from './workflow-data'

type WorkflowNodeProps = {
  node: WorkflowNodeType
  index: number
  isActive?: boolean
  isHovered?: boolean
  onHover?: (id: string | null) => void
  className?: string
}

export function WorkflowNode({
  node,
  index,
  isActive = false,
  isHovered = false,
  onHover,
  className,
}: WorkflowNodeProps) {
  const Icon = node.logo

  return (
    <motion.div
      role="figure"
      aria-label={`${node.title}: ${node.description}`}
      variants={nodeReveal}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '-50px' }}
      whileHover={{ 
        scale: 1.03, 
        y: -5,
        transition: { duration: 0.2 }
      }}
      onMouseEnter={() => onHover?.(node.id)}
      onMouseLeave={() => onHover?.(null)}
      animate={node.glow ? {
        boxShadow: [
          "0 0 20px rgba(31, 169, 113, 0.1)",
          "0 0 35px rgba(31, 169, 113, 0.4)",
          "0 0 20px rgba(31, 169, 113, 0.1)",
        ]
      } : {}}
      transition={node.glow ? { 
        boxShadow: {
          duration: 3,
          repeat: Infinity,
          ease: "easeInOut"
        }
      } : {}}
      style={{
        willChange: 'transform, opacity',
      }}
      className={cn(
        'group relative flex w-full max-w-[260px] flex-col items-center gap-3 rounded-2xl p-4 transition-all duration-300 lg:w-[170px]',
        'bg-white/[0.03] backdrop-blur-md',
        'border border-white/10 shadow-lg',
        isHovered && 'border-jisra-green/40 bg-white/[0.06] shadow-jisra-green/10',
        isActive && 'border-jisra-green/50',
        className,
      )}
    >
      {/* 1px Gradient Border Overlay (Simulated) */}
      <div className={cn(
        "absolute inset-0 rounded-2xl border border-transparent [background:linear-gradient(to_bottom,rgba(255,255,255,0.15),transparent)_border-box] pointer-events-none",
        isHovered && "[background:linear-gradient(to_bottom,rgba(31,169,113,0.3),transparent)_border-box]"
      )} />

      <div className={cn(
        "flex h-12 w-12 items-center justify-center rounded-xl transition-all duration-300",
        "bg-gradient-to-br from-white/10 to-white/5 ring-1 ring-white/10",
        "group-hover:scale-110 group-hover:ring-jisra-green/30 group-hover:bg-jisra-green/5",
        node.glow && "ring-jisra-green/50 bg-jisra-green/10"
      )}>
        {typeof Icon === 'string' ? (
          <Image
            src={Icon}
            alt=""
            width={28}
            height={28}
            className="h-7 w-7 object-contain brightness-110"
            aria-hidden="true"
          />
        ) : (
          <Icon className={cn(
            "h-6 w-6 transition-colors duration-300",
            node.glow ? "text-jisra-green" : "text-jisra-cream/80",
            "group-hover:text-jisra-green"
          )} aria-hidden="true" />
        )}
      </div>

      <div className="flex flex-col items-center text-center">
        <h3 className="text-[13px] font-bold tracking-tight text-jisra-cream">{node.title}</h3>
        <p className="mt-0.5 line-clamp-1 text-[11px] text-jisra-cream/50">{node.description}</p>
      </div>

      {isHovered && node.tooltip && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.2 }}
          className="absolute -bottom-2 left-1/2 z-50 w-max max-w-48 -translate-x-1/2 translate-y-full rounded-lg bg-jisra-ink-light/95 backdrop-blur-md px-3 py-1.5 text-xs text-jisra-cream/80 shadow-2xl border border-white/5"
          role="tooltip"
        >
          {node.tooltip}
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 border-4 border-transparent border-b-jisra-ink-light" />
        </motion.div>
      )}
    </motion.div>
  )
}
