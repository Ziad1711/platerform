'use client'

import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import ProgressSteps from '@/components/dashboard/integrations/progress-steps'
import { getNameSimilarity, isLikelyNameMatch } from '@/lib/integrations/name-similarity'

type StoreRow = { id: string; name: string; logo_url?: string | null }
type ShopRow = { key: number; name: string; phone?: string; allow_opening_parcels: boolean }

const STEPS = [
  { key: 'connecting', label: 'Connecting...' },
  { key: 'mapping', label: 'Fetching shops / Mapping shops...' },
  { key: 'syncing', label: 'Fetching cities...' },
  { key: 'done', label: 'Sync complete' },
]

function buildInitialMappings(shops: ShopRow[], stores: StoreRow[]) {
  return shops.map((shop) => {
    const direct = stores.find((store) => isLikelyNameMatch(shop.name, store.name))
    if (direct) return { externalShopId: shop.key, storeId: direct.id }

    const scored = stores
      .map((store) => ({ storeId: store.id, score: getNameSimilarity(shop.name, store.name) }))
      .sort((a, b) => b.score - a.score)[0]

    return { externalShopId: shop.key, storeId: scored && scored.score >= 0.8 ? scored.storeId : '' }
  })
}

function sanitizeRapidDeliveryToken(rawToken: string) {
  return rawToken.trim().replace(/^bearer\s+/i, '')
}

