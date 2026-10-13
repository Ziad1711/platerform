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

/** `partial` : la synchronisation s'est arrêtée alors qu'il reste des pages à parcourir.
 *  `current` : étape affichée, pas encore résolue — c'est là qu'est l'« En cours ». */
type StepState = 'pending' | 'running' | 'current' | 'done' | 'partial' | 'skipped' | 'error'

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
  /** Liaisons ne pouvant pas être confirmées (commande d'un autre store) : à réparer. */
  needsRepair?: number
  skipped: number
  skippedReasons?: Record<string, number>
  hasMore: boolean
  warnings?: string[]
}

/**
 * Bilan transmis à l'assistant modal pour conclure le parcours.
 * `completed` n'est vrai que si plus rien ne reste et qu'aucune anomalie n'est ouverte :
 * une erreur, une reprise en attente ou une liaison incohérente interdit toute conclusion.
 */
export type LightfunnelsFlowState = {
  step: 1 | 2 | 3
  /** L'utilisateur a explicitement ignoré l'import des commandes. */
  ordersSkipped: boolean
  /** Commandes réellement créées pendant ce parcours. */
  ordersImported: number
  /** Commandes déjà présentes **et vérifiées** dans le store lié. */
  alreadyVerified: number
  /** Anomalie bloquante : erreur, import partiel, liaison de commande à réparer. */
  hasIssues: boolean
  completed: boolean
}

/**
 * Nombre de lots d'une synchronisation : chaque lot traite une page, la progression reste donc
 * visible pendant l'import et une interruption reprend au curseur enregistré.
 */
const MAX_SYNC_BATCHES = 20

/**
 * Pause entre deux lots d'un même import de commandes : le quota du fournisseur est limité
 * (`429` constaté en plein import) et enchaîner les pages sans respirer ne fait que consommer
 * ce quota plus vite.
 */
const ORDER_BATCH_PAUSE_MS = 400

/** Libellés lisibles des motifs d'ignoré (le code technique reste visible entre parenthèses). */
const REASON_LABELS: Record<string, string> = {
  BEFORE_SINCE_DATE: 'antérieure à la date choisie',
  TEST_ORDER: 'commande de test',
  MISSING_REMOTE_STORE: 'boutique absente',
  STORE_MISMATCH: 'autre boutique',
  CURRENCY_MISMATCH: 'devise différente du store',
  NO_ITEMS: 'aucun article',
  OTHER_STORE: 'produit d’une autre boutique',
  VARIANTS_OPTIONS_UNAVAILABLE: 'options de variantes illisibles (relancez la synchronisation)',
}

function formatReasons(reasons: Record<string, number> | undefined) {
  return Object.entries(reasons || {})
    .map(([reason, count]) => `${REASON_LABELS[reason] || reason} (${count})`)
    .join(', ')
}

function mergeReasons(
  current: Record<string, number> | undefined,
  incoming: Record<string, number> | undefined
) {
  const merged: Record<string, number> = { ...(current || {}) }

  for (const [reason, count] of Object.entries(incoming || {})) {
    merged[reason] = (merged[reason] || 0) + count
  }

  return merged
}

/** Cumule les lots d'une même boutique : l'utilisateur lit un bilan, pas un lot isolé. */
function mergeProductBatch(
  byBinding: Map<string, ProductStepResult>,
  batch: ProductStepResult[]
) {
  for (const result of batch) {
    const key = result.bindingId || result.lightfunnelsStoreId || 'binding'
    const current = byBinding.get(key)

    if (!current) {
      byBinding.set(key, { ...result })
      continue
    }

    byBinding.set(key, {
      ...current,
      ok: current.ok && result.ok,
      reason: result.reason || current.reason,
      scanned: current.scanned + result.scanned,
      productsCreated: current.productsCreated + result.productsCreated,
      productsUpdated: current.productsUpdated + result.productsUpdated,
      productsMatched: current.productsMatched + result.productsMatched,
      variantsCreated: current.variantsCreated + result.variantsCreated,
      variantsUpdated: current.variantsUpdated + result.variantsUpdated,
      skipped: (current.skipped || 0) + (result.skipped || 0),
      skippedReasons: mergeReasons(current.skippedReasons, result.skippedReasons),
      hasMore: result.hasMore,
      warnings: Array.from(new Set([...(current.warnings || []), ...(result.warnings || [])])),
    })
  }
}

