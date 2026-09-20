'use client'

import { CodeBlock, DocsCode, DocsNote, DocsSection, DocsTable, EndpointRow } from './docs-primitives'

export function DocsOverview({ baseUrl }: { baseUrl: string }) {
  return (
    <>
      <DocsSection
        id="vue-ensemble"
        title="Vue d'ensemble"
        description="Jisra est la source unique de vérité pour les produits, les prix, le stock et les commandes."
      >
        <p className="text-sm leading-7 text-muted-foreground">
          Connectez un site e-commerce à Jisra : catalogue, prix, stock et commandes via HTTP. Les clés API se
          génèrent depuis votre espace Jisra, dans Intégrations → Site web personnalisé.
        </p>

        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            URL de base
          </p>
          <div className="rounded-xl border border-border bg-muted/30 px-3 py-2.5">
            <code className="font-mono text-xs text-foreground">{baseUrl}/api/public/v1</code>
          </div>
        </div>

        <div className="space-y-2">
          <EndpointRow method="GET" path="/catalog/products" scope="products:read" />
          <EndpointRow method="GET" path="/catalog/products/{product_id}" scope="products:read" />
          <EndpointRow method="POST" path="/catalog/availability" scope="products:read + stock:read" />
          <EndpointRow method="POST" path="/orders" scope="orders:write" />
        </div>

        <CodeBlock
          title="Architecture"
          code={`Jisra (base de données + dashboard)
        ↓  API Catalogue (lecture)
Site e-commerce du client
        ↓  API Commandes (écriture)
Jisra (commandes, stock, livraison)`}
        />

        <DocsTable
          headers={['Sens', 'Données', 'Responsable']}
          rows={[
            [
              'Jisra → Site',
              'Produits, variantes, prix, images, stock disponible',
              'Jisra (source de vérité)',
            ],
            [
              'Site → Jisra',
              'Commandes, articles, quantités, ville, adresse',
              'Site (via API publique)',
            ],
          ]}
        />

        <DocsNote tone="warning" title="Ne pas dupliquer les produits">
          <p>
            Le site ne doit pas conserver sa propre gestion de prix ou de stock. Une modification de prix se
            fait dans Jisra, puis le site la récupère via l'API Catalogue.
          </p>
        </DocsNote>

        <div>
          <p className="mb-2 text-sm font-medium text-foreground">Prérequis</p>
          <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            <li>Un store configuré dans Jisra, avec ses produits et ses variantes.</li>
            <li>Une clé API générée depuis Intégrations → Site web personnalisé.</li>
            <li>Un backend capable d'appeler Jisra (Node, PHP, Laravel, Django…).</li>
          </ul>
        </div>
      </DocsSection>

      <DocsSection
        id="demarrage"
        title="Démarrage rapide"
        description="Cinq étapes pour connecter un site à Jisra."
      >
        <ol className="space-y-3 text-sm text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">1. Sélectionner le store</span> — ouvrez{' '}
            <DocsCode>/integrations</DocsCode>, choisissez le store concerné puis l'intégration « Site web
            personnalisé ».
          </li>
          <li>
            <span className="font-medium text-foreground">2. Générer une clé API</span> — la clé complète n'est
            affichée qu'une seule fois. Conservez-la dans les variables d'environnement de votre serveur.
          </li>
          <li>
            <span className="font-medium text-foreground">3. Récupérer le catalogue</span> —{' '}
            <DocsCode>GET /api/public/v1/catalog/products</DocsCode>, puis affichez les produits sur le site.
          </li>
          <li>
            <span className="font-medium text-foreground">4. Vérifier le panier</span> —{' '}
            <DocsCode>POST /api/public/v1/catalog/availability</DocsCode> avant de valider la commande.
          </li>
          <li>
            <span className="font-medium text-foreground">5. Envoyer la commande</span> —{' '}
            <DocsCode>POST /api/public/v1/orders</DocsCode> avec les identifiants Jisra.
          </li>
        </ol>

        <CodeBlock
          title="URL de base de l'API"
          code={`${baseUrl}/api/public/v1`}
        />
      </DocsSection>

      <DocsSection
        id="authentification"
        title="Authentification et périmètres"
        description="Chaque appel doit inclure la clé API dans l'en-tête Authorization."
      >
        <CodeBlock
          title="En-têtes"
          code={`Authorization: Bearer jsk_votre_cle_api
Content-Type: application/json`}
        />

        <DocsTable
          headers={['Périmètre', 'Autorise']}
          rows={[
            [<DocsCode key="1">products:read</DocsCode>, 'Lister les produits, lire un produit, vérifier un panier.'],
            [<DocsCode key="2">stock:read</DocsCode>, 'Lire le stock disponible et vérifier la disponibilité.'],
            [<DocsCode key="3">orders:write</DocsCode>, 'Créer une commande dans Jisra.'],
          ]}
        />

        <DocsNote tone="info" title="Clés existantes">
          <p>
            Les clés créées avant l'ajout des périmètres possèdent automatiquement les trois droits. Révoquez
            une clé depuis l'interface si elle a été exposée par erreur.
          </p>
        </DocsNote>
      </DocsSection>
    </>
  )
}
