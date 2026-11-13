'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, HelpCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { pricingFaqItems } from '@/lib/marketing/faq'

export function PricingFAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  return (
    <div className="mx-auto max-w-3xl space-y-3">
      {pricingFaqItems.map((item, index) => (
        <motion.div
          key={index}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: index * 0.05 }}
          className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]"
        >
          <button
            type="button"
            onClick={() => setOpenIndex(openIndex === index ? null : index)}
            className="flex w-full items-center gap-4 p-5 text-left transition-colors hover:bg-white/[0.02]"
          >
            <HelpCircle className="h-5 w-5 shrink-0 text-jisra-green/60" />
            <span className="flex-1 text-sm font-semibold text-jisra-cream">
              {item.question}
            </span>
            <ChevronDown
              className={cn(
                'h-4 w-4 shrink-0 text-jisra-cream/40 transition-transform duration-200',
                openIndex === index && 'rotate-180'
              )}
            />
          </button>
          <AnimatePresence>
            {openIndex === index && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <div className="border-t border-white/5 px-5 py-4">
                  <p className="text-sm leading-7 text-jisra-cream/68">{item.answer}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      ))}
    </div>
  )
}
