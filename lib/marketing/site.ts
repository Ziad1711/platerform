import { v } from '@/lib/asset'

export const marketingNav = [
  { href: '#ai', label: 'IA' },
  { href: '#ads', label: 'Publicité' },
  { href: '#logistics', label: 'Logistique' },
  { href: '#integrations', label: 'Intégrations' },
  { href: '/pricing', label: 'Tarifs' },
]

export const heroStats = [
  { value: '+12 h', label: 'gagnées par semaine' },
  { value: '100 %', label: 'vision centralisée du business' },
  { value: 'API', label: 'connexion sécurisée des stores' },
  { value: '24/7', label: 'lecture de la rentabilité réelle' },
]

export const logoMarquee = [
  'YouCan',
  'LightFunnels',
  'Meta',
  'Rapid Delivery',
  'Multi-stores',
  'Profit Net',
  'MAD Native',
]

export const automations = [
  'Synchronisation automatique des commandes depuis YouCan et LightFunnels',
  'Création automatique des colis chez Rapid Delivery et autres transporteurs',
  'Mise à jour automatique des statuts livraison: confirmé, ramassé, livré, retourné',
  'Import automatique des dépenses Facebook Ads avec allocation par produit et commande',
  'Normalisation intelligente des villes FR/AR avec apprentissage progressif',
  'Calcul automatique du vrai profit net par commande',
]

export const modules = [
  'Ventes & commandes',
  'Produits & variantes',
  'Stock & inventaire',
  'Fournisseurs & ledger',
  'Publicité & ROI',
  'Dépenses',
  'Livraison',
  'Personnel & commissions',
  'Assistant IA connecté à vos données',
]

export const integrations = [
  {
    name: 'YouCan',
    status: 'Disponible',
    icon: '/icons/youcan-shop-icon-filled-256.png',
    description: 'Sync commandes, catalogue et opérations depuis votre store principal.',
  },
  {
    name: 'Rapid Delivery',
    status: 'Disponible',
    icon: '/icons/logo.gif',
    description: 'Création colis, suivi et vouchers connectés au terrain marocain.',
  },
  {
    name: 'Facebook Ads',
    status: 'Disponible',
    icon: '/icons/meta_PNG5.png',
    description: 'Dépenses pub reliées au profit net, pas seulement au volume.',
  },
  {
    name: 'Shopify',
    status: 'Bientôt',
    icon: '/icons/shopify.png',
    description: 'Connexion native pour les marques qui pilotent plusieurs stacks.',
  },
  {
    name: 'LightFunnels',
    status: 'Disponible',
    icon: '/icons/unnamed.png',
    description: 'Flux funnel et ventes centralisés dans le même cockpit business.',
  },
  {
    name: 'Multi-devises',
    status: 'Natif',
    icon: '/icons/icon-192.svg',
    description: 'MAD en natif, conversions cohérentes et lecture consolidée.',
  },
]

export const pricingPlans = [
  {
    name: 'Starter',
    price: 'Sur devis',
    description: 'Pour structurer un premier store sans Excel.',
    features: ['1 store', 'Commandes & stock', 'Livraison', 'Dashboard KPI'],
  },
  {
    name: 'Growth',
    price: 'Sur devis',
    description: 'Pour scaler avec pub, rentabilité et automatisations.',
    features: ['3 stores', 'Facebook Ads', 'Profit net', 'Assistant IA'],
    featured: true,
  },
  {
    name: 'Scale',
    price: 'Sur devis',
    description: 'Pour les équipes multi-stores avec pilotage consolidé.',
    features: ['Stores illimités', 'Équipe & rôles', 'Priorité support', 'Intégrations avancées'],
  },
]

export const faqItems = [
  {
    question: 'Jisra est-il conçu pour le Maroc ?',
    answer:
      'Oui. Le produit est pensé pour les e-commerçants marocains: français, MAD, workflows de confirmation et sociétés de livraison locales.',
  },
  {
    question: 'Est-ce que jisra remplace mes tableaux Excel ?',
    answer:
      'Oui. L’objectif est de centraliser commandes, coûts, livraison, stock et rentabilité dans une seule interface.',
  },
  {
    question: 'Puis-je gérer plusieurs stores ? ',
    answer:
      'Oui, jisra propose une vue consolidée multi-stores pour suivre votre activité globale sans changer d’outil.',
  },
  {
    question: 'Comment calculez-vous le vrai profit ?',
    answer:
      'Jisra combine revenus, coût produit, coûts pub, livraison et coûts opérationnels pour sortir la rentabilité réelle par commande.',
  },
  {
    question: 'Dois-je connecter mes intégrations dès le début ?',
    answer:
      'Non, vous pouvez démarrer progressivement puis brancher vos stores et vos sources de dépenses quand vous êtes prêt.',
  },
]

