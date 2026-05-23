'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Copy, Eye, EyeOff, RotateCcw, Trash2, Key, ExternalLink } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

type ApiKey = {
  id: string
  name: string
  key_prefix: string
  is_active: boolean
  last_used_at: string | null
  created_at: string
  revoked_at: string | null
}

export function CustomSiteKeys() {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [newKey, setNewKey] = useState<string | null>(null)
  const [showNewKey, setShowNewKey] = useState(false)
  const [copied, setCopied] = useState(false)

  const fetchKeys = async () => {
    try {
      const res = await fetch('/api/integrations/custom-site/keys')
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
  }, [])

  const generateKey = async () => {
    setGenerating(true)
    setNewKey(null)
    setShowNewKey(false)
    try {
      const res = await fetch('/api/integrations/custom-site/keys', { method: 'POST' })
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
      const res = await fetch(`/api/integrations/custom-site/keys/${keyId}`, { method: 'DELETE' })
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
                <code className="flex-1 rounded bg-white px-3 py-2 text-sm font-mono dark:bg-green-900">
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

          <Button onClick={generateKey} disabled={generating}>
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
                    <div className="flex gap-4 text-xs text-muted-foreground">
                      <span>Créée le {new Date(key.created_at).toLocaleDateString('fr-FR')}</span>
                      {key.last_used_at && (
                        <span>Dernière utilisation : {new Date(key.last_used_at).toLocaleDateString('fr-FR')}</span>
                      )}
                    </div>
                  </div>
                  {key.is_active && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Révoquer la clé API</AlertDialogTitle>
                          <AlertDialogDescription>
                            Cette action est irréversible. Les appels API utilisant cette clé seront
                            immédiatement rejetés.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Annuler</AlertDialogCancel>
                          <AlertDialogAction onClick={() => revokeKey(key.id)}>
                            Révoquer
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Documentation rapide</CardTitle>
          <CardDescription>
            Comment utiliser l'API pour importer des commandes depuis votre site.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <h4 className="font-medium mb-1">Endpoint</h4>
            <code className="rounded bg-muted px-2 py-1 text-xs font-mono">
              POST /api/public/v1/orders
            </code>
          </div>

          <div>
            <h4 className="font-medium mb-1">Headers</h4>
            <pre className="rounded bg-muted p-2 text-xs font-mono overflow-x-auto">
{`Authorization: Bearer <votre_clé_api>
Content-Type: application/json`}
            </pre>
          </div>

          <div>
            <h4 className="font-medium mb-1">Body (JSON)</h4>
            <pre className="rounded bg-muted p-2 text-xs font-mono overflow-x-auto">
{`{
  "idempotency_key": "cmd-123-abc",
  "external_order_id": "CMD-001",
  "customer_name": "Jean Dupont",
  "phone": "0612345678",
  "city": "Casablanca",
  "address": "12 Rue de la Liberté",
  "total_selling_price": 250.00,
  "delivery_charge_to_customer": 25.00,
  "delivery_note": "Frais de livraison",
  "items": [
    {
      "product_id": "uuid-du-produit",
      "product_name": "T-shirt Noir",
      "product_variant_id": "uuid-de-la-variante",
      "quantity": 2,
      "unit_selling_price": 125.00
    }
  ]
}`}
            </pre>
          </div>

          <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
            <h4 className="font-medium text-sm text-amber-800 dark:text-amber-200">📖 Explications des champs</h4>
            <div className="space-y-2 text-xs text-amber-700 dark:text-amber-300">
              <p>
                <strong>delivery_charge_to_customer</strong> : Montant des frais de livraison facturés au client. 
                Si la livraison est gratuite pour le client, mettez <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">0</code>.
              </p>
              <p>
                <strong>product_id</strong> (obligatoire) : L'identifiant unique du produit dans Jisra. 
                C'est le critère principal pour rattacher l'article à un produit. 
                Vous trouverez cet ID dans la page <strong>Produits</strong> (colonne "ID").
              </p>
              <p>
                <strong>product_name</strong> (optionnel) : Le nom du produit. Ce champ est décoratif uniquement, 
                le vrai rattachement se fait via <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">product_id</code>.
              </p>
              <p>
                <strong>product_variant_id</strong> (optionnel) : L'identifiant unique de la variante (taille, couleur, etc.). 
                Si votre produit a des variantes, vous pouvez préciser laquelle a été commandée. 
                Laissez vide ou omettez le champ si le produit n'a pas de variantes.
              </p>
            </div>
          </div>

          <div>
            <h4 className="font-medium mb-1">Réponse succès (201)</h4>
            <pre className="rounded bg-muted p-2 text-xs font-mono">
{`{ "status": "accepted", "order_id": "uuid" }`}
            </pre>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950">
            <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
            <p className="text-xs text-blue-700 dark:text-blue-300">
              L'idempotency_key permet d'éviter les doublons en cas de renvoi. Utilisez un identifiant unique
              par commande côté site.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
