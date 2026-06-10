'use client'

import { useParams, useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Loader2, Settings, Trash2, Zap } from 'lucide-react'
import { getIntegrationMarketplaceData } from '@/lib/integrations/service'
import { useState } from 'react'
import { cn } from '@/lib/utils'

export default function IntegrationSettingsPage() {
  const params = useParams()
  const router = useRouter()
  const queryClient = useQueryClient()
  const providerSlug = params.providerSlug as string
  const [isDisconnecting, setIsDisconnecting] = useState(false)

  const { data: marketplaceItems = [], isLoading } = useQuery({
    queryKey: ['integration-marketplace'],
    queryFn: () => getIntegrationMarketplaceData(),
  })

  const integration = marketplaceItems.find((item) => item.slug === providerSlug)

  const handleDisconnect = async () => {
    if (!confirm('Êtes-vous sûr de vouloir déconnecter cette intégration ?')) return
    
    setIsDisconnecting(true)
    try {
      const response = await fetch(`/api/integrations/${providerSlug}/disconnect`, {
        method: 'POST',
      })

      if (!response.ok) throw new Error('Failed to disconnect')

      await queryClient.invalidateQueries({ queryKey: ['integration-marketplace'] })
      router.push('/integrations')
    } catch (err) {
      console.error('Disconnect error:', err)
      alert('Erreur lors de la déconnexion.')
    } finally {
      setIsDisconnecting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!integration || !integration.isConnected) {
    router.push('/integrations')
    return null
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 pb-12">
      <div className="flex items-center gap-4">
        <button
          onClick={() => router.push('/integrations')}
          className="flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-muted"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Réglages {integration.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            Gérez votre connexion et vos préférences pour {integration.name}.
          </p>
        </div>
      </div>

      <div className="grid gap-8">
        {/* Basic Connection Info */}
        <section className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Settings className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">État de la connexion</h2>
              <p className="text-sm text-muted-foreground">Informations sur votre intégration active.</p>
            </div>
          </div>
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-border/50 pb-4 text-sm">
              <span className="text-muted-foreground">Fournisseur</span>
              <span className="font-medium text-foreground">{integration.name}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Statut</span>
              <span className="inline-flex items-center rounded-full bg-green-500/10 px-2.5 py-0.5 text-xs font-medium text-green-600 dark:text-green-400">
                Connecté
              </span>
            </div>
          </div>
        </section>

        {/* Integration Specific Settings - Placeholder */}
        {providerSlug === 'youcan' && (
          <section className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <Zap className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-foreground">Options YouCan</h2>
                <p className="text-sm text-muted-foreground">Configuration spécifique pour votre boutique.</p>
              </div>
            </div>
            <div className="rounded-xl bg-muted/30 p-4 text-sm text-muted-foreground italic">
              D'autres réglages spécifiques à YouCan arriveront bientôt ici (ex: synchronisation sélective, notifications, etc.).
            </div>
          </section>
        )}

        {/* Danger Zone */}
        <section className="rounded-2xl border border-destructive/20 bg-destructive/5 p-6 shadow-sm">
          <div className="mb-6 flex items-center gap-3 text-destructive">
            <Trash2 className="h-5 w-5" />
            <div>
              <h2 className="text-lg font-semibold">Zone de danger</h2>
              <p className="text-sm opacity-80">Actions irréversibles pour cette intégration.</p>
            </div>
          </div>
          <div className="flex flex-col space-y-4 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">Déconnecter l'intégration</p>
              <p className="text-xs text-muted-foreground">
                Supprime le lien entre votre boutique et la plateforme. Les webhooks seront également désactivés sur YouCan.
              </p>
            </div>
            <button
              onClick={handleDisconnect}
              disabled={isDisconnecting}
              className={cn(
                "inline-flex items-center justify-center rounded-xl bg-destructive px-6 py-2.5 text-sm font-medium text-destructive-foreground transition-all hover:opacity-90 active:scale-95 disabled:opacity-50",
                isDisconnecting && "cursor-not-allowed"
              )}
            >
              {isDisconnecting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Déconnexion...
                </>
              ) : (
                'Déconnecter'
              )}
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
