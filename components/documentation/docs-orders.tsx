'use client'

import { CodeBlock, DocsCode, DocsNote, DocsSection, DocsTable, HttpStatusBadge } from './docs-primitives'

export function DocsOrders({ baseUrl }: { baseUrl: string }) {
  return (
    <>
      <DocsSection
        id="commandes"
        title="Créer une commande"
        description="Chaque commande validée sur le site est transmise à Jisra avec les identifiants produit et variante."
      >
        <CodeBlock
          title={`POST ${baseUrl}/api/public/v1/orders`}
          code={`{
  "idempotency_key": "CMD-2026-0001-v1",
  "external_order_id": "CMD-2026-0001",
  "customer_name": "Youssef El Amrani",
  "phone": "0612345678",
  "city": "Casablanca",
  "address": "12 Rue de la Liberté",
  "total_selling_price": 423,
  "delivery_charge_to_customer": 25,
  "discount_amount": 0,
  "delivery_note": "Disponible demain à 18h",
  "source": "ads",
  "order_date": "2026-09-20T14:30:00.000Z",
  "items": [
    {
      "product_id": "8f1c2b90-3a4d-4f9e-9d21-5c6b7a8e9f01",
      "product_variant_id": "2c9a1d70-6b3e-4a52-8f04-1d2e3f4a5b6c",
      "quantity": 2,
      "unit_selling_price": 199
    }
  ]
}`}
        />

        <DocsTable
          headers={['Champ', 'Requis', 'Rôle']}
          rows={[
            [<DocsCode key="i">idempotency_key</DocsCode>, 'Oui', 'Identifiant unique côté site. Un renvoi avec la même valeur ne crée aucun doublon.'],
            [<DocsCode key="e">external_order_id</DocsCode>, 'Oui', 'Numéro de commande affiché dans Jisra pour retrouver la commande du site.'],
            [<DocsCode key="c">customer_name</DocsCode>, 'Oui', 'Nom du client.'],
            [<DocsCode key="t">total_selling_price</DocsCode>, 'Non', 'Ignoré : Jisra calcule le total (sous-total Jisra − remise + livraison).'],
            [<DocsCode key="d">delivery_charge_to_customer</DocsCode>, 'Non', 'Frais de livraison facturés au client (0 si offerts).'],
            [<DocsCode key="p">unit_selling_price</DocsCode>, 'Non', 'Ignoré : le prix enregistré dans Jisra est appliqué. Un écart est journalisé (PRICE_MISMATCH).'],
            [<DocsCode key="v">product_variant_id</DocsCode>, 'Selon produit', 'Obligatoire dès que le produit possède des variantes.'],
          ]}
        />

        <DocsNote tone="info" title="Stock non bloquant">
          <p>
            Jisra ne refuse jamais une commande pour cause de stock : elle est créée même si la quantité
            disponible est insuffisante (le stock peut devenir négatif puis être régularisé). Utilisez{' '}
            <DocsCode>POST /catalog/availability</DocsCode> pour informer le client avant validation.
          </p>
        </DocsNote>

        <DocsNote tone="success" title="Réponses possibles">
          <p>
            <DocsCode>201</DocsCode> — commande acceptée :{' '}
            <DocsCode>{'{ "status": "accepted", "order_id": "uuid" }'}</DocsCode>
          </p>
          <p>
            <DocsCode>200</DocsCode> — déjà importée :{' '}
            <DocsCode>{'{ "status": "duplicate", "order_id": "uuid" }'}</DocsCode>
          </p>
          <p>
            <DocsCode>422</DocsCode> — rejetée :{' '}
            <DocsCode>{'{ "status": "rejected", "error": "CODE", "message": "..." }'}</DocsCode>
          </p>
        </DocsNote>

        <DocsNote tone="warning" title="Clé d'idempotence réutilisée">
          <p>
            Une même <DocsCode>idempotency_key</DocsCode> renvoyée avec un contenu identique répond{' '}
            <DocsCode>duplicate</DocsCode> (aucun doublon créé). Avec un contenu différent, la commande est
            refusée avec <DocsCode>IDEMPOTENCY_CONFLICT</DocsCode>.
          </p>
        </DocsNote>

        <div>
          <p className="mb-2 text-sm font-medium text-foreground">Erreurs de rattachement produit / variante</p>
          <DocsTable
            headers={['Code', 'Cause']}
            rows={[
              [<DocsCode key="1">VARIANT_REQUIRED</DocsCode>, 'Produit avec variantes mais product_variant_id absent.'],
              [<DocsCode key="2">VARIANT_NOT_FOUND</DocsCode>, 'Variante inexistante dans Jisra.'],
              [<DocsCode key="3">VARIANT_PRODUCT_MISMATCH</DocsCode>, 'Variante liée à un autre produit.'],
              [<DocsCode key="4">VARIANT_NOT_IN_STORE</DocsCode>, 'Variante appartenant à un autre store.'],
              [<DocsCode key="5">PRODUCT_NOT_FOUND</DocsCode>, 'Produit inexistant pour ce store.'],
              [<DocsCode key="6">PRODUCT_NOT_IN_STORE</DocsCode>, "Produit d'un autre store que la clé API."],
              [<DocsCode key="7">INVALID_PRODUCT_ID / INVALID_VARIANT_ID</DocsCode>, 'UUID non valide.'],
              [<DocsCode key="8">IDEMPOTENCY_CONFLICT</DocsCode>, 'idempotency_key réutilisée avec un contenu différent.'],
              [<DocsCode key="9">PRICE_MISMATCH</DocsCode>, 'Journalisé (commande acceptée) : un écart de prix a été remplacé par le prix Jisra.'],
            ]}
          />
        </div>
      </DocsSection>

      <DocsSection
        id="erreurs"
        title="Erreurs HTTP et limites"
        description="Réponses à gérer côté site pour afficher un message correct au client."
      >
        <DocsTable
          headers={['Statut', 'Code', 'Signification']}
          rows={[
            [
              <HttpStatusBadge key="s400" status={400} />,
              <DocsCode key="1">VALIDATION_ERROR / INVALID_JSON / INVALID_LIMIT</DocsCode>,
              'Payload ou paramètre invalide : détail dans le tableau details.',
            ],
            [
              <HttpStatusBadge key="s401" status={401} />,
              <DocsCode key="2">MISSING_AUTHORIZATION / NOT_FOUND / REVOKED</DocsCode>,
              'Clé API absente, inconnue ou révoquée.',
            ],
            [
              <HttpStatusBadge key="s403" status={403} />,
              <DocsCode key="3">MISSING_SCOPE</DocsCode>,
              'La clé ne possède pas le périmètre requis.',
            ],
            [
              <HttpStatusBadge key="s404" status={404} />,
              <DocsCode key="4">PRODUCT_NOT_FOUND</DocsCode>,
              'Produit introuvable ou non publié pour ce store.',
            ],
            [
              <HttpStatusBadge key="s409" status={409} />,
              <DocsCode key="5">IDEMPOTENCY_CONFLICT</DocsCode>,
              'idempotency_key déjà utilisée avec un contenu différent.',
            ],
            [
              <HttpStatusBadge key="s422" status={422} />,
              <DocsCode key="6">VARIANT_REQUIRED, PRODUCT_NOT_IN_STORE…</DocsCode>,
              'Rattachement produit / variante invalide.',
            ],
            [
              <HttpStatusBadge key="s500" status={500} />,
              <DocsCode key="7">—</DocsCode>,
              'Erreur interne : réessayer avec un délai croissant.',
            ],
          ]}
        />

        <CodeBlock
          title="Réponse 400 — validation"
          code={`{
  "error": "Bad Request",
  "code": "VALIDATION_ERROR",
  "message": "Payload invalide",
  "details": [
    { "field": "items.0.quantity", "message": "Number must be greater than 0" }
  ]
}`}
        />

        <DocsNote tone="warning" title="Ne jamais exposer la clé API côté navigateur">
          <p>
            La clé API doit rester sur le serveur du site. Appelez Jisra depuis votre backend : un appel
            direct depuis le navigateur exposerait la clé à tous les visiteurs.
          </p>
        </DocsNote>
      </DocsSection>
    </>
  )
}
