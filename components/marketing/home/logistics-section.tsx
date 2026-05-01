'use client'

import { motion } from 'framer-motion'
import { Truck, Package, QrCode, ClipboardCheck, History } from 'lucide-react'
import NextImage from 'next/image'
import { Container } from '@/components/marketing/shared/container'
import { fadeUp } from '@/lib/marketing/motion'

const carriers = [
  { name: 'Rapid Delivery', logo: '/icons/logo.gif' },
  { name: 'Zajil', logo: '/icons/icon-192.svg' }, 
  { name: 'Aramex', logo: '/icons/icon-192.svg' }, 
  { name: 'Cat', logo: '/icons/icon-192.svg' }, 
]

export function LogisticsSection() {
  return (
    <section id="logistics" className="relative overflow-hidden py-20 sm:py-28">
      <div className="absolute left-0 bottom-0 -z-10 h-[500px] w-[500px] bg-jisra-green/5 blur-[100px]" />
      
      <Container>
        <div className="grid gap-16 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
          {/* Visual Side: Logistics UI Simulation */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="relative order-2 lg:order-1"
          >
            <div className="marketing-panel marketing-noise overflow-hidden p-0">
              {/* Fake UI Header */}
              <div className="flex items-center justify-between border-b border-white/10 bg-black/20 px-6 py-4">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-jisra-green" />
                  <span className="text-xs font-mono text-jisra-green-light tracking-widest uppercase">Expédition Automatisée</span>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex -space-x-2">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="h-6 w-6 rounded-full border-2 border-[#111714] bg-jisra-green/20 flex items-center justify-center">
                        <div className="h-1 w-1 rounded-full bg-jisra-green" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Fake Logistics Content */}
              <div className="p-6 space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h5 className="text-sm font-bold text-jisra-cream">Bon de livraison #JD-8820</h5>
                    <p className="text-[10px] text-jisra-cream/40 uppercase tracking-widest">Casablanca · Maroc</p>
                  </div>
                  <div className="h-10 w-10 bg-white p-1 rounded-lg">
                    <QrCode className="h-full w-full text-black" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-xl bg-jisra-green/10 border border-jisra-green/30 p-4 shadow-[0_0_20px_rgba(31,169,113,0.1)]">
                    <p className="text-[10px] uppercase tracking-wider text-jisra-green-light mb-2 font-bold">Statut Commande</p>
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-jisra-green animate-pulse shadow-[0_0_8px_#1fa971]" />
                      <span className="text-sm font-bold text-jisra-green uppercase tracking-tight">Livré</span>
                    </div>
                  </div>
                  <div className="rounded-xl bg-white/5 border border-white/10 p-4">
                    <p className="text-[10px] uppercase tracking-wider text-jisra-cream/30 mb-2">Inventaire</p>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-jisra-cream">Stock : 41 unités</span>
                    </div>
                  </div>
                </div>

                {/* Full Order Lifecycle Timeline */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] uppercase tracking-widest text-jisra-cream/30">Cycle de vie commande</p>
                    <span className="text-[10px] font-mono text-jisra-green animate-pulse">● SYNC LIVE</span>
                  </div>
                  <div className="relative space-y-3 pl-6 before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-px before:bg-white/10">
                    {/* Livré */}
                    <div className="relative flex items-center gap-3">
                      <div className="absolute -left-6 h-2.5 w-2.5 rounded-full bg-jisra-green shadow-[0_0_12px_#1fa971] border-2 border-[#111714]" />
                      <span className="text-xs text-jisra-green font-bold">Livré au client</span>
                      <span className="text-[10px] text-jisra-cream/30 ml-auto">Aujourd'hui</span>
                    </div>
                    {/* Expédié */}
                    <div className="relative flex items-center gap-3 opacity-90">
                      <div className="absolute -left-6 h-2 w-2 rounded-full bg-jisra-green/60 border border-[#111714]" />
                      <span className="text-xs text-jisra-cream/80">Expédié (En Transit)</span>
                      <span className="text-[10px] text-jisra-cream/30 ml-auto">14:20</span>
                    </div>
                    {/* Ramassé */}
                    <div className="relative flex items-center gap-3 opacity-70">
                      <div className="absolute -left-6 h-2 w-2 rounded-full bg-white/30 border border-[#111714]" />
                      <span className="text-xs text-jisra-cream/70">Ramassé par le livreur</span>
                      <span className="text-[10px] text-jisra-cream/30 ml-auto">10:05</span>
                    </div>
                    {/* En attente */}
                    <div className="relative flex items-center gap-3 opacity-50">
                      <div className="absolute -left-6 h-2 w-2 rounded-full bg-white/20 border border-[#111714]" />
                      <span className="text-xs text-jisra-cream/50">En attente de ramassage</span>
                      <span className="text-[10px] text-jisra-cream/30 ml-auto">Hier</span>
                    </div>
                    {/* Confirmée */}
                    <div className="relative flex items-center gap-3 opacity-30">
                      <div className="absolute -left-6 h-2 w-2 rounded-full bg-white/10 border border-[#111714]" />
                      <span className="text-xs text-jisra-cream/40">Confirmée par l'agent</span>
                      <span className="text-[10px] text-jisra-cream/30 ml-auto">Hier</span>
                    </div>
                    {/* Nouvelle */}
                    <div className="relative flex items-center gap-3 opacity-20">
                      <div className="absolute -left-6 h-2 w-2 rounded-full bg-white/5 border border-[#111714]" />
                      <span className="text-xs text-jisra-cream/30">Nouvelle (Import Store)</span>
                      <span className="text-[10px] text-jisra-cream/30 ml-auto">Hier</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="absolute -left-10 -top-10 -z-10 h-72 w-72 rounded-full bg-jisra-green/10 blur-3xl" />
          </motion.div>

          {/* Text Side */}
          <div className="order-1 lg:order-2 space-y-8">
            <motion.div
              variants={fadeUp}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              className="space-y-4"
            >
              <div className="inline-flex items-center gap-2 rounded-full border border-jisra-green/20 bg-jisra-green/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-jisra-green-light">
                <Truck className="h-3.5 w-3.5" />
                Logistique & Stock
              </div>
              <h2 className="text-3xl font-bold tracking-tight text-jisra-cream sm:text-4xl lg:text-5xl">
                Expédiez en 1 clic, suivez en temps réel.
              </h2>
              <p className="text-lg leading-8 text-jisra-cream/65">
                jisra est nativement connecté aux principaux transporteurs marocains. Créez vos colis, générez vos étiquettes et suivez le statut de livraison sans jamais quitter votre dashboard. Votre stock est automatiquement décrémenté à chaque confirmation.
              </p>
            </motion.div>

            <div className="grid gap-6">
              <div className="flex items-start gap-4">
                <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-jisra-green/10 border border-jisra-green/20">
                  <ClipboardCheck className="h-5 w-5 text-jisra-green" />
                </div>
                <div>
                  <h4 className="font-semibold text-jisra-cream">Automatisation des Vouchers</h4>
                  <p className="text-sm text-jisra-cream/50">Génération automatique des étiquettes d'expédition dès la validation du bon de ramassage.</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-jisra-green/10 border border-jisra-green/20">
                  <History className="h-5 w-5 text-jisra-green" />
                </div>
                <div>
                  <h4 className="font-semibold text-jisra-cream">Tracking Statut Live</h4>
                  <p className="text-sm text-jisra-cream/50">Mise à jour automatique des statuts (Livré, Retourné, Refusé) en synchronisation avec le transporteur.</p>
                </div>
              </div>
            </div>

            <div className="pt-4">
              <p className="text-[10px] uppercase tracking-widest text-jisra-cream/30 mb-4">Transporteurs supportés</p>
              <div className="flex flex-wrap gap-4">
                {carriers.map((carrier) => (
                  <div key={carrier.name} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-white/5 bg-white/[0.03] grayscale opacity-60 hover:grayscale-0 hover:opacity-100 transition-all cursor-default">
                    <div className="relative h-5 w-5 overflow-hidden rounded-md bg-white">
                      <NextImage src={carrier.logo} alt={carrier.name} fill className="object-contain p-0.5" />
                    </div>
                    <span className="text-xs font-bold text-jisra-cream/80">{carrier.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Container>
    </section>
  )
}
