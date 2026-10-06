'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useStore } from '@/lib/store-context'

type StoreRow = { id: string; name: string }

export default function RushlivConnectWizard({
  onClose,
}: {
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { currentStoreId, setCurrentStoreId, accessibleStores, isStoresLoading } = useStore()
  const [step, setStep] = useState<'token' | 'confirm' | 'done'>('token')
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [cityCount, setCityCount] = useState(0)
  const [summary, setSummary] = useState<{ cities: number; mappedStores: number } | null>(null)

  const validateToken = async () => {
    const tk = token.trim()
    if (!tk) {
      setError('Veuillez entrer votre token API Rushliv.')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      const response = await fetch('/api/integrations/rushliv/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiToken: tk }),
      })

      const payload = (await response.json().catch(() => null)) as {
        error?: string
        stores?: StoreRow[]
        cityCount?: number
      } | null
      if (!response.ok) throw new Error(payload?.error || 'RUSHLIV_VALIDATE_FAILED')

      setCityCount(Number(payload?.cityCount || 0))
      setStep('confirm')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'RUSHLIV_VALIDATE_FAILED')
    } finally {
      setIsLoading(false)
    }
  }

  const connectRushliv = async () => {
    const tk = token.trim()
    if (!tk) return
    if (!currentStoreId) {
      setError('Sélectionnez un store avant de connecter.')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      const response = await fetch('/api/integrations/rushliv/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiToken: tk, storeId: currentStoreId }),
      })

      const payload = (await response.json().catch(() => null)) as {
        error?: string
        cities?: number
        mappedStores?: number
      } | null
      if (!response.ok) throw new Error(payload?.error || 'RUSHLIV_CONNECT_FAILED')

      setSummary({ cities: Number(payload?.cities || 0), mappedStores: Number(payload?.mappedStores || 0) })
      setStep('done')
      await queryClient.invalidateQueries({ queryKey: ['integration-marketplace'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'RUSHLIV_CONNECT_FAILED')
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
            <h3 className="text-lg font-semibold text-foreground">Connecter Rushliv</h3>
            <p className="text-sm text-muted-foreground">
              {step === 'token' ? 'Entrez votre token API Rushliv pour commencer.' : ''}
              {step === 'confirm' ? 'Choisissez le store à associer à cette intégration.' : ''}
              {step === 'done' ? 'Connexion réussie.' : ''}
            </p>
          </div>
          <button type="button" onClick={() => !isLoading && onClose()} className="rounded-lg p-2 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          {step === 'token' ? (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Token API Rushliv</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  name="rushliv-api-token"
                  spellCheck={false}
                  autoCapitalize="none"
                  value={token}
                  onChange={(e) => { setToken(e.target.value); setError('') }}
                  placeholder="Collez votre token API Rushliv"
                  disabled={isLoading}
                  className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/20"
                />
                <p className="text-xs text-muted-foreground">
                  Token disponible dans votre compte Rushliv (clients.rushliv.com).
                </p>
              </div>

              <button
                type="button"
                onClick={() => void validateToken()}
                disabled={isLoading || !token.trim()}
                className="w-full rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {isLoading ? 'Vérification...' : 'Continuer'}
              </button>
            </>
          ) : null}

          {step === 'confirm' ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                Villes Rushliv détectées : <span className="font-medium text-foreground">{cityCount}</span>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Store</label>
                <select
                  value={currentStoreId ?? ''}
                  onChange={(e) => { setCurrentStoreId(e.target.value || null); setError('') }}
                  disabled={isLoading || isStoresLoading}
                  className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
                >
                  {accessibleStores.length === 0 && (
                    <option value="" disabled>Aucun store disponible</option>
                  )}
                  {accessibleStores.map((store) => (
                    <option key={store.id} value={store.id}>{store.name}</option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  Store auquel associer cette intégration Rushliv. Les commandes de ce store utiliseront Rushliv.
                </p>
              </div>

              <button
                type="button"
                onClick={() => void connectRushliv()}
                disabled={isLoading || !currentStoreId}
                className="w-full rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {isLoading ? 'Connexion...' : 'Connecter Rushliv'}
              </button>
              <button type="button" onClick={() => setStep('token')} className="w-full rounded-xl border border-border py-3 text-sm font-medium text-foreground hover:bg-muted">
                Retour
              </button>
            </div>
          ) : null}

          {step === 'done' ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-700">
                Rushliv connecté avec succès.
              </div>
              <div className="grid grid-cols-2 gap-3 text-center">
                <div className="rounded-xl border px-3 py-4"><div className="text-xl font-semibold">{summary?.cities || 0}</div><div className="text-xs text-muted-foreground">villes</div></div>
                <div className="rounded-xl border px-3 py-4"><div className="text-xl font-semibold">{summary?.mappedStores || 0}</div><div className="text-xs text-muted-foreground">store associé</div></div>
              </div>
              <button type="button" onClick={onClose} className="w-full rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground">
                Fermer
              </button>
            </div>
          ) : null}

          {error ? <p className="text-sm text-red-500">{error}</p> : null}
        </div>
      </div>
    </div>
  )
}
