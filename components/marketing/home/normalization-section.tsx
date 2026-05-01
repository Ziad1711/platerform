'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { MapPin, CheckCircle2, Cpu, Database, Sparkles } from 'lucide-react'
import NextImage from 'next/image'
import { Container } from '@/components/marketing/shared/container'
import { fadeUp } from '@/lib/marketing/motion'

const normalizationSteps = [
  { raw: "casa", clean: "Casablanca", region: "Grand Casablanca" },
  { raw: "rabat center", clean: "Rabat", region: "Rabat-Salé-Kénitra" },
  { raw: "kech", clean: "Marrakech", region: "Marrakech-Safi" },
  { raw: "tanjah", clean: "Tanger", region: "Tanger-Tétouan-Al Hoceïma" },
  { raw: "agadir i", clean: "Agadir", region: "Souss-Massa" },
]

export function NormalizationSection() {
  const [index, setScenarioIndex] = useState(0)
  const [isProcessing, setIsProcessing] = useState(false)

  useEffect(() => {
    const timer = setInterval(() => {
      setIsProcessing(true)
      setTimeout(() => {
        setIsProcessing(false)
        setScenarioIndex((prev) => (prev + 1) % normalizationSteps.length)
      }, 1500)
    }, 4000)
    return () => clearInterval(timer)
  }, [])

  const current = normalizationSteps[index]

  return (
    <section id="normalization" className="relative overflow-hidden py-20 sm:py-28 bg-jisra-ink/20">
      <div className="absolute right-0 top-1/2 -z-10 h-[500px] w-[500px] -translate-y-1/2 bg-jisra-green/5 blur-[100px]" />
      
      <Container>
        <div className="grid gap-16 lg:grid-cols-[1fr_1fr] lg:items-center">
          <div className="space-y-8">
            <motion.div
              variants={fadeUp}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              className="space-y-4"
            >
              <div className="inline-flex items-center gap-2 rounded-full border border-jisra-green/20 bg-jisra-green/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-jisra-green-light">
                <Cpu className="h-3.5 w-3.5" />
                Data Quality par IA
              </div>
              <h2 className="text-3xl font-bold tracking-tight text-jisra-cream sm:text-4xl lg:text-5xl">
                Des villes propres, des livraisons réussies.
              </h2>
              <p className="text-lg leading-8 text-jisra-cream/65">
                Ne perdez plus de temps à corriger manuellement les adresses. Notre IA reconnaît instantanément les abréviations, fautes de frappe et noms de quartiers pour normaliser chaque commande vers la ville exacte attendue par les transporteurs.
              </p>
            </motion.div>

            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-jisra-green">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="font-semibold text-jisra-cream">Zéro erreur d'import</span>
                </div>
                <p className="text-sm text-jisra-cream/50">Importation fluide chez Rapid Delivery et autres transporteurs sans rejet.</p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-jisra-green">
                  <Database className="h-5 w-5" />
                  <span className="font-semibold text-jisra-cream">Analyses fiables</span>
                </div>
                <p className="text-sm text-jisra-cream/50">Vos KPIs par ville sont enfin précis car "Casa", "Casablanca" et "Dar Beida" sont consolidés.</p>
              </div>
            </div>
          </div>

          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="relative"
          >
            <div className="marketing-panel marketing-noise flex min-h-[380px] flex-col overflow-hidden p-0">
              <div className="flex items-center justify-between border-b border-white/10 bg-black/20 px-6 py-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-jisra-green animate-pulse" />
                  <span className="text-xs font-mono text-jisra-green-light tracking-widest uppercase italic">IA Normalisation active</span>
                </div>
                <div className="text-[10px] text-jisra-cream/30 uppercase font-bold tracking-tighter">Engine V3.2</div>
              </div>

              <div className="flex flex-1 items-center justify-center p-8">
                <div className="relative flex w-full flex-col items-center gap-12 sm:flex-row sm:justify-between">
                  <div className="relative z-10 flex flex-col items-center gap-3">
                    <div className="text-[10px] uppercase tracking-widest text-jisra-cream/30">Donnée brute (Client)</div>
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={current.raw}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 10 }}
                        className="rounded-xl border border-white/10 bg-white/5 px-6 py-4 shadow-xl"
                      >
                        <span className="text-2xl font-mono text-jisra-cream/60 line-through decoration-red-500/50">{current.raw}</span>
                      </motion.div>
                    </AnimatePresence>
                  </div>

                  <div className="relative flex h-16 w-16 items-center justify-center">
                    <motion.div 
                      animate={isProcessing ? { scale: [1, 1.4, 1], rotate: 360 } : {}}
                      className="absolute inset-0 rounded-full bg-jisra-green/20 blur-xl"
                    />
                    <div className="relative z-10 flex h-12 w-12 items-center justify-center rounded-full bg-jisra-green shadow-[0_0_20px_#1fa971]">
                      <Cpu className={`h-6 w-6 text-white ${isProcessing ? 'animate-pulse' : ''}`} />
                    </div>
                    <div className="absolute inset-0 pointer-events-none">
                      {[...Array(4)].map((_, i) => (
                        <motion.div
                          key={i}
                          animate={isProcessing ? {
                            x: [0, (i % 2 === 0 ? 40 : -40)],
                            y: [0, (i < 2 ? 40 : -40)],
                            opacity: [0, 1, 0]
                          } : { opacity: 0 }}
                          className="absolute h-1 w-1 rounded-full bg-jisra-green"
                        />
                      ))}
                    </div>
                  </div>

                  <div className="relative z-10 flex flex-col items-center gap-3 text-center sm:items-end">
                    <div className="text-[10px] uppercase tracking-widest text-jisra-green-light">Donnée Nettoyée</div>
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={current.clean}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="rounded-xl border border-jisra-green/30 bg-jisra-green/10 px-6 py-4 shadow-[0_0_30px_rgba(31,169,113,0.15)]"
                      >
                        <div className="flex items-center gap-3">
                          <MapPin className="h-5 w-5 text-jisra-green" />
                          <span className="text-2xl font-bold text-jisra-cream">{current.clean}</span>
                        </div>
                      </motion.div>
                    </AnimatePresence>
                    <motion.p 
                      key={`reg-${index}`}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 0.4 }}
                      className="text-[10px] text-jisra-cream mt-1"
                    >
                      Region: {current.region}
                    </motion.p>
                  </div>
                </div>
              </div>

              <div className="border-t border-white/5 bg-black/40 px-8 py-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-lg bg-white p-1 flex items-center justify-center">
                      <NextImage src="/icons/logo.gif" alt="Rapid Delivery" width={32} height={32} className="object-contain" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-jisra-cream">Prêt pour Expédition</p>
                      <p className="text-[10px] text-jisra-cream/40 tracking-wider">Validation automatique par Rapid Delivery</p>
                    </div>
                  </div>
                  <div className="rounded-full bg-jisra-green/20 px-3 py-1 ring-1 ring-jisra-green/30">
                    <span className="text-[10px] font-bold text-jisra-green">QUALITÉ 100%</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="absolute -inset-4 -z-10 rounded-[2.5rem] bg-jisra-green/10 blur-2xl" />
          </motion.div>
        </div>
      </Container>
    </section>
  )
}
