'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { BrainCircuit, Sparkles, TrendingUp, AlertTriangle, Lightbulb, User } from 'lucide-react'
import { Container } from '@/components/marketing/shared/container'
import { fadeUp } from '@/lib/marketing/motion'

const chatScenarios = [
  {
    user: "Analyse ma rentabilité sur Casablanca cette semaine.",
    ai: {
      icon: TrendingUp,
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/10',
      title: 'Performance Casablanca',
      text: "Le profit net est en hausse de 14%. Cependant, 32% de vos frais de livraison sont dus à des tentatives échouées. Je suggère d'activer la confirmation automatique par SMS pour ces zones.",
    }
  },
  {
    user: "Pourquoi mon ROAS chute sur la campagne Meta ?",
    ai: {
      icon: AlertTriangle,
      color: 'text-amber-400',
      bg: 'bg-amber-500/10',
      title: 'Alerte Efficacité Pub',
      text: "Votre coût par clic a bondi de 45% sur l'audience 'Lookalike'. Cause probable : saturation de l'audience. Testez un nouveau créatif ou élargissez le ciblage pour stabiliser la marge.",
    }
  },
  {
    user: "Quel est mon niveau de stock critique ?",
    ai: {
      icon: Lightbulb,
      color: 'text-cyan-400',
      bg: 'bg-cyan-500/10',
      title: 'Gestion des Stocks',
      text: "Le produit 'Sérum Éclat' sera en rupture sous 4 jours au rythme actuel. Vos revenus potentiels perdus s'élèvent à 12 500 MAD si vous ne réapprovisionnez pas demain.",
    }
  }
]

export function AiFeatureSection() {
  const [scenarioIndex, setScenarioIndex] = useState(0)
  const [step, setStep] = useState<'user' | 'typing' | 'ai'>('user')

  useEffect(() => {
    let timer: NodeJS.Timeout

    if (step === 'user') {
      timer = setTimeout(() => setStep('typing'), 2000)
    } else if (step === 'typing') {
      timer = setTimeout(() => setStep('ai'), 1500)
    } else if (step === 'ai') {
      timer = setTimeout(() => {
        setStep('user')
        setScenarioIndex((prev) => (prev + 1) % chatScenarios.length)
      }, 5000)
    }

    return () => clearTimeout(timer)
  }, [step])

  const current = chatScenarios[scenarioIndex]

  return (
    <section id="ai" className="relative overflow-hidden py-20 sm:py-28">
      <div className="absolute left-1/2 top-1/2 -z-10 h-[600px] w-[800px] -translate-x-1/2 -translate-y-1/2 bg-jisra-green/5 blur-[120px]" />
      
      <Container>
        <div className="grid gap-16 lg:grid-cols-[1fr_0.8fr] lg:items-center">
          {/* Visual Side: Animated Chat Simulation */}
          <motion.div 
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="relative order-2 lg:order-1"
          >
            <div className="marketing-panel marketing-noise relative flex min-h-[420px] flex-col gap-6 p-6 sm:p-8">
              {/* Header */}
              <div className="flex items-center gap-3 border-b border-white/10 pb-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-jisra-green/20 ring-1 ring-jisra-green/30">
                  <BrainCircuit className="h-6 w-6 text-jisra-green" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-jisra-cream">jisra AI Assistant</h4>
                  <p className="text-[10px] uppercase tracking-widest text-jisra-green-light">Live Analysis</p>
                </div>
              </div>

              {/* Chat Area */}
              <div className="flex-1 space-y-6">
                <AnimatePresence mode="wait">
                  {/* User Message */}
                  {(step === 'user' || step === 'typing' || step === 'ai') && (
                    <motion.div
                      key={`user-${scenarioIndex}`}
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="flex justify-end"
                    >
                      <div className="max-w-[80%] rounded-2xl rounded-tr-none bg-white/5 px-4 py-2.5 border border-white/10">
                        <p className="text-sm text-jisra-cream/80">{current.user}</p>
                      </div>
                    </motion.div>
                  )}

                  {/* Typing Indicator */}
                  {step === 'typing' && (
                    <motion.div
                      key="typing"
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="flex gap-3"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-jisra-green/10">
                        <BrainCircuit className="h-4 w-4 text-jisra-green" />
                      </div>
                      <div className="flex items-center gap-1 rounded-2xl bg-white/5 px-4 py-3 border border-white/5">
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-jisra-green/40" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-jisra-green/40 [animation-delay:0.2s]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-jisra-green/40 [animation-delay:0.4s]" />
                      </div>
                    </motion.div>
                  )}

                  {/* AI Message */}
                  {step === 'ai' && (
                    <motion.div
                      key={`ai-${scenarioIndex}`}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex gap-4"
                    >
                      <div className={`mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-jisra-green/10 ring-1 ring-jisra-green/20`}>
                        <current.ai.icon className={`h-5 w-5 ${current.ai.color}`} />
                      </div>
                      <div className="space-y-2 rounded-2xl rounded-tl-none bg-jisra-green/5 p-4 border border-jisra-green/10 shadow-[0_0_20px_rgba(31,169,113,0.05)]">
                        <p className="text-xs font-bold uppercase tracking-wider text-jisra-green-light">{current.ai.title}</p>
                        <p className="text-sm leading-relaxed text-jisra-cream/90 italic">
                          "{current.ai.text}"
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Bottom Decoration */}
              <div className="mt-4 flex items-center justify-between rounded-xl border border-white/10 bg-black/20 p-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-jisra-green" />
                  <span className="text-xs text-jisra-cream/30">Analyse du business en cours...</span>
                </div>
                <div className="h-1 w-24 overflow-hidden rounded-full bg-white/5">
                  <motion.div 
                    animate={{ x: [-100, 100] }}
                    transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                    className="h-full w-1/2 bg-jisra-green/40"
                  />
                </div>
              </div>
            </div>

            <div className="absolute -inset-4 -z-10 rounded-[2.5rem] bg-jisra-green/10 blur-2xl" />
          </motion.div>

          {/* Text Side */}
          <div className="order-1 space-y-8 lg:order-2">
            <motion.div
              variants={fadeUp}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              className="space-y-4"
            >
              <div className="inline-flex items-center gap-2 rounded-full border border-jisra-green/20 bg-jisra-green/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-jisra-green-light">
                <Sparkles className="h-3.5 w-3.5" />
                jisra AI engine
              </div>
              <h2 className="text-3xl font-bold tracking-tight text-jisra-cream sm:text-4xl lg:text-5xl">
                Un cerveau au-dessus de vos données.
              </h2>
              <p className="text-lg leading-8 text-jisra-cream/65">
                L'IA de jisra ne se contente pas d'afficher des chiffres. Elle les comprend. Connectée à vos ventes, vos pubs et vos stocks, elle détecte les opportunités et vous prévient avant que les problèmes n'impactent votre profit.
              </p>
            </motion.div>

            <motion.ul 
              variants={fadeUp}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              className="grid gap-4 sm:grid-cols-2"
            >
              {[
                'Analyse multi-dimensionnelle',
                'Alertes de marge en temps réel',
                'Conseils d\'optimisation pub',
                'Prévision de rupture de stock'
              ].map((item) => (
                <li key={item} className="flex items-center gap-3 text-sm text-jisra-cream/80">
                  <div className="h-1.5 w-1.5 rounded-full bg-jisra-green shadow-[0_0_8px_#1fa971]" />
                  {item}
                </li>
              ))}
            </motion.ul>
          </div>
        </div>
      </Container>
    </section>
  )
}
