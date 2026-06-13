'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useStore } from '@/lib/store-context'

export default function OzoneConnectWizard({
  onClose,
}: {
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { currentStoreId, accessibleStores } = useStore()
  const [customerId, setCustomerId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [selectedStoreId, setSelectedStoreId] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isDone, setIsDone] = useState(false)

  const handleConnect = async () => {
    const cid = customerId.trim()
    const key = apiKey.trim()

    if (!cid || !key) {
      setError('Veuillez remplir tous les champs.')
      return
    }

    if (!selectedStoreId) {
      setError('Veuillez sélectionner un store.')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      const response = await fetch('/api/integrations/ozone/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: cid,
          apiKey: key,
          storeId: selectedStoreId,
        }),
      })

      const payload = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) throw new Error(payload?.error || 'OZONE_CONNECT_FAILED')

      setIsDone(true)
      await queryClient.invalidateQueries({ queryKey: ['integration-marketplace'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OZONE_CONNECT_FAILED')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={() => !isLoading && onClose()} />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Connecter OZONE Express</h3>
            <p className="text-sm text-muted-foreground">
              Saisissez vos identifiants OZONE et choisissez le store à lier.
            </p>
          </div>
          <button type="button" onClick={() => !isLoading && onClose()} className="rounded-lg p-2 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        {isDone ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-700">
              Connexion OZONE réussie.
            </div>
            <button type="button" onClick={onClose} className="w-full rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground">
              Fermer
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Sélecteur de store */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Store à lier</label>
              <select
                value={selectedStoreId}
                onChange={(e) => { setSelectedStoreId(e.target.value); setError('') }}
                disabled={isLoading}
                className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="">Sélectionnez un store</option>
                {accessibleStores.map((store) => (
                  <option key={store.id} value={store.id}>{store.name}</option>
                ))}
              </select>
            </div>

            {/* Customer ID */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Customer ID OZONE</label>
              <input
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={customerId}
                onChange={(e) => { setCustomerId(e.target.value); setError('') }}
                placeholder="Votre identifiant client OZONE"
                disabled={isLoading}
                className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>

            {/* API Key */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">API Key OZONE</label>
              <input
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); setError('') }}
                placeholder="Votre clé API OZONE"
                disabled={isLoading}
                className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <button
              type="button"
              onClick={() => void handleConnect()}
              disabled={isLoading || !customerId.trim() || !apiKey.trim() || !selectedStoreId}
              className="w-full rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {isLoading ? 'Connexion en cours...' : 'Connecter OZONE'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
