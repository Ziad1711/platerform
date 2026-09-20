'use client'

import { CodeBlock, DocsCode, DocsNote, DocsSection } from './docs-primitives'

export function DocsGuides({ baseUrl }: { baseUrl: string }) {
  return (
    <>
      <DocsSection
        id="exemples"
        title="Exemples d'intégration"
        description="Tous les appels doivent partir du serveur du site, jamais du navigateur du client."
      >
        <CodeBlock
          title="Node.js — récupérer le catalogue"
          code={`const API_URL = '${baseUrl}/api/public/v1'

export async function getCatalog() {
  const response = await fetch(\`\${API_URL}/catalog/products?limit=100\`, {
    headers: {
      Authorization: \`Bearer \${process.env.JISRA_API_KEY}\`,
    },
    cache: 'no-store',
  })

  if (!response.ok) throw new Error('Catalogue indisponible')

  const { data } = await response.json()
  return data
}`}
        />

        <CodeBlock
          title="Node.js — envoyer une commande"
          code={`export async function createOrder(order) {
  const response = await fetch(\`\${API_URL}/orders\`, {
    method: 'POST',
    headers: {
      Authorization: \`Bearer \${process.env.JISRA_API_KEY}\`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      idempotency_key: order.external_id,
      external_order_id: order.external_id,
      customer_name: order.customer_name,
      phone: order.phone,
      city: order.city,
      address: order.address,
      total_selling_price: order.total,
      delivery_charge_to_customer: order.delivery_fee,
      items: order.items.map((item) => ({
        product_id: item.jisra_product_id,
        product_variant_id: item.jisra_variant_id,
        quantity: item.quantity,
        unit_selling_price: item.unit_price,
      })),
    }),
  })

  return response.json()
}`}
        />

        <CodeBlock
          title="PHP — vérifier un panier avant commande"
          code={`<?php
$payload = json_encode([
  'items' => [[
    'product_id' => 'uuid-produit',
    'product_variant_id' => 'uuid-variante',
    'quantity' => 2,
  ]],
]);

$ch = curl_init('${baseUrl}/api/public/v1/catalog/availability');
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => [
    'Authorization: Bearer ' . getenv('JISRA_API_KEY'),
    'Content-Type: application/json',
  ],
  CURLOPT_POSTFIELDS => $payload,
]);

$result = json_decode(curl_exec($ch), true);
curl_close($ch);

if (!$result['is_available']) {
  // Afficher le motif renvoyé dans $result['items']
}`}
        />
      </DocsSection>

      <DocsSection
        id="bonnes-pratiques"
        title="Bonnes pratiques"
        description="Règles à respecter pour une intégration durable."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-border/50 p-4">
            <p className="text-sm font-medium text-foreground">Bonnes pratiques</p>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              <li>● Une clé API par site, jamais partagée entre plusieurs clients.</li>
              <li>● Clé stockée uniquement dans les variables d'environnement du serveur.</li>
              <li>● <DocsCode>idempotency_key</DocsCode> unique et stable par commande.</li>
              <li>● Vérifier prix et stock avant chaque validation de commande.</li>
              <li>● Mettre en cache le catalogue côté site (quelques minutes).</li>
              <li>● Ne jamais afficher les coûts d'achat ou les marges.</li>
              <li>● Prévoir des délais de reprise en cas d'indisponibilité réseau.</li>
            </ul>
          </div>

          <div className="rounded-xl border border-border/50 p-4">
            <p className="text-sm font-medium text-foreground">Checklist avant mise en ligne</p>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              <li>□ Clé de production générée et testée.</li>
              <li>□ Ancienne clé de test révoquée.</li>
              <li>□ Nombre de produits et de variantes comparé avec Jisra.</li>
              <li>□ Prix affichés identiques aux prix Jisra.</li>
              <li>□ Commande de test reçue dans Jisra.</li>
              <li>□ Renvoi de la même commande → réponse <DocsCode>duplicate</DocsCode>.</li>
              <li>□ Produit sans variante et produit avec variante testés.</li>
              <li>□ Journal d'ingestion vérifié (aucune erreur inattendue).</li>
            </ul>
          </div>
        </div>

        <DocsNote tone="warning" title="Stock négatif et survente">
          <p>
            Le stock Jisra peut devenir négatif selon votre configuration. Traitez{' '}
            <DocsCode>INSUFFICIENT_STOCK</DocsCode> comme un signal : proposez une variante alternative plutôt
            que de bloquer la commande sans explication.
          </p>
        </DocsNote>
      </DocsSection>

      <DocsSection
        id="webhooks"
        title="Webhooks (étape suivante)"
        description="Les webhooks sortants permettront au site d'être prévenu sans interrogation périodique."
      >
        <p className="text-sm text-muted-foreground">
          Les événements prévus remplaceront progressivement la synchronisation manuelle :
        </p>
        <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
          <li><DocsCode>product.created</DocsCode> et <DocsCode>product.updated</DocsCode></li>
          <li><DocsCode>price.updated</DocsCode></li>
          <li><DocsCode>stock.updated</DocsCode></li>
          <li><DocsCode>product.archived</DocsCode></li>
        </ul>
        <DocsNote tone="info" title="Sans webhooks">
          <p>
            En attendant, utilisez <DocsCode>updated_since</DocsCode> ou un cache de courte durée : le résultat
            fonctionnel est identique, avec un léger délai de propagation.
          </p>
        </DocsNote>
      </DocsSection>
    </>
  )
}
