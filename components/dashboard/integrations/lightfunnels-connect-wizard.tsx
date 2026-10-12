'use client'

import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Loader2, X, Zap } from 'lucide-react'
import LightfunnelsImportStepper, { type LightfunnelsApiStatus } from './lightfunnels-import-stepper'
import { useStore } from '@/lib/store-context'

/**
 * Connexion Lightfunnels : consentement OAuth, puis liaison explicite des boutiques
 * distantes aux stores Jisra. Une boutique distante n'est jamais rattachée
 * automatiquement.
 */
export default function LightfunnelsConnectWizard({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const { currentStoreId, setCurrentStoreId, accessibleStores } = useStore()
  const [status, setStatus] = useState<LightfunnelsApiStatus | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])

  // Le parcours est lié à un store : si « Tous les stores » est actif, on retient le premier
  // store accessible comme point de départ (modifiable à l'étape 1).
  useEffect(() => {
    if (currentStoreId || accessibleStores.length === 0) return
    setCurrentStoreId(accessibleStores[0].id)
  }, [currentStoreId, accessibleStores, setCurrentStoreId])

  const loadStatus = useCallback(async () => {
    const storeId = currentStoreId
    if (!storeId) {
      setStatus(null)
      setIsLoading(false)
      return
    }

    setIsLoading(true)

    try {
      const response = await fetch(
        `/api/integrations/lightfunnels/status?storeId=${encodeURIComponent(storeId)}`,
        { credentials: 'include' }
      )

      const payload = (await response.json().catch(() => null)) as
        | (LightfunnelsApiStatus & { error?: string })
        | null

      if (!response.ok) throw new Error(payload?.error || 'LIGHTFUNNELS_STATUS_FAILED')

      setStatus(payload as LightfunnelsApiStatus)
      setWarnings(payload?.warnings || [])
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'LIGHTFUNNELS_STATUS_FAILED')
    } finally {
      setIsLoading(false)
    }
  }, [currentStoreId])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return

      const data = event.data as { type?: string; message?: string } | null
      if (!data?.type) return

      if (data.type === 'LIGHTFUNNELS_INTEGRATION_CONNECTED') {
        setIsConnecting(false)
        void loadStatus()
        void queryClient.invalidateQueries({ queryKey: ['integration-marketplace'] })
      }

      if (data.type === 'LIGHTFUNNELS_INTEGRATION_FAILED') {
        setIsConnecting(false)
        setError(data.message || 'LIGHTFUNNELS_CONNECT_FAILED')
      }
    }

    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [loadStatus, queryClient])

  const connect = async () => {
    const storeId = currentStoreId

    if (!storeId) {
      setError('Sélectionnez un store avant de connecter Lightfunnels.')
      return
    }

    setIsConnecting(true)
    setError('')

    const popup = window.open('', 'lightfunnels_oauth_popup', 'popup=yes,width=560,height=760')

    try {
      const response = await fetch(
        `/api/integrations/lightfunnels/connect?storeId=${encodeURIComponent(storeId)}`,
        { credentials: 'include' }
      )

      const payload = (await response.json().catch(() => null)) as { url?: string; error?: string } | null

      if (!response.ok || !payload?.url) {
        throw new Error(payload?.error || 'LIGHTFUNNELS_CONNECT_FAILED')
      }

      if (!popup) {
        throw new Error('POPUP_BLOCKED')
      }

      popup.location.href = payload.url

      // Si la fenêtre se ferme sans message, on relit l'état : la connexion a pu aboutir.
      const monitor = window.setInterval(() => {
        if (popup.closed) {
          window.clearInterval(monitor)
          setIsConnecting(false)
          void loadStatus()
          void queryClient.invalidateQueries({ queryKey: ['integration-marketplace'] })
        }
      }, 1500)
    } catch (connectError) {
      popup?.close()
      setIsConnecting(false)
      setError(connectError instanceof Error ? connectError.message : 'LIGHTFUNNELS_CONNECT_FAILED')
    }
  }

  const isConnected = Boolean(status?.connected)

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-12">
      <div className="absolute inset-0 bg-black/40" onClick={() => onClose()} />

      <div className="relative z-10 w-full max-w-2xl rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Zap className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-foreground">Lightfunnels</h3>
              <p className="text-sm text-muted-foreground">
                {isConnected
                  ? 'Associez chaque boutique Lightfunnels à un store Jisra, puis importez les commandes.'
                  : 'Connectez votre compte Lightfunnels pour importer les commandes.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onClose()}
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : null}

        {!isLoading && status?.needsReconnect ? (
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              L’accès enregistré n’est plus valide. Reconnectez votre compte Lightfunnels pour
              reprendre les imports. Les commandes déjà importées ne sont pas affectées.
            </p>
          </div>
        ) : null}

        {!isLoading && status ? (
          <LightfunnelsImportStepper
            status={status}
            onChanged={loadStatus}
            connectAction={
              <button
                type="button"
                onClick={() => void connect()}
                disabled={isConnecting || !currentStoreId}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {isConnecting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Connexion en cours...
                  </>
                ) : (
                  'Se connecter à Lightfunnels'
                )}
              </button>
            }
          />
        ) : null}

        {warnings.length > 0 ? (
          <div className="mt-4 space-y-1 rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground">
            {warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        ) : null}

        {error ? <p className="mt-4 text-sm text-red-500">{error}</p> : null}
      </div>
    </div>
  )
}