export default function DeliveryConnectWizard({
  onClose,
}: {
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [step, setStep] = useState<'connecting' | 'mapping' | 'syncing' | 'done'>('connecting')
  const [token, setToken] = useState('')
  const [endpointType, setEndpointType] = useState<'standard' | 'special'>('standard')
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')
  const [shops, setShops] = useState<ShopRow[]>([])
  const [stores, setStores] = useState<StoreRow[]>([])
  const [mappings, setMappings] = useState<Array<{ externalShopId: number; storeId: string }>>([])
  const [isLoading, setIsLoading] = useState(false)
  const [summary, setSummary] = useState<{ shops: number; cities: number; states: number } | null>(null)

  const isMappingIncomplete = useMemo(() => mappings.some((item) => !item.storeId), [mappings])

  const validateToken = async () => {
    const sanitizedToken = sanitizeRapidDeliveryToken(token)

    if (!sanitizedToken) {
      setError('Veuillez entrer votre token API Rapid Delivery.')
      return
    }

    if (/^https?:\/\//i.test(sanitizedToken)) {
      setError('Veuillez coller uniquement le token API, pas une URL.')
      return
    }

    setIsLoading(true)
    setError('')
    setWarning('')

    try {
      const response = await fetch('/api/integrations/rapid-delivery/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiToken: sanitizedToken, endpointType }),
      })
      const payload = (await response.json().catch(() => null)) as { error?: string; shops?: ShopRow[]; stores?: StoreRow[] } | null
      if (!response.ok) throw new Error(payload?.error || 'RAPID_DELIVERY_VALIDATE_FAILED')

      const nextShops = payload?.shops || []
      const nextStores = payload?.stores || []
      setShops(nextShops)
      setStores(nextStores)
      setMappings(buildInitialMappings(nextShops, nextStores))
      if (nextShops.length === 0) setWarning('Aucun shop trouvé sur Rapid Delivery.')
      if (nextStores.length === 0) setWarning('Aucun store interne trouvé. Créez un store avant de continuer.')
      setStep('mapping')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'RAPID_DELIVERY_VALIDATE_FAILED')
    } finally {
      setIsLoading(false)
    }
  }

  const connectIntegration = async () => {
    const sanitizedToken = sanitizeRapidDeliveryToken(token)

    if (!sanitizedToken) {
      setError('Veuillez entrer votre token API Rapid Delivery.')
      return
    }

    if (/^https?:\/\//i.test(sanitizedToken)) {
      setError('Veuillez coller uniquement le token API, pas une URL.')
      return
    }

    setIsLoading(true)
    setStep('syncing')
    setError('')
    setWarning(isMappingIncomplete ? 'Certains shops resteront non mappés.' : '')

    try {
      const response = await fetch('/api/integrations/rapid-delivery/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiToken: sanitizedToken,
          endpointType,
          mappings: mappings.map((item) => ({ externalShopId: item.externalShopId, storeId: item.storeId || null })),
        }),
      })
      const payload = (await response.json().catch(() => null)) as { error?: string; shops?: number; cities?: number; states?: number } | null
      if (!response.ok) throw new Error(payload?.error || 'RAPID_DELIVERY_CONNECT_FAILED')

      setSummary({ shops: Number(payload?.shops || 0), cities: Number(payload?.cities || 0), states: Number(payload?.states || 0) })
      setStep('done')
      await queryClient.invalidateQueries({ queryKey: ['integration-marketplace'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'RAPID_DELIVERY_CONNECT_FAILED')
      setStep('mapping')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={() => !isLoading && onClose()} />
      <div className="relative z-10 w-full max-w-3xl rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Connecter Rapid Delivery</h3>
            <p className="text-sm text-muted-foreground">Validation du token, mapping des shops et synchronisation des tarifs.</p>
          </div>
          <button type="button" onClick={() => !isLoading && onClose()} className="rounded-lg p-2 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-6 md:grid-cols-[220px_1fr]">
          <ProgressSteps steps={STEPS} currentStep={step} />

          <div className="space-y-4">
            {step === 'connecting' ? (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Token API Rapid Delivery</label>
                  <input
                    type="password"
                    value={token}
                    onChange={(e) => {
                      setToken(e.target.value)
                      setError('')
                    }}
                    placeholder="Collez votre token API Rapid Delivery"
                    disabled={isLoading}
                    className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <p className="text-xs text-muted-foreground">
                    Collez uniquement le token. Le préfixe <span className="font-medium">Bearer</span> est ajouté automatiquement.
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Type de compte</label>
                  <select
                    value={endpointType}
                    onChange={(e) => setEndpointType(e.target.value === 'special' ? 'special' : 'standard')}
                    disabled={isLoading}
                    className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="standard">Standard — rapiddelivery.ma</option>
                    <option value="special">Prix spécial — marocgodelivery.com</option>
                  </select>
                </div>
                <button type="button" onClick={() => void validateToken()} disabled={isLoading || !token.trim()} className="w-full rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
                  {isLoading ? 'Validation...' : 'Valider le token'}
                </button>
              </>
            ) : null}

            {step === 'mapping' ? (
              <>
                <div className="rounded-xl border border-border overflow-hidden">
                  <div className="grid grid-cols-2 bg-muted/40 px-4 py-3 text-sm font-medium text-foreground">
                    <div>Shops Rapid Delivery</div>
                    <div>Stores internes</div>
                  </div>
                  <div className="divide-y divide-border">
                    {shops.map((shop, index) => (
                      <div key={shop.key} className="grid grid-cols-2 gap-4 px-4 py-3 items-center">
                        <div>
                          <div className="text-sm font-medium text-foreground">{shop.name}</div>
                          <div className="text-xs text-muted-foreground">ID {shop.key}{shop.phone ? ` • ${shop.phone}` : ''}</div>
                        </div>
                        <select
                          value={mappings[index]?.storeId || ''}
                          onChange={(e) => setMappings((current) => current.map((item, idx) => idx === index ? { ...item, storeId: e.target.value } : item))}
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                        >
                          <option value="">Non mappé</option>
                          {stores.map((store) => (
                            <option key={store.id} value={store.id}>{store.name}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>

                <button type="button" onClick={() => void connectIntegration()} disabled={isLoading || stores.length === 0} className="w-full rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
                  {isLoading ? 'Synchronisation...' : 'Confirmer et synchroniser'}
                </button>
              </>
            ) : null}

            {step === 'syncing' ? (
              <div className="rounded-xl border border-border bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
                Synchronisation des shops, villes et états en cours...
              </div>
            ) : null}

            {step === 'done' ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-700">
                  Synchronisation terminée.
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-xl border px-3 py-4"><div className="text-xl font-semibold">{summary?.shops || 0}</div><div className="text-xs text-muted-foreground">shops</div></div>
                  <div className="rounded-xl border px-3 py-4"><div className="text-xl font-semibold">{summary?.cities || 0}</div><div className="text-xs text-muted-foreground">villes</div></div>
                  <div className="rounded-xl border px-3 py-4"><div className="text-xl font-semibold">{summary?.states || 0}</div><div className="text-xs text-muted-foreground">états</div></div>
                </div>
                <button type="button" onClick={onClose} className="w-full rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground">Fermer</button>
              </div>
            ) : null}

            {warning ? <p className="text-sm text-amber-600">{warning}</p> : null}
            {error ? <p className="text-sm text-red-500">{error}</p> : null}
          </div>
        </div>
      </div>
    </div>
  )
}