export const testimonials = [
  {
    quote:
      'On a enfin une lecture claire de ce que chaque commande nous laisse vraiment, pub et livraison incluses.',
    author: 'Nadia A.',
    role: 'Founder · DTC beauté',
  },
  {
    quote:
      'Le vrai gain, ce n’est pas seulement le dashboard. C’est l’exécution plus rapide entre store, équipe et livraison.',
    author: 'Yassine B.',
    role: 'COO · Multi-stores maison',
  },
  {
    quote:
      'Avant, notre rentabilité était une hypothèse. Avec jisra, c’est un chiffre pilotable chaque jour.',
    author: 'Salma R.',
    role: 'Head of Growth · Fashion commerce',
  },
]

export const homeFeatureHighlights = [
  {
    title: 'Automatisations utiles, pas cosmétiques',
    description:
      'Les flux qui cassent vos journées — commandes, ads, livraison, statuts, coûts — sont orchestrés dans une seule logique opérationnelle.',
    image: '/marketing/feature-automation.webp',
    accent: 'Flow engine',
  },
  {
    title: 'Multi-stores sans perte de contexte',
    description:
      'Passez d’une boutique à une vue consolidée sans reconstruire vos chiffres à la main.',
    image: '/marketing/feature-multistore.webp',
    accent: 'Consolidation',
  },
  {
    title: 'Assistant IA branché aux vraies données',
    description:
      'Posez vos questions business en français et obtenez des réponses ancrées dans vos ventes, vos coûts et vos opérations.',
    image: '/marketing/feature-ai.webp',
    accent: 'AI copilote',
  },
  {
    title: 'Livraison pensée pour le terrain marocain',
    description:
      'Création colis, statuts, normalisation des villes et coordination delivery sans friction supplémentaire.',
    image: '/marketing/feature-delivery.webp',
    accent: 'Delivery ops',
  },
  {
    title: 'Ads et profit enfin reliés',
    description:
      'Le ROAS cesse d’être flatteur par défaut : vous voyez ce qui crée réellement de la marge.',
    image: '/marketing/feature-ads-profit.webp',
    accent: 'Profit layer',
  },
  {
    title: 'Stock, variantes et mouvements sous contrôle',
    description:
      'La donnée produit reste cohérente entre ventes, livraison, achats et lecture financière.',
    image: '/marketing/feature-stock.webp',
    accent: 'Inventory clarity',
  },
]

type FeatureSection = {
  heading: string
  level?: 2 | 3
  paragraphs: string[]
  links?: { href: string; label: string }[]
}

export type FeaturePage = {
  slug: string
  title: string
  description: string
  image: string
  bullets: string[]
  seoTitle?: string
  seoDescription?: string
  h1?: string
  heroDescription?: string
  valueText?: string
  content?: FeatureSection[]
}

