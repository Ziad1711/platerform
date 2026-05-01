'use client'

import { motion, useReducedMotion } from 'framer-motion'
import { WorkflowDiagram } from './WorkflowDiagram'
import { fadeUp } from '@/lib/marketing/motion'

export function WorkflowSection() {
  const prefersReducedMotion = useReducedMotion()

  return (
    <section className="relative overflow-hidden py-20 sm:py-28">
      {/* Background gradient distinctif */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-jisra-ink via-jisra-ink/95 to-jisra-ink" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(31,169,113,0.12),transparent_60%)]" />

      {/* Grille subtile */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(243,239,230,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(243,239,230,0.1) 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }}
      />

      <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Titre */}
        <motion.div
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          className="mx-auto mb-12 max-w-3xl text-center sm:mb-16"
        >
          <div className="mb-4 inline-flex rounded-full border border-jisra-green/20 bg-jisra-green/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-jisra-green-light">
            Workflow Intelligent
          </div>
          <h2 className="text-3xl font-bold tracking-tight text-jisra-cream sm:text-4xl lg:text-5xl">
            Vos commandes, pilotées en automatique
          </h2>
          <p className="mt-4 text-base leading-8 text-jisra-cream/62 sm:text-lg">
            De la réception à la livraison, jisra orchestre chaque étape sans que vous leviez le
            petit doigt.
          </p>
        </motion.div>

        {/* Diagramme */}
        <motion.div
          initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
        >
          <WorkflowDiagram />
        </motion.div>
      </div>
    </section>
  )
}
