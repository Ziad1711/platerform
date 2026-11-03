'use client'

/**
 * Panneau d'enregistrement vocal.
 *
 * Ordre imposé, de gauche à droite : annuler (X dans un cercle) → onde sonore
 * flexible avec durée → arrêter → envoyer.
 *
 * Composant purement présentationnel : la machine d'états et le micro restent
 * dans la page, ce qui rend l'affichage vérifiable sans navigateur.
 *
 * Cibles tactiles de 44 px, aucune superposition, aucun espace réservé par un
 * bouton masqué : ce panneau remplace la rangée de saisie sur la même hauteur.
 */
import type { RefObject } from 'react'
import { Send, Square, X } from 'lucide-react'
import type { VoicePhase } from '@/lib/assistant/voice-state'
import { detectCommunicationProfile } from '@/lib/assistant/semantic/locale'
import { resolveDictionary, translate } from '@/lib/assistant/blocks/i18n'

export interface AssistantVoicePanelProps {
  phase: VoicePhase
  seconds: number
  canvasRef: RefObject<HTMLCanvasElement | null>
  /**
   * Texte courant de la saisie : sert uniquement à choisir la langue des
   * libellés. Aucune donnée n'est envoyée ni conservée par ce composant.
   */
  probeText?: string
  onCancel: () => void
  onStop: () => void
  onSend: () => void
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`
}

export default function AssistantVoicePanel({
  phase,
  seconds,
  canvasRef,
  probeText = '',
  onCancel,
  onStop,
  onSend,
}: AssistantVoicePanelProps) {
  const recording = phase === 'recording'
  const ready = phase === 'recorded' || phase === 'error'
  const transcribing = phase === 'transcribing'

  const profile = detectCommunicationProfile(probeText)
  const dict = resolveDictionary(profile.locale, profile.script)
  const labels = {
    label: translate(dict, 'voice.label'),
    status: translate(dict, 'voice.transcribing'),
    cancel: translate(dict, 'voice.cancel'),
    stop: translate(dict, 'voice.stop'),
    send: translate(dict, 'voice.send'),
  }

  return (
    <div
      role="group"
      aria-label={labels.label}
      dir="ltr"
      className="flex h-11 w-full items-center gap-2 px-1"
    >
      <button
        type="button"
        onClick={onCancel}
        aria-label={labels.cancel}
        title={labels.cancel}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="relative flex h-9 min-w-0 flex-1 items-center">
        <canvas
          ref={canvasRef}
          aria-hidden
          className={`h-9 w-full text-primary ${recording ? 'opacity-100' : 'opacity-40'}`}
        />
        <span
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute inset-y-0 end-0 flex items-center rounded bg-card/80 px-1 text-[11px] font-medium tabular-nums text-foreground/80"
        >
          {transcribing ? labels.status : formatDuration(seconds)}
        </span>
      </div>

      <button
        type="button"
        onClick={onStop}
        disabled={!recording}
        aria-label={labels.stop}
        title={labels.stop}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-card text-primary transition-colors hover:bg-primary/10 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Square className="h-3.5 w-3.5" />
      </button>

      <button
        type="button"
        onClick={onSend}
        disabled={!ready || transcribing}
        aria-label={labels.send}
        title={labels.send}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-white transition-colors hover:bg-primary/90 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Send className="h-4 w-4" />
      </button>
    </div>
  )
}
