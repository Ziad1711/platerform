'use client'

import { motion } from 'framer-motion'
import { ShoppingBag, Zap, Layers, ShieldCheck } from 'lucide-react'
import NextImage from 'next/image'
import { Container } from '@/components/marketing/shared/container'
import { fadeUp } from '@/lib/marketing/motion'

type StoreBadge = {
  name: string
  logo: string
  color: string
  border: string
  status: 'Disponible' | 'Bientôt'
  soon?: boolean
}

const stores: StoreBadge[] = [
  { name: 'YouCan', logo: '/icons/youcan-shop-icon-filled-256.png', color: 'bg-[#000000]/10', border: 'border-white/10', status: 'Disponible' },
  { name: 'Shopify', logo: '/icons/shopify.png', color: 'bg-[#95BF47]/10', border: 'border-[#95BF47]/20', status: 'Bientôt', soon: true },
  { name: 'LightFunnels', logo: '/icons/unnamed.png', color: 'bg-blue-500/10', border: 'border-blue-500/20', status: 'Disponible' },
]

export function StoreIntegrationSection() {
  return (
    <section id="boutiques" className="relative overflow-hidden py-20 sm:py-28">
      {/* Background Decor */}
      <div className="absolute right-0 bottom-0 -z-10 h-[600px] w-[600px] bg-jisra-green/5 blur-[120px]" />
      
      <Container>
        <div className="grid gap-16 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          {/* Text Side */}
          <div className="space-y-8">
            <motion.div
              variants={fadeUp}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              className="space-y-4"
            >
              <div className="inline-flex items-center gap-2 rounded-full border border-jisra-green/20 bg-jisra-green/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-jisra-green-light">
                <ShoppingBag className="h-3.5 w-3.5" />
                Multi-Store Sync
              </div>
              <h2 className="text-3xl font-bold tracking-tight text-jisra-cream sm:text-4xl lg:text-5xl">
                Plusieurs boutiques. Un seul endroit pour vos commandes.
              </h2>
              <p className="text-lg leading-8 text-jisra-cream/65">
                Connectez vos boutiques YouCan et LightFunnels pour retrouver leurs commandes dans Jisra et passer d’une boutique à une vue d’ensemble.
              </p>
            </motion.div>

            <div className="grid gap-6">
              <div className="flex items-start gap-4">
                <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-jisra-green/10 border border-jisra-green/20">
                  <Zap className="h-5 w-5 text-jisra-green" />
                </div>
                <div>
                  <h4 className="font-semibold text-jisra-cream">Import Automatique Direct</h4>
                  <p className="text-sm text-jisra-cream/50">Les commandes créées sur vos boutiques connectées sont centralisées dans jisra, sans ressaisie.</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-jisra-green/10 border border-jisra-green/20">
                  <Layers className="h-5 w-5 text-jisra-green" />
                </div>
                <div>
                  <h4 className="font-semibold text-jisra-cream">Gestion Multi-Stores</h4>
                  <p className="text-sm text-jisra-cream/50">Pilotez plusieurs boutiques depuis un seul compte consolidé.</p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-4">
              {stores.map((store) => (
                <div
                  key={store.name}
                  className={`flex items-center gap-2 rounded-2xl border ${store.border} ${store.color} px-4 py-2 ${store.soon ? 'opacity-60' : ''}`}
                >
                  <div className="relative h-5 w-5">
                    <NextImage
                      src={store.logo}
                      alt={store.soon ? `${store.name} (bientôt disponible)` : store.name}
                      fill
                      className="object-contain"
                    />
                  </div>
                  <span className="text-xs font-medium text-jisra-cream/80">{store.name}</span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.15em] ${
                      store.soon
                        ? 'border-white/10 bg-white/5 text-jisra-cream/50'
                        : 'border-jisra-green/30 bg-jisra-green/10 text-jisra-green-light'
                    }`}
                  >
                    {store.status}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Visual Side: Store Sync Simulation */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="relative"
          >
            <div className="marketing-panel marketing-noise relative p-8 flex flex-col items-center justify-center min-h-[400px]">
              {/* Central jisra Logo */}
              <div className="relative z-10 flex h-24 w-24 items-center justify-center rounded-[2rem] bg-jisra-ink border border-jisra-green/30 shadow-[0_0_50px_rgba(31,169,113,0.2)]">
                <NextImage src="/icons/icon-192.svg" alt="jisra" width={48} height={48} />
              </div>

              {/* Orbiting Stores */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="h-64 w-64 rounded-full border border-white/5 animate-[spin_20s_linear_infinite]" />
                <div className="h-80 w-80 rounded-full border border-white/5 animate-[spin_35s_linear_infinite_reverse]" />
              </div>

              {/* Floating Icons */}
              <motion.div 
                animate={{ y: [0, -10, 0] }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                className="absolute top-12 left-12 flex h-16 w-16 items-center justify-center rounded-2xl bg-white border border-white/10 shadow-xl shadow-black/20"
              >
                <NextImage src="/icons/youcan-shop-icon-filled-256.png" alt="YouCan" width={32} height={32} />
              </motion.div>

              <motion.div 
                animate={{ y: [0, 10, 0] }}
                transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 1 }}
                className="absolute bottom-16 right-12 flex flex-col items-center gap-1"
              >
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-[#95BF47] opacity-40 shadow-xl shadow-black/20">
                  <NextImage src="/icons/shopify.png" alt="Shopify (bientôt disponible)" width={32} height={32} />
                </div>
                <span className="text-[8px] font-bold uppercase tracking-[0.2em] text-jisra-cream/40">Bientôt</span>
              </motion.div>

              <motion.div 
                animate={{ x: [0, -8, 0] }}
                transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
                className="absolute top-20 right-16 flex h-14 w-14 items-center justify-center rounded-2xl bg-black border border-white/10 shadow-xl shadow-black/20"
              >
                <NextImage src="/icons/unnamed.png" alt="LightFunnels" width={28} height={28} />
              </motion.div>

              {/* Connection Lines (Simulated with CSS) */}
              <svg className="absolute inset-0 h-full w-full pointer-events-none" viewBox="0 0 400 400">
                <motion.path 
                  d="M 80 80 L 160 160" 
                  stroke="url(#lineGradient)" 
                  strokeWidth="1" 
                  strokeDasharray="4 4"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
                <motion.path 
                  d="M 320 320 L 240 240" 
                  stroke="url(#lineGradient)" 
                  strokeWidth="1" 
                  strokeDasharray="4 4"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 2, repeat: Infinity, delay: 1 }}
                />
                <defs>
                  <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#1fa971" stopOpacity="0" />
                    <stop offset="50%" stopColor="#1fa971" stopOpacity="0.5" />
                    <stop offset="100%" stopColor="#1fa971" stopOpacity="0" />
                  </linearGradient>
                </defs>
              </svg>

              {/* Success Badge */}
              <div className="absolute bottom-8 flex items-center gap-2 rounded-full border border-jisra-green/30 bg-jisra-green/10 px-4 py-1.5 backdrop-blur-xl">
                <ShieldCheck className="h-3.5 w-3.5 text-jisra-green" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-jisra-green-light">Connexion API Sécurisée</span>
              </div>
            </div>
          </motion.div>
        </div>
      </Container>
    </section>
  )
}
