'use client'

import { useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Calculator, PackageCheck, Receipt, ShoppingCart, Truck } from 'lucide-react'
import { Container } from '@/components/marketing/shared/container'
import { MotionSection } from '@/components/marketing/shared/motion-section'
import { SectionHeading } from '@/components/marketing/shared/section-heading'
import { fadeUp, marketingEasing } from '@/lib/marketing/motion'
import { cn } from '@/lib/utils'

const steps = [
  {
    id: 'commande',
    label: 'Commande centralisée',
    summary: 'Une seule entrée pour vos boutiques et vos saisies.',
    icon: ShoppingCart,
  },
  {
    id: 'couts',
    label: 'Coûts associés',
    summary: 'Produit, publicité, livraison et confirmation.',
    icon: Receipt,
  },
  {
    id: 'livraison',
    label: 'Livraison rapprochée',
    summary: 'Les statuts transporteurs reliés à la commande.',
    icon: Truck,
  },
  {
    id: 'marge',
    label: 'Marge calculée',
    summary: 'Une lecture à partir de vos revenus et de vos coûts.',
    icon: Calculator,
  },
] as const

const costLines = [
  { label: 'Coût produit', amount: '240 MAD' },
  { label: 'Publicité', amount: '95 MAD' },
  { label: 'Livraison', amount: '45 MAD' },
  { label: 'Confirmation', amount: '10 MAD' },
]

const deliverySteps = [
  'Commande confirmée',
  'Colis créé',
  'Ramassé par le transporteur',
  'Livré au client',
]

function PanelHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-jisra-green/20 bg-jisra-green/10">
        <PackageCheck className="h-5 w-5 text-jisra-green" aria-hidden="true" />
      </div>
      <div>
        <h3 className="text-lg font-semibold text-jisra-cream">{title}</h3>
        <p className="mt-2 text-sm leading-7 text-jisra-cream/60">{description}</p>
      </div>
    </div>
  )
}

function JourneyPanel({ stepIndex }: { stepIndex: number }) {
  if (stepIndex === 0) {
    return (
      <div className="space-y-4">
        <PanelHeading
          title="La commande entre dans un flux unique"
          description="Depuis une boutique connectée ou une saisie manuelle, la commande rejoint le même espace que vos autres opérations."
        />
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            ['Source', 'Boutique connectée'],
            ['Articles', '2 références'],
            ['Statut', 'À confirmer'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-[10px] uppercase tracking-[0.18em] text-jisra-cream/38">{label}</p>
              <p className="mt-2 text-sm font-medium text-jisra-cream/85">{value}</p>
            </div>
          ))}
        </div>
        <p className="text-xs leading-5 text-jisra-cream/48">
          Les informations disponibles restent rattachées à la commande pour la suite du suivi.
        </p>
      </div>
    )
  }

  if (stepIndex === 1) {
    return (
      <div className="space-y-4">
        <PanelHeading
          title="Les coûts sont associés à la commande"
          description="Coût produit, publicité, livraison et confirmation sont enregistrés au même endroit pour éviter les lectures séparées."
        />
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          {costLines.map((line) => (
            <div key={line.label} className="flex items-center justify-between gap-4 py-2 text-sm">
              <span className="text-jisra-cream/60">{line.label}</span>
              <span className="font-mono text-jisra-cream/85">{line.amount}</span>
            </div>
          ))}
          <div className="mt-2 flex items-center justify-between gap-4 border-t border-white/10 pt-3 text-sm font-semibold">
            <span className="text-jisra-cream/75">Coûts enregistrés</span>
            <span className="font-mono text-jisra-cream">390 MAD</span>
          </div>
        </div>
        <p className="text-xs leading-5 text-jisra-cream/48">
          Chaque montant reste rattaché à la commande pour être retrouvé dans la lecture de la marge.
        </p>
      </div>
    )
  }

  if (stepIndex === 2) {
    return (
      <div className="space-y-4">
        <PanelHeading
          title="La livraison est rapprochée de la commande"
          description="Lorsque le transporteur transmet ses statuts, ils sont rapprochés de la commande. Un statut non reconnu reste à vérifier."
        />
        <ol className="relative ml-2 space-y-4 border-l border-white/10 pl-5">
          {deliverySteps.map((label, index) => (
            <li key={label} className="relative text-sm">
              <span
                className={cn(
                  'absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-[#111714]',
                  index === deliverySteps.length - 1
                    ? 'bg-jisra-green shadow-[0_0_12px_#1fa971]'
                    : 'bg-white/35'
                )}
                aria-hidden="true"
              />
              <span className={index === deliverySteps.length - 1 ? 'font-semibold text-jisra-green' : 'text-jisra-cream/70'}>
                {label}
              </span>
            </li>
          ))}
        </ol>
        <p className="text-xs leading-5 text-jisra-cream/48">
          Les étapes affichées dépendent des informations effectivement transmises par le transporteur.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PanelHeading
        title="La marge devient lisible"
        description="Le calcul reprend les revenus et les coûts enregistrés pour la commande, sans reconstruire les chiffres à la main."
      />
      <div className="rounded-2xl border border-jisra-green/20 bg-jisra-green/10 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-4 text-sm">
          <span className="text-jisra-cream/65">Revenu total</span>
          <span className="font-mono text-jisra-cream">590 MAD</span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-4 text-sm">
          <span className="text-jisra-cream/65">Coûts enregistrés</span>
          <span className="font-mono text-jisra-cream">− 390 MAD</span>
        </div>
        <div className="mt-3 flex items-center justify-between gap-4 border-t border-jisra-green/20 pt-3 text-base font-semibold">
          <span className="text-jisra-cream">Marge</span>
          <span className="font-mono text-jisra-green-light">200 MAD</span>
        </div>
      </div>
      <p className="text-xs leading-5 text-jisra-cream/48">
        Le revenu total considéré dans cette simulation est de 590 MAD, frais de livraison facturés au client inclus.
      </p>
      <p className="text-xs leading-5 text-jisra-cream/48">
        Exemple arithmétique construit à partir des montants fictifs ci-dessus : 590 − 390 = 200 MAD.
      </p>
    </div>
  )
}

