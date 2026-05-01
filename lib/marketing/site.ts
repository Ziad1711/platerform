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
  { value: '5 min', label: 'pour connecter un store' },
  { value: '24/7', label: 'lecture de la rentabilité réelle' },
]

export const logoMarquee = [
  'YouCan',
  'Shopify',
  'LightFunnels',
  'Meta',
  'Rapid Delivery',
  'Multi-stores',
  'Profit Net',
  'MAD Native',
]

export const automations = [
  'Synchronisation automatique des commandes depuis YouCan, Shopify et LightFunnels',
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
    status: 'Bientôt',
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

export const featurePages = [
  {
    slug: 'ventes',
    title: 'Ventes & commandes',
    description: 'Centralisez les commandes, statuts, confirmations et suivi opérationnel dans un seul flux.',
    image: '/marketing/feature-automation.webp',
    bullets: ['Commandes unifiées', 'Statuts fiables', 'Exécution plus rapide'],
  },
  {
    slug: 'publicite',
    title: 'Publicité & ROI',
    description: 'Mesurez le ROAS réel avec import Facebook Ads et allocation aux commandes.',
    image: '/marketing/feature-ads-profit.webp',
    bullets: ['Ads reliées au net', 'Allocation par commande', 'Lecture ROI exploitable'],
  },
  {
    slug: 'livraison',
    title: 'Livraison',
    description: 'Automatisez colis, bons de ramassage, étiquettes et suivi transporteur.',
    image: '/marketing/feature-delivery.webp',
    bullets: ['Colis automatisés', 'Suivi synchronisé', 'Workflow localisé Maroc'],
  },
  {
    slug: 'stock',
    title: 'Stock & inventaire',
    description: 'Suivez produits, variantes et mouvements de stock sans ruptures invisibles.',
    image: '/marketing/feature-stock.webp',
    bullets: ['Variantes cohérentes', 'Mouvements visibles', 'Moins de rupture cachée'],
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