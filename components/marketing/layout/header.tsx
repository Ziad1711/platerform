'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Menu, X } from 'lucide-react'
import { marketingNav } from '@/lib/marketing/site'
import { Container } from '@/components/marketing/shared/container'
import { MarketingLink } from '@/components/marketing/shared/marketing-link'
import { JisraMark, JisraWordmark } from '@/components/logo'

export function MarketingHeader() {
  const [open, setOpen] = useState(false)
  const [isScrolled, setIsScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 16)
    onScroll()
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header className="sticky top-0 z-[60] px-3 pt-3 sm:px-4">
      <Container className="px-0">
        <motion.div
          animate={{
            y: 0,
            borderColor: isScrolled ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.08)',
            backgroundColor: isScrolled ? 'rgba(24,32,28,0.88)' : 'rgba(24,32,28,0.56)',
            boxShadow: isScrolled
              ? '0 18px 70px rgba(0,0,0,0.34)'
              : '0 10px 40px rgba(0,0,0,0.18)',
          }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="relative rounded-[22px] border backdrop-blur-2xl"

        >
          <div className="absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-jisra-green/50 to-transparent" />
          <div className="flex h-[60px] items-center justify-between gap-6 px-4 sm:px-5 lg:px-6">

            <Link href="/" className="group flex items-center gap-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-1.5 transition-transform duration-300 group-hover:scale-[1.03]">
                <JisraMark size={28} ink="#f3efe6" accent="#1fa971" />
              </div>
              <div className="flex flex-col">
                <JisraWordmark size={18} ink="#f3efe6" accent="#1fa971" />
                <span className="text-[10px] uppercase tracking-[0.28em] text-jisra-cream/42">commerce operating system</span>
              </div>
            </Link>

            <nav className="hidden items-center gap-1 lg:flex">
              {marketingNav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="group relative rounded-xl px-4 py-2.5 text-sm font-medium text-jisra-cream/68 transition-colors duration-300 hover:text-jisra-cream"
                >
                  <span>{item.label}</span>
                  <span className="absolute inset-x-4 bottom-1 h-px origin-left scale-x-0 bg-jisra-green transition-transform duration-300 group-hover:scale-x-100" />
                </Link>
              ))}
            </nav>

            <div className="hidden items-center gap-3 lg:flex">
              <MarketingLink href="/login" variant="ghost">
                Se connecter
              </MarketingLink>
              <MarketingLink href="/signup">
                Démarrer
              </MarketingLink>
            </div>

            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-jisra-cream transition hover:bg-white/[0.08] lg:hidden"
              aria-label={open ? 'Fermer le menu' : 'Ouvrir le menu'}
              aria-expanded={open}
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </motion.div>
      </Container>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22 }}
            className="lg:hidden"
          >
            <Container className="mt-3 px-0">
              <div className="overflow-hidden rounded-[24px] border border-white/10 bg-jisra-ink-light/94 p-4 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-2xl">

                <div className="grid gap-2">
                  {marketingNav.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="rounded-2xl px-4 py-3 text-sm font-medium text-jisra-cream/78 transition hover:bg-white/[0.05] hover:text-jisra-cream"
                      onClick={() => setOpen(false)}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>

                <div className="mt-4 grid gap-3 border-t border-white/10 pt-4">
                  <MarketingLink href="/login" variant="ghost">
                    Se connecter
                  </MarketingLink>
                  <MarketingLink href="/signup">
                    Démarrer
                  </MarketingLink>
                </div>
              </div>
            </Container>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  )
}