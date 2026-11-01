/**
 * Audio de dictée : encodage WAV PCM mono 16 bits et lecture stricte côté serveur.
 *
 * Pourquoi WAV : la durée est vérifiable exactement à partir de l'en-tête, sans
 * décodage ni dépendance externe. Le navigateur ne peut donc pas minimiser la
 * durée facturée, et le serveur impose une limite réelle de 120 secondes.
 *
 * Aucune donnée n'est conservée : les octets vivent le temps de la requête.
 */
import {
  MAX_AUDIO_BYTES,
  MAX_AUDIO_SECONDS,
  MIN_AUDIO_SECONDS,
  TARGET_CHANNELS,
  TARGET_SAMPLE_RATE,
} from '@/lib/assistant/transcription-limits'

/** Sous-ensemble d'`AudioBuffer` utilisé par l'encodeur (testable sans DOM). */
export interface AudioBufferLike {
  numberOfChannels: number
  length: number
  sampleRate: number
  getChannelData: (channel: number) => Float32Array
}

export interface WavInfo {
  sampleRate: number
  channels: number
  bitsPerSample: number
  dataBytes: number
  /** Durée exacte déduite de l'en-tête, jamais d'une valeur cliente. */
  durationSeconds: number
}

export type WavValidation =
  | { ok: true; info: WavInfo }
  | { ok: false; code: 'TRANSCRIPTION_AUDIO_EMPTY' | 'TRANSCRIPTION_TOO_LARGE' | 'TRANSCRIPTION_TOO_LONG' | 'TRANSCRIPTION_UNSUPPORTED_TYPE' }

export type WavParse =
  | { ok: true; info: WavInfo }
  | { ok: false; reason: 'WAV_INVALID' | 'WAV_UNSUPPORTED_FORMAT' | 'WAV_EMPTY' }

function writeAscii(view: DataView, offset: number, text: string) {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index))
  }
}

/**
 * Encode un buffer audio en WAV PCM 16 bits mono à 16 kHz.
 * Le rééchantillonnage est linéaire : suffisant pour de la parole, sans dépendance.
 */
export function encodeWav(
  audio: AudioBufferLike,
  targetSampleRate = TARGET_SAMPLE_RATE,
): Uint8Array {
  const sourceRate = Math.max(1, Math.round(audio.sampleRate))
  const channels = Math.max(1, Math.round(audio.numberOfChannels))
  const frames = Math.max(1, Math.round((audio.length * targetSampleRate) / sourceRate))

  const samples = new Float32Array(frames)
  const sourceChannels: Float32Array[] = []
  for (let channel = 0; channel < channels; channel += 1) {
    sourceChannels.push(audio.getChannelData(channel))
  }

  for (let frame = 0; frame < frames; frame += 1) {
    const position = (frame * sourceRate) / targetSampleRate
    const left = Math.min(audio.length - 1, Math.floor(position))
    const right = Math.min(audio.length - 1, left + 1)
    const fraction = position - left
    let sum = 0
    for (const data of sourceChannels) {
      const a = data[left] ?? 0
      const b = data[right] ?? a
      sum += a * (1 - fraction) + b * fraction
    }
    samples[frame] = sum / channels
  }

  const dataBytes = frames * TARGET_CHANNELS * 2
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, TARGET_CHANNELS, true)
  view.setUint32(24, targetSampleRate, true)
  view.setUint32(28, targetSampleRate * TARGET_CHANNELS * 2, true)
  view.setUint16(32, TARGET_CHANNELS * 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataBytes, true)

  let offset = 44
  for (let frame = 0; frame < frames; frame += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[frame]))
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
    offset += 2
  }

  return new Uint8Array(buffer)
}

/** Lecture stricte : RIFF/WAVE, PCM 16 bits, mono, 8–48 kHz. */
export function parseWav(bytes: Uint8Array): WavParse {
  if (bytes.byteLength < 44) return { ok: false, reason: 'WAV_INVALID' }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (offset: number) =>
    String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3))

  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return { ok: false, reason: 'WAV_INVALID' }

  let cursor = 12
  let format: { audioFormat: number; channels: number; sampleRate: number; bitsPerSample: number } | null = null
  let dataBytes: number | null = null

  while (cursor + 8 <= bytes.byteLength) {
    const id = tag(cursor)
    const size = view.getUint32(cursor + 4, true)
    const body = cursor + 8
    if (body + size > bytes.byteLength) return { ok: false, reason: 'WAV_INVALID' }

    if (id === 'fmt ') {
      if (size < 16) return { ok: false, reason: 'WAV_INVALID' }
      format = {
        audioFormat: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true),
      }
    } else if (id === 'data') {
      dataBytes = size
    }

    cursor = body + size + (size % 2)
  }

  if (!format) return { ok: false, reason: 'WAV_INVALID' }
  if (format.audioFormat !== 1 || format.bitsPerSample !== 16) {
    return { ok: false, reason: 'WAV_UNSUPPORTED_FORMAT' }
  }
  if (format.channels !== TARGET_CHANNELS) return { ok: false, reason: 'WAV_UNSUPPORTED_FORMAT' }
  if (format.sampleRate < 8_000 || format.sampleRate > 48_000) {
    return { ok: false, reason: 'WAV_UNSUPPORTED_FORMAT' }
  }
  if (dataBytes === null || dataBytes <= 0) return { ok: false, reason: 'WAV_EMPTY' }

  const durationSeconds = dataBytes / (format.sampleRate * format.channels * 2)
  return {
    ok: true,
    info: {
      sampleRate: format.sampleRate,
      channels: format.channels,
      bitsPerSample: format.bitsPerSample,
      dataBytes,
      durationSeconds,
    },
  }
}

/**
 * Validation complète côté serveur : taille, format, durée réelle.
 * Le client ne fournit jamais la durée : elle est recalculée depuis l'en-tête.
 */
export function validateWavForTranscription(bytes: Uint8Array): WavValidation {
  if (bytes.byteLength > MAX_AUDIO_BYTES) return { ok: false, code: 'TRANSCRIPTION_TOO_LARGE' }

  const parsed = parseWav(bytes)
  if (!parsed.ok) {
    if (parsed.reason === 'WAV_EMPTY') return { ok: false, code: 'TRANSCRIPTION_AUDIO_EMPTY' }
    return { ok: false, code: 'TRANSCRIPTION_UNSUPPORTED_TYPE' }
  }

  if (parsed.info.durationSeconds < MIN_AUDIO_SECONDS) {
    return { ok: false, code: 'TRANSCRIPTION_AUDIO_EMPTY' }
  }
  if (parsed.info.durationSeconds > MAX_AUDIO_SECONDS) {
    return { ok: false, code: 'TRANSCRIPTION_TOO_LONG' }
  }

  return { ok: true, info: parsed.info }
}
