'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import StoreSelector from '@/components/dashboard/store-selector'
import ConfirmationKpis from '@/components/dashboard/confirmation/confirmation-kpis'
import ConfirmationOrderCard from '@/components/dashboard/confirmation/confirmation-order-card'
import PostponeOrderDialog from '@/components/dashboard/confirmation/postpone-order-dialog'
import CancelOrderDialog from '@/components/dashboard/confirmation/cancel-order-dialog'
import ConfirmOrderDialog from '@/components/dashboard/confirmation/confirm-order-dialog'
import OrderConfirmationDetails from '@/components/dashboard/confirmation/order-confirmation-details'
import OrderEditDialog from '@/components/dashboard/confirmation/order-edit-dialog'
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

const FILTER_TABS: { value: ConfirmationQueueFilter; label: string }[] = [
  { value: 'to_process', label: 'À traiter' },
  { value: 'to_callback', label: 'À rappeler' },
  { value: 'late', label: 'En retard' },
  { value: 'confirmed', label: 'Confirmées' },
  { value: 'cancelled', label: 'Annulées' },
  { value: 'all', label: 'Toutes' },
]

type QueueResponse = {
  settings: ConfirmationSettings
  orders: ConfirmationOrder[]
  counts: Record<string, number>
}

type ActionPayload = {
  action?: ConfirmationAction
  attemptNumber?: number | null
  attemptCount?: number
  maxAttempts?: number
  autoCancelled?: boolean
  parcel?: { created: boolean; trackingNumber: string | null; warning: string | null }
}

function getTodayStartIso() {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  return start.toISOString()
}

export default function ConfirmationPage() {
  const { currentStoreId } = useStore()
  const { can } = usePermissions(currentStoreId)
  const queryClient = useQueryClient()

  const canProcess = can('confirmation.process')
  const canEdit = can('confirmation.edit')
  const [filter, setFilter] = useState<ConfirmationQueueFilter>('to_process')
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
  const [detailsOrder, setDetailsOrder] = useState<ConfirmationOrder | null>(null)
  const [editOrder, setEditOrder] = useState<ConfirmationOrder | null>(null)

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

  const actionMutation = useMutation({
    mutationFn: async (input: {
      order: ConfirmationOrder
      action: ConfirmationAction
      callbackAt?: string
      reasonCode?: string
      note?: string
      deliveryMode?: 'internal' | 'shipping'
      deliveryCompanyId?: string | null
    }) => {
      const response = await fetch('/api/orders/confirmation/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: input.order.id,
          action: input.action,
          callbackAt: input.callbackAt ?? null,
          reasonCode: input.reasonCode ?? null,
          note: input.note ?? null,
          deliveryMode: input.deliveryMode ?? null,
          deliveryCompanyId: input.deliveryCompanyId ?? null,
          // Détection de concurrence : un autre agent a peut-être déjà traité la commande.
          expectedStatus: input.order.status,
          expectedAttemptCount: Number(input.order.confirmation_attempt_count || 0),
        }),
      })

      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.error || 'CONFIRMATION_ACTION_FAILED')
      }
      return payload as ActionPayload
    },
    onSuccess: async (payload) => {
      setPostponeOrder(null)
      setCancelOrder(null)
      setConfirmOrder(null)
      await queryClient.invalidateQueries({ queryKey: ['confirmation-queue'] })

      if (payload?.action === 'CONFIRM') {
        if (payload.parcel?.created) {
          toast.success(`Commande confirmée. Colis créé (${payload.parcel.trackingNumber}).`)
        } else if (payload.parcel?.warning) {
          toast.warning(`Commande confirmée, mais création du colis échouée : ${payload.parcel.warning}`)
        } else {
          toast.success('Commande confirmée.')
        }
        return
      }

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
    onError: async (error) => {
      const message = error instanceof Error ? error.message : 'CONFIRMATION_ACTION_FAILED'
      if (message.includes('ORDER_ALREADY_UPDATED')) {
        toast.error('Cette commande vient d’être modifiée par un autre utilisateur. La liste a été actualisée.')
      } else if (message.includes('ORDER_NOT_CONFIRMABLE')) {
        toast.error('Cette commande est déjà confirmée ou annulée.')
      } else {
        toast.error(message)
      }
      await queryClient.invalidateQueries({ queryKey: ['confirmation-queue'] })
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
        <div>
          <h1 className="text-xl font-semibold text-foreground">Confirmation des commandes</h1>
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

          {!canProcess ? (
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
                  onConfirm={() => setConfirmOrder(order)}
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
        busy={actionMutation.isPending}
        canEdit={canEdit}
        onClose={() => setConfirmOrder(null)}
        onEdit={() => {
          const target = confirmOrder
          setConfirmOrder(null)
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

