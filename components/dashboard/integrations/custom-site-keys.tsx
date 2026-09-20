'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Copy, Eye, EyeOff, RotateCcw, Trash2, Key } from 'lucide-react'
import { CustomSiteApiDocs } from '@/components/dashboard/integrations/custom-site-api-docs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

type ApiKey = {
  id: string
  name: string
  key_prefix: string
  is_active: boolean
  last_used_at: string | null
  created_at: string
  revoked_at: string | null
  scopes: string[] | null
}

const SCOPE_OPTIONS = [
  { value: 'products:read', label: 'Lire les produits et les prix' },
  { value: 'stock:read', label: 'Lire le stock disponible' },
  { value: 'orders:write', label: 'Envoyer les commandes' },
]

export function CustomSiteKeys({ storeId }: { storeId: string }) {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [newKey, setNewKey] = useState<string | null>(null)
  const [showNewKey, setShowNewKey] = useState(false)
  const [copied, setCopied] = useState(false)
  const [revokeDialogOpen, setRevokeDialogOpen] = useState<string | null>(null)
  const [selectedScopes, setSelectedScopes] = useState<string[]>(
    SCOPE_OPTIONS.map((option) => option.value)
  )

  const fetchKeys = async () => {
    try {
      const res = await fetch(`/api/integrations/custom-site/keys?store_id=${storeId}`)
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()
      setKeys(data.keys || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchKeys()
  }, [storeId])

  const toggleScope = (scope: string) => {
    setSelectedScopes((prev) =>
      prev.includes(scope) ? prev.filter((item) => item !== scope) : [...prev, scope]
    )
  }

  const generateKey = async () => {
    setGenerating(true)
    setNewKey(null)
    setShowNewKey(false)
    try {
      const res = await fetch('/api/integrations/custom-site/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_id: storeId, scopes: selectedScopes }),
      })
      if (!res.ok) throw new Error('Failed to generate')
      const data = await res.json()
      setNewKey(data.key)
      setShowNewKey(true)
      await fetchKeys()
    } catch (err) {
      console.error(err)
    } finally {
      setGenerating(false)
    }
  }

  const revokeKey = async (keyId: string) => {
    try {
      const res = await fetch(`/api/integrations/custom-site/keys/${keyId}?store_id=${storeId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to revoke')
      await fetchKeys()
    } catch (err) {
      console.error(err)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            Clés API
          </CardTitle>
          <CardDescription>
            Gérez les clés API pour importer les commandes de votre site web vers Jisra.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {newKey && showNewKey && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950">
              <p className="mb-2 text-sm font-medium text-green-800 dark:text-green-200">
                🎉 Clé générée avec succès !
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded bg-white px-3 py-2 text-sm font-mono break-all dark:bg-green-900">
                  {showNewKey ? newKey : '••••••••••••••••'}
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setShowNewKey(!showNewKey)}
                >
                  {showNewKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => copyToClipboard(newKey)}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                ⚠️ Conservez cette clé précieusement. Elle ne sera plus jamais affichée.
              </p>
              {copied && (
                <p className="mt-1 text-xs text-green-600">✓ Copié dans le presse-papier</p>
              )}
            </div>
          )}

          <div className="rounded-lg border p-3">
            <p className="text-sm font-medium text-foreground">Droits de la nouvelle clé</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {SCOPE_OPTIONS.map((option) => (
                <label key={option.value} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={selectedScopes.includes(option.value)}
                    onChange={() => toggleScope(option.value)}
                    className="mt-0.5 h-3.5 w-3.5"
                  />
                  <span>
                    <span className="block font-mono text-[11px] text-foreground">{option.value}</span>
                    {option.label}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <Button onClick={generateKey} disabled={generating || selectedScopes.length === 0}>
            {generating ? (
              <>
                <RotateCcw className="mr-2 h-4 w-4 animate-spin" />
                Génération...
              </>
            ) : (
              <>
                <Key className="mr-2 h-4 w-4" />
                Générer une nouvelle clé
              </>
            )}
          </Button>

          {loading ? (
            <p className="text-sm text-muted-foreground">Chargement...</p>
          ) : keys.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucune clé API créée. Générez votre première clé pour commencer.
            </p>
          ) : (
            <div className="space-y-3">
              {keys.map((key) => (
                <div
                  key={key.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{key.name}</span>
                      <Badge variant={key.is_active ? 'default' : 'secondary'}>
                        {key.is_active ? 'Actif' : 'Révoqué'}
                      </Badge>
                    </div>
                    <code className="text-xs text-muted-foreground font-mono">
                      {key.key_prefix}...
                    </code>
                    {Array.isArray(key.scopes) && key.scopes.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {key.scopes.map((scope) => (
                          <span
                            key={scope}
                            className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground"
                          >
                            {scope}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div className="flex gap-4 text-xs text-muted-foreground">
                      <span>Créée le {new Date(key.created_at).toLocaleDateString('fr-FR')}</span>
                      {key.last_used_at && (
                        <span>Dernière utilisation : {new Date(key.last_used_at).toLocaleDateString('fr-FR')}</span>
                      )}
                    </div>
                  </div>
                  {key.is_active && (
                    <Dialog open={revokeDialogOpen === key.id} onOpenChange={(open) => setRevokeDialogOpen(open ? key.id : null)}>
                      <DialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Révoquer la clé API</DialogTitle>
                          <DialogDescription>
                            Cette action est irréversible. Les appels API utilisant cette clé seront
                            immédiatement rejetés.
                          </DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                          <Button variant="outline" onClick={() => setRevokeDialogOpen(null)}>
                            Annuler
                          </Button>
                          <Button variant="destructive" onClick={() => revokeKey(key.id)}>
                            Révoquer
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <CustomSiteApiDocs />
    </div>
  )
}
