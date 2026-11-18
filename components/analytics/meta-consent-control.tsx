'use client'

import { useSyncExternalStore, useState } from 'react'
import { metaChoice, setMetaChoice, subscribeMetaChoice } from '@/lib/analytics/meta-browser'

export function MetaConsentControl({ onlyUnset = false }: { onlyUnset?: boolean }) {
  const choice = useSyncExternalStore(subscribeMetaChoice, metaChoice, () => null)
  const ready = useSyncExternalStore(subscribeMetaChoice, () => true, () => false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)

  async function choose(granted: boolean) {
    setBusy(true)
    setError(false)
    try { await setMetaChoice(granted) }
    catch { setError(true) }
    finally { setBusy(false) }
  }

  if (!ready || (onlyUnset && choice !== null && !busy && !error)) return null
  return (
    <div className="rounded-2xl border border-current/20 p-4 text-sm">
      <p className="font-semibold">Mesure publicitaire Meta (facultative)</p>
      <p className="mt-1">Avec votre accord, Jisra utilise le Pixel et l’API de conversions de Meta et relie en interne les campagnes à l’inscription et au premier paiement vérifié. Votre choix n’affecte pas votre accès au service. Vous pouvez le retirer dans la politique de confidentialité ou les paramètres.</p>
      {error && <p role="alert" className="mt-1">Le choix n’a pas été enregistré sur le serveur. Réessayez.</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={busy || choice === 'granted'} onClick={() => void choose(true)} className="min-h-11 rounded-xl border px-3 disabled:opacity-50">Autoriser Meta</button>
        <button type="button" disabled={busy || (choice === 'denied' && !error)} onClick={() => void choose(false)} className="min-h-11 rounded-xl border px-3 disabled:opacity-50">{choice === 'granted' ? 'Retirer mon accord Meta' : 'Refuser Meta'}</button>
      </div>
    </div>
  )
}