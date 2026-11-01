'use client'

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Loader2,
  MessageSquare,
  Menu,
  Mic,
  MoreVertical,
  Pin,
  PinOff,
  Plus,
  Send,
  Sparkles,
  Square,
  Trash2,
  Wallet,
  X,
} from 'lucide-react'
import AssistantChartCard from '@/components/assistant/assistant-chart-card'
import AssistantWarnings from '@/components/assistant/assistant-warnings'
import type { AssistantStructuredResponse } from '@/lib/assistant/types'
import { useStore } from '@/lib/store-context'
import { resolveRetryRequestId } from '@/lib/assistant/retry-key'
import { decideAutoScroll, hasUsableChart, mergeDisplayMessages, sanitizeMetricsSummary } from '@/lib/assistant/chat-ui'
import { MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS } from '@/lib/assistant/transcription-limits'
import { encodeWav } from '@/lib/assistant/audio-wav'

/** Longueur maximale d'un message de chat (alignée sur la route serveur). */
const MAX_TRANSCRIPT_LENGTH = 2_000

/** Horodatage isolé du rendu : seule la dictée l'utilise. */
function currentTimestamp(): number {
  return Date.now()
}

/** Durée d'enregistrement affichée `mm:ss`. */
function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

interface ThreadItem {
  id: string
  title: string | null
  is_pinned?: boolean
  created_at: string
  updated_at: string
}

interface ChatMessage {
  id: string
  thread_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  credits_used: number
  metadata?: {
    structured_response?: AssistantStructuredResponse
  } | null
  created_at: string
}

function AssistantActivityTrace({ steps }: { steps: Array<{ label: string; detail?: string }> }) {
  if (!steps.length) return null

  return (
    <div className="mt-3 rounded-lg border bg-secondary px-3 py-2">
      <div className="text-[11px] font-semibold text-muted-foreground mb-1">Trace d’activité</div>
      <div className="space-y-1">
        {steps.map((step, index) => (
          <div key={`${step.label}-${index}`} className="text-[11px] text-foreground flex items-start gap-2">
            <span className="mt-[3px] inline-block h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" />
            <span>
              {step.label}
              {step.detail ? <span className="text-muted-foreground"> — {step.detail}</span> : null}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

interface WalletResponse {
  monthlyCredits: number
  creditsUsed: number
  remainingCredits: number
}

function renderInlineMarkdown(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)

  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={index} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      )
    }

    return <span key={index}>{part}</span>
  })
}

function isMarkdownSeparatorLine(line: string) {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line)
}

function parseTableCells(line: string) {
  return line
    .split('|')
    .map((cell) => cell.trim())
    .filter((cell, index, arr) => !(arr.length > 1 && cell === '' && (index === 0 || index === arr.length - 1)))
}

