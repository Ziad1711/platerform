'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { X, Loader2 } from 'lucide-react'
import { useStore } from '@/lib/store-context'

const FORCELOG_PROVIDER_ID = '422b8621-f708-4e5a-ba50-c9196c214a8a'

export default function ForceLogConnectWizard({
  onClose,
}: {
  onClose: () => void
}) {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const { currentStoreId, accessibleStores } = useStore()
  const [step, setStep] = useState<'api-key' | 'config' | 'done'>('api-key')
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [selectedStoreId, setSelectedStoreId] = useState('')
  const [defaultProductNature, setDefaultProductNature] = useState('')
  const [pickupPhone, setPickupPhone] = useState('')
  const [pickupCityKey, setPickupCityKey] = useState('')
  const [pickupCityName, setPickupCityName] = useState('')
  const [pickupAddress, setPickupAddress] = useState('')

  // Charger les villes ForceLog depuis delivery_rates
  const { data: forcelogCities = [] } = useQuery({
    queryKey: ['forcelog-cities'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('delivery_rates')
        .select('external_city_key, city_name')
        .eq('provider_id', FORCELOG_PROVIDER_ID)
        .order('city_name', { ascending: true })

      if (error) throw error
      return data || []
    },
  })

  const validateApiKey = async () => {
    const key = apiKey.trim()
    if (!key) {
      setError('Veuillez entrer votre clé API ForceLog.')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      const response = await fetch('/api/integrations/forcelog/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: key,
          storeId: selectedStoreId,
          parcelCreationMode: 'auto',
          defaultProductNature: defaultProductNature || null,
          pickupPhone: pickupPhone || null,
          pickupCityKey: pickupCityKey || null,
          pickupCityName: pickupCityName || null,
          pickupAddress: pickupAddress || null,
        }),
      })

      const payload = await response.json().catch(() => null) as { error?: string } | null
      if (!response.ok) throw new Error(payload?.error || 'FORCELOG_CONNECT_FAILED')

      await queryClient.invalidateQueries({ queryKey: ['integration-marketplace'] })
      setStep('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connexion ForceLog impossible.')
      setStep('api-key')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={() => !isLoading && onClose()} />
      <div className="relative z-10 w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Connecter ForceLog</h3>
            <p className="text-sm text-muted-foreground">
              {step === 'api-key' && 'Entrez votre clé API ForceLog et configurez les paramètres.'}
              {step === 'done' && 'Connexion ForceLog réussie.'}
            </p>
          </div>
          <button type="button" onClick={() => !isLoading && onClose()} className="rounded-lg p-2 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          {step === 'api-key' && (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Store</label>
                <select
                  value={selectedStoreId}
                  onChange={(e) => setSelectedStoreId(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm"
                >
                  <option value="">Sélectionner un store</option>
                  {accessibleStores.map((store) => (
                    <option key={store.id} value={store.id}>{store.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Clé API ForceLog</label>
                <input
                  type="text"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck="false"
                  name="forcelog-api-key-field"
                  value={apiKey}
                  onChange={(e) => { setApiKey(e.target.value); setError('') }}
                  placeholder="Collez votre clé API ForceLog"
                  disabled={isLoading}
                  className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Nature produit par défaut</label>
                <input
                  type="text"
                  value={defaultProductNature}
                  onChange={(e) => setDefaultProductNature(e.target.value)}
                  placeholder="Ex: Vêtements, Électronique..."
                  className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div className="space-y-2 border-t border-border pt-4">
                <p className="text-sm font-medium text-foreground">Paramètres de ramassage *</p>
                <input
                  type="text"
                  value={pickupPhone}
                  onChange={(e) => setPickupPhone(e.target.value)}
                  placeholder="Téléphone ramassage *"
                  className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                />
                <select
                  value={pickupCityKey}
                  onChange={(e) => {
                    const selected = forcelogCities.find((c: any) => c.external_city_key === e.target.value)
                    setPickupCityKey(e.target.value)
                    setPickupCityName(selected?.city_name || '')
                  }}
                  className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm"
                >
                  <option value="">Ville ramassage *</option>
                  {forcelogCities.map((city: any) => (
                    <option key={city.external_city_key} value={city.external_city_key}>
                      {city.city_name}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={pickupAddress}
                  onChange={(e) => setPickupAddress(e.target.value)}
                  placeholder="Adresse ramassage *"
                  className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <button
                type="button"
                onClick={() => void validateApiKey()}
                disabled={isLoading || !apiKey.trim() || !selectedStoreId || !pickupPhone.trim() || !pickupCityKey || !pickupAddress.trim()}
                className="w-full rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Connexion...
                  </span>
                ) : 'Connecter ForceLog'}
              </button>
            </>
          )}

          {step === 'done' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-700">
                ForceLog connecté avec succès !
              </div>
              <button type="button" onClick={onClose} className="w-full rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground">
                Fermer
              </button>
            </div>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
      </div>
    </div>
  )
}