'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ShieldCheck } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { readAnalyticsConsent, writeAnalyticsConsent, type AnalyticsConsent } from '@/lib/analytics/consent'

export function CookieBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // L'ancien consentement marketing (« jisra-cookie-consent ») ne couvrait
    // aucune mesure d'audience : le visiteur est donc interrogé à nouveau.
    setVisible(readAnalyticsConsent() === null)
  }, [])

  const choose = (consent: AnalyticsConsent) => {
    writeAnalyticsConsent(consent)
    setVisible(false)
  }

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          className="fixed inset-x-4 bottom-4 z-[80] mx-auto max-w-3xl rounded-[24px] border border-white/10 bg-jisra-ink-light/92 p-4 text-jisra-cream shadow-[0_24px_80px_rgba(0,0,0,0.4)] backdrop-blur-2xl sm:p-5"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-2xl border border-jisra-green/20 bg-jisra-green/10 p-2 text-jisra-green-light">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold">Cookies et mesure d’audience</p>
                <p className="mt-1 text-sm leading-6 text-jisra-cream/64">
                  Les cookies nécessaires au fonctionnement et à la sécurité restent actifs. La mesure d’audience (Google Analytics) n’est activée qu’avec votre accord, et vous pouvez le retirer à tout moment depuis la{' '}
                  <Link
                    href="/legal/confidentialite"
                    className="underline decoration-white/30 underline-offset-2 transition-colors hover:text-jisra-cream"
                  >
                    politique de confidentialité
                  </Link>
                  .
                </p>
              </div>
            </div>

            <div className="flex gap-3 sm:shrink-0">
              <button
                type="button"
                onClick={() => choose('denied')}
                className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-jisra-cream/82 transition hover:border-white/24 hover:text-jisra-cream"
              >
                Refuser
              </button>
              <button
                type="button"
                onClick={() => choose('granted')}
                className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-jisra-green px-4 py-2 text-sm font-semibold text-white transition hover:bg-jisra-green-light"
              >
                Accepter
              </button>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}