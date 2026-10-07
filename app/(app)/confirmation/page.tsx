'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import StoreSelector from '@/components/dashboard/store-selector'
import ConfirmationKpis from '@/components/dashboard/confirmation/confirmation-kpis'
import ConfirmationOrderCard from '@/components/dashboard/confirmation/confirmation-order-card'
import PostponeOrderDialog from '@/components/dashboard/confirmation/postpone-order-dialog'
import CancelOrderDialog from '@/components/dashboard/confirmation/cancel-order-dialog'
import ConfirmOrderDialog from '@/components/dashboard/confirmation/confirm-order-dialog'
import OrderConfirmationDetails from '@/components/dashboard/confirmation/order-confirmation-details'
import OrderEditDialog from '@/components/dashboard/confirmation/order-edit-dialog'
import { JisraMark } from '@/components/logo'
import { useStore } from '@/lib/store-context'
import { usePermissions } from '@/lib/auth/use-permissions'
import { DEFAULT_MAX_ATTEMPTS } from '@/lib/confirmation/constants'
import type { ConfirmationAction } from '@/lib/confirmation/constants'
import type {
  ConfirmationOrder,
  ConfirmationQueueFilter,
  ConfirmationSettings,
  ConfirmationSortOrder,
} from '@/lib/confirmation/types'
import { getSortOptions } from '@/lib/confirmation/queries'
import type { ConfirmationDeliveryOptions } from '@/lib/confirmation/delivery-options'
import type { ConfirmationProgressStage, ConfirmOutcome } from '@/lib/confirmation/progress'

const FILTER_TABS: { value: ConfirmationQueueFilter; label: string }[] = [
  { value: 'all', label: 'Toutes les commandes' },
  { value: 'to_process', label: 'À traiter' },
  { value: 'to_callback', label: 'À rappeler' },
  { value: 'late', label: 'En retard' },
  { value: 'confirmed', label: 'Confirmées' },
  { value: 'cancelled', label: 'Annulées' },
]

type QueueResponse = {
  settings: ConfirmationSettings
  orders: ConfirmationOrder[]
  counts: Record<string, number>
}

type ActionPayload = {
  action?: ConfirmationAction
  status?: string
  attemptNumber?: number | null
  attemptCount?: number
  maxAttempts?: number
  autoCancelled?: boolean
  parcel?: { created: boolean; trackingNumber: string | null; warning: string | null }
}

/** Vues dépendantes du statut des commandes : rafraîchies après une confirmation. */
function invalidateSalesViews(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ['orders'] })
  queryClient.invalidateQueries({ queryKey: ['dashboard-kpis'] })
  queryClient.invalidateQueries({ queryKey: ['dashboard-business-trends'] })
  queryClient.invalidateQueries({ queryKey: ['dashboard-profit-chart'] })
  queryClient.invalidateQueries({ queryKey: ['dashboard-top-products'] })
  queryClient.invalidateQueries({ queryKey: ['dashboard-ads-cost-chart'] })
  queryClient.invalidateQueries({ queryKey: ['dashboard-recent-orders'] })
  queryClient.invalidateQueries({ queryKey: ['dashboard-city-performance'] })
  queryClient.invalidateQueries({ queryKey: ['dashboard-confirmation-performance'] })
  queryClient.invalidateQueries({ queryKey: ['finance-kpi-summary'] })
}

function getTodayStartIso() {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  return start.toISOString()
}

/** Délais (ms) entre deux relectures d'une confirmation interrompue (fenêtre ≈ 17 s). */
const VERIFICATION_POLL_DELAYS = [0, 600, 1200, 2000, 3000, 4500, 6000]

/** Clé de persistance de la tentative en cours de vérification (survit au rechargement). */
const PENDING_ATTEMPT_STORAGE_KEY = 'confirmation:pending-attempt'

type PendingAttempt = { orderId: string; attemptId: string | null }

