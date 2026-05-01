'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, Save, X } from 'lucide-react'
import ProgressSteps from '@/components/dashboard/integrations/progress-steps'
import { useStore } from '@/lib/store-context'
import { createClient } from '@/lib/supabase/client'

type AccountRow = {
  id: string
  account_id: string
  account_name: string
  account_currency: string
  timezone_name: string | null
  timezone_offset_hours: number | null
  is_active: boolean
}

type ProductRow = { id: string; name: string }
type StoreRow = { id: string; name: string }
type MappingRow = {
  id: string
  ad_account_id: string
  external_campaign_id: string
  campaign_name: string
  product_id: string
  is_active: boolean
}
type CampaignRow = { id: string; name: string; effectiveStatus: string }

const steps = [
  { key: 'connect', label: 'Connecter Facebook' },
  { key: 'accounts', label: 'Choisir les ad accounts' },
  { key: 'mapping', label: 'Mapper les campagnes' },
  { key: 'rate', label: 'Taux de change' },
  { key: 'sync', label: 'Synchronisation' },
]

export default function FacebookAdsConnectWizard({ onClose }: { onClose: () => void }) {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const { currentStoreId, setCurrentStoreId } = useStore()
  const [currentStep, setCurrentStep] = useState<'connect' | 'accounts' | 'mapping' | 'rate' | 'sync'>('connect')
  const [isConnecting, setIsConnecting] = useState(false)
  const [isSavingAccounts, setIsSavingAccounts] = useState(false)
  const [isSavingMappings, setIsSavingMappings] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [syncProgress, setSyncProgress] = useState<{ inserted: number; updated: number } | null>(null)
  const [syncDone, setSyncDone] = useState(false)
  const [error, setError] = useState('')
  const [rateSaved, setRateSaved] = useState(false)
  const syncStartedRef = useRef(false)
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([])
  const [campaignsByAccount, setCampaignsByAccount] = useState<Record<string, CampaignRow[]>>({})
  const [selectedProducts, setSelectedProducts] = useState<Record<string, string>>({})

  const { data: accountsPayload, refetch: refetchAccounts } = useQuery({
    queryKey: ['facebook-ads-accounts'],
    queryFn: async () => {
      const response = await fetch('/api/integrations/facebook-ads/accounts')
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'FACEBOOK_ACCOUNTS_FETCH_FAILED')
      return payload as { connected: boolean; accounts: AccountRow[] }
    },
  })

  const { data: mappingsPayload, refetch: refetchMappings } = useQuery({
    queryKey: ['facebook-ads-mappings', currentStoreId],
    enabled: !!currentStoreId,
    queryFn: async () => {
      const response = await fetch(`/api/integrations/facebook-ads/mappings?storeId=${encodeURIComponent(currentStoreId || '')}`)
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'FACEBOOK_MAPPINGS_FETCH_FAILED')
      return payload as { products: ProductRow[]; mappings: MappingRow[] }
    },
  })

  const { data: stores = [] } = useQuery({
    queryKey: ['facebook-ads-stores'],
    queryFn: async () => {
      const { data, error } = await supabase.from('stores').select('id, name').order('created_at', { ascending: true })
      if (error) throw new Error(error.message || 'Impossible de charger les stores')
      return (data || []) as StoreRow[]
    },
  })

  const connected = accountsPayload?.connected || false
  const accounts = accountsPayload?.accounts || []
  const activeAccounts = useMemo(() => accounts.filter((account) => account.is_active), [accounts])
  const products = mappingsPayload?.products || []
  const existingMappings = mappingsPayload?.mappings || []

  useEffect(() => {
    const nextIds = accounts.filter((account) => account.is_active).map((account) => account.id)
    setSelectedAccountIds((current) => {
      if (current.length === nextIds.length && current.every((id, index) => id === nextIds[index])) return current
      return nextIds
    })
  }, [accounts])

  useEffect(() => {
    const next: Record<string, string> = {}
    existingMappings.forEach((mapping) => {
      next[`${mapping.ad_account_id}:${mapping.external_campaign_id}`] = mapping.product_id
    })
    setSelectedProducts(next)
  }, [existingMappings])

  useEffect(() => {
    async function loadCampaigns() {
      if (!connected || activeAccounts.length === 0) {
        setCampaignsByAccount({})
        return
      }

      const next: Record<string, CampaignRow[]> = {}
      for (const account of activeAccounts) {
        try {
          const response = await fetch(`/api/integrations/facebook-ads/campaigns?accountId=${encodeURIComponent(account.account_id)}`)
          const payload = await response.json().catch(() => null)
          next[account.id] = response.ok ? payload?.campaigns || [] : []
        } catch {
          next[account.id] = []
        }
      }

      setCampaignsByAccount(next)
    }

    void loadCampaigns()
  }, [connected, activeAccounts])

  const flattenedCampaigns = useMemo(
    () => activeAccounts.flatMap((account) => (campaignsByAccount[account.id] || []).map((campaign) => ({ account, campaign }))),
    [activeAccounts, campaignsByAccount]
  )

  useEffect(() => {
    if (!connected && currentStep !== 'connect') setCurrentStep('connect')
  }, [connected, currentStep])

  const canAccessAccountsStep = connected
  const canAccessMappingStep = connected
  const canAccessSyncStep = canAccessMappingStep && !!currentStoreId && flattenedCampaigns.length > 0

  const toggleAccount = (accountId: string) => {
    setSelectedAccountIds((current) =>
      current.includes(accountId) ? current.filter((id) => id !== accountId) : [...current, accountId]
    )
  }

  const openPopup = async () => {
    setIsConnecting(true)
    setError('')
    try {
      const popup = window.open('', 'facebook_ads_oauth_popup', 'popup=yes,width=640,height=760')
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const accessToken = session?.access_token || ''
      const response = await fetch('/api/integrations/facebook-ads/connect', {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.url) throw new Error(payload?.error || 'FACEBOOK_CONNECT_FAILED')
      if (!popup) throw new Error('Popup bloqué. Autorisez les popups et réessayez.')
      popup.location.href = payload.url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'FACEBOOK_CONNECT_FAILED')
    } finally {
      setIsConnecting(false)
    }
  }

  useEffect(() => {
    const onMessage = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type !== 'FACEBOOK_ADS_INTEGRATION_CONNECTED') return
      await queryClient.invalidateQueries({ queryKey: ['integration-marketplace'] })
      await refetchAccounts()
      setCurrentStep('accounts')
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [queryClient, refetchAccounts])

  const saveAccounts = async () => {
    setIsSavingAccounts(true)
    setError('')
    try {
      const response = await fetch('/api/integrations/facebook-ads/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedAccountIds }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'FACEBOOK_ACCOUNTS_SAVE_FAILED')
      await refetchAccounts()
      setCurrentStep('mapping')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'FACEBOOK_ACCOUNTS_SAVE_FAILED')
    } finally {
      setIsSavingAccounts(false)
    }
  }

  const saveMappings = async () => {
    if (!currentStoreId) {
      setError('Sélectionnez un store avant de mapper les campagnes.')
      return
    }

    setIsSavingMappings(true)
    setError('')
    try {
      const mappings = flattenedCampaigns
        .map(({ account, campaign }) => ({
          adAccountId: account.id,
          externalCampaignId: campaign.id,
          campaignName: campaign.name,
          productId: selectedProducts[`${account.id}:${campaign.id}`] || '',
        }))
        .filter((item) => item.productId)

      const response = await fetch('/api/integrations/facebook-ads/mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId: currentStoreId, mappings }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'FACEBOOK_MAPPINGS_SAVE_FAILED')
      await refetchMappings()
      setCurrentStep('rate')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'FACEBOOK_MAPPINGS_SAVE_FAILED')
    } finally {
      setIsSavingMappings(false)
    }
  }

  const runSync = async () => {
    if (!currentStoreId) return

    setIsRefreshing(true)
    setSyncProgress(null)
    setSyncDone(false)
    setError('')
    try {
      const response = await fetch('/api/integrations/facebook-ads/sync/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId: currentStoreId }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'FACEBOOK_MANUAL_SYNC_FAILED')
      const results = payload?.results?.[0]
      if (results) setSyncProgress({ inserted: results.inserted, updated: results.updated })
      setSyncDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'FACEBOOK_MANUAL_SYNC_FAILED')
    } finally {
      setIsRefreshing(false)
    }
  }

  // Auto-déclencher la sync dès qu'on arrive à l'étape 4
  useEffect(() => {
    if (currentStep === 'sync' && !syncStartedRef.current && currentStoreId) {
      syncStartedRef.current = true
      void runSync()
    }
  }, [currentStep, currentStoreId])

  const disconnect = async () => {
    setError('')
    try {
      const response = await fetch('/api/integrations/facebook-ads/disconnect', { method: 'POST' })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'FACEBOOK_DISCONNECT_FAILED')
      await queryClient.invalidateQueries({ queryKey: ['integration-marketplace'] })
      await refetchAccounts()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'FACEBOOK_DISCONNECT_FAILED')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-6xl rounded-3xl border border-border bg-card shadow-2xl">
        <div className="flex items-start justify-between border-b border-border p-6">
          <div>
            <h3 className="text-xl font-semibold text-foreground">Configuration Facebook Ads</h3>
            <p className="mt-1 text-sm text-muted-foreground">Un flux simple par étapes pour connecter, filtrer et mapper vos campagnes.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-6 p-6 lg:grid-cols-[260px_1fr]">
          <aside className="rounded-2xl border border-border bg-muted/20 p-4">
            <ProgressSteps steps={steps} currentStep={currentStep} />
          </aside>

          <div className="space-y-6">
            {currentStep === 'connect' ? (
            <section className="rounded-2xl border border-border p-5">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h4 className="font-semibold text-foreground">Étape 1 — Connexion</h4>
                  <p className="text-sm text-muted-foreground">Connectez votre compte Facebook une seule fois.</p>
                </div>
                {connected ? <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-600">Connecté</span> : null}
              </div>
              <div className="flex flex-wrap gap-3">
                <button type="button" onClick={() => void openPopup()} disabled={isConnecting || connected} className="rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
                  {isConnecting ? 'Connexion...' : connected ? 'Connexion établie' : 'Connecter Facebook'}
                </button>
                {connected ? (
                  <button type="button" onClick={() => void disconnect()} className="rounded-xl border border-red-200 px-4 py-3 text-sm font-medium text-red-600">
                    Déconnecter
                  </button>
                ) : null}
              </div>
            </section>
            ) : null}

            {currentStep === 'accounts' ? (
            <section className="rounded-2xl border border-border p-5">
              <div className="mb-4">
                <h4 className="font-semibold text-foreground">Étape 2 — Ad accounts à utiliser</h4>
                <p className="text-sm text-muted-foreground">Choisissez seulement les comptes publicitaires à intégrer pour éviter d’avoir trop de campagnes inutiles.</p>
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {accounts.map((account) => {
                  const checked = selectedAccountIds.includes(account.id)
                  return (
                    <button
                      key={account.id}
                      type="button"
                      onClick={() => toggleAccount(account.id)}
                      disabled={!connected}
                      className={`rounded-2xl border p-4 text-left transition ${checked ? 'border-primary bg-primary/5' : 'border-border'} disabled:opacity-50`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-foreground">{account.account_name}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{account.account_currency} • {account.account_id}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{account.timezone_name || 'Timezone inconnue'}</div>
                        </div>
                        <div className={`flex h-5 w-5 items-center justify-center rounded-full border ${checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}`}>
                          {checked ? <Check className="h-3 w-3" /> : null}
                        </div>
                      </div>
                    </button>
                  )
                })}
                {accounts.length === 0 ? <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">Aucun ad account disponible.</div> : null}
              </div>

              <div className="mt-4 flex gap-3">
                <button type="button" onClick={() => void saveAccounts()} disabled={!connected || isSavingAccounts} className="rounded-xl border px-4 py-3 text-sm font-medium disabled:opacity-50">
                  {isSavingAccounts ? 'Enregistrement...' : 'Valider les ad accounts'}
                </button>
              </div>
            </section>
            ) : null}

            {currentStep === 'mapping' ? (
            <section className="rounded-2xl border border-border p-5">
              <div className="mb-4 space-y-3">
                <div>
                  <h4 className="font-semibold text-foreground">Étape 3 — Mapping campagnes → produits</h4>
                  <p className="text-sm text-muted-foreground">Seules les campagnes des ad accounts sélectionnés sont affichées.</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Choisir un store</label>
                  <select value={currentStoreId || ''} onChange={(e) => setCurrentStoreId(e.target.value || null)} className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm">
                    <option value="">Sélectionnez un store</option>
                    {stores.map((store) => (
                      <option key={store.id} value={store.id}>{store.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="rounded-2xl border overflow-hidden">
                <div className="grid grid-cols-[1.1fr_1.2fr_1fr_120px] gap-3 bg-muted/40 px-4 py-3 text-sm font-medium text-foreground">
                  <div>Ad account</div>
                  <div>Campagne</div>
                  <div>Produit</div>
                  <div>Statut</div>
                </div>
                <div className="max-h-[360px] divide-y divide-border overflow-auto">
                  {flattenedCampaigns.map(({ account, campaign }) => {
                    const key = `${account.id}:${campaign.id}`
                    return (
                      <div key={key} className="grid grid-cols-[1.1fr_1.2fr_1fr_120px] gap-3 px-4 py-3 items-center">
                        <div className="text-sm text-foreground">{account.account_name}</div>
                        <div>
                          <div className="text-sm text-foreground">{campaign.name}</div>
                          <div className="text-xs text-muted-foreground">{campaign.effectiveStatus || 'unknown'}</div>
                        </div>
                        <select value={selectedProducts[key] || ''} onChange={(e) => setSelectedProducts((current) => ({ ...current, [key]: e.target.value }))} className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
                          <option value="">Non mappé</option>
                          {products.map((product) => (
                            <option key={product.id} value={product.id}>{product.name}</option>
                          ))}
                        </select>
                        <div className="text-xs text-muted-foreground">{selectedProducts[key] ? 'Lié' : 'À mapper'}</div>
                      </div>
                    )
                  })}
                  {flattenedCampaigns.length === 0 ? <div className="px-4 py-6 text-sm text-muted-foreground">Aucune campagne à afficher pour les comptes sélectionnés.</div> : null}
                </div>
              </div>

              <div className="mt-4 flex gap-3">
                <button type="button" onClick={() => void saveMappings()} disabled={!currentStoreId || isSavingMappings} className="rounded-xl border px-4 py-3 text-sm font-medium disabled:opacity-50">
                  {isSavingMappings ? 'Enregistrement...' : 'Enregistrer le mapping'}
                </button>
              </div>
            </section>
            ) : null}

            {currentStep === 'rate' ? (
            <section className="rounded-2xl border border-border p-5">
              <div className="mb-4">
                <h4 className="font-semibold text-foreground">Étape 4 — Taux de change</h4>
                <p className="text-sm text-muted-foreground">Saisissez le taux de change entre la devise de vos comptes publicitaires et celle de votre store.</p>
              </div>

              <ExchangeRateForm
                storeId={currentStoreId}
                accounts={activeAccounts}
                onSaved={() => { setRateSaved(true); setCurrentStep('sync') }}
                onError={setError}
              />
            </section>
            ) : null}

            {currentStep === 'sync' ? (
            <section className="rounded-2xl border border-border p-5">
              <div className="mb-4">
                <h4 className="font-semibold text-foreground">Étape 4 — Synchronisation</h4>
                <p className="text-sm text-muted-foreground">Récupération automatique des données publicitaires depuis le 1er janvier {new Date().getFullYear()}.</p>
              </div>

              {isRefreshing ? (
                <div className="flex items-center gap-3 rounded-xl bg-muted/30 px-4 py-4 text-sm text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <span>Importation des dépenses publicitaires en cours...</span>
                </div>
              ) : syncDone && syncProgress ? (
                <div className="space-y-3">
                  <div className="rounded-xl bg-emerald-500/10 px-4 py-4 text-sm text-emerald-700">
                    <div className="font-medium">Synchronisation terminée</div>
                    <div className="mt-2 flex gap-6">
                      <span><strong>{syncProgress.inserted}</strong> lignes insérées</span>
                      <span><strong>{syncProgress.updated}</strong> lignes mises à jour</span>
                    </div>
                  </div>
                  <button type="button" onClick={onClose} className="rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground">
                    Terminer
                  </button>
                </div>
              ) : syncDone && !syncProgress ? (
                <div className="rounded-xl bg-amber-500/10 px-4 py-4 text-sm text-amber-700">
                  Synchronisation terminée, mais aucune donnée retournée. Vérifiez que vos campagnes ont des dépenses sur la période.
                </div>
              ) : null}
            </section>
            ) : null}

            {currentStep === 'connect' && canAccessAccountsStep ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
                Connexion réussie. Passez maintenant à la sélection des ad accounts à gauche.
              </div>
            ) : null}

            {currentStep === 'accounts' && selectedAccountIds.length > 0 ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
                Ad accounts enregistrés. Passez maintenant au mapping des campagnes.
              </div>
            ) : null}

            {currentStep === 'mapping' && canAccessSyncStep ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
                Mapping prêt. Vous pouvez maintenant lancer la synchronisation.
              </div>
            ) : null}

            {error ? <p className="text-sm text-red-500">{error}</p> : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function ExchangeRateForm({
  storeId,
  accounts,
  onSaved,
  onError,
}: {
  storeId: string | null
  accounts: AccountRow[]
  onSaved: () => void
  onError: (msg: string) => void
}) {
  const [baseCurrency, setBaseCurrency] = useState('')
  const [targetCurrency, setTargetCurrency] = useState('')
  const [rate, setRate] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [storeCurrency, setStoreCurrency] = useState<string | null>(null)
  const [loadingStore, setLoadingStore] = useState(true)
  const supabase = createClient()

  // Détecter la devise des ad accounts
  useEffect(() => {
    const currencies = [...new Set(accounts.map((a) => a.account_currency).filter(Boolean))]
    if (currencies.length === 1) {
      setBaseCurrency(currencies[0])
    } else if (currencies.length > 1) {
      setBaseCurrency(currencies[0])
    }
  }, [accounts])

  // Charger la devise du store
  useEffect(() => {
    async function load() {
      if (!storeId) {
        setLoadingStore(false)
        return
      }
      setLoadingStore(true)
      const { data, error } = await supabase
        .from('stores')
        .select('currency')
        .eq('id', storeId)
        .single()
      if (!error && data?.currency) {
        setStoreCurrency(data.currency)
        setTargetCurrency(data.currency)
      }
      setLoadingStore(false)
    }
    void load()
  }, [storeId, supabase])

  const handleSave = async () => {
    if (!storeId) {
      onError('Aucun store sélectionné.')
      return
    }
    if (!baseCurrency || !targetCurrency) {
      onError('Devises manquantes.')
      return
    }
    const rateNum = parseFloat(rate)
    if (isNaN(rateNum) || rateNum <= 0) {
      onError('Taux de change invalide.')
      return
    }

    setIsSaving(true)
    onError('')
    try {
      const response = await fetch('/api/integrations/facebook-ads/exchange-rate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId, baseCurrency, targetCurrency, rate: rateNum }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'EXCHANGE_RATE_SAVE_FAILED')
      onSaved()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'EXCHANGE_RATE_SAVE_FAILED')
    } finally {
      setIsSaving(false)
    }
  }

  if (loadingStore) {
    return (
      <div className="flex items-center gap-3 rounded-xl bg-muted/30 px-4 py-4 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <span>Chargement des informations...</span>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-muted/20 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">Devise des ad accounts</label>
            <input
              type="text"
              value={baseCurrency}
              onChange={(e) => setBaseCurrency(e.target.value.toUpperCase())}
              className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm"
              placeholder="ex: USD"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">Devise du store</label>
            <input
              type="text"
              value={targetCurrency}
              onChange={(e) => setTargetCurrency(e.target.value.toUpperCase())}
              className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm"
              placeholder="ex: MAD"
            />
            {storeCurrency && (
              <p className="mt-1 text-xs text-muted-foreground">
                Devise détectée du store : <strong>{storeCurrency}</strong>
              </p>
            )}
          </div>
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-sm font-medium text-foreground">
            Taux de change (1 {baseCurrency || '?'} = X {targetCurrency || '?'})
          </label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm"
            placeholder="ex: 10.50"
          />
        </div>
      </div>

      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={isSaving || !rate || !baseCurrency || !targetCurrency}
        className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {isSaving ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Enregistrement...
          </>
        ) : (
          <>
            <Save className="h-4 w-4" />
            Valider le taux de change
          </>
        )}
      </button>
    </div>
  )
}
