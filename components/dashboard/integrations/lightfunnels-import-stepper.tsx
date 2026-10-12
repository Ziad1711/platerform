'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Check,
  Circle,
  Link2,
  Loader2,
  Package,
  RefreshCw,
  ShoppingCart,
  Trash2,
  Unplug,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStore } from '@/lib/store-context'

export type LightfunnelsBindingView = {
  id: string
  store_id: string
  lightfunnels_store_id: string
  lightfunnels_store_name: string | null
  webhook_order_confirmed_id: string | null
  webhook_target_url: string | null
  has_more: boolean
  import_cursor: string | null
  last_import_at: string | null
  last_import_scanned: number
  last_import_imported: number
  last_import_skipped: number
  last_import_error: string | null
  products_has_more: boolean | null
  last_products_at: string | null
  last_products_scanned: number
  last_products_created: number
  last_products_updated: number
  last_products_error: string | null
}

export type LightfunnelsApiStatus = {
  connected: boolean
  needsReconnect: boolean
  integrationId?: string
  integrationStatus?: string
  stores: Array<{ id: string; name: string; slug: string | null }>
  bindings: LightfunnelsBindingView[]
  minSinceDate: string
  warnings: string[]
}

/** `partial` : la synchronisation s'est arrêtée alors qu'il reste des pages à parcourir. */
type StepState = 'pending' | 'running' | 'done' | 'partial' | 'skipped' | 'error'

type ProductStepResult = {
  ok: boolean
  reason?: string
  bindingId?: string
  lightfunnelsStoreId?: string
  scanned: number
  productsCreated: number
  productsUpdated: number
  productsMatched: number
  variantsCreated: number
  variantsUpdated: number
  skipped?: number
  skippedReasons?: Record<string, number>
  hasMore: boolean
  warnings?: string[]
}

type OrderStepResult = {
  ok: boolean
  reason?: string
  bindingId?: string
  lightfunnelsStoreId?: string
  scanned: number
  imported: number
  alreadyImported: number
  skipped: number
  skippedReasons?: Record<string, number>
  hasMore: boolean
  warnings?: string[]
}

function formatReasons(reasons: Record<string, number> | undefined) {
  return Object.entries(reasons || {})
    .map(([reason, count]) => `${reason} (${count})`)
    .join(', ')
}

/**
 * Libellés lisibles des avertissements techniques. Un code inconnu est affiché tel quel :
 * aucune anomalie ne doit être masquée à l'utilisateur.
 */
const WARNING_LABELS: Record<string, string> = {
  HISTORY_UP_TO_DATE: 'Historique déjà à jour (aucune nouveauté détectée).',
  LINES_SUBTOTAL_MISMATCH: 'Écart entre les lignes reconstituées et le sous-total source (absorbé par la remise).',
  MAPPING_PRODUCT_MISSING: 'Liaison produit introuvable : elle a été reconstruite.',
  MAPPING_VARIANT_MISSING: 'Liaison variante introuvable : elle a été reconstruite.',
  ORDER_ADDRESSES_UNAVAILABLE: 'Adresses absentes de la réponse : ville ou client possiblement incomplets.',
  ORDERS_QUERY_WITHOUT_STORE_ID: 'La boutique n’est pas exposée par l’API des commandes.',
  PRODUCTS_WITHOUT_STORE_ID: 'La boutique n’est pas exposée par l’API du catalogue.',
  ORDER_WITHOUT_REMOTE_STORE: 'Commande sans boutique : acceptée car une seule boutique est liée.',
}

function formatWarnings(warnings: string[] | undefined) {
  return (warnings || [])
    .map((warning) => {
      const [code, ...rest] = String(warning).split(':')
      const label = WARNING_LABELS[code]
      if (!label) return warning
      return rest.length > 0 ? `${label} (${rest.join(':')})` : label
    })
    .join(' · ')
}

