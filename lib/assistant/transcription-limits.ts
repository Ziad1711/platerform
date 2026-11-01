/**
 * Limites partagées de la dictée vocale (client et serveur).
 *
 * Le navigateur applique ces limites pour l'expérience utilisateur ; la route
 * serveur les réapplique car un client ne fait jamais autorité. Taille et durée
 * restent volontairement sous les limites du fournisseur (25 Mo).
 */

export const TRANSCRIPTION_MODEL = 'gpt-transcribe'

/**
 * 4 Mo : sous la limite de requête de la plateforme (4,5 Mo) et très au-dessus
 * d'une dictée WAV de 120 s (≈ 3,84 Mo à 16 kHz mono 16 bits).
 */
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024
/** Durée minimale : en dessous, aucune parole exploitable. */
export const MIN_AUDIO_SECONDS = 0.5
/** Durée maximale d'un enregistrement envoyé. */
export const MAX_AUDIO_SECONDS = 120
/** Format canonique : WAV PCM mono 16 bits à 16 kHz (durée vérifiable). */
export const TARGET_SAMPLE_RATE = 16_000
export const TARGET_CHANNELS = 1
/** Plafond journalier partagé par utilisateur (réservé en base, atomique). */
export const TRANSCRIPTION_DAILY_SECONDS = 600
export const TRANSCRIPTION_DAILY_REQUESTS = 40
/** Tarif public indicatif du modèle (USD par minute d'audio). */
export const TRANSCRIPTION_COST_PER_MINUTE_USD = 0.0045

/**
 * Activation explicite de la dictée. Fermée par défaut : le plafond de coût
 * n'est pas global (compteur en mémoire de processus), donc la route ne doit
 * pas être exposée avant la mise en place d'un compteur partagé atomique.
 */
export const TRANSCRIPTION_FLAG_ENV = 'ASSISTANT_TRANSCRIPTION_ENABLED'

export function isTranscriptionEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return String(env[TRANSCRIPTION_FLAG_ENV] ?? '').trim().toLowerCase() === 'enabled'
}

/**
 * Seul WAV est accepté : sa durée se vérifie exactement dans l'en-tête.
 * Un format compressé sans durée lisible ne permettrait pas de plafonner le coût.
 */
const SUPPORTED_AUDIO_TYPES = ['audio/wav', 'audio/x-wav'] as const

/** Type MIME de base, sans paramètres (`;codecs=opus`). */
export function baseAudioType(type: string | null | undefined): string {
  return String(type || '').split(';')[0].trim().toLowerCase()
}

export function isSupportedAudioType(type: string | null | undefined): boolean {
  const base = baseAudioType(type)
  return (SUPPORTED_AUDIO_TYPES as readonly string[]).includes(base)
}

/** Coût fournisseur indicatif d'une durée, jamais facturé aux crédits de chat. */
export function estimateTranscriptionCostUsd(seconds: number): number {
  const safe = Math.max(0, Number(seconds) || 0)
  return Number(((safe / 60) * TRANSCRIPTION_COST_PER_MINUTE_USD).toFixed(6))
}

/**
 * Contexte fourni au modèle : langues attendues et vocabulaire métier.
 * Le modèle détecte la langue ; aucun texte n'est traduit.
 */
export function buildTranscriptionPrompt(): string {
  return [
    'Dictée d’un commerçant e-commerce marocain.',
    'Langues attendues : français, arabe, darija marocaine, anglais, avec alternance possible dans la même phrase.',
    'Vocabulaire fréquent : commandes, confirmées, livrées, retournées, annulées, chiffre d’affaires,',
    'marge contributive, dépenses publicitaires, coût d’achat, stock, fournisseur, ville, campagne.',
    'Transcris fidèlement les mots prononcés, sans traduire et sans reformuler.',
  ].join(' ')
}
