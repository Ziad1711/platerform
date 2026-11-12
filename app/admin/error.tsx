'use client'

export default function AdminError({ reset }: { reset: () => void }) {
  return <div role="alert" className="space-y-4 rounded-2xl border border-white/15 p-6"><h2 className="text-xl font-semibold">Administration temporairement indisponible</h2><p>Aucun accès n’est accordé sans vérification serveur.</p><button onClick={reset} className="min-h-11 rounded-xl border px-5">Réessayer</button></div>
}