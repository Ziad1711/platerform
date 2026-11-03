/**
 * Machine d'états de l'enregistrement vocal.
 *
 * Règle centrale : **arrêter n'envoie jamais**. Un arrêt place l'enregistrement
 * en attente (« prêt à envoyer ») ; seule une action explicite déclenche la
 * transcription, donc l'appel réseau et le coût associé.
 *
 * Le module est pur : il ne touche ni au micro, ni au réseau, ce qui rend les
 * transitions vérifiables sans navigateur.
 */

export type VoicePhase = 'idle' | 'recording' | 'recorded' | 'transcribing' | 'error'

export interface VoiceState {
  phase: VoicePhase
  /** Message déjà localisé par l'appelant, jamais un code interne. */
  error: string | null
  /** Identifiant de session : invalide les callbacks tardifs. */
  sessionId: number
}

export type VoiceEvent =
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'send' }
  | { type: 'cancel' }
  | { type: 'transcribed' }
  | { type: 'failed'; message: string }

export function initialVoiceState(sessionId = 0): VoiceState {
  return { phase: 'idle', error: null, sessionId }
}

export function canStart(state: VoiceState): boolean {
  return state.phase === 'idle' || state.phase === 'recorded' || state.phase === 'error'
}

export function canStop(state: VoiceState): boolean {
  return state.phase === 'recording'
}

/** Envoi autorisé uniquement sur un enregistrement terminé non envoyé. */
export function canSend(state: VoiceState): boolean {
  return state.phase === 'recorded' || state.phase === 'error'
}

export function isRecording(state: VoiceState): boolean {
  return state.phase === 'recording'
}

export function isBusy(state: VoiceState): boolean {
  return state.phase === 'recording' || state.phase === 'transcribing'
}

export function reduceVoice(state: VoiceState, event: VoiceEvent): VoiceState {
  switch (event.type) {
    case 'start':
      if (!canStart(state)) return state
      return { phase: 'recording', error: null, sessionId: state.sessionId + 1 }

    case 'stop':
      if (!canStop(state)) return state
      return { ...state, phase: 'recorded', error: null }

    case 'send':
      if (!canSend(state)) return state
      return { ...state, phase: 'transcribing', error: null }

    case 'cancel':
      // Une annulation invalide la session en cours : tout callback tardif
      // (arrêt du MediaRecorder, réponse réseau) sera ignoré.
      return { phase: 'idle', error: null, sessionId: state.sessionId + 1 }

    case 'transcribed':
      return { phase: 'idle', error: null, sessionId: state.sessionId + 1 }

    case 'failed':
      return { ...state, phase: 'error', error: event.message }

    default:
      return state
  }
}

/** Libellé localisé de l'état courant (clé de dictionnaire). */
export function voiceStatusKey(state: VoiceState): string {
  switch (state.phase) {
    case 'recording': return 'voice.recording'
    case 'recorded': return 'voice.ready'
    case 'transcribing': return 'voice.transcribing'
    case 'error': return 'voice.failed'
    default: return 'voice.label'
  }
}
