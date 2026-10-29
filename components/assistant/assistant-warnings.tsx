'use client'

import { summarizeWarnings } from '@/lib/assistant/chat-ui'

/**
 * Avertissements analytiques condensés.
 *
 * Une seule ligne compacte est affichée ; les limites distinctes restent
 * accessibles dans une section dépliable. Aucune réserve critique (partial,
 * missing, forbidden, unavailable, devises mixtes, montants non vérifiés)
 * n'est supprimée ni reformulée.
 */
export default function AssistantWarnings({ warnings }: { warnings?: string[] | null }) {
  const { summary, details, criticalCount } = summarizeWarnings(warnings)

  if (!summary) return null

  return (
    <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5">
      <p className="text-[11px] leading-4 text-amber-800">
        <span className="font-semibold">Limites : </span>
        {summary}
        {criticalCount > 0 ? (
          <span className="ml-1 text-amber-900">· {criticalCount} réserve(s) critique(s)</span>
        ) : null}
      </p>

      {details.length > 0 ? (
        <details className="mt-1">
          <summary className="cursor-pointer list-none text-[11px] text-amber-800 underline decoration-dotted">
            Voir les limites de l’analyse ({details.length})
          </summary>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {details.map((text, index) => (
              <li key={`${index}-${text}`} className="text-[11px] leading-4 text-amber-800">
                {text}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}