export const featurePages: FeaturePage[] = [
  {
    slug: 'ventes',
    title: 'Ventes & commandes',
    description:
      'Organisez vos commandes, leurs confirmations et leurs statuts dans jisra. Saisie, import CSV et suivi des ventes depuis une interface adaptée au e-commerce marocain.',
    image: '/marketing/feature-automation.webp',
    seoTitle: 'Gestion des commandes e-commerce au Maroc',
    seoDescription:
      'Organisez vos commandes, leurs confirmations et leurs statuts dans jisra. Saisie, import CSV et suivi des ventes depuis une interface adaptée au e-commerce marocain.',
    h1: 'Gérez vos commandes e-commerce depuis un même espace',
    heroDescription:
      'Saisissez vos commandes, importez-les par fichier CSV ou recevez celles des boutiques connectées, puis suivez leurs statuts et leurs confirmations dans un même espace.',
    valueText:
      'Un espace unique pour les commandes à traiter, les confirmations et les statuts, relié aux autres modules de gestion.',
    bullets: ['Saisie et import CSV', 'Réception des commandes connectées', 'Confirmation et suivi des statuts'],
    content: [
      {
        heading: 'De la réception à la confirmation',
        paragraphs: [
          'Saisissez vos commandes ou importez-les par fichier CSV. Pour une boutique connectée, jisra dispose également d’un parcours de réception des commandes depuis YouCan et LightFunnels. Retrouvez les informations client, les articles et le statut de chaque commande dans votre espace de vente.',
        ],
      },
      {
        heading: 'Un suivi exploitable par l’équipe',
        level: 3,
        paragraphs: [
          'Consultez les commandes à traiter, mettez à jour leur statut et préparez les étapes de confirmation. Les actions disponibles dépendent du rôle attribué à chaque membre de l’équipe.',
        ],
      },
      {
        heading: 'Gardez le lien entre vente, stock et livraison',
        paragraphs: [
          'Les articles commandés, les mouvements de stock et les informations de livraison s’inscrivent dans les parcours de gestion de jisra. Les données nécessaires à l’expédition restent consultables depuis la commande.',
        ],
        links: [
          { href: '/features/stock', label: 'Suivre le stock des articles' },
          { href: '/features/livraison', label: 'Préparer les livraisons' },
          { href: '/features/publicite', label: 'Consulter les dépenses publicitaires' },
        ],
      },
    ],
  },
  {
    slug: 'publicite',
    title: 'Publicité & ROI',
    description:
      'Suivez les dépenses Meta, consultez vos indicateurs publicitaires et rapprochez les coûts de vos commandes dans jisra, selon les données synchronisées ou saisies.',
    image: '/marketing/feature-ads-profit.webp',
    seoTitle: 'Suivi des dépenses Facebook Ads e-commerce',
    seoDescription:
      'Suivez les dépenses Meta, consultez vos indicateurs publicitaires et rapprochez les coûts de vos commandes dans jisra, selon les données synchronisées ou saisies.',
    h1: 'Suivez vos dépenses publicitaires et leurs indicateurs',
    heroDescription:
      'Consultez les dépenses publicitaires sur la période choisie, avec les indicateurs calculés à partir des données synchronisées ou saisies dans jisra.',
    valueText:
      'Les dépenses publicitaires sont rapprochées des coûts suivis dans jisra, selon les données disponibles.',
    bullets: ['Données Facebook Ads', 'Saisie et import', 'Coûts rapprochés des commandes'],
    content: [
      {
        heading: 'Retrouvez vos coûts publicitaires',
        paragraphs: [
          'Connectez les données Facebook Ads lorsque l’intégration est configurée, ou utilisez les modes de saisie et d’import disponibles. Consultez les dépenses sur la période choisie, avec conversion de devise lorsqu’elle s’applique.',
        ],
      },
      {
        heading: 'Comparez les campagnes et les produits',
        level: 3,
        paragraphs: [
          'Les vues disponibles présentent notamment les dépenses et certains indicateurs par campagne ou par produit. Le détail par produit dépend des correspondances configurées ; un historique importé peut ne pas comporter de détail par campagne.',
        ],
      },
      {
        heading: 'Replacez la publicité dans le suivi de vos ventes',
        paragraphs: [
          'jisra peut répartir des coûts publicitaires sur les commandes selon ses règles de calcul. Ces coûts vous aident à lire vos indicateurs de gestion ; ils ne prouvent pas qu’une campagne donnée a généré une commande particulière.',
        ],
        links: [
          { href: '/features/ventes', label: 'Consulter les commandes' },
          { href: '/features/stock', label: 'Suivre les produits' },
        ],
      },
    ],
  },
  {
    slug: 'livraison',
    title: 'Livraison',
    description:
      'Préparez les colis depuis vos commandes, consultez les bons de ramassage et suivez les statuts de livraison avec les transporteurs configurés dans jisra.',
    image: '/marketing/feature-delivery.webp',
    seoTitle: 'Gestion des livraisons e-commerce au Maroc',
    seoDescription:
      'Préparez les colis depuis vos commandes, consultez les bons de ramassage et suivez les statuts de livraison avec les transporteurs configurés dans jisra.',
    h1: 'Préparez et suivez vos livraisons depuis vos commandes',
    heroDescription:
      'Créez les colis depuis une commande éligible, regroupez les bons de ramassage et consultez les statuts transmis par les transporteurs configurés.',
    valueText:
      'Les colis partent des commandes enregistrées, avec les informations nécessaires au transporteur configuré.',
    bullets: ['Colis depuis la commande', 'Bons de ramassage et documents', 'Suivi des statuts transporteur'],
    content: [
      {
        heading: 'Préparez les colis avec les bonnes informations',
        paragraphs: [
          'Depuis une commande éligible, renseignez les informations nécessaires au transporteur connecté. jisra vérifie notamment la ville de livraison et la configuration de la boutique d’expédition ; les informations manquantes doivent être corrigées avant de créer le colis.',
        ],
      },
      {
        heading: 'Bons de ramassage et étiquettes',
        level: 3,
        paragraphs: [
          'Selon le transporteur configuré, regroupez les colis dans un bon de ramassage et accédez aux documents d’expédition disponibles.',
        ],
      },
      {
        heading: 'Consultez la progression des expéditions',
        paragraphs: [
          'Les statuts transmis par les transporteurs pris en charge peuvent être rapprochés de vos commandes. Une synchronisation ou un statut non reconnu demande une vérification : jisra ne remplace pas le suivi fourni par le transporteur.',
        ],
        links: [
          { href: '/features/ventes', label: 'Partir des commandes' },
          { href: '/features/stock', label: 'Suivre les articles' },
        ],
      },
    ],
  },
  {
    slug: 'stock',
    title: 'Stock & inventaire',
    description:
      'Consultez le stock de vos produits et variantes, enregistrez les entrées et ajustements et retrouvez l’historique des mouvements dans jisra.',
    image: '/marketing/feature-stock.webp',
    seoTitle: 'Gestion de stock e-commerce au Maroc',
    seoDescription:
      'Consultez le stock de vos produits et variantes, enregistrez les entrées et ajustements et retrouvez l’historique des mouvements dans jisra.',
    h1: 'Suivez le stock de vos produits et variantes',
    heroDescription:
      'Consultez les quantités suivies par produit ou variante, enregistrez les entrées et ajustements et retrouvez l’historique des mouvements.',
    valueText:
      'Les quantités suivies, les entrées et les ajustements restent consultables dans l’historique des mouvements.',
    bullets: ['Stock par produit et variante', 'Entrées et ajustements', 'Historique des mouvements'],
    content: [
      {
        heading: 'Une lecture du stock par produit ou variante',
        paragraphs: [
          'Retrouvez vos références et leurs variantes pour consulter les quantités suivies dans jisra. Le mode de suivi dépend de la configuration du produit.',
        ],
      },
      {
        heading: 'Enregistrez les entrées et les ajustements',
        level: 3,
        paragraphs: [
          'Saisissez un mouvement de stock ou enregistrez un achat fournisseur depuis l’espace stock. Les mouvements associés aux commandes sont distingués des ajustements manuels dans le parcours de gestion.',
        ],
      },
      {
        heading: 'Retrouvez l’historique des mouvements',
        paragraphs: [
          'Consultez les opérations enregistrées pour comprendre l’évolution des quantités et vérifier les corrections nécessaires. Une quantité suivie dans jisra dépend des mouvements et des données effectivement renseignés.',
        ],
        links: [
          { href: '/features/ventes', label: 'Relier le stock aux commandes' },
          { href: '/features/livraison', label: 'Préparer l’expédition' },
        ],
      },
    ],
  },
  {
    slug: 'assistant-ia',
    title: 'Assistant IA',
    description: 'Posez des questions business en français et obtenez des réponses exploitables.',
    image: '/marketing/feature-ai.webp',
    bullets: ['Questions en français', 'Réponses actionnables', 'Connecté aux vraies données'],
  },
  {
    slug: 'multi-stores',
    title: 'Multi-stores',
    description: 'Pilotez plusieurs boutiques et devises dans une seule interface consolidée.',
    image: '/marketing/feature-multistore.webp',
    bullets: ['Vue consolidée', 'Navigation par store', 'Croissance sans fragmentation'],
  },
]