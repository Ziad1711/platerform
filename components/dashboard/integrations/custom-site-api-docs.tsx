'use client'

import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ExternalLink } from 'lucide-react'

export function CustomSiteApiDocs() {
  return (
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
  "delivery_note": "je serai dispo demain à 18h",
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

        <div>
          <h4 className="font-medium mb-1">Exemples d'articles (items)</h4>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Produit sans variante</p>
            <pre className="rounded bg-muted p-2 text-xs font-mono overflow-x-auto">
{`{
  "product_id": "uuid-du-produit",
  "quantity": 2,
  "unit_selling_price": 125.00
}`}
            </pre>

            <p className="text-xs text-muted-foreground">Variante physique (couleur, taille, modèle)</p>
            <pre className="rounded bg-muted p-2 text-xs font-mono overflow-x-auto">
{`{
  "product_id": "uuid-du-produit",
  "product_variant_id": "uuid-variante-noir-xl",
  "quantity": 2,
  "unit_selling_price": 125.00
}`}
            </pre>

            <p className="text-xs text-muted-foreground">Pack quantité (stock partagé, multiplicateur 3)</p>
            <pre className="rounded bg-muted p-2 text-xs font-mono overflow-x-auto">
{`{
  "product_id": "uuid-du-produit",
  "product_variant_id": "uuid-pack-3",
  "quantity": 2,
  "unit_selling_price": 250.00
}`}
            </pre>

            <p className="text-xs text-muted-foreground">
              Avec un multiplicateur de 3, ce dernier article consomme 6 unités physiques du stock.
            </p>
          </div>
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
              <strong>product_variant_id</strong> : L'identifiant unique de la variante commandée.
              Copiez-le depuis la page <strong>Produits</strong> (bouton copier de la ligne de la variante).
            </p>
            <p>
              <strong>product_id</strong> et <strong>product_variant_id</strong> doivent appartenir au store
              de la clé API, sinon la commande est rejetée.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr>
                    <th className="py-1 pr-2 font-medium">Situation</th>
                    <th className="py-1 font-medium">product_variant_id</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="py-1 pr-2">Produit sans variante</td>
                    <td className="py-1">À omettre</td>
                  </tr>
                  <tr>
                    <td className="py-1 pr-2">Couleur, taille, modèle (stock par variante)</td>
                    <td className="py-1">Obligatoire</td>
                  </tr>
                  <tr>
                    <td className="py-1 pr-2">Pack 1, 2, 3 unités (stock partagé)</td>
                    <td className="py-1">Obligatoire</td>
                  </tr>
                  <tr>
                    <td className="py-1 pr-2">Variante d'un autre produit ou d'un autre store</td>
                    <td className="py-1">Commande rejetée</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              Le mode de stock (<code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">partagé</code> ou{' '}
              <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">par variante</code>) et la quantité par pack
              sont configurés dans Jisra. Ne les envoyez pas : l'API les applique automatiquement à partir de{' '}
              <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">product_variant_id</code>.
            </p>
          </div>
        </div>

        <div>
          <h4 className="font-medium mb-1">Réponse succès (201)</h4>
          <pre className="rounded bg-muted p-2 text-xs font-mono">
{`{ "status": "accepted", "order_id": "uuid" }`}
          </pre>
        </div>

        <div>
          <h4 className="font-medium mb-1">Erreurs de variantes (422)</h4>
          <div className="space-y-2">
            <pre className="rounded bg-muted p-2 text-xs font-mono overflow-x-auto">
{`{
  "status": "rejected",
  "error": "VARIANT_REQUIRED",
  "message": "Le produit uuid-du-produit possède des variantes : product_variant_id est obligatoire..."
}`}
            </pre>
            <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              <li><code>VARIANT_REQUIRED</code> : produit avec variantes mais <code>product_variant_id</code> absent.</li>
              <li><code>VARIANT_NOT_FOUND</code> : variante inexistante dans Jisra.</li>
              <li><code>VARIANT_PRODUCT_MISMATCH</code> : variante liée à un autre produit.</li>
              <li><code>VARIANT_NOT_IN_STORE</code> : variante appartenant à un autre store.</li>
              <li><code>PRODUCT_NOT_FOUND</code> / <code>PRODUCT_NOT_IN_STORE</code> : produit invalide.</li>
              <li><code>INVALID_PRODUCT_ID</code> / <code>INVALID_VARIANT_ID</code> : UUID non valide.</li>
            </ul>
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950">
          <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
          <p className="text-xs text-blue-700 dark:text-blue-300">
            L'idempotency_key permet d'éviter les doublons en cas de renvoi. Utilisez un identifiant unique
            par commande côté site.
          </p>
        </div>

        <div className="border-t border-border pt-3">
          <Link
            href="/documentation"
            className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
          >
            Consulter la documentation complète
            <ExternalLink className="h-4 w-4" />
          </Link>
          <p className="mt-1 text-xs text-muted-foreground">
            Catalogue, prix, stock disponible, authentification et exemples de code.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