/**
 * Assistant d'intégration Lightfunnels en trois étapes, avec barre de progression :
 *   1. associer la boutique distante au store Jisra ;
 *   2. synchroniser le catalogue (produits + variantes) — étape facultative ;
 *   3. importer les commandes — étape facultative et datable.
 *
 * Chaque étape peut être explicitement ignorée : rien n'est importé sans action de
 * l'utilisateur, et la progression reflète les étapes résolues (faites ou ignorées).
 */
export default function LightfunnelsImportStepper({
  status,
  onChanged,
  showDisconnect = true,
  connectAction = null,
  reconnectAction = null,
}: {
  status: LightfunnelsApiStatus
  onChanged: () => void | Promise<void>
  /**
   * Affiche la déconnexion en fin d'assistant. Les réglages de l'intégration possèdent déjà
   * leur propre « Zone de danger » : ils passent `false` pour éviter le doublon.
   */
  showDisconnect?: boolean
  /** Action de connexion OAuth injectée par l'assistant quand le compte n'est pas encore lié. */
  connectAction?: ReactNode
  /**
   * Action de **ré-autorisation** proposée quand le compte est déjà lié : indispensable après
   * l'ajout d'une permission (le consentement déjà accordé ne l'inclut pas), et sans effet sur
   * les liaisons et les données déjà importées.
   */
  reconnectAction?: ReactNode
}) {
  const queryClient = useQueryClient()
  const { currentStoreId, setCurrentStoreId, accessibleStores, isStoresLoading } = useStore()

  // Le parcours est séquentiel : une seule étape est affichée, `Suivant` débloque la suite.
  const [step, setStep] = useState<1 | 2 | 3>(1)

  const [selectedStoreId, setSelectedStoreId] = useState(currentStoreId || '')
  const [remoteStoreId, setRemoteStoreId] = useState('')
  const [isBinding, setIsBinding] = useState(false)
  const [unbindingId, setUnbindingId] = useState<string | null>(null)
  const [isDisconnecting, setIsDisconnecting] = useState(false)

  const [sinceDate, setSinceDate] = useState(status.minSinceDate)

  const [productsState, setProductsState] = useState<StepState>('pending')
  const [ordersState, setOrdersState] = useState<StepState>('pending')
  // Un import peut viser plusieurs boutiques liées : chaque étape affiche un résultat par
  // boutique, jamais un bilan agrégé.
  const [productsResults, setProductsResults] = useState<ProductStepResult[]>([])
  const [ordersResults, setOrdersResults] = useState<OrderStepResult[]>([])
  const [error, setError] = useState('')

  const targetStoreId = currentStoreId || selectedStoreId
  const storeBindings = status.bindings.filter((binding) => binding.store_id === targetStoreId)
  const boundRemoteStoreIds = new Set(status.bindings.map((binding) => binding.lightfunnels_store_id))
  const availableRemoteStores = status.stores.filter((store) => !boundRemoteStoreIds.has(store.id))
  const binding = storeBindings.length === 1 ? storeBindings[0] : null

  const step1State: StepState = storeBindings.length > 0 ? 'done' : 'pending'

  const overallProgress = useMemo(() => {
    const states = [step1State, productsState, ordersState]
    const resolved = states.filter((state) => state === 'done' || state === 'skipped').length
    return Math.round((resolved / states.length) * 100)
  }, [step1State, productsState, ordersState])

  const storeName = (storeId: string) =>
    accessibleStores.find((store) => store.id === storeId)?.name || 'Store inconnu'

  /** Libellé d'un résultat d'import : boutique Lightfunnels → store Jisra. */
  const bindingLabel = (result: { bindingId?: string; lightfunnelsStoreId?: string }) => {
    const row = status.bindings.find((item) => item.id === result.bindingId)
    const remoteName =
      row?.lightfunnels_store_name || row?.lightfunnels_store_id || result.lightfunnelsStoreId
    const target = row ? storeName(row.store_id) : null

    if (!remoteName && !target) return 'Boutique liée'
    return target ? `${remoteName || 'Boutique'} → ${target}` : String(remoteName)
  }

  const refresh = async () => {
    await onChanged()
    await queryClient.invalidateQueries({ queryKey: ['lightfunnels-status'] })
    await queryClient.invalidateQueries({ queryKey: ['integration-marketplace'] })
  }

  const bindStore = async (remoteId?: string) => {
    const remoteTarget = remoteId || remoteStoreId || availableRemoteStores[0]?.id || ''

    if (!targetStoreId) {
      setError('Sélectionnez un store Jisra à associer.')
      return
    }

    if (!remoteTarget) {
      setError('Sélectionnez la boutique Lightfunnels à associer.')
      return
    }

    setIsBinding(true)
    setError('')

    try {
      const response = await fetch('/api/integrations/lightfunnels/bindings', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId: targetStoreId, lightfunnelsStoreId: remoteTarget }),
      })

      const payload = (await response.json().catch(() => null)) as { error?: string } | null

      if (!response.ok) {
        // Message actionnable : l'utilisateur doit reconnecter son compte, pas réessayer.
        if (payload?.error === 'LIGHTFUNNELS_RECONNECT_REQUIRED') {
          throw new Error(
            'L’accès Lightfunnels n’est plus valide : reconnectez le compte (bouton ci-dessus).'
          )
        }

        throw new Error(payload?.error || 'LIGHTFUNNELS_BINDING_FAILED')
      }

      await refresh()
    } catch (bindError) {
      setError(bindError instanceof Error ? bindError.message : 'LIGHTFUNNELS_BINDING_FAILED')
    } finally {
      setIsBinding(false)
    }
  }

  // Une seule boutique côté compte : l'association est faite d'office, sans redemander un
  // choix qui n'en est pas un. Le verrou évite toute boucle si l'appel échoue.
  const autoBindKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!status.connected) return
    if (status.stores.length !== 1) return
    if (storeBindings.length > 0) return
    if (!targetStoreId || isBinding) return

    const key = `${targetStoreId}:${status.stores[0].id}`
    if (autoBindKeyRef.current === key) return

    autoBindKeyRef.current = key
    void bindStore(status.stores[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.connected, status.stores, storeBindings.length, targetStoreId, isBinding])

  const unbind = async (bindingId: string) => {
    if (!confirm('Détacher cette boutique ? Les commandes déjà importées sont conservées.')) return

    setUnbindingId(bindingId)
    setError('')

    try {
      const response = await fetch(
        `/api/integrations/lightfunnels/bindings?bindingId=${encodeURIComponent(bindingId)}`,
        { method: 'DELETE', credentials: 'include' }
      )

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(payload?.error || 'LIGHTFUNNELS_UNBIND_FAILED')
      }

      await refresh()
    } catch (unbindError) {
      setError(unbindError instanceof Error ? unbindError.message : 'LIGHTFUNNELS_UNBIND_FAILED')
    } finally {
      setUnbindingId(null)
    }
  }

  // Déconnexion de portée compte : elle ne dépend d'aucun store sélectionné.
  const disconnectAccount = async () => {
    if (
      !confirm(
        'Déconnecter Lightfunnels ? Toutes les boutiques liées seront détachées et les webhooks supprimés. Les commandes et les produits déjà importés sont conservés.'
      )
    ) {
      return
    }

    setIsDisconnecting(true)
    setError('')

    try {
      const response = await fetch('/api/integrations/lightfunnels/disconnect', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(payload?.error || 'LIGHTFUNNELS_DISCONNECT_FAILED')
      }

      await refresh()
    } catch (disconnectError) {
      setError(
        disconnectError instanceof Error ? disconnectError.message : 'LIGHTFUNNELS_DISCONNECT_FAILED'
      )
    } finally {
      setIsDisconnecting(false)
    }
  }

  const runStep = async (step: 'products' | 'orders') => {
    if (!targetStoreId) {
      setError('Sélectionnez un store avant de lancer la synchronisation.')
      return
    }

    if (step === 'products' && storeBindings.length === 0) {
      setError('Associez d’abord une boutique (étape 1).')
      return
    }

    if (step === 'products') setProductsState('running')
    else setOrdersState('running')

    setError('')

    try {
      const response = await fetch('/api/integrations/lightfunnels/sync', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId: targetStoreId,
          ...(binding ? { bindingId: binding.id } : {}),
          sinceDate,
          importProducts: step === 'products',
          importOrders: step === 'orders',
        }),
      })

      const payload = (await response.json().catch(() => null)) as {
        error?: string
        ok?: boolean
        products?: ProductStepResult[]
        orders?: OrderStepResult[]
        warnings?: string[]
      } | null

      if (!response.ok) throw new Error(payload?.error || 'LIGHTFUNNELS_SYNC_FAILED')

      const failed = payload?.ok === false

      if (step === 'products') {
        const productResults = payload?.products || []
        setProductsResults(productResults)
        // « Partiel » plutôt que « Terminé » tant qu'il reste des pages à parcourir.
        const remaining = productResults.some((result) => result.hasMore)
        setProductsState(failed ? 'error' : remaining ? 'partial' : 'done')

        // Étape franchie : on enchaîne sur les ventes, sans repasser par la boutique.
        if (!failed && !remaining) setStep(3)
      } else {
        const orderResults = payload?.orders || []
        setOrdersResults(orderResults)
        const remaining = orderResults.some((result) => result.hasMore)
        setOrdersState(failed ? 'error' : remaining ? 'partial' : 'done')
      }

      if (failed) {
        setError(payload?.warnings?.join(' · ') || 'Synchronisation interrompue.')
      }

      await refresh()
      await queryClient.invalidateQueries({ queryKey: ['orders'] })
      await queryClient.invalidateQueries({ queryKey: ['products'] })
    } catch (stepError) {
      const message = stepError instanceof Error ? stepError.message : 'LIGHTFUNNELS_SYNC_FAILED'
      setError(message)
      if (step === 'products') setProductsState('error')
      else setOrdersState('error')
    }
  }

  const stepBadge = (state: StepState) => {
    const label =
      state === 'done'
        ? 'Terminé'
        : state === 'partial'
          ? 'Partiel'
          : state === 'running'
            ? 'En cours'
            : state === 'error'
              ? 'À corriger'
              : state === 'skipped'
                ? 'Ignoré'
                : 'À faire'

    const tone =
      state === 'done'
        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
        : state === 'partial'
          ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
          : state === 'running'
            ? 'bg-primary/10 text-primary'
            : state === 'error'
              ? 'bg-red-500/10 text-red-600 dark:text-red-400'
              : 'bg-muted text-muted-foreground'

    return (
      <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', tone)}>
        {state === 'running' ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : state === 'done' ? (
          <Check className="h-3 w-3" />
        ) : state === 'error' ? (
          <AlertTriangle className="h-3 w-3" />
        ) : (
          <Circle className="h-3 w-3" />
        )}
        {label}
      </span>
    )
  }

  return (
    <div className="space-y-4">
      {/* Barre de progression des trois étapes */}
      <div className="rounded-2xl border border-border/50 bg-card p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-foreground">Progression de l’intégration</p>
          <span className="text-xs font-medium text-muted-foreground">{overallProgress}%</span>
        </div>

        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${overallProgress}%` }}
          />
        </div>

        <div className="mt-3 grid gap-2 text-[11px] sm:grid-cols-3">
          {(
            [
              ['1. Boutique', step1State],
              ['2. Produits', productsState],
              ['3. Commandes', ordersState],
            ] as Array<[string, StepState]>
          ).map(([label, state]) => (
            <div key={label} className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">{label}</span>
              {stepBadge(state)}
            </div>
          ))}
        </div>
      </div>

      {/* Étape 1 — boutique */}
      {step === 1 ? (
      <section className="rounded-2xl border border-border/50 bg-card p-5 shadow-sm">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <Link2 className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {status.connected ? '1. Associer une boutique' : '1. Store et connexion'}
              </h3>
              <p className="text-xs text-muted-foreground">
                {status.connected
                  ? 'Le rattachement est explicite : aucune association par ressemblance de nom.'
                  : 'Choisissez le store Jisra, connectez le compte Lightfunnels, puis associez une boutique.'}
              </p>
            </div>
          </div>
          {stepBadge(step1State)}
        </div>

        {storeBindings.length > 0 ? (
          <div className="space-y-2">
            {storeBindings.map((row: LightfunnelsBindingView) => (
              <div
                key={row.id}
                className="flex flex-col gap-2 rounded-xl border border-border/60 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-foreground">
                    {row.lightfunnels_store_name || row.lightfunnels_store_id}
                    <span className="text-muted-foreground"> → {storeName(row.store_id)}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {row.webhook_order_confirmed_id ? 'webhook actif' : 'webhook absent'}
                  </p>
                  {row.last_import_error ? (
                    <p className="flex items-center gap-1 text-xs text-red-500">
                      <AlertTriangle className="h-3 w-3" /> {row.last_import_error}
                    </p>
                  ) : null}
                  {row.last_products_error ? (
                    <p className="flex items-center gap-1 text-xs text-red-500">
                      <AlertTriangle className="h-3 w-3" /> Catalogue : {row.last_products_error}
                    </p>
                  ) : null}
                  {row.has_more ? (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      Historique des commandes incomplet : relancez l’import pour continuer.
                    </p>
                  ) : null}
                  {row.products_has_more ? (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      Catalogue incomplet : relancez la synchronisation des produits pour continuer.
                    </p>
                  ) : null}
                </div>

                <button
                  type="button"
                  onClick={() => void unbind(row.id)}
                  disabled={unbindingId === row.id}
                  className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                >
                  {unbindingId === row.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Unplug className="h-3 w-3" />
                  )}
                  Détacher
                </button>
              </div>
            ))}

            {/* Une autorisation déjà accordée ne gagne pas les nouvelles permissions : cette
                action relance le consentement OAuth sans toucher aux liaisons ni aux données. */}
            {reconnectAction ? (
              <div className="space-y-1">
                {reconnectAction}
                <p className="text-xs text-muted-foreground">
                  À utiliser après une mise à jour des permissions (ex. lecture du catalogue) :
                  les liaisons et les commandes déjà importées sont conservées.
                </p>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            {/* Le store Jisra est choisi ici une seule fois : il sert aussi au contrôle de droits
                exigé par la connexion OAuth, ce qui évite une double sélection. */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">Store Jisra</label>
              <select
                value={targetStoreId}
                onChange={(event) => {
                  setSelectedStoreId(event.target.value)
                  setCurrentStoreId(event.target.value || null)
                  setError('')
                }}
                disabled={isBinding || isStoresLoading}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none disabled:opacity-50"
              >
                {accessibleStores.length === 0 ? (
                  <option value="">Aucun store disponible</option>
                ) : null}
                {accessibleStores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                  </option>
                ))}
              </select>
            </div>

            {status.connected ? (
              <div className="space-y-3">
                {status.stores.length === 1 ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Association automatique de « {status.stores[0]?.name || 'votre boutique'} »…
                  </div>
                ) : (
                  <>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-foreground">Boutique Lightfunnels</label>
                      <select
                        value={remoteStoreId || availableRemoteStores[0]?.id || ''}
                        onChange={(event) => {
                          setRemoteStoreId(event.target.value)
                          setError('')
                        }}
                        disabled={isBinding || availableRemoteStores.length === 0}
                        className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none disabled:opacity-50"
                      >
                        {availableRemoteStores.length === 0 ? (
                          <option value="">
                            {status.stores.length
                              ? 'Toutes les boutiques sont déjà associées'
                              : 'Aucune boutique accessible'}
                          </option>
                        ) : null}
                        {availableRemoteStores.map((store) => (
                          <option key={store.id} value={store.id}>
                            {store.name}
                            {store.slug ? ` (${store.slug})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    <button
                      type="button"
                      onClick={() => void bindStore()}
                      disabled={isBinding || !targetStoreId || availableRemoteStores.length === 0}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                    >
                      {isBinding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                      Associer la boutique
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Connectez votre compte Lightfunnels avec ce store, puis associez une boutique
                  Lightfunnels.
                </p>
                {connectAction}
              </div>
            )}
          </div>
        )}
      </section>
      ) : null}

      {/* Étape 2 — produits */}
      {step === 2 ? (
      <section className="rounded-2xl border border-border/50 bg-card p-5 shadow-sm">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <Package className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">2. Produits et variantes</h3>
              <p className="text-xs text-muted-foreground">
                Les produits déjà liés sont rafraîchis (nom, prix, ancien prix, SKU, variantes).
                Le coût d’achat, le stock et la publication ne sont jamais modifiés.
              </p>
            </div>
          </div>
          {stepBadge(productsState)}
        </div>

        <div className="space-y-3">
          {/* Deux choix seulement : « Non » avance sans aucun appel API, « Synchroniser »
              importe puis enchaîne lui-même sur les ventes. */}
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => {
                setError('')
                setProductsState('skipped')
                setProductsResults([])
                setStep(3)
              }}
              disabled={productsState === 'running'}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-border px-5 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50 sm:flex-1"
            >
              Non
            </button>

            <button
              type="button"
              onClick={() => void runStep('products')}
              disabled={productsState === 'running' || step1State !== 'done'}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 sm:flex-1"
            >
              {productsState === 'running' ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Synchronisation...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" />
                  {productsState === 'partial' ? 'Reprendre' : 'Synchroniser'}
                </>
              )}
            </button>
          </div>

          {productsResults.length > 0 ? (
            <div className="space-y-2">
              {productsResults.map((result) => (
                <div
                  key={result.bindingId || result.lightfunnelsStoreId || 'catalog-result'}
                  className="space-y-1 rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground"
                >
                  <p className="font-medium text-foreground">{bindingLabel(result)}</p>
                  <p>
                    <span className="font-medium text-foreground">{result.productsCreated}</span>{' '}
                    produit(s) créé(s), {result.productsUpdated} mis à jour,{' '}
                    {result.productsMatched} déjà lié(s) · {result.variantsCreated} variante(s)
                    créée(s), {result.variantsUpdated} mise(s) à jour
                  </p>
                  <p>{result.scanned} produit(s) analysé(s)</p>
                  {result.skipped && result.skipped > 0 ? (
                    <p>
                      {result.skipped} ignoré(s)
                      {formatReasons(result.skippedReasons)
                        ? ` : ${formatReasons(result.skippedReasons)}`
                        : ''}
                    </p>
                  ) : null}
                  {result.warnings && result.warnings.length > 0 ? (
                    <p className="text-amber-600 dark:text-amber-400">
                      {formatWarnings(result.warnings)}
                    </p>
                  ) : null}
                  {!result.ok && result.reason ? (
                    <p className="flex items-center gap-1 text-red-500">
                      <AlertTriangle className="h-3 w-3" /> {result.reason}
                    </p>
                  ) : null}
                  {result.hasMore ? (
                    <p className="text-amber-600 dark:text-amber-400">
                      Il reste des produits : relancez la synchronisation, la reprise continue à la page
                      enregistrée.
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </section>
      ) : null}

      {/* Étape 3 — commandes */}
      {step === 3 ? (
      <section className="rounded-2xl border border-border/50 bg-card p-5 shadow-sm">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <ShoppingCart className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">3. Commandes</h3>
              <p className="text-xs text-muted-foreground">
                Les commandes déjà importées ne sont jamais réécrites ; les doublons sont ignorés.
              </p>
            </div>
          </div>
          {stepBadge(ordersState)}
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-foreground">Commandes depuis</label>
            <input
              type="date"
              min={status.minSinceDate}
              value={sinceDate}
              onChange={(event) => {
                const value = event.target.value
                setSinceDate(value < status.minSinceDate ? status.minSinceDate : value)
              }}
              disabled={ordersState === 'running'}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
            />
          </div>

          {/* Deux choix seulement : « Non » termine sans appel API, « Synchroniser » importe. */}
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => {
                setError('')
                setOrdersState('skipped')
                setOrdersResults([])
              }}
              disabled={ordersState === 'running'}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-border px-5 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50 sm:flex-1"
            >
              Non
            </button>

            <button
              type="button"
              onClick={() => void runStep('orders')}
              disabled={ordersState === 'running' || step1State !== 'done'}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 sm:flex-1"
            >
              {ordersState === 'running' ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Import...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" />
                  {ordersState === 'partial' ? 'Reprendre' : 'Synchroniser'}
                </>
              )}
            </button>
          </div>

          {ordersResults.length > 0 ? (
            <div className="space-y-2">
              {ordersResults.map((result) => (
                <div
                  key={result.bindingId || result.lightfunnelsStoreId || 'binding-result'}
                  className="space-y-1 rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground"
                >
                  <p className="font-medium text-foreground">{bindingLabel(result)}</p>
                  <p>
                    <span className="font-medium text-foreground">{result.imported}</span> commande(s)
                    importée(s) sur {result.scanned} analysée(s) · {result.alreadyImported} déjà
                    présente(s)
                  </p>
                  {result.skipped > 0 ? (
                    <p>
                      {result.skipped} ignorée(s)
                      {formatReasons(result.skippedReasons) ? ` : ${formatReasons(result.skippedReasons)}` : ''}
                    </p>
                  ) : null}
                  {result.warnings && result.warnings.length > 0 ? (
                    <p className="text-amber-600 dark:text-amber-400">
                      {formatWarnings(result.warnings)}
                    </p>
                  ) : null}
                  {result.hasMore ? (
                    <p className="text-amber-600 dark:text-amber-400">
                      Il reste d’anciennes commandes : relancez l’import, la reprise continue à la
                      page enregistrée.
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {ordersState === 'done' || ordersState === 'skipped' ? (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-emerald-700 dark:text-emerald-400">
              {ordersState === 'skipped'
                ? 'Étape ignorée : les ventes n’ont pas été importées. Vous pouvez fermer cette fenêtre.'
                : 'Import terminé. Vous pouvez fermer cette fenêtre.'}
            </div>
          ) : null}
        </div>
      </section>
      ) : null}

      {/* Navigation séquentielle : une seule étape est affichée à la fois */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setStep((current) => (current > 1 ? ((current - 1) as 1 | 2 | 3) : current))}
          disabled={step === 1}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-border px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-40"
        >
          Précédent
        </button>

        {step === 1 ? (
          <button
            type="button"
            onClick={() => setStep(2)}
            disabled={step1State !== 'done'}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Suivant
          </button>
        ) : (
          <span className="text-xs text-muted-foreground">
            {step === 2 ? 'Choisissez « Non » ou « Synchroniser »' : 'Dernière étape'}
          </span>
        )}
      </div>

      {step1State !== 'done' ? (
        <p className="text-xs text-amber-600">
          Associez d’abord une boutique (étape 1) pour activer les étapes produits et commandes.
        </p>
      ) : null}

      {/* Déconnexion : l'accès Lightfunnels est global au compte, pas à un store */}
      {showDisconnect ? (
        <section className="rounded-2xl border border-destructive/20 bg-destructive/5 p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <Trash2 className="mt-0.5 h-4 w-4 text-destructive" />
              <div>
                <p className="text-sm font-medium text-foreground">Déconnecter Lightfunnels</p>
                <p className="text-xs text-muted-foreground">
                  Retire l’accès au compte et détache toutes les boutiques liées (webhooks supprimés).
                  Les commandes et les produits déjà importés sont conservés.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void disconnectAccount()}
              disabled={isDisconnecting}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-destructive px-5 py-2.5 text-sm font-medium text-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {isDisconnecting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Déconnexion...
                </>
              ) : (
                'Déconnecter'
              )}
            </button>
          </div>
        </section>
      ) : null}

      {error ? <p className="text-sm text-red-500">{error}</p> : null}
    </div>
  )
}

