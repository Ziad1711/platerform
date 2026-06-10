'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, X, Zap, Globe, ExternalLink } from 'lucide-react'
import { JisraMark } from '@/components/logo'
import { getIntegrationMarketplaceData } from '@/lib/integrations/service'
import IntegrationCard from '@/components/dashboard/integrations/integration-card'
import DeliveryConnectWizard from '@/components/dashboard/integrations/delivery-connect-wizard'
import FacebookAdsConnectWizard from '@/components/dashboard/integrations/facebook-ads-connect-wizard'
import { CustomSiteKeys } from '@/components/dashboard/integrations/custom-site-keys'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { useStore } from '@/lib/store-context'

function IntegrationSkeletonCard() {
  return (
    <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm animate-pulse">
      <div className="flex items-start justify-between">
        <div className="h-14 w-14 rounded-xl bg-muted" />
        <div className="h-6 w-24 rounded-full bg-muted" />
      </div>
      <div className="mt-5 space-y-3">
        <div className="h-5 w-32 rounded bg-muted" />
        <div className="space-y-2">
          <div className="h-4 w-full rounded bg-muted" />
          <div className="h-4 w-2/3 rounded bg-muted" />
        </div>
      </div>
      <div className="mt-5 flex items-center gap-2">
        <div className="h-3 w-3 rounded-full bg-muted" />
        <div className="h-3 w-24 rounded bg-muted" />
      </div>
      <div className="mt-5 h-12 w-full rounded-xl bg-muted" />
    </div>
  )
}

