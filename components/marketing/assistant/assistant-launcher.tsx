'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import { MessageCircle } from 'lucide-react'

/**
 * Le widget n'est téléchargé qu'après interaction (ou inactivité prolongée) :
 * aucun impact sur le premier rendu de la page d'accueil.
 */
const AssistantWidget = dynamic(() => import('./assistant-widget').then((module) => module.AssistantWidget), { ssr: false })

export function AssistantLauncher({ available }: { available: boolean }) {
  const [ready, setReady] = useState(false)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const handle = window.requestIdleCallback
      ? window.requestIdleCallback(() => setReady(true), { timeout: 4000 })
      : window.setTimeout(() => setReady(true), 3500)
    return () => {
      if (window.cancelIdleCallback && typeof handle === 'number') window.cancelIdleCallback(handle)
      else window.clearTimeout(handle as number)
    }
  }, [])
  if (ready) return <AssistantWidget initialOpen={open} available={available} />
  return <button type="button" onClick={() => { setOpen(true); setReady(true) }} aria-label="Discuter avec l’assistant Jisra"
    className="fixed bottom-20 right-4 z-[70] flex h-12 w-12 sm:bottom-[5.25rem] sm:right-6 items-center justify-center rounded-full bg-jisra-green text-white shadow-lg shadow-jisra-green/30 transition hover:bg-jisra-green-light focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-jisra-cream">
    <MessageCircle aria-hidden className="h-6 w-6" />
  </button>
}
