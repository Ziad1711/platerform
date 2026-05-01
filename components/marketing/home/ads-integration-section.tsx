'use client'

import { motion } from 'framer-motion'
import { BarChart3, RefreshCw, Target, Wallet, ArrowRight } from 'lucide-react'
import NextImage from 'next/image'
import { Container } from '@/components/marketing/shared/container'
import { fadeUp } from '@/lib/marketing/motion'

const adPlatforms = [
  { name: 'Meta Ads', icon: '/icons/meta_PNG5.png', color: 'bg-[#0668E1]/10', border: 'border-[#0668E1]/20' },
  { name: 'TikTok Ads', icon: '/icons/unnamed.png', color: 'bg-black/20', border: 'border-white/10' }, 
  { name: 'Google Ads', icon: '/icons/icon-192.svg', color: 'bg-[#FBBC04]/10', border: 'border-[#FBBC04]/20' },
  { name: 'Snapchat', icon: '/icons/unnamed.png', color: 'bg-[#FFFC00]/10', border: 'border-[#FFFC00]/20' },
]

export function AdsIntegrationSection() {
  return (
    <section id="ads" className="relative overflow-hidden py-20 sm:py-28">
      <div className="absolute right-0 top-0 -z-10 h-[500px] w-[500px] bg-jisra-green/5 blur-[100px]" />
      
      <Container>
        <div className="grid gap-16 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
          <div className="space-y-8">
            <motion.div
              variants={fadeUp}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              className="space-y-4"
            >
              <div className="inline-flex items-center gap-2 rounded-full border border-jisra-green/20 bg-jisra-green/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-jisra-green-light">
                <Target className="h-3.5 w-3.5" />
                Data Ads Temps Réel
              </div>
              <h2 className="text-3xl font-bold tracking-tight text-jisra-cream sm:text-4xl lg:text-5xl">
                Le ROAS réel, pas celui du Manager.
              </h2>
              <p className="text-lg leading-8 text-jisra-cream/65">
                jisra importe vos dépenses publicitaires toutes les 15 minutes. En croisant ces données avec vos ventes confirmées et livrées, nous calculons le ROAS net et le profit exact pour chaque campagne, chaque adset et chaque commande.
              </p>
            </motion.div>

            <div className="grid gap-6">
              <div className="flex items-start gap-4">
                <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-jisra-green/10 border border-jisra-green/20">
                  <RefreshCw className="h-5 w-5 text-jisra-green" />
                </div>
                <div>
                  <h4 className="font-semibold text-jisra-cream">Synchronisation Omnicanale</h4>
                  <p className="text-sm text-jisra-cream/50">Centralisez Meta, TikTok, Google et Snapchat dans une vue unique.</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-jisra-green/10 border border-jisra-green/20">
                  <BarChart3 className="h-5 w-5 text-jisra-green" />
                </div>
                <div>
                  <h4 className="font-semibold text-jisra-cream">Profit par Commande</h4>
                  <p className="text-sm text-jisra-cream/50">Voyez exactement combien chaque commande vous rapporte après frais publicitaires.</p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-4 pt-4">
              {adPlatforms.map((platform) => (
                <div key={platform.name} className={`flex items-center gap-2 rounded-2xl border ${platform.border} ${platform.color} px-4 py-2`}>
                  <div className="relative h-5 w-5">
                    <NextImage src={platform.icon} alt={platform.name} fill className="object-contain" />
                  </div>
                  <span className="text-xs font-medium text-jisra-cream/80">{platform.name}</span>
                </div>
              ))}
            </div>
          </div>

          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="relative"
          >
            <div className="marketing-panel marketing-noise overflow-hidden p-0">
              <div className="flex items-center justify-between border-b border-white/10 bg-black/20 px-6 py-4">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-jisra-green animate-pulse" />
                  <span className="text-xs font-mono text-jisra-green-light tracking-widest uppercase">Direct Sync active</span>
                </div>
                <div className="flex gap-1.5">
                  <div className="h-2 w-2 rounded-full bg-white/10" />
                  <div className="h-2 w-2 rounded-full bg-white/10" />
                  <div className="h-2 w-2 rounded-full bg-white/10" />
                </div>
              </div>

              <div className="p-6 space-y-6">
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-wider text-jisra-cream/40">Dépense Pub</p>
                    <p className="text-xl font-bold text-jisra-cream">4 280 MAD</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-wider text-jisra-cream/40">ROAS Manager</p>
                    <p className="text-xl font-bold text-blue-400">8.4x</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-wider text-jisra-green/60">ROAS Réel (Net)</p>
                    <p className="text-xl font-bold text-jisra-green">5.1x</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between rounded-xl bg-white/5 border border-white/10 p-4">
                    <div className="flex items-center gap-3">
                      <div className="relative h-8 w-8 overflow-hidden rounded-lg bg-white p-1.5">
                        <NextImage src="/icons/meta_PNG5.png" alt="Meta" fill className="object-contain" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-jisra-cream">Campagne Prospecting - MA</p>
                        <p className="text-[10px] text-jisra-cream/40">Meta Ads · Live</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-jisra-green">+ 12 400 MAD Profit</p>
                      <p className="text-[10px] text-jisra-cream/40">Net après Ads & Livraison</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between rounded-xl bg-white/5 border border-white/10 p-4 opacity-70">
                    <div className="flex items-center gap-3">
                      <div className="relative h-8 w-8 overflow-hidden rounded-lg bg-black p-1.5">
                        <NextImage src="/icons/tiktok.webp" alt="TikTok" fill className="object-contain" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-jisra-cream">Video Scaling - Trend</p>
                        <p className="text-[10px] text-jisra-cream/40">TikTok Ads · Live</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-jisra-green">+ 8 150 MAD Profit</p>
                      <p className="text-[10px] text-jisra-cream/40">Net après Ads & Livraison</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-[10px] uppercase tracking-widest text-jisra-cream/30">
                    <span>Importation des données</span>
                    <span>98%</span>
                  </div>
                  <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      whileInView={{ width: '98%' }}
                      transition={{ duration: 2, ease: "easeOut" }}
                      className="h-full bg-gradient-to-r from-jisra-green to-cyan-500"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="absolute -right-6 -top-6 -z-10 h-64 w-64 rounded-full bg-blue-500/10 blur-3xl" />
            <div className="absolute -left-6 -bottom-6 -z-10 h-64 w-64 rounded-full bg-jisra-green/10 blur-3xl" />
          </motion.div>
        </div>
      </Container>
    </section>
  )
}