/** État observé en relisant une confirmation côté serveur. */
type ConfirmationReadState =
  | 'confirmed'
  | 'not_confirmed'
  | 'in_progress'
  | 'absent'
  | 'unreachable'

/** Identifiant unique de tentative, au format UUID v4. */
function createAttemptId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

/**
 * Relit l'état réel d'une tentative de confirmation :
 * `confirmed` (appliquée), `not_confirmed` (échouée de façon définitive),
 * `in_progress` (toujours en cours), `absent` (jamais enregistrée côté serveur)
 * ou `unreachable` (serveur injoignable : aucune conclusion possible).
 */
async function readConfirmationState(
  orderId: string,
  attemptId: string | null
): Promise<ConfirmationReadState> {
  const params = new URLSearchParams({ orderId })
  if (attemptId) params.set('attemptId', attemptId)

  let response: Response
  try {
    response = await fetch(`/api/orders/confirmation/action?${params.toString()}`)
  } catch {
    return 'unreachable'
  }
  if (!response.ok) return 'unreachable'

  const payload = await response.json().catch(() => null)
  const status = payload?.order?.status ? String(payload.order.status) : null
  if (!status) return 'unreachable'
  if (status === 'confirmed') return 'confirmed'

  const attemptState = payload?.attempt?.state ? String(payload.attempt.state) : null
  if (!attemptState) return 'absent'
  if (attemptState === 'failed') return 'not_confirmed'
  // `succeeded` avec une commande non confirmée (état incohérent) : on reste prudent.
  return 'in_progress'
}

/**
 * Interroge le serveur jusqu'à obtenir un verdict fiable. Tant que la tentative est
 * en cours ou que le serveur est injoignable, on ne conclut pas : le renvoi reste
 * verrouillé. Un `not_confirmed` n'est retenu que si la tentative a été identifiée
 * côté serveur et que son échec est définitif.
 */
async function resolveConfirmationVerdict(
  orderId: string,
  attemptId: string | null
): Promise<'confirmed' | 'not_confirmed' | 'unknown'> {
  for (let index = 0; index < VERIFICATION_POLL_DELAYS.length; index += 1) {
    if (index > 0) await wait(VERIFICATION_POLL_DELAYS[index])

    const state = await readConfirmationState(orderId, attemptId)
    if (state === 'confirmed') return 'confirmed'
    if (state === 'not_confirmed') return 'not_confirmed'
  }

  // Reste « en cours », « absente » ou « injoignable » : la requête initiale peut
  // encore aboutir — tentative toujours en cours d'exécution, ou requête encore en
  // route vers le serveur (l'enregistrement de la tentative peut ne pas encore
  // exister). Seul un échec définitif prouve qu'une nouvelle tentative est sûre ;
  // sinon on ne conclut pas et le renvoi reste verrouillé.
  return 'unknown'
}

