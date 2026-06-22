'use client'

import { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { X, Copy, Check } from 'lucide-react'
import { useStore } from '@/lib/store-context'
import { SITE_URL } from '@/lib/marketing/site-url'

export default function DigylogConnectWizard({
  onClose,
}: {
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { currentStoreId, setCurrentStoreId, accessibleStores, isStoresLoading } = useStore()
  const [step, setStep] = useState<'token' | 'config' | 'done'>('token')
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [integrationId, setIntegrationId] = useState('')
  const [defaultNetworkId, setDefaultNetworkId] = useState(1)
  const [defaultOrderMode, setDefaultOrderMode] = useState<1 | 2>(1)
  const [defaultSendStatus, setDefaultSendStatus] = useState<0 | 1>(1)
  const [defaultExternalStore, setDefaultExternalStore] = useState('')
  const [webhookUrl, setWebhookUrl] = useState('')
  const [copied, setCopied] = useState(false)

  // Générer l'URL webhook depuis le domaine de production (SITE_URL)
  useEffect(() => {
    setWebhookUrl(`${SITE_URL}/api/integrations/digylog/webhook`)
  }, [])

  const copyWebhookUrl = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }

  const validateAndConnect = async () => {
    const tk = token.trim()
    if (!tk) {
      setError('Veuillez entrer votre token API Digylog.')
      return
    }

    if (!currentStoreId) {
      setError('Sélectionnez un store avant de connecter.')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      const response = await fetch('/api/integrations/digylog/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId: currentStoreId,
          token: tk,
          defaultNetworkId,
          defaultOrderMode,
          defaultSendStatus,
          defaultExternalStore: defaultExternalStore || undefined,
          webhookUrl,
        }),
      })

      const payload = (await response.json().catch(() => null)) as { error?: string; detail?: string; integrationId?: string } | null
      if (!response.ok) {
        const msg = payload?.detail ? `${payload.error}: ${payload.detail}` : (payload?.error || 'DIGYLOG_CONNECT_FAILED')
        throw new Error(msg)
      }

      setIntegrationId(payload?.integrationId || '')
      setStep('done')
      await queryClient.invalidateQueries({ queryKey: ['integration-marketplace'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'DIGYLOG_CONNECT_FAILED')
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
            <h3 className="text-lg font-semibold text-foreground">Connecter Digylog</h3>
            <p className="text-sm text-muted-foreground">
              {step === 'token' ? 'Entrez votre token API Digylog pour commencer.' : ''}
              {step === 'config' ? 'Configurez les paramètres par défaut.' : ''}
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
              {/* Sélecteur de store */}
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
                  {accessibleStores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  Store auquel associer cette intégration Digylog.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Token API Digylog</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  name="digylog-api-token"
                  spellCheck={false}
                  autoCapitalize="none"
                  value={token}
                  onChange={(e) => { setToken(e.target.value); setError('') }}
                  placeholder="Collez votre token API Digylog"
                  disabled={isLoading}
                  className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/20"
                />
                <p className="text-xs text-muted-foreground">
                  Votre token personnel Digylog. Le préfixe <span className="font-medium">Bearer</span> est ajouté automatiquement.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">URL du webhook</label>
                <div className="flex items-center gap-2">
                  <input
                    type="url"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    disabled={isLoading}
                    className="flex-1 rounded-xl border border-border bg-background px-3 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <button
                    type="button"
                    onClick={copyWebhookUrl}
                    className="rounded-xl border border-border p-3 text-muted-foreground hover:bg-muted"
                    title="Copier l'URL"
                  >
                    {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Collez cette URL dans la configuration webhook de votre compte Digylog (menu Webhook).
                  Digylog enverra un <span className="font-medium">PUT</span> de vérification, puis les mises à jour de statut automatiquement.
                </p>
              </div>

              <button
                type="button"
                onClick={() => void validateAndConnect()}
                disabled={isLoading || !token.trim()}
                className="w-full rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {isLoading ? 'Connexion...' : 'Connecter Digylog'}
              </button>
            </>
          ) : null}

          {step === 'done' ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-700">
                Digylog connecté avec succès.
              </div>
              <div className="rounded-xl border border-border bg-muted/50 px-4 py-3 text-sm">
                <p className="mb-1 text-xs font-medium text-muted-foreground">URL webhook enregistrée :</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate text-xs text-foreground">{webhookUrl}</code>
                  <button
                    type="button"
                    onClick={copyWebhookUrl}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    title="Copier"
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
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
