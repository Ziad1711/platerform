'use client'

import { motion } from 'framer-motion'
import { JisraMark } from '@/components/logo'
import { IntegrationLogo } from '@/components/marketing/integrations/integration-logo'

type FlowItem = {
  id: string
  name: string
  logoUrl: string | null
}

/** Nombre maximum de logos affichés autour du hub. */
const MAX_NODES = 12
/** Rayon du cercle de logos, en pourcentage du cadre. */
const RADIUS = 37
/** Amplitude du rapprochement vers le centre, en % de la taille d'une tuile. */
const TRAVEL = 55
const BASE_SECONDS = 4.4
/**
 * Décalages déterministes (pas de Math.random : le rendu serveur et le rendu
 * client doivent produire exactement la même animation) : l'ordre des
 * allers-retours est volontairement perturbé.
 */
const JITTER = [0.62, 0.05, 0.83, 0.31, 0.94, 0.18, 0.7, 0.42, 0.12, 0.88, 0.35, 0.58]

function jitterAt(index: number) {
  return JITTER[index % JITTER.length]
}

/**
 * Visuel du hero du catalogue : hub jisra central entouré de tous les logos.
 * Chaque logo se rapproche du centre puis s'en éloigne, avec un rythme propre
 * (ordre perturbé) et sans mouvement circulaire.
 */
export function IntegrationFlow({ items }: { items: FlowItem[] }) {
  const nodes = items.slice(0, MAX_NODES)
  const count = nodes.length || 1
  const step = 360 / count

  const positioned = nodes.map((node, index) => {
    const angle = ((index * step - 90) * Math.PI) / 180
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const jitter = jitterAt(index)

    return {
      node,
      x: 50 + RADIUS * cos,
      y: 50 + RADIUS * sin,
      // Le logo se déplace vers le centre (opposé au rayon) puis revient.
      moveX: `${(-cos * TRAVEL).toFixed(2)}%`,
      moveY: `${(-sin * TRAVEL).toFixed(2)}%`,
      delay: jitter * BASE_SECONDS,
      duration: BASE_SECONDS + jitter * 2.2,
      withTrail: index % 2 === 0,
    }
  })

  return (
    <div className="marketing-panel marketing-noise relative overflow-hidden p-5 sm:p-7">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(31,169,113,0.16),transparent_62%)]" />
      <div className="marketing-grid pointer-events-none absolute inset-0 opacity-30" />

      <div className="relative mx-auto aspect-square w-full max-w-[300px] sm:max-w-[380px] lg:max-w-[430px]">
        <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden="true">
          <defs>
            <radialGradient id="integration-flow-base" cx="50" cy="50" r="48" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#1fa971" stopOpacity="0.42" />
              <stop offset="72%" stopColor="#1fa971" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#1fa971" stopOpacity="0.03" />
            </radialGradient>
          </defs>

          {positioned.map((entry) => (
            <line
              key={`base-${entry.node.id}`}
              x1="50"
              y1="50"
              x2={entry.x}
              y2={entry.y}
              stroke="url(#integration-flow-base)"
              strokeWidth="0.4"
            />
          ))}

          {positioned
            .filter((entry) => entry.withTrail)
            .map((entry) => (
              <motion.line
                key={`trail-${entry.node.id}`}
                x1="50"
                y1="50"
                x2={entry.x}
                y2={entry.y}
                stroke="#2dd18f"
                strokeWidth="0.7"
                strokeLinecap="round"
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 0.55, 0] }}
                transition={{
                  duration: entry.duration * 0.5,
                  delay: entry.delay,
                  ease: 'easeInOut',
                  repeat: Infinity,
                  repeatDelay: entry.duration * 0.5,
                }}
              />
            ))}
        </svg>

        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <motion.div
            className="h-24 w-24 rounded-full bg-jisra-green/25 blur-2xl sm:h-28 sm:w-28"
            animate={{ opacity: [0.5, 0.85, 0.5] }}
            transition={{ duration: 5.5, ease: 'easeInOut', repeat: Infinity }}
          />
        </div>

        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="flex h-[68px] w-[68px] items-center justify-center rounded-[22px] border border-jisra-green/25 bg-jisra-ink/90 shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:h-[82px] sm:w-[82px]">
            <JisraMark size={34} ink="#f3efe6" accent="#1fa971" />
          </div>
        </div>

        {positioned.map((entry) => (
          <div
            key={entry.node.id}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${entry.x}%`, top: `${entry.y}%` }}
          >
            <motion.div
              animate={{
                x: ['0%', entry.moveX, '0%'],
                y: ['0%', entry.moveY, '0%'],
                scale: [1, 0.92, 1],
              }}
              transition={{
                duration: entry.duration,
                delay: entry.delay,
                ease: 'easeInOut',
                repeat: Infinity,
              }}
            >
              <div className="relative">
                <motion.span
                  className="pointer-events-none absolute -inset-1.5 rounded-[18px] border border-jisra-green/45 shadow-[0_0_24px_rgba(31,169,113,0.45)]"
                  initial={{ opacity: 0.08 }}
                  animate={{ opacity: [0.08, 0.7, 0.08] }}
                  transition={{
                    duration: entry.duration,
                    delay: entry.delay,
                    ease: 'easeInOut',
                    repeat: Infinity,
                  }}
                />
                <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl border border-white/12 bg-white shadow-[0_12px_30px_rgba(0,0,0,0.42)] sm:h-12 sm:w-12 lg:h-[52px] lg:w-[52px]">
                  <IntegrationLogo name={entry.node.name} logoUrl={entry.node.logoUrl} />
                </div>
              </div>
            </motion.div>
          </div>
        ))}
      </div>

      <div className="relative mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 border-t border-white/10 pt-4 text-[10px] font-semibold uppercase tracking-[0.22em] text-jisra-cream/45">
        <span>Boutiques</span>
        <span className="h-1 w-1 rounded-full bg-jisra-green/60" />
        <span>Livraison</span>
        <span className="h-1 w-1 rounded-full bg-jisra-green/60" />
        <span>Publicité</span>
        <span className="h-1 w-1 rounded-full bg-jisra-green/60" />
        <span>API</span>
      </div>
    </div>
  )
}