export default function IntegrationsPage() {
  const router = useRouter()
  const { currentStoreId, accessibleStores } = useStore()
  const supabase = createClient()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [connectProviderSlug, setConnectProviderSlug] = useState<string | null>(null)
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false)
  const [youcanStoreSlug, setYoucanStoreSlug] = useState('')
  const [isConnecting, setIsConnecting] = useState(false)
  const [connectError, setConnectError] = useState('')
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)
  const [importProducts, setImportProducts] = useState(true)
  const [importOrders, setImportOrders] = useState(true)
  const [sinceDate, setSinceDate] = useState('2026-01-01')
  const [isStartingImport, setIsStartingImport] = useState(false)
  const [importError, setImportError] = useState('')
  const [isCustomSiteModalOpen, setIsCustomSiteModalOpen] = useState(false)
  const [selectedCustomSiteStoreId, setSelectedCustomSiteStoreId] = useState<string | null>(null)
  const [selectedCustomSiteStoreWebsite, setSelectedCustomSiteStoreWebsite] = useState<string | null>(null)
  const popupMonitorRef = useRef<number | null>(null)
  const popupWindowRef = useRef<Window | null>(null)
  const hasHandledConnectRef = useRef(false)

  const clearPopupMonitor = () => {
    if (popupMonitorRef.current !== null) {
      window.clearInterval(popupMonitorRef.current)
      popupMonitorRef.current = null
    }
  }

  const handleConnectionSuccess = () => {
    if (hasHandledConnectRef.current) return
    hasHandledConnectRef.current = true

    clearPopupMonitor()
    popupWindowRef.current = null
    void queryClient.invalidateQueries({ queryKey: ['integration-marketplace'] })
    setIsConnectModalOpen(false)
    setIsImportModalOpen(true)
    setConnectProviderSlug(null)
    setYoucanStoreSlug('')
  }

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type !== 'YOUCAN_INTEGRATION_CONNECTED') return
      if (popupWindowRef.current && event.source !== popupWindowRef.current) return

      handleConnectionSuccess()
    }

    window.addEventListener('message', onMessage)
    return () => {
      clearPopupMonitor()
      window.removeEventListener('message', onMessage)
    }
  }, [queryClient])

  const { data: marketplaceItems = [], isLoading } = useQuery({
    queryKey: ['integration-marketplace'],
    queryFn: getIntegrationMarketplaceData,
  })

  const filteredIntegrations = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return marketplaceItems

    return marketplaceItems.filter(
      (item) =>
        item.name.toLowerCase().includes(term) ||
        item.description.toLowerCase().includes(term)
    )
  }, [search, marketplaceItems])

  const sortedIntegrations = useMemo(
    () =>
      [...filteredIntegrations].sort((a, b) => {
        if (b.usersCount !== a.usersCount) return b.usersCount - a.usersCount
        return b.ratingAvg - a.ratingAvg
      }),
    [filteredIntegrations]
  )

  const featuredIntegrations = sortedIntegrations.slice(0, 2)
  const regularIntegrations = sortedIntegrations.slice(2)

  const handleAction = (providerSlug: string, isConnected: boolean) => {
    if (isConnected) {
      router.push(`/integrations/${providerSlug}/settings`)
    } else if (providerSlug === 'custom-site') {
      setIsCustomSiteModalOpen(true)
      setSelectedCustomSiteStoreId(null)
      setSelectedCustomSiteStoreWebsite(null)
    } else {
      setConnectProviderSlug(providerSlug)
      if (providerSlug !== 'facebook-ads' && providerSlug !== 'rapid-delivery') {
        setYoucanStoreSlug('')
      }
      setConnectError('')
      setIsConnectModalOpen(true)
    }
  }

  const handleConnect = async () => {
    if (!connectProviderSlug) return

    const slug = youcanStoreSlug.trim().replace(/^https?:\/\//, '').replace(/\.youcan\.shop.*$/i, '')
    if (!slug) {
      setConnectError('Veuillez entrer votre slug de boutique YouCan.')
      return
    }

    setIsConnecting(true)
    setConnectError('')
    hasHandledConnectRef.current = false

    const popup = window.open('', 'youcan_oauth_popup', 'popup=yes,width=560,height=760')
    popupWindowRef.current = popup

    const {
      data: { session },
    } = await supabase.auth.getSession()

    const accessToken = session?.access_token
    if (!accessToken) {
      popup?.close()
      window.location.href = '/login'
      setIsConnecting(false)
      return
    }

    const response = await fetch(
      `/api/integrations/${connectProviderSlug}/connect?store=${encodeURIComponent(slug)}&storeId=${currentStoreId || ''}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    )

    if (!response.ok) {
      const errorPayload = (await response.json().catch(() => null)) as { error?: string } | null
      clearPopupMonitor()
      popup?.close()
      setConnectError(errorPayload?.error || 'Impossible de démarrer la connexion YouCan. Réessayez.')
      setIsConnecting(false)
      return
    }

    const payload = (await response.json()) as { url?: string }
    if (!payload.url) {
      clearPopupMonitor()
      popup?.close()
      setConnectError('URL d\'autorisation invalide.')
      setIsConnecting(false)
      return
    }

    if (!popup) {
      setConnectError('Popup bloqué. Autorisez les popups et réessayez.')
      setIsConnecting(false)
      return
    }

    const authorizationUrl = payload.url
    popup.location.href = authorizationUrl

    setIsConnectModalOpen(false)
    setConnectProviderSlug(null)
    setIsConnecting(false)

    clearPopupMonitor()
    let hasRetriedAuthorize = false
    const monitorStartAt = Date.now()

    popupMonitorRef.current = window.setInterval(() => {
      if (popup.closed) {
        clearPopupMonitor()
        popupWindowRef.current = null

        if (!hasHandledConnectRef.current) {
          void queryClient.invalidateQueries({ queryKey: ['integration-marketplace'] }).then(() => {
            const latestMarketplace = queryClient.getQueryData(['integration-marketplace']) as
              | Array<{ slug: string; isConnected: boolean }>
              | undefined

            const youcanIntegration = latestMarketplace?.find((item) => item.slug === 'youcan')
            if (youcanIntegration?.isConnected) {
              handleConnectionSuccess()
            }
          })
        }
        return
      }

      // After 10 seconds, try to detect if the popup is on YouCan's domain (cross-origin)
      // or still on our domain. If cross-origin (YouCan), attempt to redirect back to authorize URL.
      if (!hasRetriedAuthorize && Date.now() - monitorStartAt > 10000) {
        let isOnExternalDomain = false

        try {
          // This throws a SecurityError if cross-origin
          const href = popup.location.href
          // If readable, check if it's on YouCan's dashboard (not our domain, not authorize page)
          if (
            href.startsWith('https://seller-area.youcan.shop') &&
            !href.includes('/oauth/authorize')
          ) {
            isOnExternalDomain = true
          }
        } catch {
          // Cross-origin: popup is on an external domain (YouCan SSO or dashboard)
          isOnExternalDomain = true
        }

        if (isOnExternalDomain) {
          hasRetriedAuthorize = true
          try {
            popup.location.href = authorizationUrl
          } catch {
            // ignore
          }
        }
      }
    }, 1500)
  }

  const handleStartImport = async () => {
    if (!currentStoreId) {
      setImportError('Sélectionnez un store avant de lancer l\'import.')
      return
    }

    if (!importProducts && !importOrders) {
      setImportError('Choisissez au moins Produits ou Ventes.')
      return
    }

    setIsStartingImport(true)
    setImportError('')

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      const accessToken = session?.access_token || ''
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }

      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`
      }

      const response = await fetch('/api/integrations/youcan/sync', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({
          storeId: currentStoreId,
          importProducts,
          importOrders,
          sinceDate: importOrders ? sinceDate : undefined,
        }),
      })

      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(errorPayload?.error || 'Lancement import impossible')
      }

      setIsImportModalOpen(false)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Erreur import')
    } finally {
      setIsStartingImport(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-10 px-4 py-8 pt-2 sm:pt-8">

      {/* Header Section */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex flex-col items-center sm:items-start gap-1">
          <div className="flex items-center gap-2">
            <JisraMark size={28} />
            <span className="text-lg font-bold text-[#1fa971] bg-[#1fa971]/10 px-3 py-1 rounded-full">
              Intégrations
            </span>
          </div>
          <p className="text-sm text-muted-foreground text-center sm:text-left">
            Connectez vos outils et automatisez votre business
          </p>
        </div>

        {/* Search Bar */}
        <div className="flex items-center gap-2 w-full sm:w-auto sm:min-w-[360px]">
          <div className="relative flex-1">
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoComplete="off"
              name="integrations-search"
              spellCheck={false}
              placeholder="Search integrations (Shopify, Stripe, DHL, WooCommerce...)"
              className="w-full rounded-2xl border border-border bg-card py-4 pl-14 pr-6 text-base text-foreground shadow-lg transition-all duration-300 focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/20"
            />
          </div>
          <button
            type="button"
            className="shrink-0 rounded-2xl border border-[#1fa971] bg-[#1fa971] p-4 text-white shadow-lg hover:bg-[#1a8e5e] transition-colors"
            aria-label="Search"
          >
            <Search className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Featured Integrations Section */}
      {featuredIntegrations.length > 0 && (
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <Zap className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-semibold text-foreground">Featured Integrations</h2>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {featuredIntegrations.map((integration) => (
              <IntegrationCard
                key={integration.id}
                name={integration.name}
                description={integration.description}
                usersCount={integration.usersCount}
                ratingAvg={integration.ratingAvg}
                totalReviews={integration.totalReviews}
                isConnected={integration.isConnected}
                onAction={() => handleAction(integration.slug, integration.isConnected)}
                isFeatured={true}
                logoUrl={integration.logoUrl}
              />
            ))}
          </div>
        </div>
      )}

      {/* All Integrations Section */}
      <div className="space-y-6">
        <h2 className="text-2xl font-semibold text-foreground">All Integrations</h2>
        <div className={cn(
          "grid gap-6",
          "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
          regularIntegrations.length === 0 && "lg:grid-cols-3"
        )}>
          {isLoading ? (
            Array.from({ length: 6 }).map((_, index) => (
              <IntegrationSkeletonCard key={`skeleton-${index}`} />
            ))
          ) : sortedIntegrations.length > 0 ? (
            regularIntegrations.map((integration) => (
              <IntegrationCard
                key={integration.id}
                name={integration.name}
                description={integration.description}
                usersCount={integration.usersCount}
                ratingAvg={integration.ratingAvg}
                totalReviews={integration.totalReviews}
                isConnected={integration.isConnected}
                onAction={() => handleAction(integration.slug, integration.isConnected)}
                logoUrl={integration.logoUrl}
              />
            ))
          ) : (
            <div className="col-span-full text-center py-12">
              <div className="text-muted-foreground">
                No integrations found matching "{search}"
              </div>
            </div>
          )}
        </div>
      </div>

      {isConnectModalOpen && connectProviderSlug === 'rapid-delivery' ? (
        <DeliveryConnectWizard
          onClose={() => {
            if (!isConnecting) {
              setIsConnectModalOpen(false)
              setConnectProviderSlug(null)
              setConnectError('')
            }
          }}
        />
      ) : null}

      {isConnectModalOpen && connectProviderSlug === 'facebook-ads' ? (
        <FacebookAdsConnectWizard
          onClose={() => {
            setIsConnectModalOpen(false)
            setConnectProviderSlug(null)
            setConnectError('')
          }}
        />
      ) : null}

      {/* YouCan Connect Modal */}
      {isConnectModalOpen && connectProviderSlug !== 'rapid-delivery' && connectProviderSlug !== 'facebook-ads' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => {
              if (!isConnecting) {
                setIsConnectModalOpen(false)
                setConnectProviderSlug(null)
                setYoucanStoreSlug('')
                setConnectError('')
              }
            }}
          />

          <div className="relative z-10 w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-foreground">
                  {connectProviderSlug === 'rapid-delivery' ? 'Connecter Rapid Delivery' : 'Connecter YouCan'}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {connectProviderSlug === 'rapid-delivery'
                    ? 'Entrez votre token API Rapid Delivery'
                    : 'Entrez le slug de votre boutique YouCan'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!isConnecting) {
                    setIsConnectModalOpen(false)
                    setConnectProviderSlug(null)
                    setYoucanStoreSlug('')
                    setConnectError('')
                  }
                }}
                className="rounded-lg p-2 text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              {connectProviderSlug !== 'rapid-delivery' ? (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">
                    Slug de votre boutique
                  </label>
                  <div className="flex items-center rounded-xl border border-border bg-background overflow-hidden focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary">
                    <span className="pl-3 pr-1 text-sm text-muted-foreground whitespace-nowrap">
                      https://
                    </span>
                    <input
                      type="text"
                      value={youcanStoreSlug}
                      onChange={(e) => {
                        setYoucanStoreSlug(e.target.value)
                        setConnectError('')
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleConnect()
                      }}
                      placeholder="mon-store"
                      disabled={isConnecting}
                      className="flex-1 py-3 pr-3 text-sm text-foreground bg-transparent outline-none disabled:opacity-50"
                    />
                    <span className="pr-3 text-sm text-muted-foreground whitespace-nowrap">
                      .youcan.shop
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Exemple : si votre boutique est <span className="font-medium">mon-store.youcan.shop</span>, entrez <span className="font-medium">mon-store</span>
                  </p>
                </div>
              ) : null}

              {connectError && (
                <p className="text-sm text-red-500">{connectError}</p>
              )}

              {connectProviderSlug !== 'rapid-delivery' ? (
                <button
                  type="button"
                  onClick={() => void handleConnect()}
                  disabled={isConnecting || !youcanStoreSlug.trim()}
                  className="w-full rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isConnecting ? 'Connexion en cours...' : 'Se connecter à YouCan'}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* Custom Site Modal */}
      {isCustomSiteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-12">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => {
              setIsCustomSiteModalOpen(false)
              setSelectedCustomSiteStoreId(null)
              setSelectedCustomSiteStoreWebsite(null)
            }}
          />

          <div className="relative z-10 w-full max-w-2xl rounded-2xl border border-border bg-card p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Globe className="h-6 w-6 text-primary" />
                <div>
                  <h3 className="text-lg font-semibold text-foreground">
                    Site web personnalisé
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Gérez l'intégration de votre site web vers Jisra
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsCustomSiteModalOpen(false)
                  setSelectedCustomSiteStoreId(null)
                  setSelectedCustomSiteStoreWebsite(null)
                }}
                className="rounded-lg p-2 text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Sélecteur de store */}
            <div className="mb-6 space-y-3">
              <label className="text-sm font-medium text-foreground">
                Store concerné
              </label>
              <div className="grid gap-2">
                {accessibleStores.map((store) => {
                  const isSelected = selectedCustomSiteStoreId === store.id
                  return (
                    <button
                      key={store.id}
                      type="button"
                      onClick={async () => {
                        setSelectedCustomSiteStoreId(store.id)
                        const { data } = await supabase
                          .from('stores')
                          .select('website')
                          .eq('id', store.id)
                          .single()
                        setSelectedCustomSiteStoreWebsite(data?.website || null)
                      }}
                      className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-all ${
                        isSelected
                          ? 'border-primary bg-primary/5 ring-1 ring-primary'
                          : 'border-border hover:border-primary/50 hover:bg-muted/50'
                      }`}
                    >
                      <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                        isSelected ? 'border-primary bg-primary' : 'border-muted-foreground'
                      }`}>
                        {isSelected && <div className="h-2 w-2 rounded-full bg-white" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{store.name}</p>
                        {store.id === selectedCustomSiteStoreId && selectedCustomSiteStoreWebsite && (
                          <a
                            href={selectedCustomSiteStoreWebsite.startsWith('http') ? selectedCustomSiteStoreWebsite : `https://${selectedCustomSiteStoreWebsite}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-0.5 flex items-center gap-1 text-xs text-primary hover:underline"
                          >
                            <Globe className="h-3 w-3" />
                            {selectedCustomSiteStoreWebsite}
                            <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {selectedCustomSiteStoreId && (
              <CustomSiteKeys storeId={selectedCustomSiteStoreId} />
            )}
          </div>
        </div>
      )}

      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => {
              if (!isStartingImport) {
                setIsImportModalOpen(false)
                setImportError('')
              }
            }}
          />

          <div className="relative z-10 w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-foreground">Importer depuis YouCan</h3>
                <p className="text-sm text-muted-foreground">Choisissez les données à importer</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!isStartingImport) {
                    setIsImportModalOpen(false)
                    setImportError('')
                  }
                }}
                className="rounded-lg p-2 text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              <label className="flex items-center gap-3 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={importProducts}
                  onChange={(e) => setImportProducts(e.target.checked)}
                  disabled={isStartingImport}
                />
                Importer Produits + Variantes
              </label>

              <label className="flex items-center gap-3 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={importOrders}
                  onChange={(e) => setImportOrders(e.target.checked)}
                  disabled={isStartingImport}
                />
                Importer Ventes (Orders)
              </label>

              {importOrders ? (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Depuis (min: 2026-01-01)</label>
                  <input
                    type="date"
                    min="2026-01-01"
                    value={sinceDate}
                    onChange={(e) => {
                      const value = e.target.value
                      setSinceDate(value < '2026-01-01' ? '2026-01-01' : value)
                    }}
                    disabled={isStartingImport}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                  />
                </div>
              ) : null}

              {!currentStoreId ? (
                <p className="text-sm text-amber-600">Sélectionnez un store en haut avant de lancer l’import.</p>
              ) : null}

              {importError ? <p className="text-sm text-red-500">{importError}</p> : null}

              <button
                type="button"
                onClick={() => void handleStartImport()}
                disabled={isStartingImport}
                className="w-full rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isStartingImport ? 'Import en cours...' : 'Démarrer import'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
