'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, Loader2, Menu, X } from 'lucide-react'
import { marketingNav } from '@/lib/marketing/site'
import { Container } from '@/components/marketing/shared/container'
import { MarketingLink } from '@/components/marketing/shared/marketing-link'
import { SolutionsMenu } from '@/components/marketing/layout/solutions-menu'
import { SOLUTION_ICONS } from '@/components/marketing/layout/solution-icons'
import { JisraMark, JisraWordmark } from '@/components/logo'

export function MarketingHeader() {
  const [open, setOpen] = useState(false)
  const [mobileSolutions, setMobileSolutions] = useState(false)
  const [isScrolled, setIsScrolled] = useState(false)
  const [navigating, setNavigating] = useState(false)
  const headerRef = useRef<HTMLElement | null>(null)

  // Menu mobile : fermeture au toucher/clic en dehors de l'en-tête.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (headerRef.current && !headerRef.current.contains(event.target as Node)) {
        setOpen(false)
        setMobileSolutions(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 16)
    onScroll()
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header ref={headerRef} className="sticky top-0 z-[60] px-3 pt-3 sm:px-4">
      <Container className="px-0">
        <motion.div
          animate={{
            y: 0,
            borderColor: isScrolled ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.08)',
            backgroundColor: '#18201c',
            boxShadow: isScrolled
              ? '0 18px 70px rgba(0,0,0,0.34)'
              : '0 10px 40px rgba(0,0,0,0.18)',
          }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="relative rounded-[22px] border"

        >
          <div className="absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-jisra-green/50 to-transparent" />
          <div className="flex h-[60px] items-center justify-between gap-6 px-4 sm:px-5 lg:px-6">

            <Link href="/" className="group flex items-center gap-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-1.5 transition-transform duration-300 group-hover:scale-[1.03]">
                <JisraMark size={28} ink="#f3efe6" accent="#1fa971" />
              </div>
              <div className="flex flex-col">
                <JisraWordmark size={18} ink="#f3efe6" accent="#1fa971" />
                <span className="mt-[3px] whitespace-nowrap text-[8.5px] uppercase leading-none tracking-[0.16em] text-jisra-cream/42 sm:mt-0 sm:text-[10px] sm:tracking-[0.28em]">commerce operating system</span>
              </div>
            </Link>

            <nav aria-label="Navigation principale" className="hidden items-center gap-0 xl:flex">
              {marketingNav.map((item) => item.items ? <SolutionsMenu key={item.label} items={item.items} /> : (
                <Link
                  key={item.href}
                  href={item.href}
                  className="group relative rounded-xl px-2.5 py-2.5 text-sm font-medium text-jisra-cream/68 transition-colors duration-300 hover:text-jisra-cream"
                >
                  <span>{item.label}</span>
                  <span className="absolute inset-x-4 bottom-1 h-px origin-left scale-x-0 bg-jisra-green transition-transform duration-300 group-hover:scale-x-100" />
                </Link>
              ))}
            </nav>

            <div className="hidden items-center gap-3 xl:flex">
              <div onClick={() => setNavigating(true)} className="contents">
                <MarketingLink href="/login" variant="ghost">
                  {navigating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Se connecter'}
                </MarketingLink>
              </div>
              <MarketingLink href="/signup">
                Démarrer
              </MarketingLink>
            </div>

            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-jisra-cream transition hover:bg-white/[0.08] xl:hidden"
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
            className="absolute inset-x-0 top-full z-[70] px-3 pt-3 sm:px-4 xl:hidden"
          >
            <Container className="px-0">
              <div className="max-h-[calc(100dvh-7rem)] overflow-y-auto overscroll-contain rounded-[24px] border border-white/10 bg-jisra-ink-light p-4 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">

                <div className="grid gap-2">
                  {marketingNav.map((item) => item.items ? (
                    <div key={item.label}>
                      <button
                        type="button"
                        onClick={() => setMobileSolutions((value) => !value)}
                        aria-expanded={mobileSolutions}
                        aria-controls="mobile-solutions"
                        className="flex w-full items-center justify-between rounded-2xl px-4 py-3 text-sm font-medium text-jisra-cream/78 transition hover:bg-white/[0.05] hover:text-jisra-cream"
                      >
                        <span>{item.label}</span>
                        <ChevronDown aria-hidden className={`h-4 w-4 transition-transform ${mobileSolutions ? 'rotate-180' : ''}`} />
                      </button>
                      {mobileSolutions ? (
                        <ul id="mobile-solutions" className="mt-1 grid gap-1 pl-3">
                          {item.items.map((entry) => {
                            const Icon = SOLUTION_ICONS[entry.icon]
                            return (
                              <li key={entry.href}>
                                <Link
                                  href={entry.href}
                                  onClick={() => { setMobileSolutions(false); setOpen(false) }}
                                  className="flex min-h-11 items-start gap-3 rounded-xl px-3 py-2.5 text-sm text-jisra-cream/75 transition hover:bg-white/[0.05] hover:text-jisra-cream"
                                >
                                  <span aria-hidden className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-jisra-green/10">
                                    <Icon className="h-4 w-4 text-jisra-green" />
                                  </span>
                                  <span className="min-w-0">
                                    <span className="block font-medium">{entry.title}</span>
                                    <span className="mt-0.5 block text-xs leading-5 text-jisra-cream/55">{entry.description}</span>
                                  </span>
                                </Link>
                              </li>
                            )
                          })}
                        </ul>
                      ) : null}
                    </div>
                  ) : (
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
                  <div onClick={() => setNavigating(true)} className="contents">
                    <MarketingLink href="/login" variant="ghost">
                      {navigating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Se connecter'}
                    </MarketingLink>
                  </div>
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