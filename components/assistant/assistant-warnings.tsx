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
  const { summary, details } = summarizeWarnings(warnings)

  if (!summary) return null

  return (
    <div className="mt-2.5 rounded-lg border border-amber-200/70 bg-amber-50/70 px-3 py-2">
      <p className="flex items-start gap-1.5 text-[11px] leading-4 text-amber-800">
        <span aria-hidden className="mt-[3px] inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
        <span>{summary}</span>
      </p>

      {details.length > 0 ? (
        <details className="mt-1.5">
          <summary className="cursor-pointer list-none text-[11px] text-amber-800/90 underline decoration-dotted">
            Limites de l’analyse ({details.length})
          </summary>
          <ul className="mt-1.5 list-disc space-y-1 pl-4">
            {details.map((text, index) => (
              <li key={`${index}-${text}`} className="text-[11px] leading-4 text-amber-800/90">
                {text}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}
