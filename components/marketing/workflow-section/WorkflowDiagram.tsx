'use client'

import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { nodes, branches } from './workflow-data'
import { WorkflowNode } from './WorkflowNode'
import WorkflowPaths from './WorkflowPaths'
import { reducedMotionVariants } from './workflow-variants'

const GRID_WIDTH = 1400
const GRID_HEIGHT = 600

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

  // Define the logical flow for mobile
  const mobileFlow = [
    nodes.find(n => n.id === 'provider'),
    nodes.find(n => n.id === 'jisra-receive'),
    branches.find(n => n.id === 'ads'),
    nodes.find(n => n.id === 'notif-push'),
    nodes.find(n => n.id === 'confirm'),
    branches.find(n => n.id === 'stock'),
    nodes.find(n => n.id === 'delivery'),
    nodes.find(n => n.id === 'delivered'),
    nodes.find(n => n.id === 'kpis'),
  ].filter(Boolean)

  return (
    <div
      className="relative mx-auto w-full max-w-7xl"
      role="img"
      aria-label="Schéma du workflow d'automatisation jisra"
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

      {/* --- MOBILE VIEW (< 1024px) --- */}
      <div className="flex flex-col items-center gap-12 py-10 lg:hidden">
        {mobileFlow.map((node, i) => (
          <div key={node!.id} className="relative flex flex-col items-center">
            {/* Simple vertical connector */}
            {i < mobileFlow.length - 1 && (
              <div className="absolute top-full h-12 w-px bg-gradient-to-b from-jisra-green/40 to-cyan-500/40 shadow-[0_0_8px_rgba(31,169,113,0.3)]" />
            )}
            
            <WorkflowNode
              node={node as any}
              index={i}
              isActive={activeNodes.has(node!.id)}
              isHovered={hoveredNode === node!.id}
              onHover={setHoveredNode}
              className="w-full max-w-[260px]"
            />
          </div>
        ))}
      </div>
    </div>
  )
}
