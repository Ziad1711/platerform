'use client'

import { CodeBlock, DocsCode, DocsNote, DocsSection, DocsTable, EndpointRow } from './docs-primitives'

export function DocsCatalog({ baseUrl }: { baseUrl: string }) {
  return (
    <>
      <DocsSection
        id="catalogue"
        title="Catalogue produits"
        description="Le site récupère les produits, variantes et prix depuis Jisra. Jisra reste la source unique de vérité."
      >
        <div className="space-y-2">
          <EndpointRow method="GET" path="/catalog/products" scope="products:read" />
          <EndpointRow method="GET" path="/catalog/products/{product_id}" scope="products:read" />
          <EndpointRow
            method="POST"
            path="/catalog/availability"
            scope="products:read + stock:read"
          />
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-foreground">Paramètres de liste</p>
          <DocsTable
            headers={['Paramètre', 'Défaut', 'Description']}
            rows={[
              [<DocsCode key="l">limit</DocsCode>, '50', 'Entre 1 et 200 produits par page.'],
              [<DocsCode key="c">cursor</DocsCode>, '—', "ID du dernier produit reçu. À renvoyer pour obtenir la page suivante."],
              [
                <DocsCode key="u">updated_since</DocsCode>,
                '—',
                'Date ISO 8601. Ne renvoie que les produits modifiés après cette date (synchronisation incrémentale).',
              ],
              [<DocsCode key="s">sku</DocsCode>, '—', 'Filtre exact sur le SKU du produit.'],
            ]}
          />
        </div>

        <DocsNote tone="info" title="Paramètres invalides">
          <p>
            Un <DocsCode>limit</DocsCode> hors bornes, un <DocsCode>cursor</DocsCode> non UUID ou un{' '}
            <DocsCode>updated_since</DocsCode> non ISO 8601 est refusé en <DocsCode>400</DocsCode> (
            <DocsCode>INVALID_LIMIT</DocsCode>, <DocsCode>INVALID_CURSOR</DocsCode>,{' '}
            <DocsCode>INVALID_UPDATED_SINCE</DocsCode>).
          </p>
        </DocsNote>

        <CodeBlock
          title={`GET ${baseUrl}/api/public/v1/catalog/products?limit=50`}
          code={`curl --location '${baseUrl}/api/public/v1/catalog/products?limit=50' \\
  --header 'Authorization: Bearer jsk_votre_cle_api'`}
        />

        <CodeBlock
          title="Réponse 200"
          code={`{
  "data": [
    {
      "id": "8f1c2b90-3a4d-4f9e-9d21-5c6b7a8e9f01",
      "name": "T-shirt Premium",
      "sku": "TSHIRT-001",
      "image_url": "https://.../products/tshirt.jpg",
      "stock_tracking_mode": "variant",
      "has_variants": true,
      "price": { "min": 199, "max": 249, "currency": "MAD" },
      "variants": [
        {
          "id": "2c9a1d70-6b3e-4a52-8f04-1d2e3f4a5b6c",
          "name": "Noir / XL",
          "sku": "TSHIRT-001-NOIR-XL",
          "selling_price": 199,
          "option_values": { "Couleur": "Noir", "Taille": "XL" },
          "available_stock": 12,
          "is_available": true
        }
      ],
      "available_stock": 12,
      "is_available": true,
      "updated_at": "2026-09-20T10:00:00.000Z"
    }
  ],
  "currency": "MAD",
  "includes_stock": true,
  "pagination": { "limit": 50, "next_cursor": null, "has_more": false }
}`}
        />

        <DocsNote tone="info" title="Publication et stock">
          <p>
            Seuls les produits dont <DocsCode>publication_status</DocsCode> vaut <DocsCode>active</DocsCode>{' '}
            sont renvoyés : les produits <DocsCode>draft</DocsCode> et <DocsCode>archived</DocsCode> sont exclus.
          </p>
          <p>
            <DocsCode>available_stock</DocsCode> et <DocsCode>is_available</DocsCode> ne sont renvoyés que si
            la clé API possède le périmètre <DocsCode>stock:read</DocsCode>. Le coût d&apos;achat et la marge ne
            sont jamais exposés.
          </p>
        </DocsNote>

        <div>
          <p className="mb-2 text-sm font-medium text-foreground">Synchronisation incrémentale</p>
          <p className="text-xs text-muted-foreground">
            Conservez la date du dernier produit reçu, puis rappelez la liste avec{' '}
            <DocsCode>updated_since</DocsCode>. Pagez avec <DocsCode>cursor</DocsCode> jusqu'à{' '}
            <DocsCode>has_more: false</DocsCode>.
          </p>
        </div>
      </DocsSection>

      <DocsSection
        id="disponibilite"
        title="Vérification avant commande"
        description="À exécuter côté serveur juste avant de créer la commande : Jisra confirme les prix et le stock réels."
      >
        <CodeBlock
          title={`POST ${baseUrl}/api/public/v1/catalog/availability`}
          code={`{
  "items": [
    {
      "product_id": "8f1c2b90-3a4d-4f9e-9d21-5c6b7a8e9f01",
      "product_variant_id": "2c9a1d70-6b3e-4a52-8f04-1d2e3f4a5b6c",
      "quantity": 2
    }
  ]
}`}
        />

        <CodeBlock
          title="Réponse 200"
          code={`{
  "currency": "MAD",
  "is_available": true,
  "unavailable_count": 0,
  "subtotal_amount": 398,
  "items": [
    {
      "product_id": "8f1c2b90-3a4d-4f9e-9d21-5c6b7a8e9f01",
      "product_variant_id": "2c9a1d70-6b3e-4a52-8f04-1d2e3f4a5b6c",
      "requested_quantity": 2,
      "is_available": true,
      "available_stock": 12,
      "unit_selling_price": 199,
      "line_total": 398,
      "price_source": "variant",
      "reason": null
    }
  ]
}`}
        />

        <DocsTable
          headers={['reason', 'Signification']}
          rows={[
            [<DocsCode key="r1">PRODUCT_NOT_FOUND</DocsCode>, 'Produit inexistant ou appartenant à un autre store.'],
            [<DocsCode key="r2">VARIANT_REQUIRED</DocsCode>, 'Le produit possède des variantes : product_variant_id est obligatoire.'],
            [<DocsCode key="r3">VARIANT_NOT_FOUND</DocsCode>, 'Variante inexistante ou hors du store de la clé.'],
            [<DocsCode key="r4">VARIANT_PRODUCT_MISMATCH</DocsCode>, "La variante n'appartient pas au produit envoyé."],
            [<DocsCode key="r5">INSUFFICIENT_STOCK</DocsCode>, 'Stock insuffisant pour la quantité demandée.'],
            [<DocsCode key="r6">INVALID_QUANTITY</DocsCode>, 'Quantité absente, nulle ou négative.'],
          ]}
        />

        <DocsNote tone="success" title="Contrôle informatif, jamais bloquant">
          <p>
            Cette vérification sert à prévenir votre site (prix obsolète, produit retiré, stock faible). Jisra
            n&apos;annule jamais une commande pour cause de stock : elle est enregistrée puis traitée selon
            votre workflow de confirmation. Le stock peut devenir négatif et se régularise lors du retour ou
            de l&apos;inventaire.
          </p>
        </DocsNote>

        <DocsNote tone="warning" title="Prix de référence">
          <p>
            <DocsCode>unit_selling_price</DocsCode> correspond au prix enregistré dans Jisra. Utilisez-le pour
            afficher le prix final et détecter un panier obsolète. Une remise commerciale doit être envoyée
            explicitement dans la commande.
          </p>
        </DocsNote>
      </DocsSection>
    </>
  )
}
