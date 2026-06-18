'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { X, Loader2 } from 'lucide-react'
import { useStore } from '@/lib/store-context'

export default function AmeexConnectWizard({
  onClose,
}: {
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { accessibleStores } = useStore()
  const [step, setStep] = useState<'credentials' | 'done'>('credentials')
  const [apiId, setApiId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [selectedStoreId, setSelectedStoreId] = useState('')

  const validateAndConnect = async () => {
    const id = apiId.trim()
    const key = apiKey.trim()

    if (!id) { setError('Veuillez entrer votre API ID AMEEX.'); return }
    if (!key) { setError('Veuillez entrer votre API KEY AMEEX.'); return }
    if (!selectedStoreId) { setError('Veuillez selectionner un store.'); return }

    setIsLoading(true)
    setError('')

    try {
      const response = await fetch('/api/integrations/ameex/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiId: id, apiKey: key, storeId: selectedStoreId, parcelCreationMode: 'auto' }),
      })

      const payload = await response.json().catch(() => null) as { error?: string } | null
      if (!response.ok) throw new Error(payload?.error || 'AMEEX_CONNECT_FAILED')

      await queryClient.invalidateQueries({ queryKey: ['integration-marketplace'] })
      setStep('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connexion AMEEX impossible.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-8 pb-24 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/40" onClick={() => !isLoading && onClose()} />
      <div className="relative z-10 w-full max-w-2xl rounded-2xl border border-border bg-card p-4 sm:p-6 shadow-2xl my-auto">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Connecter AMEEX</h3>
            <p className="text-sm text-muted-foreground">
              {step === 'credentials' && 'Entrez vos identifiants AMEEX (API ID + API KEY).'}
              {step === 'done' && 'Connexion AMEEX reussie.'}
            </p>
          </div>
          <button type="button" onClick={() => !isLoading && onClose()} className="rounded-lg p-2 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          {step === 'credentials' && (
            <div className="flex flex-col sm:flex-row gap-4 sm:gap-6">
              <div className="flex-1 space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Store</label>
                  <select value={selectedStoreId} onChange={(e) => setSelectedStoreId(e.target.value)} className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm">
                    <option value="">Selectionner un store</option>
                    {accessibleStores.map((store) => (
                      <option key={store.id} value={store.id}>{store.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">API ID AMEEX <span className="text-red-500">*</span></label>
                  <input type="text" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false" name="ameex-api-id"
                    value={apiId} onChange={(e) => { setApiId(e.target.value); setError('') }}
                    placeholder="Votre API ID AMEEX (C-Api-Id)" disabled={isLoading}
                    className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/20" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">API KEY AMEEX <span className="text-red-500">*</span></label>
                  <input type="password" autoComplete="new-password" autoCorrect="off" autoCapitalize="off" spellCheck="false" name="ameex-api-key"
                    value={apiKey} onChange={(e) => { setApiKey(e.target.value); setError('') }}
                    placeholder="Votre API KEY AMEEX (C-Api-Key)" disabled={isLoading}
                    className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/20" />
                </div>
                <button type="button" onClick={() => void validateAndConnect()}
                  disabled={isLoading || !apiId.trim() || !apiKey.trim() || !selectedStoreId}
                  className="w-full rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
                  {isLoading ? (
                    <span className="flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Connexion...</span>
                  ) : 'Connecter AMEEX'}
                </button>
              </div>

              <div className="w-full sm:w-64 shrink-0 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700 space-y-2 h-fit">
                <p className="font-medium">Comment recuperer vos identifiants ?</p>
                <ol className="list-decimal list-inside space-y-1.5 text-blue-600">
                  <li>Allez sur <a href="https://c.ameex.app/#Ameex/Business" target="_blank" rel="noopener noreferrer" className="font-medium underline hover:text-blue-800">c.ameex.app</a></li>
                  <li>Choisissez le business de votre store</li>
                  <li>Cliquez sur les 3 points, puis <strong>Gerer</strong></li>
                  <li>Choisissez <strong>API</strong> dans le menu</li>
                  <li>Copiez le <strong>API ID</strong> depuis la section cle API</li>
                  <li>Cliquez sur <strong>Generer une nouvelle cle API</strong> pour obtenir la cle</li>
                </ol>
              </div>
            </div>
          )}

          {step === 'done' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-700">
                AMEEX connecte avec succes !
              </div>
              <p className="text-sm text-muted-foreground">
                Les villes AMEEX sont disponibles dans la page Ventes pour selection. Les colis seront automatiquement crees lors du passage au statut confirme.
              </p>
              <button type="button" onClick={onClose} className="w-full rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground">Fermer</button>
            </div>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
      </div>
    </div>
  )
}