function renderMessageContent(content: string) {
  const lines = content.split('\n')
  const nodes: ReactNode[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const trimmed = line.trim()

    const hasPotentialTable = trimmed.includes('|') && index + 1 < lines.length && isMarkdownSeparatorLine(lines[index + 1])

    if (hasPotentialTable) {
      const headerCells = parseTableCells(lines[index])
      let nextIndex = index + 2
      const rows: string[][] = []

      while (nextIndex < lines.length && lines[nextIndex].includes('|')) {
        const rowCells = parseTableCells(lines[nextIndex])
        if (rowCells.length > 0) rows.push(rowCells)
        nextIndex += 1
      }

      nodes.push(
        <div key={`table-${index}`} className="mt-2 overflow-x-auto rounded-lg border border-border bg-card/90">
          <table className="min-w-full text-xs">
            <thead className="bg-secondary">
              <tr>
                {headerCells.map((cell, cellIndex) => (
                  <th key={cellIndex} className="px-2 py-1.5 text-left font-semibold text-foreground border-b border-border">
                    {renderInlineMarkdown(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="odd:bg-card even:bg-secondary/60">
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="px-2 py-1.5 border-b border-gray-100 text-foreground">
                      {renderInlineMarkdown(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )

      index = nextIndex - 1
      continue
    }

    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      nodes.push(
        <div key={index} className="flex gap-2">
          <span>•</span>
          <span>{renderInlineMarkdown(trimmed.slice(2))}</span>
        </div>
      )
      continue
    }

    if (trimmed === '') {
      nodes.push(<div key={index} className="h-2" />)
      continue
    }

    nodes.push(
      <div key={index}>
        {renderInlineMarkdown(line)}
      </div>
    )
  }

  return nodes
}

const SUGGESTIONS = [
  'Analyse mon business',
  'Montre-moi mes meilleurs produits',
  'Résume mes dépenses',
  'Compare ce mois au mois dernier',
]

function readApiError(payload: unknown, fallback: string) {
  if (payload && typeof payload === 'object') {
    const record = payload as { message?: unknown; error?: unknown }
    if (typeof record.message === 'string' && record.message) return record.message
    if (typeof record.error === 'string' && record.error) return record.error
  }

  return fallback
}

/**
 * Fermeture serveur du pilote (verrou global, allowlist, configuration
 * incomplète). Le code est conservé pour distinguer une indisponibilité
 * volontaire d'une erreur métier.
 */
const ASSISTANT_CLOSED_CODES = new Set([
  'ASSISTANT_DISABLED',
  'ASSISTANT_NOT_ALLOWED',
  'ASSISTANT_PILOT_CONFIG_INCOMPLETE',
])

class AssistantApiError extends Error {
  code: string | null

  constructor(message: string, code: string | null) {
    super(message)
    this.name = 'AssistantApiError'
    this.code = code
  }
}

function readApiFailure(payload: unknown, fallback: string) {
  const record = payload && typeof payload === 'object' ? (payload as { error?: unknown; code?: unknown }) : null
  const rawCode = typeof record?.error === 'string' ? record.error : typeof record?.code === 'string' ? record.code : null
  return new AssistantApiError(readApiError(payload, fallback), rawCode)
}

export default function AssistantIAPage() {
  const queryClient = useQueryClient()
  const { currentStoreId, userId } = useStore()

  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [serverError, setServerError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [optimisticUserMessage, setOptimisticUserMessage] = useState<{ content: string; storeId: string } | null>(null)
  const [pendingUserMessageCreatedAt, setPendingUserMessageCreatedAt] = useState<string | null>(null)
  const [threadMenuOpenId, setThreadMenuOpenId] = useState<string | null>(null)
  const [threadsOpen, setThreadsOpen] = useState(false)
  const [loadingStepIndex, setLoadingStepIndex] = useState(0)
  const [recording, setRecording] = useState(false)
  const [recordSeconds, setRecordSeconds] = useState(0)
  const [transcribing, setTranscribing] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const messagesContainerRef = useRef<HTMLDivElement | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const threadsButtonRef = useRef<HTMLButtonElement | null>(null)
  const threadsDrawerRef = useRef<HTMLElement | null>(null)
  const pageRef = useRef<HTMLDivElement | null>(null)
  // Références DOM stables par message assistant : cible du défilement.
  const assistantMessageRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const handledAssistantIdRef = useRef<string | null>(null)
  const autoScrollAllowedRef = useRef(true)
  const previousThreadRef = useRef<string | null>(null)
  const programmaticScrollUntilRef = useRef(0)
  const lastScrollTopRef = useRef(0)
  const revealUserMessageRef = useRef(false)

  // Dictée vocale : l'audio reste en mémoire, jamais stocké.
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recorderStreamRef = useRef<MediaStream | null>(null)
  const recorderChunksRef = useRef<Blob[]>([])
  const recorderTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const recorderModeRef = useRef<'send' | 'insert'>('insert')
  const recorderCancelledRef = useRef(false)
  const recorderStartedAtRef = useRef(0)
  const transcribeAbortRef = useRef<AbortController | null>(null)
  // Verrous synchrones : deux clics ne peuvent ni ouvrir deux micros ni payer
  // deux transcriptions.
  const voiceStartLockRef = useRef(false)
  const voiceSessionRef = useRef(0)
  const voiceRequestIdRef = useRef<string | null>(null)
  const transcribeInFlightRef = useRef(false)
  const sendingRef = useRef(false)
  // Onde sonore réellement alimentée par le microphone.
  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const waveformRafRef = useRef<number | null>(null)

  const hasStore = Boolean(currentStoreId)
  const canLoad = hasStore

  // Les caches sont liés au compte ET à la boutique : un changement de compte
  // ne peut jamais réafficher les conversations d'un autre utilisateur.
  const threadsQuery = useQuery<{ threads: ThreadItem[] }>({
    queryKey: ['assistant-threads', userId, currentStoreId],
    enabled: canLoad,
    queryFn: async () => {
      const res = await fetch(`/api/assistant/threads?storeId=${encodeURIComponent(String(currentStoreId))}`)
      const data = await res.json().catch(() => null)
      if (!res.ok) throw readApiFailure(data, 'Impossible de charger les conversations')
      return data
    },
  })

  const walletQuery = useQuery<{ wallet: WalletResponse }>({
    queryKey: ['assistant-wallet', userId],
    queryFn: async () => {
      const res = await fetch('/api/assistant/wallet')
      const data = await res.json().catch(() => null)
      if (!res.ok) throw readApiFailure(data, 'Impossible de charger vos crédits IA')
      return data
    },
  })

  const threadList = threadsQuery.data?.threads

  // Le thread actif doit appartenir à la liste de la boutique courante : un
  // changement de boutique invalide donc naturellement l'ancien identifiant,
  // sans effet de bord ni remise à zéro manuelle.
  const selectedThreadId = useMemo(() => {
    if (!threadList) return null
    if (activeThreadId && threadList.some((thread) => thread.id === activeThreadId)) {
      return activeThreadId
    }
    return threadList[0]?.id || null
  }, [threadList, activeThreadId])

  const pendingUserMessage =
    optimisticUserMessage && optimisticUserMessage.storeId === currentStoreId
      ? optimisticUserMessage.content
      : null

  const [messagePageSize, setMessagePageSize] = useState(50)

  const messagesQuery = useQuery<{ messages: ChatMessage[]; hasMore?: boolean }>({
    queryKey: ['assistant-messages', userId, currentStoreId, selectedThreadId, messagePageSize],
    enabled: canLoad && Boolean(selectedThreadId),
    queryFn: async () => {
      const res = await fetch(
        `/api/assistant/threads/${selectedThreadId}/messages?storeId=${encodeURIComponent(String(currentStoreId))}&limit=${messagePageSize}`
      )
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(readApiError(data, 'Impossible de charger les messages'))
      return data
    },
  })

  const createThreadMutation = useMutation({
    mutationFn: async () => {
      if (!currentStoreId) throw new Error('Sélectionnez une boutique avant de créer une conversation.')

      const res = await fetch('/api/assistant/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId: currentStoreId, title: 'Nouvelle conversation' }),
      })

      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(readApiError(data, 'Impossible de créer la conversation'))
      return data as { thread: ThreadItem }
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['assistant-threads'] })
      setActiveThreadId(data.thread.id)
      setThreadsOpen(false)
      setServerError(null)
      setTimeout(() => inputRef.current?.focus(), 0)
    },
    onError: (error) => {
      setServerError(error instanceof Error ? error.message : 'Erreur de création')
    },
  })

  const sendAbortRef = useRef<AbortController | null>(null)

  const sendMessageMutation = useMutation({
    mutationFn: async (payload: { message: string; threadId: string | null; requestId: string; storeId: string }) => {
      if (!payload.storeId) throw new Error('Sélectionnez une boutique avant d’envoyer un message.')

      // Une seule requête en vol : la précédente est annulée (serveur + fournisseur).
      sendAbortRef.current?.abort()
      const controller = new AbortController()
      sendAbortRef.current = controller

      const res = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          storeId: payload.storeId,
          threadId: payload.threadId,
          message: payload.message,
          requestId: payload.requestId,
        }),
      })

      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(readApiError(data, 'Erreur Assistant IA'))
      return data
    },
    onSuccess: async (data, variables) => {
      // Réponse tardive d'un autre périmètre : jamais appliquée à la boutique courante.
      if (variables.storeId !== currentStoreId) return

      if (data?.threadId) {
        setActiveThreadId(data.threadId)
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['assistant-threads'] }),
        queryClient.invalidateQueries({ queryKey: ['assistant-messages'] }),
        queryClient.invalidateQueries({ queryKey: ['assistant-wallet'] }),
      ])
      setServerError(null)
      setWarning(typeof data?.warning === 'string' && data.warning ? data.warning : null)
      setOptimisticUserMessage(null)
      setPendingUserMessageCreatedAt(null)
    },
    onError: (error, variables) => {
      if (variables.storeId !== currentStoreId) return
      if (error instanceof DOMException && error.name === 'AbortError') return

      setServerError(error instanceof Error ? error.message : 'Erreur d’envoi')
      setWarning(null)
      setOptimisticUserMessage(null)
      setPendingUserMessageCreatedAt(null)
    },
    onSettled: () => {
      sendAbortRef.current = null
    },
  })

  // Changement de boutique ou de compte : annule la requête en vol pour empêcher
  // toute réponse affichée hors du périmètre courant.
  useEffect(() => {
    return () => {
      sendAbortRef.current?.abort()
      sendAbortRef.current = null
    }
  }, [currentStoreId, userId])

  const updateThreadMutation = useMutation({
    mutationFn: async (payload: { threadId: string; action: 'rename' | 'toggle_pin'; title?: string; isPinned?: boolean }) => {
      const res = await fetch(`/api/assistant/threads/${payload.threadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(readApiError(data, 'Erreur de mise à jour'))
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['assistant-threads'] })
      setThreadMenuOpenId(null)
    },
    onError: (error) => {
      setServerError(error instanceof Error ? error.message : 'Erreur de mise à jour')
    },
  })

  const deleteThreadMutation = useMutation({
    mutationFn: async (threadId: string) => {
      const res = await fetch(`/api/assistant/threads/${threadId}`, {
        method: 'DELETE',
      })

      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(readApiError(data, 'Erreur de suppression'))
      return data
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['assistant-threads'] }),
        queryClient.invalidateQueries({ queryKey: ['assistant-messages'] }),
      ])
      setThreadMenuOpenId(null)
    },
    onError: (error) => {
      setServerError(error instanceof Error ? error.message : 'Erreur de suppression')
    },
  })

  const remainingCredits = walletQuery.data?.wallet?.remainingCredits
  const hasWalletLoaded = typeof remainingCredits === 'number'
  const isNoCredits = hasWalletLoaded && remainingCredits <= 0

  // Indisponibilité volontaire décidée côté serveur (verrou, allowlist,
  // configuration incomplète) : l'interface affiche le message contrôlé renvoyé
  // par l'API et bloque l'envoi. Ce n'est jamais un contrôle de sécurité : le
  // refus réel est appliqué par les routes API.
  const assistantClosedError = useMemo(() => {
    const errors = [threadsQuery.error, walletQuery.error]
    for (const error of errors) {
      if (error instanceof AssistantApiError && error.code && ASSISTANT_CLOSED_CODES.has(error.code)) {
        return error.message
      }
    }
    return null
  }, [threadsQuery.error, walletQuery.error])

  const isAssistantBlocked = isNoCredits || Boolean(assistantClosedError)

  const handleRenameThread = async (thread: ThreadItem) => {
    const nextTitle = window.prompt('Nouveau titre de la conversation', thread.title || '')
    if (!nextTitle) return
    await updateThreadMutation.mutateAsync({
      threadId: thread.id,
      action: 'rename',
      title: nextTitle,
    })
  }

  const handleTogglePinThread = async (thread: ThreadItem) => {
    await updateThreadMutation.mutateAsync({
      threadId: thread.id,
      action: 'toggle_pin',
      isPinned: !thread.is_pinned,
    })
  }

  const handleDeleteThread = async (thread: ThreadItem) => {
    const confirmed = window.confirm('Supprimer cette conversation ? Cette action est définitive.')
    if (!confirmed) return

    await deleteThreadMutation.mutateAsync(thread.id)
    if (selectedThreadId === thread.id) {
      setActiveThreadId(null)
    }
  }

  const pendingRequestRef = useRef<{ key: string; requestId: string } | null>(null)


  const handleSend = async (message: string) => {
    const clean = message.trim()
    if (!clean || !hasStore || !currentStoreId) return
    // Un seul envoi à la fois : un double clic (ou un envoi vocal tardif) ne
    // doit jamais produire deux messages ni deux débits.
    if (sendingRef.current) return
    sendingRef.current = true
    setServerError(null)
    setOptimisticUserMessage({ content: clean, storeId: String(currentStoreId) })
    setPendingUserMessageCreatedAt(new Date().toISOString())
    autoScrollAllowedRef.current = true
    revealUserMessageRef.current = true
    setInput('')

    // Même texte, même compte, même boutique et même conversation relancés
    // après un échec = même clé ; tout changement de périmètre produit une
    // nouvelle clé (aucun rejeu inter-périmètre possible).
    const retry = resolveRetryRequestId(
      pendingRequestRef.current,
      { userId, storeId: currentStoreId, threadId: selectedThreadId, message: clean },
      () =>
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : null
    )

    if (!retry) {
      sendingRef.current = false
      setInput(clean)
      setOptimisticUserMessage(null)
      setServerError('Navigateur incompatible : identifiant de requête indisponible.')
      return
    }

    const requestId = retry.requestId
    pendingRequestRef.current = retry

    try {
      await sendMessageMutation.mutateAsync({
        message: clean,
        threadId: selectedThreadId,
        requestId,
        storeId: currentStoreId,
      })
      pendingRequestRef.current = null
    } catch {
      setInput(clean)
    } finally {
      sendingRef.current = false
    }
  }

  // Drawer mobile : Escape, verrou de défilement et focus initial.
  useEffect(() => {
    if (!threadsOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setThreadsOpen(false)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const frame = requestAnimationFrame(() => threadsDrawerRef.current?.focus())
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      cancelAnimationFrame(frame)
    }
  }, [threadsOpen])

  // Hauteur réellement visible : le clavier virtuel réduit `visualViewport`.
  // La zone de saisie reste ainsi ancrée en bas, sans double défilement.
  useEffect(() => {
    const viewport = window.visualViewport
    const element = pageRef.current
    if (!viewport || !element) return

    const apply = () => {
      const top = Math.max(0, element.getBoundingClientRect().top)
      element.style.height = `${Math.max(240, Math.round(viewport.height - top))}px`
    }

    apply()
    viewport.addEventListener('resize', apply)
    viewport.addEventListener('scroll', apply)
    return () => {
      viewport.removeEventListener('resize', apply)
      viewport.removeEventListener('scroll', apply)
      element.style.removeProperty('height')
    }
  }, [])

  const closeThreads = useCallback(() => {
    setThreadsOpen(false)
    requestAnimationFrame(() => threadsButtonRef.current?.focus())
  }, [])

  /* ------------------------------------------------------------------ */
  /* Dictée vocale : enregistrement local, transcription côté serveur    */
  /* ------------------------------------------------------------------ */

  const clearRecorderTimer = useCallback(() => {
    if (recorderTimerRef.current) {
      clearInterval(recorderTimerRef.current)
      recorderTimerRef.current = null
    }
  }, [])

  /** Libère le micro : aucune piste active ne survit à l'enregistrement. */
  const stopTracks = useCallback(() => {
    recorderStreamRef.current?.getTracks().forEach((track) => track.stop())
    recorderStreamRef.current = null
  }, [])

  const stopWaveform = useCallback(() => {
    if (waveformRafRef.current !== null) {
      cancelAnimationFrame(waveformRafRef.current)
      waveformRafRef.current = null
    }
  }, [])

  /** Dessine l'onde réelle du microphone (canvas, aucune boucle React). */
  const startWaveform = useCallback(() => {
    const render = () => {
      const canvas = waveformCanvasRef.current
      const analyser = analyserRef.current
      if (!canvas || !analyser) {
        waveformRafRef.current = requestAnimationFrame(render)
        return
      }
      const context = canvas.getContext('2d')
      if (!context) return

      const ratio = Math.min(2, window.devicePixelRatio || 1)
      const width = Math.max(40, canvas.clientWidth)
      const height = Math.max(20, canvas.clientHeight)
      if (canvas.width !== Math.floor(width * ratio) || canvas.height !== Math.floor(height * ratio)) {
        canvas.width = Math.floor(width * ratio)
        canvas.height = Math.floor(height * ratio)
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0)

      const data = new Uint8Array(analyser.fftSize)
      analyser.getByteTimeDomainData(data)
      const bars = 28
      const step = Math.max(1, Math.floor(data.length / bars))
      const gap = 2
      const barWidth = Math.max(1.5, (width - gap * (bars - 1)) / bars)
      context.clearRect(0, 0, width, height)
      // Couleur du thème (text-primary) : cohérente en clair et en sombre.
      context.fillStyle = window.getComputedStyle(canvas).color || '#1fa971'

      for (let index = 0; index < bars; index += 1) {
        let sum = 0
        for (let offset = 0; offset < step; offset += 1) {
          const sample = (data[index * step + offset] - 128) / 128
          sum += sample * sample
        }
        const rms = Math.sqrt(sum / step)
        const barHeight = Math.max(2, Math.min(height, rms * height * 3.2))
        const x = index * (barWidth + gap)
        const y = (height - barHeight) / 2
        if (typeof context.roundRect === 'function') {
          context.beginPath()
          context.roundRect(x, y, barWidth, barHeight, barWidth / 2)
          context.fill()
        } else {
          context.fillRect(x, y, barWidth, barHeight)
        }
      }

      waveformRafRef.current = requestAnimationFrame(render)
    }
    render()
  }, [])

  const stopAudioGraph = useCallback(() => {
    stopWaveform()
    analyserRef.current = null
    const context = audioContextRef.current
    audioContextRef.current = null
    if (context && context.state !== 'closed') void context.close().catch(() => undefined)
  }, [stopWaveform])

  const resetRecorderState = useCallback(() => {
    recorderRef.current = null
    recorderChunksRef.current = []
    clearRecorderTimer()
    stopTracks()
    setRecording(false)
    setRecordSeconds(0)
  }, [clearRecorderTimer, stopTracks])

  /** Annulation : aucun appel API, aucune donnée audio conservée. */
  const cancelRecording = useCallback(() => {
    // Invalide immédiatement tout callback tardif (onstop, réponse réseau).
    voiceSessionRef.current += 1
    recorderCancelledRef.current = true
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop()
      } catch {
        // déjà arrêté
      }
    }
    transcribeAbortRef.current?.abort()
    transcribeAbortRef.current = null
    stopAudioGraph()
    setTranscribing(false)
    resetRecorderState()
  }, [resetRecorderState, stopAudioGraph])

  const stopRecording = useCallback(
    (mode: 'send' | 'insert') => {
      const recorder = recorderRef.current
      if (!recorder || recorder.state === 'inactive') return
      recorderModeRef.current = mode
      clearRecorderTimer()
      setRecording(false)
      try {
        recorder.stop()
      } catch {
        resetRecorderState()
      }
    },
    [clearRecorderTimer, resetRecorderState],
  )

  // Départ de la page : arrêt du micro, minuteur et requête de transcription.
  useEffect(() => {
    return () => {
      clearRecorderTimer()
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try {
          recorderRef.current.stop()
        } catch {
          // ignore
        }
      }
      recorderStreamRef.current?.getTracks().forEach((track) => track.stop())
      stopWaveform()
      const context = audioContextRef.current
      audioContextRef.current = null
      if (context && context.state !== 'closed') void context.close().catch(() => undefined)
      transcribeAbortRef.current?.abort()
    }
  }, [clearRecorderTimer, stopWaveform])

  // Changement de boutique : la dictée en cours est abandonnée sans envoi.
  const voiceStoreRef = useRef<string | null>(null)
  useEffect(() => {
    if (voiceStoreRef.current && voiceStoreRef.current !== currentStoreId) cancelRecording()
    voiceStoreRef.current = currentStoreId
  }, [currentStoreId, cancelRecording])

  async function transcribeAudio(blob: Blob, mode: 'send' | 'insert', sessionId: number) {
    if (sessionId !== voiceSessionRef.current) return
    if (transcribeInFlightRef.current) return
    if (blob.size > MAX_AUDIO_BYTES) {
      setVoiceError('Enregistrement trop volumineux.')
      return
    }

    transcribeInFlightRef.current = true
    setTranscribing(true)
    setVoiceError(null)
    const controller = new AbortController()
    transcribeAbortRef.current = controller

    try {
      const form = new FormData()
      form.append('file', blob, 'dictation.wav')
      form.append('storeId', String(currentStoreId))
      form.append(
        'requestId',
        voiceRequestIdRef.current ??
          (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : ''),
      )

      const res = await fetch('/api/assistant/transcribe', {
        method: 'POST',
        body: form,
        signal: controller.signal,
      })
      const data = await res.json().catch(() => null)
      // Session invalidée entre-temps (annulation, changement de boutique) :
      // aucun état ni envoi n'est appliqué à la conversation courante.
      if (sessionId !== voiceSessionRef.current) return
      if (!res.ok) throw new Error(readApiError(data, 'Transcription impossible'))

      const text = String((data as { text?: unknown } | null)?.text ?? '').trim()
      if (!text) throw new Error('Aucune parole détectée dans l’enregistrement.')

      if (text.length > MAX_TRANSCRIPT_LENGTH) {
        setInput(text.slice(0, MAX_TRANSCRIPT_LENGTH))
        setVoiceError('Transcription longue : vérifiez le texte avant de l’envoyer.')
        return
      }

      if (mode === 'send') {
        if (isAssistantBlocked || sendMessageMutation.isPending) {
          setInput(text)
          setVoiceError('Transcription placée dans le champ : l’envoi automatique est indisponible.')
          return
        }
        // Le texte reste dans le champ si l'envoi est refusé par un verrou
        // concurrent : aucune parole transcrite n'est perdue.
        setInput(text)
        await handleSend(text)
        return
      }

      setInput((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text))
      setTimeout(() => inputRef.current?.focus(), 0)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return
      if (sessionId === voiceSessionRef.current) {
        setVoiceError(error instanceof Error ? error.message : 'Transcription impossible.')
      }
    } finally {
      transcribeInFlightRef.current = false
      if (sessionId === voiceSessionRef.current) {
        setTranscribing(false)
        transcribeAbortRef.current = null
      }
    }
  }

  async function startRecording() {
    // Verrou synchrone AVANT toute demande de permission : deux clics rapides
    // ne peuvent pas ouvrir deux flux micro.
    if (voiceStartLockRef.current) return
    if (recording || transcribing || isAssistantBlocked || sendMessageMutation.isPending || !hasStore) return
    voiceStartLockRef.current = true
    setVoiceError(null)

    if (
      typeof navigator === 'undefined' ||
      typeof navigator.mediaDevices?.getUserMedia !== 'function' ||
      typeof MediaRecorder === 'undefined' ||
      typeof window === 'undefined' ||
      typeof window.AudioContext === 'undefined'
    ) {
      setVoiceError('La dictée n’est pas prise en charge par ce navigateur.')
      voiceStartLockRef.current = false
      return
    }

    try {
      // Nouvelle session : tout callback d'une dictée précédente devient obsolète.
      const sessionId = voiceSessionRef.current + 1
      voiceSessionRef.current = sessionId
      voiceRequestIdRef.current =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : null

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      })
      recorderStreamRef.current = stream

      const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
      const mimeType = candidates.find((type) => MediaRecorder.isTypeSupported(type)) || ''
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)

      const AudioContextCtor = window.AudioContext
      const audioContext = new AudioContextCtor()
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0.75
      audioContext.createMediaStreamSource(stream).connect(analyser)
      audioContextRef.current = audioContext
      analyserRef.current = analyser
      if (audioContext.state === 'suspended') void audioContext.resume()

      recorderCancelledRef.current = false
      recorderChunksRef.current = []
      recorderStartedAtRef.current = currentTimestamp()

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) recorderChunksRef.current.push(event.data)
      }

      recorder.onstop = () => {
        const chunks = recorderChunksRef.current
        recorderChunksRef.current = []
        const mode = recorderModeRef.current
        recorderRef.current = null
        stopTracks()
        stopAudioGraph()

        // Callback tardif d'une session annulée : ignoré sans traitement.
        if (sessionId !== voiceSessionRef.current) return

        if (recorderCancelledRef.current) {
          recorderCancelledRef.current = false
          return
        }

        const recorded = new Blob(chunks, { type: chunks[0]?.type || mimeType || 'audio/webm' })
        if (recorded.size === 0) {
          setVoiceError('Enregistrement vide : aucune parole détectée.')
          return
        }

        // Conversion locale en WAV 16 kHz mono : la durée devient vérifiable
        // côté serveur, sans dépendre d'une valeur envoyée par le navigateur.
        void (async () => {
          try {
            const encoded = await recorded.arrayBuffer()
            const decoder = new AudioContextCtor()
            const decoded = await decoder.decodeAudioData(encoded)
            const wav = encodeWav(decoded)
            await decoder.close()

            if (sessionId !== voiceSessionRef.current) return
            if (wav.byteLength > MAX_AUDIO_BYTES) {
              setVoiceError('Enregistrement trop volumineux.')
              return
            }

            const wavBuffer = wav.buffer.slice(
              wav.byteOffset,
              wav.byteOffset + wav.byteLength,
            ) as ArrayBuffer
            await transcribeAudio(new Blob([wavBuffer], { type: 'audio/wav' }), mode, sessionId)
          } catch {
            if (sessionId === voiceSessionRef.current) {
              setVoiceError('Enregistrement audio illisible : réessayez.')
            }
          }
        })()
      }

      recorder.start(250)
      recorderRef.current = recorder
      setRecording(true)
      setRecordSeconds(0)
      startWaveform()

      recorderTimerRef.current = setInterval(() => {
        const elapsed = Math.round((Date.now() - recorderStartedAtRef.current) / 1000)
        setRecordSeconds(elapsed)
        if (elapsed >= MAX_AUDIO_SECONDS) stopRecording('insert')
      }, 500)
    } catch (error) {
      stopTracks()
      stopAudioGraph()
      const name = error instanceof DOMException ? error.name : ''
      setVoiceError(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Accès au micro refusé. Autorisez le microphone pour dicter.'
          : 'Micro indisponible sur cet appareil.',
      )
    } finally {
      voiceStartLockRef.current = false
    }
  }

  const messages = useMemo(() => messagesQuery.data?.messages || [], [messagesQuery.data?.messages])

  const persistedThreadKey = selectedThreadId || 'pending-thread'

  // Fusion dédoublonnée + tri déterministe : l'ordre ne dépend ni de l'ordre
  // d'arrivée réseau ni du rafraîchissement de la conversation.
  const displayMessages = useMemo(
    () =>
      mergeDisplayMessages<ChatMessage>(
        messages,
        pendingUserMessage
          ? {
              content: pendingUserMessage,
              threadId: persistedThreadKey,
              createdAt: pendingUserMessageCreatedAt || undefined,
            }
          : null
      ),
    [messages, pendingUserMessage, pendingUserMessageCreatedAt, persistedThreadKey]
  )

  const latestAssistantId = useMemo(() => {
    for (let index = displayMessages.length - 1; index >= 0; index -= 1) {
      if (displayMessages[index].role === 'assistant') return displayMessages[index].id
    }
    return null
  }, [displayMessages])

  const latestUserMessageId = useMemo(() => {
    for (let index = displayMessages.length - 1; index >= 0; index -= 1) {
      if (displayMessages[index].role === 'user') return displayMessages[index].id
    }
    return null
  }, [displayMessages])

  const latestAssistantSuggestions = useMemo(() => {
    const lastAssistant = [...displayMessages]
      .reverse()
      .find((m) => m.role === 'assistant' && m.metadata?.structured_response?.suggestions?.length)

    return lastAssistant?.metadata?.structured_response?.suggestions || SUGGESTIONS
  }, [displayMessages])

  const liveActivitySteps = useMemo(() => {
    const source = (pendingUserMessage || input || '').toLowerCase()
    const wantsWeb =
      source.includes('marché') ||
      source.includes('concurrence') ||
      source.includes('benchmark') ||
      source.includes('tendance externe')

    const labels = [
      'Je réfléchis à votre demande',
      'Je vérifie vos accès et le store actif',
      'Je consulte les données de votre base',
      wantsWeb ? 'Je cherche aussi du contexte web' : null,
      'Je calcule les métriques',
      'Je prépare une réponse claire',
    ].filter(Boolean) as string[]

    return labels.map((label) => ({ label }))
  }, [pendingUserMessage, input])

  useEffect(() => {
    if (!sendMessageMutation.isPending) {
      // Remise à zéro hors du corps synchrone de l'effet (règle React) : le
      // comportement observable reste identique.
      queueMicrotask(() => setLoadingStepIndex(0))
      return
    }

    queueMicrotask(() => setLoadingStepIndex(0))
    const timer = setInterval(() => {
      setLoadingStepIndex((prev) => Math.min(prev + 1, Math.max(0, liveActivitySteps.length - 1)))
    }, 1100)

    return () => clearInterval(timer)
  }, [sendMessageMutation.isPending, liveActivitySteps.length])

  // Suivi du défilement : un déplacement manuel vers le haut désactive le
  // positionnement automatique ; les déplacements programmés sont ignorés.
  const handleMessagesScroll = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container) return

    const top = container.scrollTop
    if (Date.now() < programmaticScrollUntilRef.current) {
      lastScrollTopRef.current = top
      return
    }

    if (top < lastScrollTopRef.current - 8) {
      autoScrollAllowedRef.current = false
    } else if (container.scrollHeight - top - container.clientHeight <= 96) {
      autoScrollAllowedRef.current = true
    }

    lastScrollTopRef.current = top
  }, [])

  /**
   * Logique de positionnement unique : `thread` (ouverture), `reveal` (message
   * envoyé), `reply` (début de la réponse). Aucune remontée automatique.
   */
  const positionMessages = useCallback(
    (kind: 'thread' | 'reveal' | 'reply', messageId: string | null) => {
      const container = messagesContainerRef.current
      if (!container) return

      const reduceMotion =
        typeof window !== 'undefined' && typeof window.matchMedia === 'function'
          ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
          : false
      const behavior: ScrollBehavior = kind === 'thread' || reduceMotion ? 'auto' : 'smooth'

      programmaticScrollUntilRef.current = Date.now() + 800

      if (kind === 'thread') {
        container.scrollTo({ top: container.scrollHeight, behavior })
        return
      }

      if (kind === 'reveal') {
        container.scrollTo({ top: container.scrollHeight, behavior })
        return
      }

      const node = messageId ? assistantMessageRefs.current.get(messageId) : null
      if (!node) return

      const offset = node.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 8
      // Jamais de mouvement vers le haut : on ne remonte pas la conversation.
      const target = Math.max(container.scrollTop, Math.min(offset, container.scrollHeight - container.clientHeight))
      container.scrollTo({ top: target, behavior })
    },
    []
  )

  // Ouverture d'une conversation ou arrivée d'une réponse : un seul effet.
  useEffect(() => {
    const threadChanged = previousThreadRef.current !== selectedThreadId
    previousThreadRef.current = selectedThreadId

    const decision = decideAutoScroll({
      threadChanged,
      latestAssistantId,
      lastHandledAssistantId: handledAssistantIdRef.current,
      userScrolledAway: !autoScrollAllowedRef.current,
    })

    if (decision === 'none') return
    handledAssistantIdRef.current = latestAssistantId

    // Deux frames : le message, ses indicateurs, son graphique et ses limites sont rendus.
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() =>
        positionMessages(decision === 'bottom' ? 'thread' : 'reply', latestAssistantId)
      )
    })

    return () => cancelAnimationFrame(frame)
  }, [latestAssistantId, selectedThreadId, positionMessages])

  // Message envoyé : on garde la bulle utilisateur visible, sans saut vers le haut.
  useEffect(() => {
    if (!revealUserMessageRef.current) return
    if (!autoScrollAllowedRef.current) return

    revealUserMessageRef.current = false
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => positionMessages('reveal', null))
    })

    return () => cancelAnimationFrame(frame)
  }, [latestUserMessageId, positionMessages])

  return (
    <div ref={pageRef} className="grid h-full min-h-0 grid-cols-1 overflow-hidden lg:grid-cols-[300px_1fr] lg:gap-4 lg:p-4">
      {threadsOpen ? (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={closeThreads}
          aria-hidden
        />
      ) : null}
      <aside
        id="threads-drawer"
        ref={threadsDrawerRef}
        role="dialog"
        aria-modal={threadsOpen}
        aria-label="Conversations"
        tabIndex={-1}
        className={`fixed inset-y-0 left-0 z-50 flex w-[85%] max-w-xs min-h-0 flex-col overflow-hidden border-r bg-card shadow-xl transition-transform duration-200 ease-out focus:outline-none lg:static lg:z-auto lg:w-auto lg:max-w-none lg:translate-x-0 lg:rounded-xl lg:border lg:shadow-sm lg:transition-none ${
          threadsOpen ? 'translate-x-0' : '-translate-x-full invisible lg:visible'
        }`}
      >
        <div className="p-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-2 text-foreground font-semibold">
            <MessageSquare className="w-4 h-4" />
            Conversations
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => createThreadMutation.mutate()}
              disabled={createThreadMutation.isPending}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs text-white hover:bg-primary/90 disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              Nouvelle
            </button>
            <button
              type="button"
              onClick={closeThreads}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary lg:hidden"
              aria-label="Fermer les conversations"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="p-3 border-b bg-secondary/70">
          <div className="inline-flex items-center gap-2 text-xs rounded-full px-3 py-1 bg-card border text-foreground">
            <Wallet className="w-3.5 h-3.5" />
            {walletQuery.isLoading
              ? 'Crédits...'
              : `Crédits restants: ${walletQuery.data?.wallet?.remainingCredits ?? 0}`}
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-2 space-y-1">
          {threadsQuery.isLoading ? (
            <div className="p-3 text-sm text-muted-foreground">Chargement...</div>
          ) : threadsQuery.data?.threads?.length ? (
            threadsQuery.data.threads.map((thread) => {
              const active = thread.id === selectedThreadId
              return (
                <div
                  key={thread.id}
                  className={`w-full text-left p-2 rounded-lg border transition relative ${
                    active ? 'bg-blue-50 border-blue-200' : 'bg-card hover:bg-secondary border-transparent'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <button
                      onClick={() => {
                        setActiveThreadId(thread.id)
                        setThreadsOpen(false)
                      }}
                      className="min-w-0 flex-1 px-1 py-1 text-left"
                    >
                      <div className="text-sm font-medium text-foreground flex items-center gap-1">
                        <span className="truncate">{thread.title || 'Nouvelle conversation'}</span>
                        {thread.is_pinned ? <Pin className="w-3 h-3 text-amber-500 shrink-0" /> : null}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-1">
                        {new Date(thread.updated_at).toLocaleString('fr-FR')}
                      </div>
                    </button>

                    <div className="relative">
                      <button
                        onClick={() => setThreadMenuOpenId((prev) => (prev === thread.id ? null : thread.id))}
                        className="h-7 w-7 rounded-md border bg-card hover:bg-secondary inline-flex items-center justify-center"
                      >
                        <MoreVertical className="w-3.5 h-3.5 text-muted-foreground" />
                      </button>

                      {threadMenuOpenId === thread.id ? (
                        <div className="absolute right-0 mt-1 z-20 w-40 rounded-lg border bg-card shadow-md p-1">
                          <button
                            onClick={() => handleRenameThread(thread)}
                            className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-secondary"
                            disabled={updateThreadMutation.isPending}
                          >
                            Renommer
                          </button>
                          <button
                            onClick={() => handleTogglePinThread(thread)}
                            className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-secondary inline-flex items-center gap-1"
                            disabled={updateThreadMutation.isPending}
                          >
                            {thread.is_pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
                            {thread.is_pinned ? 'Désépingler' : 'Épingler'}
                          </button>
                          <button
                            onClick={() => handleDeleteThread(thread)}
                            className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-red-50 text-red-600 inline-flex items-center gap-1"
                            disabled={deleteThreadMutation.isPending}
                          >
                            <Trash2 className="w-3 h-3" />
                            Supprimer
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              )
            })
          ) : (
            <div className="p-3 text-sm text-muted-foreground">Aucune conversation pour le moment.</div>
          )}
        </div>
      </aside>

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-card lg:rounded-xl lg:border lg:shadow-sm">
        <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2 lg:hidden">
          <button
            ref={threadsButtonRef}
            type="button"
            onClick={() => setThreadsOpen(true)}
            aria-label="Ouvrir les conversations"
            aria-expanded={threadsOpen}
            aria-controls="threads-drawer"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border bg-card hover:bg-secondary"
          >
            <Menu className="h-4 w-4" />
          </button>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">Assistant</span>
          <button
            type="button"
            onClick={() => createThreadMutation.mutate()}
            disabled={createThreadMutation.isPending}
            aria-label="Nouvelle conversation"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border bg-card hover:bg-secondary disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
          </button>
        </header>

        <div
          ref={messagesContainerRef}
          onScroll={handleMessagesScroll}
          className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain bg-secondary/40 p-3 sm:p-4"
        >
          {assistantClosedError ? (
            <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-sm">
              {assistantClosedError}
            </div>
          ) : null}

          {serverError ? (
            <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm">{serverError}</div>
          ) : null}

          {messagesQuery.data?.hasMore ? (
            <div className="flex justify-center">
              <button
                onClick={() => setMessagePageSize((prev) => Math.min(prev + 50, 100))}
                disabled={messagesQuery.isFetching}
                className="text-[11px] px-3 py-1.5 rounded-full border bg-card hover:bg-secondary disabled:opacity-50"
              >
                Charger les messages plus anciens
              </button>
            </div>
          ) : null}

          {!selectedThreadId && !pendingUserMessage ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground">
              <Sparkles className="w-8 h-8 mb-3 text-indigo-400" />
              <p className="font-semibold text-foreground">Bonjour, je suis votre assistant IA</p>
              <p className="text-sm mt-1 max-w-xl">
                Je peux analyser vos ventes, vos dépenses, votre stock et vos performances.
              </p>
              {!hasStore ? (
                <p className="text-sm mt-2 text-amber-700">
                  Sélectionnez une boutique pour lancer une analyse.
                </p>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2 justify-center">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => handleSend(suggestion)}
                    disabled={isAssistantBlocked || sendMessageMutation.isPending}
                    className="text-xs px-3 py-1.5 rounded-full border bg-card hover:bg-secondary disabled:opacity-50"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : messagesQuery.isLoading ? (
            <div className="text-sm text-muted-foreground">Chargement des messages...</div>
          ) : displayMessages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground">
              <p className="font-medium">Commencez votre conversation</p>
              <p className="text-sm">Posez une question business sur vos stores.</p>
              <div className="mt-4 flex flex-wrap gap-2 justify-center">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => handleSend(suggestion)}
                    disabled={isAssistantBlocked || sendMessageMutation.isPending}
                    className="text-xs px-3 py-1.5 rounded-full border bg-card hover:bg-secondary disabled:opacity-50"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            displayMessages.map((msg) => (
              <div
                key={msg.id}
                ref={(node) => {
                  if (msg.role !== 'assistant') return
                  if (node) assistantMessageRefs.current.set(msg.id, node)
                  else assistantMessageRefs.current.delete(msg.id)
                }}
                data-message-role={msg.role}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[92%] break-words rounded-2xl px-3 py-2.5 text-sm leading-6 border sm:max-w-[85%] sm:px-4 ${
                    msg.role === 'user'
                      ? 'bg-primary text-white border-blue-600'
                      : 'bg-card text-foreground border-border'
                  }`}
                >
                  <div className="space-y-1">{renderMessageContent(msg.content)}</div>

                  {msg.role === 'assistant' && msg.metadata?.structured_response?.metrics_summary?.length ? (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {sanitizeMetricsSummary(msg.metadata.structured_response.metrics_summary).map((metric) => (
                        <span
                          key={`${metric.label}-${metric.value}`}
                          className="inline-flex items-baseline gap-1 rounded-md border border-border bg-secondary/70 px-2 py-1"
                        >
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{metric.label}</span>
                          <span className="text-[12px] font-semibold text-foreground">{metric.value}</span>
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {msg.role === 'assistant' &&
                  msg.metadata?.structured_response &&
                  hasUsableChart(msg.metadata.structured_response) ? (
                    <AssistantChartCard response={msg.metadata.structured_response} />
                  ) : null}

                  {msg.role === 'assistant' && msg.metadata?.structured_response?.warnings?.length ? (
                    <AssistantWarnings warnings={msg.metadata.structured_response.warnings} />
                  ) : null}

                  {msg.role === 'assistant' && msg.metadata?.structured_response?.suggestions?.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {msg.metadata.structured_response.suggestions.slice(0, 5).map((suggestion) => (
                        <button
                          key={suggestion}
                          onClick={() => handleSend(suggestion)}
                          disabled={isAssistantBlocked || sendMessageMutation.isPending}
                          className="text-[11px] px-2.5 py-1 rounded-full border bg-card hover:bg-secondary"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {msg.role === 'assistant' && msg.credits_used > 0 ? (
                    <div className="mt-1 text-[11px] text-muted-foreground">Crédits: {msg.credits_used}</div>
                  ) : null}
                </div>
              </div>
            ))
          )}

          {sendMessageMutation.isPending ? (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-2xl px-4 py-2.5 text-sm border bg-card text-foreground border-border">
                Assistant en train d’écrire...
                <AssistantActivityTrace steps={liveActivitySteps.slice(0, loadingStepIndex + 1)} />
              </div>
            </div>
          ) : null}

          <div ref={messagesEndRef} />
        </div>

        <div className="shrink-0 border-t bg-card px-2 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-3">
          {warning ? (
            <div className="mb-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              {warning}
            </div>
          ) : null}

          {isNoCredits ? (
            <div className="mb-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              Vous n’avez plus de crédits IA.
            </div>
          ) : null}

          {transcribing ? (
            <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Transcription en cours…
            </div>
          ) : null}

          {voiceError ? (
            <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {voiceError}
            </div>
          ) : null}

          <div className="flex items-end gap-2">
            <div
              className={`relative flex-1 rounded-lg border bg-card transition-colors focus-within:ring-2 focus-within:ring-primary ${
                recording ? 'border-primary/40 bg-primary/[0.04]' : ''
              }`}
            >
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    if (input.trim() && !recording && !transcribing && !isAssistantBlocked && !sendMessageMutation.isPending) {
                      handleSend(input)
                    }
                  }
                }}
                placeholder="Posez votre question business..."
                rows={2}
                aria-label="Message à envoyer"
                className={`w-full resize-none rounded-lg border-0 bg-transparent px-3 py-2 text-sm focus:outline-none ${
                  recording ? 'invisible' : ''
                }`}
                disabled={isAssistantBlocked || sendMessageMutation.isPending || !hasStore}
              />

              {recording ? (
                <div
                  role="group"
                  aria-label="Enregistrement en cours"
                  className="absolute inset-0 flex items-center gap-2 rounded-lg px-3"
                >
                  <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/50" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                  </span>
                  <canvas
                    ref={waveformCanvasRef}
                    aria-hidden
                    className="h-8 min-w-0 flex-1 text-primary"
                  />
                  <span
                    role="status"
                    aria-live="polite"
                    className="w-9 shrink-0 text-center text-[11px] font-medium tabular-nums text-foreground/80"
                  >
                    {formatDuration(recordSeconds)}
                  </span>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      onClick={cancelRecording}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary"
                      title="Annuler l’enregistrement"
                      aria-label="Annuler l’enregistrement"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => stopRecording('insert')}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-primary/30 bg-card text-primary hover:bg-primary/10"
                      title="Arrêter et insérer le texte"
                      aria-label="Arrêter et insérer le texte"
                    >
                      <Square className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => stopRecording('send')}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary text-white hover:bg-primary/90"
                      title="Arrêter et envoyer"
                      aria-label="Arrêter et envoyer"
                    >
                      <Send className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <button
              type="button"
              onClick={startRecording}
              disabled={recording || transcribing || isAssistantBlocked || sendMessageMutation.isPending || !hasStore}
              className={`inline-flex h-10 w-10 items-center justify-center rounded-lg border bg-card text-foreground hover:bg-secondary disabled:opacity-50 ${
                recording ? 'invisible' : ''
              }`}
              title="Dicter un message"
              aria-label="Dicter un message"
            >
              <Mic className="h-4 w-4" />
            </button>
            <button
              onClick={() => handleSend(input)}
              disabled={!input.trim() || recording || transcribing || isAssistantBlocked || sendMessageMutation.isPending || !hasStore}
              className={`inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50 ${
                recording ? 'invisible' : ''
              }`}
            >
              <Send className="w-4 h-4" />
            </button>
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            {latestAssistantSuggestions.slice(0, 4).map((suggestion) => (
              <button
                key={`bottom-${suggestion}`}
                onClick={() => handleSend(suggestion)}
                disabled={isAssistantBlocked || sendMessageMutation.isPending}
                className="text-[11px] px-2.5 py-1 rounded-full border bg-secondary hover:bg-secondary"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