function summarizeProducts(results: ProductStepResult[]) {
  const created = results.reduce((total, row) => total + row.productsCreated, 0)
  const updated = results.reduce((total, row) => total + row.productsUpdated, 0)
  return `${created} créé(s), ${updated} mis à jour`
}

function summarizeOrders(results: OrderStepResult[]) {
  const imported = results.reduce((total, row) => total + row.imported, 0)
  const verified = results.reduce((total, row) => total + row.alreadyImported, 0)
  const skipped = results.reduce((total, row) => total + row.skipped, 0)
  const toRepair = results.reduce((total, row) => total + (row.needsRepair || 0), 0)

  // Le bilan sépare explicitement les quatre situations : importée, déjà présente **et
  // vérifiée**, ignorée, à réparer. Rien n'est agrégé sous un « déjà présente » ambigu.
  return [
    `${imported} importée(s)`,
    `${verified} déjà vérifiée(s)`,
    `${skipped} ignorée(s)`,
    ...(toRepair > 0 ? [`${toRepair} à réparer`] : []),
  ].join(', ')
}

function mergeOrderBatch(byBinding: Map<string, OrderStepResult>, batch: OrderStepResult[]) {
  for (const result of batch) {
    const key = result.bindingId || result.lightfunnelsStoreId || 'binding'
    const current = byBinding.get(key)

    if (!current) {
      byBinding.set(key, { ...result })
      continue
    }

    byBinding.set(key, {
      ...current,
      ok: current.ok && result.ok,
      reason: result.reason || current.reason,
      scanned: current.scanned + result.scanned,
      imported: current.imported + result.imported,
      alreadyImported: current.alreadyImported + result.alreadyImported,
      needsRepair: (current.needsRepair || 0) + (result.needsRepair || 0),
      skipped: current.skipped + result.skipped,
      skippedReasons: mergeReasons(current.skippedReasons, result.skippedReasons),
      hasMore: result.hasMore,
      warnings: Array.from(new Set([...(current.warnings || []), ...(result.warnings || [])])),
    })
  }
}

/**
 * Libellés lisibles des avertissements techniques. Un code inconnu est affiché tel quel :
 * aucune anomalie ne doit être masquée à l'utilisateur.
 */
