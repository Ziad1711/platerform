'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { X, Loader2 } from 'lucide-react'
import { useStore } from '@/lib/store-context'
import { createClient } from '@/lib/supabase/client'
const supabase = createClient()

const SENDIT_PROVIDER_ID = '5998e563-96ed-47cc-881a-43f41827f858'

export default function SenditConnectWizard({
  onClose,
}: {
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { accessibleStores } = useStore()
  const [step, setStep] = useState<'api-key' | 'pickup' | 'done'>('api-key')
  const [publicKey, setPublicKey] = useState('')
  const [secretKey, setSecretKey] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [selectedStoreId, setSelectedStoreId] = useState('')
  const [pickupDistrictId, setPickupDistrictId] = useState('')

  const { data: senditPickupDistricts = [] } = useQuery({
    queryKey: ['sendit-pickup-districts', selectedStoreId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('delivery_rates')
        .select('external_city_key, city_name')
        .eq('provider_id', SENDIT_PROVIDER_ID)
        .order('city_name', { ascending: true })
      if (error) throw error
      const uniqueMap = new Map<string, any>()
      for (const rate of data || []) {
        uniqueMap.set(String(rate.external_city_key), {
          city_key: rate.external_city_key,
          city_name: rate.city_name,
        })
      }
      return Array.from(uniqueMap.values())
    },
    enabled: step === 'pickup',
  })

  const connect = async () => {
    const pk = publicKey.trim()
    const sk = secretKey.trim()
    if (!pk || !sk) {
      setError('Veuillez remplir les deux clés.')
      return
    }
    if (!selectedStoreId) {
      setError('Veuillez sélectionner un store.')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      const response = await fetch('/api/integrations/sendit/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicKey: pk, secretKey: sk, storeId: selectedStoreId }),
      })

      const payload = await response.json().catch(() => null) as { error?: string } | null
      if (!response.ok) throw new Error(payload?.error || 'SENDIT_CONNECT_FAILED')

      await queryClient.invalidateQueries({ queryKey: ['integration-marketplace'] })
      setStep('pickup')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connexion Sendit impossible.')
    } finally {
      setIsLoading(false)
    }
  }

  const savePickupDistrict = async () => {
    if (!pickupDistrictId) {
      setStep('done')
      setTimeout(() => onClose(), 1500)
      return
    }
    setIsLoading(true)
    setError('')
    try {
      const response = await fetch('/api/integrations/sendit/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicKey: '__skip__', secretKey: '__skip__', storeId: selectedStoreId, pickupDistrictId }),
      })
      const payload = await response.json().catch(() => null) as { error?: string } | null
      if (!response.ok) throw new Error(payload?.error || 'SENDIT_UPDATE_PICKUP_FAILED')
      setStep('done')
      setTimeout(() => onClose(), 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de l\'enregistrement.')
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
            <h3 className="text-lg font-semibold text-foreground">Connecter Sendit</h3>
            <p className="text-sm text-muted-foreground">
              {step === 'api-key' && 'Entrez vos clés API Sendit (clé publique et clé secrète).'}
              {step === 'done' && 'Connexion Sendit réussie.'}
            </p>
          </div>
          <button type="button" onClick={() => !isLoading && onClose()} className="rounded-lg p-2 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          {step === 'api-key' && (
            <>
              {/* Champ caché anti-autocomplete */}
              <input type="text" name="fake-username" autoComplete="username" style={{ display: 'none' }} readOnly tabIndex={-1} />
              <input type="password" name="fake-password" autoComplete="current-password" style={{ display: 'none' }} readOnly tabIndex={-1} />

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
                <label className="text-sm font-medium text-foreground">Clé publique</label>
                <input
                  type="text"
                  autoComplete="new-password"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck="false"
                  name="sendit-public-key"
                  value={publicKey}
                  onChange={(e) => { setPublicKey(e.target.value); setError('') }}
                  placeholder="Collez votre clé publique Sendit"
                  disabled={isLoading}
                  className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Clé secrète</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck="false"
                  name="sendit-secret-key"
                  value={secretKey}
                  onChange={(e) => { setSecretKey(e.target.value); setError('') }}
                  placeholder="Collez votre clé secrète Sendit"
                  disabled={isLoading}
                  className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <button
                type="button"
                onClick={() => void connect()}
                disabled={isLoading || !publicKey.trim() || !secretKey.trim() || !selectedStoreId}
                className="w-full rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Connexion...
                  </span>
                ) : 'Connecter Sendit'}
              </button>
            </>
          )}

          {step === 'pickup' && (
            <>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-700">
                Sendit connecté avec succès ! Choisissez votre ville de ramassage par défaut.
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Ville de ramassage</label>
                <select
                  value={pickupDistrictId}
                  onChange={(e) => setPickupDistrictId(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm"
                >
                  <option value="">Sélectionner une ville de ramassage</option>
                  {senditPickupDistricts.map((d: any) => (
                    <option key={d.city_key} value={d.city_key}>{d.city_name}</option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  Cette ville sera utilisée par défaut comme point de ramassage pour vos colis Sendit.
                </p>
              </div>

              <button
                type="button"
                onClick={() => void savePickupDistrict()}
                disabled={isLoading}
                className="w-full rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Enregistrement...
                  </span>
                ) : 'Enregistrer'}
              </button>
            </>
          )}

          {step === 'done' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-700">
                Sendit connecté avec succès !
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