export function OrderJourneySection() {
  const [activeStep, setActiveStep] = useState(0)
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const reduceMotion = useReducedMotion()
  const active = steps[activeStep]

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') nextIndex = (index + 1) % steps.length
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') nextIndex = (index - 1 + steps.length) % steps.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = steps.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    setActiveStep(nextIndex)
    tabRefs.current[nextIndex]?.focus()
  }

  return (
    <MotionSection id="parcours" className="py-20 sm:py-24" withStagger>
      <Container className="space-y-12">
        <SectionHeading
          eyebrow="Comment ça marche"
          title="Une commande. Tous ses coûts. Une lecture claire."
          description="Jisra relie les informations que vous enregistrez pour rendre chaque commande lisible, du premier statut jusqu’à sa marge."
        />

        <motion.div variants={fadeUp} className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
          <div
            role="tablist"
            aria-label="Étapes de lecture d’une commande"
            aria-orientation="vertical"
            className="grid gap-3"
          >
            {steps.map((step, index) => {
              const Icon = step.icon
              const isActive = index === activeStep

              return (
                <button
                  key={step.id}
                  ref={(element) => {
                    tabRefs.current[index] = element
                  }}
                  id={`journey-tab-${step.id}`}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls="journey-panel"
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => setActiveStep(index)}
                  onKeyDown={(event) => onTabKeyDown(event, index)}
                  className={cn(
                    'group flex min-h-[76px] w-full items-start gap-4 rounded-[22px] border p-4 text-left transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jisra-green/60 focus-visible:ring-offset-2 focus-visible:ring-offset-jisra-ink',
                    isActive
                      ? 'border-jisra-green/30 bg-jisra-green/10 shadow-[0_18px_50px_rgba(31,169,113,0.10)]'
                      : 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]'
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-colors duration-300',
                      isActive
                        ? 'border-jisra-green/30 bg-jisra-green/15 text-jisra-green-light'
                        : 'border-white/10 bg-white/[0.04] text-jisra-cream/60'
                    )}
                  >
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-jisra-cream">{step.label}</span>
                    <span className="mt-1 block text-xs leading-5 text-jisra-cream/52">{step.summary}</span>
                  </span>
                </button>
              )
            })}
          </div>

          <div className="marketing-panel marketing-noise overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4 sm:px-7">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-jisra-green-light">
                  Commande #DEMO-1042
                </p>
                <p className="mt-1 text-xs text-jisra-cream/45">Lecture produit · exemple</p>
              </div>
              <span className="rounded-full border border-jisra-green/20 bg-jisra-green/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-jisra-green-light">
                Valeurs fictives
              </span>
            </div>

            <div
              id="journey-panel"
              role="tabpanel"
              aria-labelledby={`journey-tab-${active.id}`}
              tabIndex={0}
              className="min-h-[310px] p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-jisra-green/60 sm:p-7"
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={active.id}
                  initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -8 }}
                  transition={reduceMotion ? { duration: 0 } : { duration: 0.28, ease: marketingEasing }}
                >
                  <JourneyPanel stepIndex={activeStep} />
                </motion.div>
              </AnimatePresence>
            </div>

            <p className="border-t border-white/10 px-5 py-4 text-xs leading-5 text-jisra-cream/50 sm:px-7">
              Démonstration illustrative : commande, montants et statuts fictifs, sans résultat client. La marge dépend des revenus et des coûts que vous enregistrez.
            </p>
          </div>
        </motion.div>
      </Container>
    </MotionSection>
  )
}