const WARNING_LABELS: Record<string, string> = {
  HISTORY_UP_TO_DATE: 'Historique déjà à jour (aucune nouveauté détectée).',
  ORDER_MAPPED_TO_OTHER_STORE:
    'Commande déjà liée à un autre store : elle n’a été ni déplacée ni dupliquée, la liaison est à réparer.',
  ORDER_MAPPING_NEEDS_REPAIR:
    'Import non conclu : au moins une commande est déjà liée à un autre store, la liaison est à réparer.',
  ORDER_MAPPING_ORPHANS_REPAIRED:
    'Liaison(s) orpheline(s) réparée(s) : la vente avait été supprimée, la commande a été recréée.',
  LINES_SUBTOTAL_MISMATCH: 'Écart entre les lignes reconstituées et le sous-total source (absorbé par la remise).',
  MAPPING_PRODUCT_MISSING: 'Liaison produit introuvable : elle a été reconstruite.',
  MAPPING_VARIANT_MISSING: 'Liaison variante introuvable : elle a été reconstruite.',
  ORDER_VARIANT_NOT_IDENTIFIED:
    'Variante non identifiée pour une ligne ayant une option : la vente reste rattachée au produit (aucune variante choisie au hasard).',
  PRODUCTS_VARIANTS_OPTIONS_UNAVAILABLE:
    'Options des variantes illisibles : les produits concernés ont été ignorés au lieu de deviner leurs variantes — relancez la synchronisation du catalogue.',
  ORDER_ADDRESSES_UNAVAILABLE: 'Adresses absentes de la réponse : ville ou client possiblement incomplets.',
  ORDERS_QUERY_WITHOUT_STORE_ID: 'La boutique n’est pas exposée par l’API des commandes.',
  PRODUCTS_WITHOUT_STORE_ID: 'La boutique n’est pas exposée par l’API du catalogue.',
  ORDER_WITHOUT_REMOTE_STORE: 'Commande sans boutique : acceptée car une seule boutique est liée.',
  LIGHTFUNNELS_RATE_LIMITED: 'Limite temporaire chez Lightfunnels : réessayez dans quelques minutes.',
  ORDER_DETAIL_BLOCKED:
    'Commande bloquante : la page sera relue à la reprise, les commandes déjà importées ne seront pas dupliquées.',
  LIGHTFUNNELS_ORDER_DETAIL_INCOMPLETE:
    'Commande lue sans ses articles : import refusé pour ne pas créer une vente incomplète.',
  LIGHTFUNNELS_ORDER_NOT_FOUND: 'Commande introuvable chez Lightfunnels.',
  LIGHTFUNNELS_ORDER_LINE_AMBIGUOUS:
    'Articles refusés faute d’options lisibles : la commande sera relue à la reprise (aucune variante devinée, aucune commande sautée).',
  LIGHTFUNNELS_ORDER_DATE_UNRESOLVABLE:
    'Date de commande illisible chez Lightfunnels : la commande est bloquée plutôt que datée d’aujourd’hui, elle sera relue à la reprise.',
  ORDER_UPSERT_BLOCKED:
    'Écriture de la commande bloquée : la page sera relue à la reprise, aucune commande n’est sautée.',
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
 * Un arrêt par limitation de débit (`429`) n'est pas une erreur de données : la reprise
 * continue à la page enregistrée. Le message affiché doit donc le dire clairement au lieu
 * d'annoncer des commandes manquantes.
 */
function isRateLimitReason(reason: string | undefined) {
  return String(reason || '').includes('LIGHTFUNNELS_RATE_LIMITED')
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
  connectAction = null,
  reconnectAction = null,
  showBindingActions = true,
  showCompletionNotice = true,
  onFlowStateChange,
}: {
  status: LightfunnelsApiStatus
  onChanged: () => void | Promise<void>
  /** Action de connexion OAuth injectée par l'assistant quand le compte n'est pas encore lié. */
  connectAction?: ReactNode
  /**
   * Action de **ré-autorisation** proposée quand le compte est déjà lié : indispensable après
   * l'ajout d'une permission (le consentement déjà accordé ne l'inclut pas), et sans effet sur
   * les liaisons et les données déjà importées.
   */
  reconnectAction?: ReactNode
  /**
   * « Détacher » par boutique n'est proposé que dans les réglages de l'intégration : le
   * parcours de connexion initial ne doit exposer aucune action destructive.
   */
  showBindingActions?: boolean
  /**
   * Le message « Import terminé… » est masqué quand l'appelant conclut lui-même le parcours
   * (assistant modal) — il reste affiché dans la page de réglages, qui ne se ferme jamais.
   */
  showCompletionNotice?: boolean
  /**
   * Bilan du parcours, remonté à chaque changement d'état : permet à l'assistant modal
   * d'afficher une fiche de confirmation et de ne se fermer **que** sans anomalie.
   */
  onFlowStateChange?: (state: LightfunnelsFlowState) => void
}) {
  const queryClient = useQueryClient()
  const { currentStoreId, setCurrentStoreId, accessibleStores, isStoresLoading } = useStore()

  // Le parcours est séquentiel : une seule étape est affichée, `Suivant` débloque la suite.
  const [step, setStep] = useState<1 | 2 | 3>(1)

  const [selectedStoreId, setSelectedStoreId] = useState(currentStoreId || '')
  const [remoteStoreId, setRemoteStoreId] = useState('')
  const [isBinding, setIsBinding] = useState(false)
  const [unbindingId, setUnbindingId] = useState<string | null>(null)

  const [sinceDate, setSinceDate] = useState(status.minSinceDate)

  const [productsState, setProductsState] = useState<StepState>('pending')
  const [ordersState, setOrdersState] = useState<StepState>('pending')
  // Un import peut viser plusieurs boutiques liées : chaque étape affiche un résultat par
  // boutique, jamais un bilan agrégé.
  const [productsResults, setProductsResults] = useState<ProductStepResult[]>([])
  const [ordersResults, setOrdersResults] = useState<OrderStepResult[]>([])
  /** Progression du lot en cours (« lot 3 · 12 créé(s) · 25 analysé(s) »). */
  const [progressNote, setProgressNote] = useState('')
  const [error, setError] = useState('')

  /**
   * Bilan remonté à l'appelant : une conclusion n'est possible que si l'étape des commandes est
   * résolue **et** qu'aucune anomalie n'est ouverte (erreur, import partiel, liaison de commande
   * à réparer, commande non confirmée).
   */
  useEffect(() => {
    if (!onFlowStateChange) return

    const ordersImported = ordersResults.reduce((total, row) => total + row.imported, 0)
    const alreadyVerified = ordersResults.reduce((total, row) => total + row.alreadyImported, 0)
    const needsRepair = ordersResults.reduce((total, row) => total + (row.needsRepair || 0), 0)
    const hasIssues =
      productsState === 'error' ||
      productsState === 'partial' ||
      ordersState === 'error' ||
      ordersState === 'partial' ||
      needsRepair > 0 ||
      ordersResults.some((row) => !row.ok)

    onFlowStateChange({
      step,
      ordersSkipped: ordersState === 'skipped',
      ordersImported,
      alreadyVerified,
      hasIssues,
      completed: step === 3 && (ordersState === 'done' || ordersState === 'skipped') && !hasIssues,
    })
  }, [onFlowStateChange, step, productsState, ordersState, ordersResults])

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

  /** Borne du sélecteur de date : importer des commandes « depuis demain » n'a aucun sens. */
  const todayIso = new Date().toISOString().slice(0, 10)

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
      // Boutique liée : le parcours enchaîne seul sur les produits, sans étape manuelle.
      setStep(2)
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

  /**
   * Import par lots courts : chaque requête traite une page, la progression est donc visible
   * pendant l'exécution, et une limite de débit du fournisseur n'oblige pas à tout recommencer
   * (la reprise repart du curseur enregistré). Les compteurs sont cumulés par boutique.
   */
  const runStep = async (step: 'products' | 'orders') => {
    if (!targetStoreId) {
      setError('Sélectionnez un store avant de lancer la synchronisation.')
      return
    }

    if (step === 'products' && storeBindings.length === 0) {
      setError('Associez d’abord une boutique (étape 1).')
      return
    }

    if (step === 'products') {
      setProductsState('running')
      setProductsResults([])
    } else {
      setOrdersState('running')
      setOrdersResults([])
    }

    setError('')
    setProgressNote('')

    try {
      if (step === 'products') {
        const byBinding = new Map<string, ProductStepResult>()
        let failedAny = false
        let errorText = ''

        for (let batch = 1; batch <= MAX_SYNC_BATCHES; batch += 1) {
          const payload = await requestSyncBatch(step)
          const results = payload?.products || []
          mergeProductBatch(byBinding, results)

          if (payload?.ok === false) {
            failedAny = true
            errorText = (payload?.warnings || []).join(' · ')
          }

          const rows = Array.from(byBinding.values())
          setProductsResults(rows)
          setProgressNote(
            `lot ${batch} · ${rows.reduce((total, row) => total + row.productsCreated, 0)} créé(s) · ` +
              `${rows.reduce((total, row) => total + row.scanned, 0)} analysé(s)`
          )

          if (failedAny || !rows.some((row) => row.hasMore)) break
        }

        const rows = Array.from(byBinding.values())
        const remaining = rows.some((row) => row.hasMore)
        const failed = failedAny || rows.some((row) => !row.ok)

        setProductsState(failed ? 'error' : remaining ? 'partial' : 'done')
        if (failed) setError(errorText || 'Synchronisation des produits interrompue.')

        // Étape franchie : on enchaîne sur les ventes, sans repasser par la boutique.
        if (!failed && !remaining) setStep(3)
      } else {
        const byBinding = new Map<string, OrderStepResult>()
        let failedAny = false
        let errorText = ''

        for (let batch = 1; batch <= MAX_SYNC_BATCHES; batch += 1) {
          const payload = await requestSyncBatch(step)
          const results = payload?.orders || []
          mergeOrderBatch(byBinding, results)

          if (payload?.ok === false) {
            failedAny = true
            // Motif d'échec de chaque boutique, en libellés lisibles : la limitation du
            // fournisseur ne doit pas être noyée dans les avertissements de données.
            errorText = (payload?.orders || [])
              .filter((row) => !row.ok && row.reason)
              .map((row) => formatWarnings([String(row.reason)]))
              .join(' · ')
          }

          const rows = Array.from(byBinding.values())
          setOrdersResults(rows)
          setProgressNote(
            `lot ${batch} · ${rows.reduce((total, row) => total + row.imported, 0)} importée(s) · ` +
              `${rows.reduce((total, row) => total + row.alreadyImported, 0)} déjà vérifiée(s) · ` +
              `${rows.reduce((total, row) => total + row.scanned, 0)} analysée(s)`
          )

          if (failedAny || !rows.some((row) => row.hasMore)) break

          // Une pause entre deux pages laisse respirer le quota du fournisseur.
          await new Promise((resolve) => setTimeout(resolve, ORDER_BATCH_PAUSE_MS))
        }

        const rows = Array.from(byBinding.values())
        const remaining = rows.some((row) => row.hasMore)
        const toRepair = rows.reduce((total, row) => total + (row.needsRepair || 0), 0)
        const failed = failedAny || rows.some((row) => !row.ok) || toRepair > 0

        setOrdersState(failed ? 'error' : remaining ? 'partial' : 'done')
        if (failed) {
          // Le motif le plus actionnable passe en premier : une liaison incohérente ne doit pas
          // être noyée dans une liste de codes techniques.
          setError(
            toRepair > 0
              ? `${toRepair} commande(s) déjà liée(s) à un autre store : rien n’a été déplacé ni dupliqué, la liaison est à réparer.`
              : errorText || 'Import des commandes interrompu.'
          )
        }
      }

      await refresh()
      await queryClient.invalidateQueries({ queryKey: ['orders'] })
      await queryClient.invalidateQueries({ queryKey: ['products'] })
    } catch (stepError) {
      const message = stepError instanceof Error ? stepError.message : 'LIGHTFUNNELS_SYNC_FAILED'
      setError(message)
      if (step === 'products') setProductsState('error')
      else setOrdersState('error')
    } finally {
      setProgressNote('')
    }
  }

  /** Un lot = une page : voir `MAX_SYNC_BATCHES` pour la borne du parcours complet. */
  const requestSyncBatch = async (step: 'products' | 'orders') => {
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
        maxPages: 1,
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

    return payload
  }

  const stepBadge = (state: StepState) => {
    const isActive = state === 'running' || state === 'current'

    const label =
      state === 'done'
        ? 'Terminé'
        : state === 'partial'
          ? 'Partiel'
          : isActive
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
          : isActive
            ? 'bg-primary/10 text-primary'
            : state === 'error'
              ? 'bg-red-500/10 text-red-600 dark:text-red-400'
              : 'bg-muted text-muted-foreground'

    return (
      <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', tone)}>
        {isActive ? (
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

        <div className="mt-4 space-y-2">
          {(
            [
              {
                index: 1 as const,
                label: 'Boutique associée',
                state: step1State,
                detail:
                  storeBindings.length > 0
                    ? `${storeBindings.length} boutique(s) liée(s)`
                    : 'boutique à associer',
              },
              {
                index: 2 as const,
                label: 'Produits',
                state: productsState,
                detail: productsResults.length > 0
                  ? summarizeProducts(productsResults)
                  : 'à synchroniser ou à ignorer',
              },
              {
                index: 3 as const,
                label: 'Commandes',
                state: ordersState,
                detail: ordersResults.length > 0
                  ? summarizeOrders(ordersResults)
                  : 'à importer ou à ignorer',
              },
            ] as Array<{ index: 1 | 2 | 3; label: string; state: StepState; detail: string }>
          ).map((row) => {
            const isActive = row.index === step
            // L'étape affichée est « en cours » tant qu'elle n'est pas résolue : les états
            // restent donc à leur place, y compris pendant une synchronisation.
            const state: StepState = isActive && row.state === 'pending' ? 'current' : row.state
            const isRunning = row.state === 'running'

            return (
              <div
                key={row.label}
                className={cn(
                  'flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-xs',
                  isActive ? 'border-primary/40 bg-primary/5' : 'border-transparent'
                )}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={cn(
                      'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
                      isActive ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                    )}
                  >
                    {row.index}
                  </span>
                  <span className="min-w-0">
                    <span className={cn(isActive ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                      {row.label}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {isRunning && progressNote ? progressNote : row.detail}
                    </span>
                  </span>
                </div>
                {stepBadge(state)}
              </div>
            )
          })}
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

                {showBindingActions ? (
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
                ) : null}
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
                // Même règle qu'à l'étape des commandes : une synchronisation en échec ne doit
                // pas être effacée par « Non ».
                if (productsState === 'error' || productsState === 'partial') return

                setError('')
                setProductsState('skipped')
                setProductsResults([])
                setStep(3)
              }}
              disabled={
                productsState === 'running' || productsState === 'error' || productsState === 'partial'
              }
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
                  {productsState === 'partial' || productsState === 'error'
                    ? 'Reprendre'
                    : 'Synchroniser'}
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
              max={todayIso}
              value={sinceDate}
              onChange={(event) => {
                const value = event.target.value > todayIso ? todayIso : event.target.value
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
                // « Non » ne conclut rien si un import a déjà signalé une anomalie : l'état
                // d'erreur (ou l'import partiel) et son message sont conservés, sinon un
                // incident deviendrait une confirmation trompeuse.
                if (ordersState === 'error' || ordersState === 'partial') return

                setError('')
                setOrdersState('skipped')
                setOrdersResults([])
              }}
              disabled={
                ordersState === 'running' || ordersState === 'error' || ordersState === 'partial'
              }
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
                  {ordersState === 'partial' || ordersState === 'error'
                    ? 'Reprendre'
                    : 'Synchroniser'}
                </>
              )}
            </button>
          </div>

          {/* Progression visible pendant l'import : le total de l'historique n'est pas connu,
              aucun pourcentage n'est donc inventé — on montre le lot en cours et les compteurs
              réellement reçus (barre indéterminée volontaire). */}
          {ordersState === 'running' ? (
            <div
              role="status"
              aria-live="polite"
              className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3"
            >
              <p className="flex items-center gap-2 text-xs font-medium text-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                Import en cours — {progressNote || 'lecture de la page…'}
              </p>

              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
              </div>

              <p className="text-[11px] text-muted-foreground">
                Chaque lot regroupe plusieurs commandes : les compteurs s’actualisent à la fin de
                chaque lot, pas commande par commande.
              </p>

              {ordersResults.length > 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  {ordersResults.reduce((total, row) => total + row.imported, 0)} importée(s) ·{' '}
                  {ordersResults.reduce((total, row) => total + row.alreadyImported, 0)} déjà
                  vérifiée(s) · {ordersResults.reduce((total, row) => total + row.scanned, 0)}{' '}
                  analysée(s)
                </p>
              ) : null}
            </div>
          ) : null}

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
                    présente(s) et vérifiée(s) dans ce store
                  </p>
                  {result.needsRepair && result.needsRepair > 0 ? (
                    <p className="flex items-center gap-1 text-red-500">
                      <AlertTriangle className="h-3 w-3" /> {result.needsRepair} commande(s) déjà liée(s) à
                      un autre store : ni déplacée(s) ni dupliquée(s), à réparer.
                    </p>
                  ) : null}
                  {result.skipped > 0 ? (
                    <p>
                      {result.skipped} ignorée(s)
                      {formatReasons(result.skippedReasons) ? ` : ${formatReasons(result.skippedReasons)}` : ''}
                    </p>
                  ) : null}
                  {(result.warnings || []).filter((warning) => warning !== result.reason).length > 0 ? (
                    <p className="text-amber-600 dark:text-amber-400">
                      {formatWarnings(
                        (result.warnings || []).filter((warning) => warning !== result.reason)
                      )}
                    </p>
                  ) : null}
                  {!result.ok && result.reason ? (
                    <p className="flex items-center gap-1 text-red-500">
                      <AlertTriangle className="h-3 w-3" /> {formatWarnings([result.reason])}
                    </p>
                  ) : null}
                  {result.hasMore ? (
                    <p className="text-amber-600 dark:text-amber-400">
                      {isRateLimitReason(result.reason)
                        ? 'Lecture interrompue par Lightfunnels (limite de débit) : la reprise continue à la page enregistrée et aucune commande n’est sautée.'
                        : 'Il reste des pages à parcourir : relancez l’import, la reprise continue à la page enregistrée.'}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {showCompletionNotice && (ordersState === 'done' || ordersState === 'skipped') ? (
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

      {error ? <p className="text-sm text-red-500">{error}</p> : null}
    </div>
  )
}