function readPendingAttempt(): PendingAttempt | null {
  try {
    const raw = window.localStorage.getItem(PENDING_ATTEMPT_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PendingAttempt
    if (!parsed || typeof parsed.orderId !== 'string') return null
    return {
      orderId: parsed.orderId,
      attemptId: parsed.attemptId ? String(parsed.attemptId) : null,
    }
  } catch {
    return null
  }
}

function writePendingAttempt(value: PendingAttempt) {
  try {
    window.localStorage.setItem(PENDING_ATTEMPT_STORAGE_KEY, JSON.stringify(value))
  } catch {
    // Persistance best-effort : son échec ne doit pas casser la vérification.
  }
}

function clearPendingAttempt() {
  try {
    window.localStorage.removeItem(PENDING_ATTEMPT_STORAGE_KEY)
  } catch {
    // Ignoré.
  }
}

export default function ConfirmationPage() {
  const { currentStoreId } = useStore()
  const { can, isLoading: isPermissionsLoading } = usePermissions(currentStoreId)
  const queryClient = useQueryClient()

  const canProcess = can('confirmation.process')
  const canEdit = can('confirmation.edit')
  const [filter, setFilter] = useState<ConfirmationQueueFilter>('all')
  const [sort, setSort] = useState<ConfirmationSortOrder>('recent')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [todayStart] = useState(getTodayStartIso)

  const PAGE_SIZE = 40

  // Évite une requête serveur à chaque frappe.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput)
      setPage(1)
    }, 400)

    return () => clearTimeout(timer)
  }, [searchInput])

  const [postponeOrder, setPostponeOrder] = useState<ConfirmationOrder | null>(null)
  const [cancelOrder, setCancelOrder] = useState<ConfirmationOrder | null>(null)
  const [confirmOrder, setConfirmOrder] = useState<ConfirmationOrder | null>(null)
  // Résultat final de la confirmation en cours, affiché dans la modale.
  const [confirmOutcome, setConfirmOutcome] = useState<ConfirmOutcome | null>(null)
  // Commande dont l'état est vérifié après une coupure de flux (bloque tout renvoi).
  const [verifyingOrderId, setVerifyingOrderId] = useState<string | null>(null)
  // Identifiant de la tentative de confirmation en cours (transmis au serveur).
  const confirmAttemptIdRef = useRef<string | null>(null)
  // Verdict non tranché : tant qu'il l'est, fermer la modale ne doit pas débloquer.
  const confirmVerdictUnresolvedRef = useRef(false)
  const [detailsOrder, setDetailsOrder] = useState<ConfirmationOrder | null>(null)
  const [editOrder, setEditOrder] = useState<ConfirmationOrder | null>(null)

  // Après un rechargement pendant une vérification en cours : on relit l'état de la
  // tentative avant d'autoriser une nouvelle confirmation. Tant que le verdict est
  // indéterminé, la commande concernée reste verrouillée.
  useEffect(() => {
    const pending = readPendingAttempt()
    if (!pending) return

    let cancelled = false
    setVerifyingOrderId(pending.orderId)
    confirmVerdictUnresolvedRef.current = true

    void resolveConfirmationVerdict(pending.orderId, pending.attemptId).then((verdict) => {
      if (cancelled) return

      if (verdict === 'confirmed') {
        confirmVerdictUnresolvedRef.current = false
        clearPendingAttempt()
        setVerifyingOrderId(null)
        void queryClient.invalidateQueries({ queryKey: ['confirmation-queue'] })
        toast.success('Commande confirmée. Vérifiez le colis avant toute autre action.')
        return
      }

      if (verdict === 'not_confirmed') {
        confirmVerdictUnresolvedRef.current = false
        clearPendingAttempt()
        setVerifyingOrderId(null)
        void queryClient.invalidateQueries({ queryKey: ['confirmation-queue'] })
        return
      }

      toast.error(
        'État de la commande toujours incertain. Vérifiez chez le transporteur avant de réessayer.'
      )
    })

    return () => {
      cancelled = true
    }
  }, [queryClient])

  // Fermeture automatique de la modale dès que la confirmation est réellement
  // terminée : toutes les étapes (validation, confirmation, ville, colis) sont
  // atteintes et le colis est créé. Un colis en échec ou au résultat inconnu
  // reste affiché : l'agent doit en être averti avant de fermer.
  useEffect(() => {
    if (!confirmOrder || !confirmOutcome) return
    if (confirmVerdictUnresolvedRef.current) return
    if (confirmOutcome.parcelUnknown) return
    if (confirmOutcome.parcel && !confirmOutcome.parcel.created) return

    // Un court délai laisse apparaître la dernière étape terminée avant la fermeture.
    const timer = setTimeout(() => {
      setConfirmOrder(null)
      setConfirmOutcome(null)
    }, 1200)

    return () => clearTimeout(timer)
  }, [confirmOrder, confirmOutcome])

  const { data, isLoading, isFetching } = useQuery<QueueResponse>({
    queryKey: ['confirmation-queue', currentStoreId, filter, sort, search, todayStart, page],
    enabled: Boolean(currentStoreId),
    queryFn: async () => {
      const params = new URLSearchParams({
        storeId: String(currentStoreId),
        filter,
        sort,
        todayStart,
        limit: String(PAGE_SIZE),
        offset: String((page - 1) * PAGE_SIZE),
      })
      if (search.trim()) params.set('search', search.trim())

      const response = await fetch(`/api/orders/confirmation/queue?${params.toString()}`)
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.error || 'CONFIRMATION_QUEUE_FETCH_FAILED')
      }
      return payload as QueueResponse
    },
  })

  const maxAttempts = Number(data?.settings?.max_attempts || DEFAULT_MAX_ATTEMPTS)
  const orders = useMemo(() => data?.orders || [], [data?.orders])

  // Étapes réellement atteintes pendant la confirmation en cours (flux SSE).
  const [confirmProgress, setConfirmProgress] = useState<ConfirmationProgressStage[]>([])

  /**
   * Consomme le flux de progression de la confirmation : chaque événement
   * `progress` reflète une étape réellement terminée côté serveur, et un unique
   * événement terminal (`result` ou `error`) clôt l'appel. Si le flux est coupé
   * sans verdict, on refuse de considérer la confirmation comme acquise.
   */
  const runConfirmStream = async (requestBody: Record<string, unknown>): Promise<ActionPayload> => {
    setConfirmProgress([])

    let response: Response
    try {
      response = await fetch('/api/orders/confirmation/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ ...requestBody, stream: true }),
      })
    } catch {
      // Coupure avant même d'atteindre le serveur : verdict inconnu côté client.
      throw new Error('CONFIRMATION_STREAM_INTERRUPTED')
    }

    const contentType = response.headers.get('content-type') || ''
    // Réponse non exploitable en flux : soit une vraie erreur métier (JSON), soit une
    // réponse illisible — dans ce dernier cas on ne peut pas conclure.
    if (!response.ok || !response.body || !contentType.includes('text/event-stream')) {
      const payload = await response.json().catch(() => null)
      if (payload?.error) throw new Error(String(payload.error))
      if (response.ok && payload && typeof payload === 'object') return payload as ActionPayload
      throw new Error('CONFIRMATION_STREAM_INTERRUPTED')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let result: ActionPayload | null = null
    let failure: string | null = null

    while (true) {
      let readResult: ReadableStreamReadResult<Uint8Array>
      try {
        readResult = await reader.read()
      } catch {
        // Flux coupé pendant la lecture : on retombe sur l'analyse terminale ci-dessous.
        break
      }
      const { value, done } = readResult
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      while (buffer.includes('\n\n')) {
        const boundary = buffer.indexOf('\n\n')
        const chunk = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)

        const dataLine = chunk.split('\n').find((line) => line.startsWith('data:'))
        if (!dataLine) continue
        const raw = dataLine.slice(5).trim()
        if (!raw) continue

        let event: { type?: string; stage?: string; result?: unknown; error?: string }
        try {
          event = JSON.parse(raw)
        } catch {
          continue
        }

        if (event.type === 'progress' && typeof event.stage === 'string') {
          const stage = event.stage as ConfirmationProgressStage
          setConfirmProgress((previous) =>
            previous.includes(stage) ? previous : [...previous, stage]
          )
        } else if (event.type === 'result') {
          result = (event.result || {}) as ActionPayload
        } else if (event.type === 'error') {
          failure = event.error || 'CONFIRMATION_ACTION_FAILED'
        }
      }
    }

    if (failure) throw new Error(failure)
    if (!result) throw new Error('CONFIRMATION_STREAM_INTERRUPTED')
    return result
  }

  const actionMutation = useMutation({
    mutationFn: async (input: {
      order: ConfirmationOrder
      action: ConfirmationAction
      callbackAt?: string
      reasonCode?: string
      note?: string
      deliveryMode?: 'internal' | 'shipping'
      deliveryCompanyId?: string | null
      deliveryOptions?: ConfirmationDeliveryOptions
    }) => {
      const requestBody = {
        orderId: input.order.id,
        action: input.action,
        callbackAt: input.callbackAt ?? null,
        reasonCode: input.reasonCode ?? null,
        note: input.note ?? null,
        deliveryMode: input.deliveryMode ?? null,
        deliveryCompanyId: input.deliveryCompanyId ?? null,
        deliveryOptions: input.deliveryOptions ?? null,
        // Détection de concurrence : un autre agent a peut-être déjà traité la commande.
        expectedStatus: input.order.status,
        expectedAttemptCount: Number(input.order.confirmation_attempt_count || 0),
      }

      // La confirmation pilote un flux d'étapes réelles (SSE) pour afficher la
      // progression : validation, confirmation, recherche ville, IA, colis.
      if (input.action === 'CONFIRM') {
        // Identifiant unique de cette tentative : permet au serveur (et à la relecture
        // après coupure) de distinguer « en cours » de « non appliquée ».
        const attemptId = createAttemptId()
        confirmAttemptIdRef.current = attemptId
        return await runConfirmStream({ ...requestBody, attemptId })
      }

      const response = await fetch('/api/orders/confirmation/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })

      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.error || 'CONFIRMATION_ACTION_FAILED')
      }
      return payload as ActionPayload
    },
    onMutate: async ({ order, action, callbackAt }) => {
      // Retour visuel immédiat : la commande affichée (statut, compteur d'appels,
      // prochain rappel) reflète l'action sans attendre le rechargement de la file.
      await queryClient.cancelQueries({ queryKey: ['confirmation-queue'] })
      const previousQueues = queryClient.getQueriesData({ queryKey: ['confirmation-queue'] })
      const nowIso = new Date().toISOString()
      queryClient.setQueriesData({ queryKey: ['confirmation-queue'] }, (old: any) => {
        if (!old || !Array.isArray(old.orders)) return old
        return {
          ...old,
          orders: old.orders.map((queuedOrder: any) => {
            if (queuedOrder?.id !== order.id) return queuedOrder
            const nextStatus =
              action === 'CONFIRM'
                ? 'confirmed'
                : action === 'CANCEL'
                  ? 'cancelled'
                  : queuedOrder.status
            const currentAttempts = Number(queuedOrder.confirmation_attempt_count || 0)
            return {
              ...queuedOrder,
              status: nextStatus,
              confirmation_attempt_count:
                action === 'NO_ANSWER' ? currentAttempts + 1 : currentAttempts,
              confirmation_last_action_at: nowIso,
              next_callback_at:
                action === 'POSTPONE' && callbackAt ? callbackAt : queuedOrder.next_callback_at,
            }
          }),
        }
      })
      return { previousQueues }
    },
    onSuccess: (payload, variables) => {
      setPostponeOrder(null)
      setCancelOrder(null)
      // Réconciliation avec la vérité serveur : le statut réel (par ex. annulation
      // automatique après « Pas de réponse ») et le compteur d'appels renvoyés par
      // l'API sont appliqués immédiatement, sans attendre le rechargement de la file.
      const finalStatus = typeof payload?.status === 'string' ? payload.status : null
      const serverAttempts = Number(payload?.attemptCount)
      if (finalStatus || Number.isFinite(serverAttempts)) {
        queryClient.setQueriesData({ queryKey: ['confirmation-queue'] }, (old: any) => {
          if (!old || !Array.isArray(old.orders)) return old
          return {
            ...old,
            orders: old.orders.map((queuedOrder: any) =>
              queuedOrder?.id === variables.order.id
                ? {
                    ...queuedOrder,
                    ...(finalStatus ? { status: finalStatus } : {}),
                    ...(Number.isFinite(serverAttempts)
                      ? { confirmation_attempt_count: serverAttempts }
                      : {}),
                  }
                : queuedOrder
            ),
          }
        })
      }
      // Rafraîchissement en arrière-plan : le message de succès et le déblocage
      // des boutons n'attendent pas le rechargement de la file.
      void queryClient.invalidateQueries({ queryKey: ['confirmation-queue'] })

      if (payload?.action === 'CONFIRM') {
        // Une confirmation touche le statut, la livraison et les colis : les vues
        // ventes et tableaux de bord doivent refléter le changement.
        invalidateSalesViews(queryClient)
        // Le résultat final reste affiché dans la modale : l'agent ne doit pas le
        // perdre dans une notification fugace.
        setConfirmOutcome({
          status: typeof payload.status === 'string' ? payload.status : 'confirmed',
          parcel: payload.parcel || null,
        })
        if (payload.parcel?.created) {
          toast.success(`Commande confirmée. Colis créé (${payload.parcel.trackingNumber}).`)
        } else if (payload.parcel?.warning) {
          toast.warning(`Commande confirmée, mais création du colis échouée : ${payload.parcel.warning}`)
        } else {
          toast.success('Commande confirmée.')
        }
        return
      }

      setConfirmOrder(null)

      if (payload?.autoCancelled) {
        toast.info(
          `Appel ${payload.attemptNumber} enregistré. Limite atteinte : la commande a été annulée automatiquement.`
        )
        return
      }

      if (payload?.action === 'NO_ANSWER') {
        toast.success(
          `Appel ${payload.attemptNumber} enregistré (${payload.attemptCount}/${payload.maxAttempts}).`
        )
        return
      }
      if (payload?.action === 'POSTPONE') {
        toast.success('Rappel programmé.')
        return
      }
      if (payload?.action === 'CANCEL') {
        toast.success('Commande annulée.')
      }
    },
    onError: async (error, variables, context: any) => {
      const message = error instanceof Error ? error.message : 'CONFIRMATION_ACTION_FAILED'

      // Flux coupé sans verdict : impossible de déduire l'état côté client. On bloque
      // tout renvoi et on relit l'état réel de la commande avant d'autoriser une
      // nouvelle tentative (le serveur reste de toute façon garde-fou).
      if (message.includes('CONFIRMATION_STREAM_INTERRUPTED') && variables?.order?.id) {
        const orderId = String(variables.order.id)
        const attemptId = confirmAttemptIdRef.current

        setVerifyingOrderId(orderId)
        confirmVerdictUnresolvedRef.current = true
        // La tentative est persistée : un rechargement rejouera la vérification.
        writePendingAttempt({ orderId, attemptId })

        // Verdict de la relecture : confirmée, non confirmée, ou indéterminé.
        const verdict = await resolveConfirmationVerdict(orderId, attemptId)

        void queryClient.invalidateQueries({ queryKey: ['confirmation-queue'] })

        if (verdict === 'confirmed') {
          // La confirmation a bien été appliquée : le colis peut avoir été créé.
          confirmVerdictUnresolvedRef.current = false
          clearPendingAttempt()
          setVerifyingOrderId(null)
          setConfirmOutcome({ status: 'confirmed', parcel: null, parcelUnknown: true })
          toast.success('Commande confirmée. Vérifiez le colis avant toute autre action.')
          return
        }

        if (verdict === 'not_confirmed') {
          // La commande n'a pas été confirmée : une nouvelle tentative est sûre.
          confirmVerdictUnresolvedRef.current = false
          clearPendingAttempt()
          setVerifyingOrderId(null)
          if (Array.isArray(context?.previousQueues)) {
            for (const [key, data] of context.previousQueues) {
              queryClient.setQueryData(key, data)
            }
          }
          setConfirmOrder(null)
          toast.error('Confirmation interrompue : la commande n’a pas été confirmée. Réessayez.')
          return
        }

        // Verdict indéterminé : l'état réel est inconnu. On garde le renvoi bloqué (busy)
        // et on exige un rechargement : l'état sera revérifié avant toute nouvelle
        // tentative, et la modale ne peut plus être fermée à l'aveugle.
        toast.error(
          'Résultat incertain : rechargez la page pour vérifier l’état de la commande avant de réessayer.'
        )
        return
      }

      if (Array.isArray(context?.previousQueues)) {
        for (const [key, data] of context.previousQueues) {
          queryClient.setQueryData(key, data)
        }
      }
      if (message.includes('ORDER_ALREADY_UPDATED')) {
        toast.error('Cette commande vient d’être modifiée par un autre utilisateur. La liste a été actualisée.')
      } else if (message.includes('ORDER_NOT_CONFIRMABLE')) {
        toast.error('Cette commande est déjà confirmée ou annulée.')
      } else {
        toast.error(message)
      }
      void queryClient.invalidateQueries({ queryKey: ['confirmation-queue'] })
    },
  })

  const handleNoAnswer = (order: ConfirmationOrder) => {
    const attempts = Number(order.confirmation_attempt_count || 0)
    const isLastAttempt = attempts + 1 >= maxAttempts

    if (isLastAttempt) {
      const confirmed = window.confirm(
        `Cette action enregistrera l’appel ${maxAttempts} et annulera automatiquement la commande. Continuer ?`
      )
      if (!confirmed) return
    }

    actionMutation.mutate({ order, action: 'NO_ANSWER' })
  }


  return (
    <div className="space-y-5">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex flex-col items-center md:items-start gap-1">
          <div className="flex items-center gap-2">
            <JisraMark size={28} />
            <span className="text-lg font-bold text-[#1fa971] bg-[#1fa971]/10 px-3 py-1 rounded-full">
              Confirmation
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Traitez les commandes en attente : appels, rappels, confirmations et annulations.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StoreSelector />
          <button
            type="button"
            onClick={() => queryClient.invalidateQueries({ queryKey: ['confirmation-queue'] })}
            className="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-secondary"
          >
            {isFetching ? 'Actualisation...' : 'Actualiser'}
          </button>
        </div>
      </div>

      {!currentStoreId ? (
        <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
          Sélectionnez un store pour afficher les commandes à confirmer.
        </div>
      ) : (
        <>
          <ConfirmationKpis
            counts={data?.counts || {}}
            activeFilter={filter}
            onSelectFilter={(next) => setFilter(next as ConfirmationQueueFilter)}
          />

          <div className="rounded-xl border border-border bg-card p-3 space-y-3">
            <div className="flex flex-wrap gap-2">
              {FILTER_TABS.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => {
                    setFilter(tab.value)
                    setPage(1)
                    // Le tri « rappel le plus proche » n'existe que sur les files avec rappel.
                    if (sort === 'callback' && tab.value !== 'to_callback' && tab.value !== 'late') {
                      setSort('recent')
                    }
                  }}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium border transition-colors ${
                    filter === tab.value
                      ? 'border-primary bg-primary text-white'
                      : 'border-border text-muted-foreground hover:bg-secondary'
                  }`}
                >
                  {tab.label}
                  {data?.counts?.[tab.value] !== undefined ? (
                    <span className="ml-2 text-xs opacity-80">{data.counts[tab.value]}</span>
                  ) : null}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Tri :</span>
              {getSortOptions(filter).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setSort(option.value)
                    setPage(1)
                  }}
                  className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                    sort === option.value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:bg-secondary'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Rechercher un client, un téléphone ou un numéro de suivi"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </div>

          {!canProcess && !isPermissionsLoading ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              Votre rôle vous permet de consulter les commandes, mais pas de les traiter.
            </div>
          ) : null}

          {isLoading ? (
            <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
              Chargement des commandes...
            </div>
          ) : orders.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
              Aucune commande dans cette file.
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              {orders.map((order) => (
                <ConfirmationOrderCard
                  key={order.id}
                  order={order}
                  maxAttempts={maxAttempts}
                  busy={actionMutation.isPending || !canProcess}
                  onNoAnswer={() => handleNoAnswer(order)}
                  onPostpone={() => setPostponeOrder(order)}
                  onCancel={() => setCancelOrder(order)}
                  onConfirm={() => {
                    // La commande est en cours de vérification (confirmation coupée) :
                    // aucune nouvelle confirmation tant que l'état n'est pas tranché.
                    if (verifyingOrderId === order.id) {
                      toast.error(
                        'Vérification de la commande en cours : rechargez la page avant de réessayer.'
                      )
                      return
                    }
                    setConfirmOutcome(null)
                    setConfirmOrder(order)
                  }}
                  onEdit={() => setEditOrder(order)}
                  onOpenDetails={() => setDetailsOrder(order)}
                />
              ))}
            </div>
          )}

          {orders.length > 0 ? (
            <div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-sm">
              <button
                type="button"
                disabled={page === 1 || isFetching}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                className="rounded-md border border-border px-3 py-1.5 text-foreground hover:bg-secondary disabled:opacity-50"
              >
                Précédent
              </button>
              <span className="text-muted-foreground">Page {page}</span>
              <button
                type="button"
                disabled={orders.length < PAGE_SIZE || isFetching}
                onClick={() => setPage((current) => current + 1)}
                className="rounded-md border border-border px-3 py-1.5 text-foreground hover:bg-secondary disabled:opacity-50"
              >
                Suivant
              </button>
            </div>
          ) : null}
        </>
      )}

      <PostponeOrderDialog
        open={Boolean(postponeOrder)}
        customerName={postponeOrder?.customer_name || null}
        requireDatetime={data?.settings?.require_callback_datetime !== false}
        busy={actionMutation.isPending}
        onClose={() => setPostponeOrder(null)}
        onSubmit={(callbackAt, note) => {
          if (!postponeOrder) return
          actionMutation.mutate({ order: postponeOrder, action: 'POSTPONE', callbackAt, note })
        }}
      />

      <CancelOrderDialog
        open={Boolean(cancelOrder)}
        customerName={cancelOrder?.customer_name || null}
        requireReason={data?.settings?.require_cancellation_reason !== false}
        busy={actionMutation.isPending}
        onClose={() => setCancelOrder(null)}
        onSubmit={(reasonCode, note) => {
          if (!cancelOrder) return
          actionMutation.mutate({ order: cancelOrder, action: 'CANCEL', reasonCode, note })
        }}
      />

      <ConfirmOrderDialog
        open={Boolean(confirmOrder)}
        order={confirmOrder}
        busy={actionMutation.isPending || Boolean(verifyingOrderId)}
        progressStages={confirmProgress}
        finished={Boolean(confirmOutcome)}
        outcome={confirmOutcome}
        canEdit={canEdit}
        onClose={() => {
          // Tant que le verdict est indéterminé, fermer la modale ne doit pas débloquer
          // une nouvelle confirmation à l'aveugle : un rechargement est nécessaire.
          if (confirmVerdictUnresolvedRef.current) return
          setConfirmOrder(null)
          setConfirmOutcome(null)
          setVerifyingOrderId(null)
        }}
        onEdit={() => {
          const target = confirmOrder
          setConfirmOrder(null)
          setConfirmOutcome(null)
          if (target) setEditOrder(target)
        }}
        onSubmit={(choice) => {
          if (!confirmOrder) return
          actionMutation.mutate({
            order: confirmOrder,
            action: 'CONFIRM',
            note: choice.deliveryNote,
            deliveryMode: choice.deliveryMode,
            deliveryCompanyId: choice.deliveryCompanyId,
            deliveryOptions: choice.deliveryOptions,
          })
        }}
      />

      <OrderEditDialog
        open={Boolean(editOrder)}
        order={editOrder}
        onClose={() => setEditOrder(null)}
        onSaved={() => queryClient.invalidateQueries({ queryKey: ['confirmation-queue'] })}
      />

      <OrderConfirmationDetails
        open={Boolean(detailsOrder)}
        order={detailsOrder}
        onClose={() => setDetailsOrder(null)}
      />
    </div>
  )
}

