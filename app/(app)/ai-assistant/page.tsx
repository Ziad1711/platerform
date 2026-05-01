'use client'

import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageSquare, MoreVertical, Pin, PinOff, Plus, Send, Sparkles, Trash2, Wallet } from 'lucide-react'
import AssistantChartCard from '@/components/assistant/assistant-chart-card'
import type { AssistantStructuredResponse } from '@/lib/assistant/types'
import { useStore } from '@/lib/store-context'

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

export default function AssistantIAPage() {
  const queryClient = useQueryClient()
  const { currentStoreId } = useStore()

  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [serverError, setServerError] = useState<string | null>(null)
  const [optimisticUserMessage, setOptimisticUserMessage] = useState<string | null>(null)
  const [threadMenuOpenId, setThreadMenuOpenId] = useState<string | null>(null)
  const [loadingStepIndex, setLoadingStepIndex] = useState(0)
  const messagesContainerRef = useRef<HTMLDivElement | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  const canLoad = true

  const threadsQuery = useQuery<{ threads: ThreadItem[] }>({
    queryKey: ['assistant-threads'],
    enabled: canLoad,
    queryFn: async () => {
      const res = await fetch('/api/assistant/threads')
      if (!res.ok) throw new Error('Impossible de charger les conversations')
      return res.json()
    },
  })

  const walletQuery = useQuery<{ wallet: WalletResponse }>({
    queryKey: ['assistant-wallet'],
    queryFn: async () => {
      const res = await fetch('/api/assistant/wallet')
      if (!res.ok) throw new Error('Impossible de charger vos crédits IA')
      return res.json()
    },
  })

  const selectedThreadId = activeThreadId || threadsQuery.data?.threads?.[0]?.id || null

  const messagesQuery = useQuery<{ messages: ChatMessage[] }>({
    queryKey: ['assistant-messages', selectedThreadId],
    enabled: canLoad && Boolean(selectedThreadId),
    queryFn: async () => {
      const res = await fetch(`/api/assistant/threads/${selectedThreadId}/messages`)
      if (!res.ok) throw new Error('Impossible de charger les messages')
      return res.json()
    },
  })

  const createThreadMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/assistant/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId: currentStoreId, title: 'Nouvelle conversation' }),
      })
      if (!res.ok) throw new Error('Impossible de créer la conversation')
      return res.json() as Promise<{ thread: ThreadItem }>
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['assistant-threads'] })
      setActiveThreadId(data.thread.id)
      setServerError(null)
      setTimeout(() => inputRef.current?.focus(), 0)
    },
    onError: (error) => {
      setServerError(error instanceof Error ? error.message : 'Erreur de création')
    },
  })

  const sendMessageMutation = useMutation({
    mutationFn: async (payload: { message: string; threadId: string | null }) => {
      const res = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId: currentStoreId,
          threadId: payload.threadId,
          message: payload.message,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Erreur Assistant IA')
      return data
    },
    onSuccess: async (data) => {
      if (data.threadId) {
        setActiveThreadId(data.threadId)
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['assistant-threads'] }),
        queryClient.invalidateQueries({ queryKey: ['assistant-messages', data.threadId || selectedThreadId] }),
        queryClient.invalidateQueries({ queryKey: ['assistant-wallet'] }),
      ])
      setServerError(null)
      setOptimisticUserMessage(null)
    },
    onError: (error) => {
      setServerError(error instanceof Error ? error.message : 'Erreur d’envoi')
      setOptimisticUserMessage(null)
    },
  })

  const updateThreadMutation = useMutation({
    mutationFn: async (payload: { threadId: string; action: 'rename' | 'toggle_pin'; title?: string; isPinned?: boolean }) => {
      const res = await fetch(`/api/assistant/threads/${payload.threadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Erreur de mise à jour')
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

      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Erreur de suppression')
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

  const handleSend = async (message: string) => {
    const clean = message.trim()
    if (!clean) return
    setServerError(null)
    setOptimisticUserMessage(clean)
    setInput('')

    try {
      await sendMessageMutation.mutateAsync({ message: clean, threadId: selectedThreadId })
    } catch {
      setInput(clean)
    }
  }

  const messages = useMemo(() => messagesQuery.data?.messages || [], [messagesQuery.data?.messages])
  const displayMessages = useMemo(() => {
    if (!optimisticUserMessage) return messages

    return [
      ...messages,
      {
        id: 'optimistic-user-message',
        thread_id: selectedThreadId || 'pending-thread',
        role: 'user' as const,
        content: optimisticUserMessage,
        credits_used: 0,
        created_at: new Date().toISOString(),
      },
    ]
  }, [messages, optimisticUserMessage, selectedThreadId])

  const latestAssistantSuggestions = useMemo(() => {
    const lastAssistant = [...displayMessages]
      .reverse()
      .find((m) => m.role === 'assistant' && m.metadata?.structured_response?.suggestions?.length)

    return lastAssistant?.metadata?.structured_response?.suggestions || SUGGESTIONS
  }, [displayMessages])

  const liveActivitySteps = useMemo(() => {
    const source = (optimisticUserMessage || input || '').toLowerCase()
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
  }, [optimisticUserMessage, input])

  useEffect(() => {
    if (!sendMessageMutation.isPending) {
      setLoadingStepIndex(0)
      return
    }

    setLoadingStepIndex(0)
    const timer = setInterval(() => {
      setLoadingStepIndex((prev) => Math.min(prev + 1, Math.max(0, liveActivitySteps.length - 1)))
    }, 1100)

    return () => clearInterval(timer)
  }, [sendMessageMutation.isPending, liveActivitySteps.length])

  useEffect(() => {
    if (!messagesContainerRef.current) return
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [displayMessages.length, sendMessageMutation.isPending, selectedThreadId])

  return (
    <div className="h-full min-h-0 grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4 p-4">
      <aside className="bg-card rounded-xl border shadow-sm flex flex-col overflow-hidden min-h-0">
        <div className="p-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-2 text-foreground font-semibold">
            <MessageSquare className="w-4 h-4" />
            Conversations
          </div>
          <button
            onClick={() => createThreadMutation.mutate()}
            disabled={createThreadMutation.isPending}
            className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md bg-primary text-white hover:bg-primary/90 disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" />
            Nouvelle
          </button>
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
                    <button onClick={() => setActiveThreadId(thread.id)} className="flex-1 text-left min-w-0 px-1 py-1">
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

      <section className="bg-card rounded-xl border shadow-sm flex flex-col overflow-hidden min-h-0">

        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-secondary/40">
          {serverError ? (
            <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm">{serverError}</div>
          ) : null}

          {!selectedThreadId && !optimisticUserMessage ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground">
              <Sparkles className="w-8 h-8 mb-3 text-indigo-400" />
              <p className="font-semibold text-foreground">Bonjour, je suis votre assistant IA</p>
              <p className="text-sm mt-1 max-w-xl">
                Je peux analyser vos ventes, vos dépenses, votre stock et vos performances.
              </p>
              <div className="mt-4 flex flex-wrap gap-2 justify-center">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => handleSend(suggestion)}
                    disabled={isNoCredits || sendMessageMutation.isPending}
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
                    disabled={isNoCredits || sendMessageMutation.isPending}
                    className="text-xs px-3 py-1.5 rounded-full border bg-card hover:bg-secondary disabled:opacity-50"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            displayMessages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-6 border ${
                    msg.role === 'user'
                      ? 'bg-primary text-white border-blue-600'
                      : 'bg-card text-foreground border-border'
                  }`}
                >
                  <div className="space-y-1">{renderMessageContent(msg.content)}</div>
                  {msg.role === 'assistant' && msg.metadata?.structured_response ? (
                    <AssistantChartCard response={msg.metadata.structured_response} />
                  ) : null}

                  {msg.role === 'assistant' && msg.metadata?.structured_response?.warnings?.length ? (
                    <div className="mt-2 space-y-1">
                      {msg.metadata.structured_response.warnings.map((warning, idx) => (
                        <div key={`${warning}-${idx}`} className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">
                          {warning}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {msg.role === 'assistant' && msg.metadata?.structured_response?.suggestions?.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {msg.metadata.structured_response.suggestions.slice(0, 5).map((suggestion) => (
                        <button
                          key={suggestion}
                          onClick={() => handleSend(suggestion)}
                          disabled={isNoCredits || sendMessageMutation.isPending}
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

        <div className="p-3 border-t bg-card">
          {isNoCredits ? (
            <div className="mb-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              Vous n’avez plus de crédits IA.
            </div>
          ) : null}

          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  if (input.trim() && !isNoCredits && !sendMessageMutation.isPending) {
                    handleSend(input)
                  }
                }
              }}
              placeholder="Posez votre question business..."
              rows={2}
              className="flex-1 resize-none rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              disabled={isNoCredits || sendMessageMutation.isPending}
            />
            <button
              onClick={() => handleSend(input)}
              disabled={!input.trim() || isNoCredits || sendMessageMutation.isPending}
              className="h-10 w-10 rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50 inline-flex items-center justify-center"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            {latestAssistantSuggestions.slice(0, 4).map((suggestion) => (
              <button
                key={`bottom-${suggestion}`}
                onClick={() => handleSend(suggestion)}
                disabled={isNoCredits || sendMessageMutation.isPending}
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
