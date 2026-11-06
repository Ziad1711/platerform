'use client'

import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowDown } from 'lucide-react'
import { nodes, branches, type WorkflowNode as WorkflowNodeType } from './workflow-data'
import { WorkflowNode } from './WorkflowNode'
import WorkflowPaths from './WorkflowPaths'
import { reducedMotionVariants } from './workflow-variants'

const GRID_WIDTH = 1400
const GRID_HEIGHT = 600

const MOBILE_FLOW_IDS = ['provider', 'jisra-receive', 'ads', 'notif-push', 'confirm', 'delivery', 'stock', 'delivered', 'kpis']

const mobileFlow: WorkflowNodeType[] = MOBILE_FLOW_IDS.flatMap((id) => {
  const node = nodes.find((item) => item.id === id)
  if (node) return [node]
  const branch = branches.find((item) => item.id === id)
  if (!branch) return []
  return [
    {
      id: branch.id,
      title: branch.title,
      description: branch.description,
      logo: branch.logo,
      position: branch.position,
      type: 'integration' as const,
      tooltip: branch.tooltip,
    },
  ]
})

export function WorkflowDiagram() {
  const prefersReducedMotion = useReducedMotion()
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const [activeNodes, setActiveNodes] = useState<Set<string>>(new Set())

  const variants = prefersReducedMotion ? reducedMotionVariants : undefined

  const handleNodeInView = (id: string) => {
    setActiveNodes((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }

  // Define the logical flow for mobile (module-level `mobileFlow`)

  return (
    <div
      className="relative mx-auto w-full max-w-7xl"
      role="img"
      aria-label="Schéma du parcours de commande jisra"
    >
      {/* --- DESKTOP VIEW (>= 1024px) --- */}
      <div 
        className="hidden lg:relative lg:block lg:w-full lg:overflow-visible" 
        style={{ paddingBottom: '42.85%' }} // 600 / 1400 = 0.4285
      >
        {/* Calque Arrière-plan : Chemins SVG et Particules */}
        {!prefersReducedMotion && (
          <div className="absolute inset-0 z-0">
            <WorkflowPaths />
          </div>
        )}

        {/* Nœuds principaux */}
        {nodes.map((node, i) => (
          <motion.div
            key={node.id}
            variants={variants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: '-50px' }}
            onViewportEnter={() => handleNodeInView(node.id)}
            className="absolute z-10"
            style={{
              left: `${(node.position.x / GRID_WIDTH) * 100}%`,
              top: `${(node.position.y / GRID_HEIGHT) * 100}%`,
              transform: 'translate(-50%, -50%)',
            }}
          >
            <WorkflowNode
              node={node}
              index={i}
              isActive={activeNodes.has(node.id)}
              isHovered={hoveredNode === node.id}
              onHover={setHoveredNode}
            />
          </motion.div>
        ))}

        {/* Branches parallèles (Ads, Stock) */}
        {branches.map((branch, i) => (
          <motion.div
            key={branch.id}
            variants={variants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: '-50px' }}
            onViewportEnter={() => handleNodeInView(branch.id)}
            className="absolute z-10"
            style={{
              left: `${(branch.position.x / GRID_WIDTH) * 100}%`,
              top: `${(branch.position.y / GRID_HEIGHT) * 100}%`,
              transform: 'translate(-50%, -50%)',
            }}
          >
            <WorkflowNode
              node={{
                id: branch.id,
                title: branch.title,
                description: branch.description,
                logo: branch.logo,
                position: branch.position,
                type: 'integration',
                tooltip: branch.tooltip,
              }}
              index={nodes.length + i}
              isActive={activeNodes.has(branch.connectsTo)}
              isHovered={hoveredNode === branch.id}
              onHover={setHoveredNode}
            />
          </motion.div>
        ))}
      </div>

      {/* --- MOBILE / TABLET VIEW (< 1024px) --- */}
      <div className="relative flex flex-col items-center px-4 py-8 lg:hidden">
        <div className="pointer-events-none absolute inset-y-6 left-1/2 -z-10 w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-white/10 to-transparent" />

        {mobileFlow.map((node, i) => (
          <div key={node.id} className="flex w-full flex-col items-center">
            <WorkflowNode
              node={node}
              index={i}
              isActive={activeNodes.has(node.id)}
              isHovered={hoveredNode === node.id}
              onHover={setHoveredNode}
              className="w-full max-w-[300px]"
            />

            {i < mobileFlow.length - 1 && (
              <div className="relative flex h-10 w-full items-center justify-center">
                <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 overflow-hidden bg-white/10">
                  <motion.div
                    className="h-full w-full bg-gradient-to-b from-jisra-green/80 via-jisra-green/50 to-cyan-400/70"
                    initial={prefersReducedMotion ? false : { scaleY: 0 }}
                    whileInView={prefersReducedMotion ? undefined : { scaleY: 1 }}
                    viewport={{ once: true, margin: '-20% 0px -20% 0px' }}
                    transition={{ duration: 0.45, ease: 'easeOut' }}
                    style={{ transformOrigin: 'top' }}
                  />
                </div>
                <motion.span
                  initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.85 }}
                  whileInView={prefersReducedMotion ? undefined : { opacity: 1, scale: 1 }}
                  viewport={{ once: true, margin: '-20% 0px -20% 0px' }}
                  transition={{ delay: 0.12, duration: 0.28, ease: 'easeOut' }}
                  className="relative z-10 flex h-6 w-6 items-center justify-center rounded-full border border-jisra-green/30 bg-jisra-ink/90 text-jisra-green-light shadow-[0_0_14px_rgba(31,169,113,0.25)]"
                >
                  <ArrowDown className="h-3 w-3" aria-hidden="true" />
                </motion.span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

