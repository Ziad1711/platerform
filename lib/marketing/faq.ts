export type PublicFaqItem = { question: string; answer: string }

export type FaqLink = { href: string; label: string }

export type FaqCategory = {
  id: string
  label: string
  description: string
  order: number
}

export type FaqQuestion = {
  /** Identifiant stable : jamais régénéré, utilisé comme ancre. */
  id: string
  categoryId: string
  question: string
  answer: string
  keywords: string[]
  links?: FaqLink[]
  popular?: boolean
  published: boolean
  /** Date de dernière vérification éditoriale (ISO). */
  lastReviewed: string
  /** Source officielle de l'information. */
  source: string
}

const REVIEWED = '2026-11-14'
const SOURCE_PRODUCT = 'Documentation produit et pages publiques Jisra'
const SOURCE_CATALOG = 'Catalogue public des offres (/pricing)'
const SOURCE_INTEGRATIONS = 'Catalogue public des intégrations (/catalogue-integrations)'

/** 11 catégories publiques, ordre d'affichage. */
export const faqCategories: FaqCategory[] = [
  { id: 'decouvrir', label: 'Découvrir Jisra', description: 'La plateforme, son périmètre et le marché couvert.', order: 1 },
  { id: 'inscription', label: 'Inscription & premiers pas', description: 'Créer un compte et démarrer sans blocage.', order: 2 },
  { id: 'forfaits', label: 'Forfaits & tarifs', description: 'Offres, quotas, paiement et facturation.', order: 3 },
  { id: 'commandes', label: 'Commandes & confirmation', description: 'Réception des ventes, confirmations et statuts.', order: 4 },
  { id: 'livraison', label: 'Livraison & transporteurs', description: 'Colis, suivi, bons de ramassage et étiquettes.', order: 5 },
  { id: 'stock', label: 'Stock, produits & fournisseurs', description: 'Variantes, mouvements de stock et achats.', order: 6 },
  { id: 'publicite', label: 'Publicité & rentabilité', description: 'Dépenses Meta, indicateurs et profit net.', order: 7 },
  { id: 'assistant', label: 'Assistant IA & crédits', description: 'Assistant business, crédits et limites.', order: 8 },
  { id: 'integrations', label: 'Intégrations & API', description: 'Boutiques, transporteurs et accès API.', order: 9 },
  { id: 'securite', label: 'Sécurité, confidentialité & permissions', description: 'Isolation des données, rôles et démarches.', order: 10 },
  { id: 'assistance', label: 'Facturation & assistance', description: 'Contact, support et questions non résolues.', order: 11 },
]

export const faqQuestions: FaqQuestion[] = [
  // ── Découvrir Jisra ─────────────────────────────────────────────
  {
    id: 'quest-ce-que-jisra',
    categoryId: 'decouvrir',
    question: 'Qu’est-ce que Jisra ?',
    answer:
      'Jisra est un ERP SaaS conçu pour les e-commerçants marocains. Il réunit dans une seule interface les commandes, le stock, la publicité, la livraison, les dépenses et le calcul du profit net.',
    keywords: ['jisra', 'erp', 'saas', 'plateforme', 'c’est quoi', 'présentation', 'logiciel'],
    links: [{ href: '/features', label: 'Voir les fonctionnalités' }, { href: '/pricing', label: 'Voir les offres' }],
    popular: true,
    published: true,
    lastReviewed: REVIEWED,
    source: SOURCE_PRODUCT,
  },
  {
    id: 'jisra-maroc',
    categoryId: 'decouvrir',
    question: 'Jisra est-il conçu pour le Maroc ?',
    answer:
      'Oui. Le produit est pensé pour les e-commerçants marocains : français, MAD, workflows de confirmation et sociétés de livraison locales.',
    keywords: ['maroc', 'marché', 'mad', 'dirham', 'français', 'local', 'confirmation'],
    published: true,
    lastReviewed: REVIEWED,
    source: SOURCE_PRODUCT,
  },
  {
    id: 'jisra-excel',
    categoryId: 'decouvrir',
    question: 'Jisra remplace-t-il mes tableaux Excel ?',
    answer:
      'Oui. L’objectif est de centraliser commandes, coûts, livraison, stock et rentabilité dans une seule interface.',
    keywords: ['excel', 'tableur', 'remplacer', 'centraliser', 'tableaux', 'fichier'],
    published: true,
    lastReviewed: REVIEWED,
    source: SOURCE_PRODUCT,
  },
  {
    id: 'modules-inclus',
    categoryId: 'decouvrir',
    question: 'Quels modules sont inclus dans Jisra ?',
    answer:
      'Jisra regroupe neuf modules : ventes et commandes, produits et variantes, stock et inventaire, fournisseurs et ledger, publicité et ROI, dépenses, livraison, personnel et commissions, ainsi que l’assistant IA connecté à vos données.',
    keywords: ['modules', 'fonctionnalités', 'ventes', 'produits', 'stock', 'publicité', 'dépenses', 'livraison', 'personnel'],
    links: [{ href: '/features', label: 'Détail des fonctionnalités' }],
    published: true,
    lastReviewed: REVIEWED,
    source: SOURCE_PRODUCT,
  },
  {
    id: 'boutiques-connectables',
    categoryId: 'decouvrir',
    question: 'Quelles boutiques puis-je connecter ?',
    answer:
      'YouCan et LightFunnels disposent d’une connexion native. Shopify est annoncé comme une intégration à venir. La liste à jour est affichée sur le catalogue public des intégrations.',
    keywords: ['boutiques', 'youcan', 'lightfunnels', 'shopify', 'store', 'connexion'],
    links: [{ href: '/catalogue-integrations', label: 'Voir les intégrations' }],
    published: true,
    lastReviewed: REVIEWED,
    source: SOURCE_INTEGRATIONS,
  },
  {
    id: 'multi-devises',
    categoryId: 'decouvrir',
    question: 'Jisra gère-t-il plusieurs devises ?',
    answer:
      'Oui. Le MAD est pris en charge nativement et des taux de change permettent une lecture consolidée lorsque plusieurs devises sont utilisées.',
    keywords: ['devise', 'devises', 'mad', 'currency', 'change', 'conversion'],
    published: true,
    lastReviewed: REVIEWED,
    source: SOURCE_PRODUCT,
  },
  // ── Inscription & premiers pas ──────────────────────────────────
  {
    id: 'creer-compte',
    categoryId: 'inscription',
    question: 'Comment créer un compte ?',
    answer:
      'Rendez-vous sur la page d’inscription, renseignez vos informations et validez. À la première connexion, Jisra propose de créer votre première boutique.',
    keywords: ['inscription', 'compte', 'signup', 'créer', 'enregistrer', 's’inscrire'],
    links: [{ href: '/signup', label: 'Créer un compte' }],
    popular: true,
    published: true,
    lastReviewed: REVIEWED,
    source: SOURCE_PRODUCT,
  },
  {
    id: 'gratuit-evoluer',
    categoryId: 'inscription',
    question: 'Puis-je commencer gratuitement puis évoluer ?',
    answer:
      'Le compte Free est gratuit et sans engagement. Pour une offre payante, vous pouvez préparer une demande depuis /subscribe ; l’activation intervient après vérification du paiement par virement. Le paiement en ligne n’est pas disponible.',
    keywords: ['gratuit', 'free', 'essai', 'évoluer', 'abonnement', 'souscrire', 'virement'],
    links: [{ href: '/pricing', label: 'Voir les offres' }, { href: '/subscribe', label: 'Récapitulatif de souscription' }],
    popular: true,
    published: true,
    lastReviewed: REVIEWED,
    source: SOURCE_CATALOG,
  },
  {
    id: 'integrations-debut',
    categoryId: 'inscription',
    question: 'Dois-je connecter mes intégrations dès le début ?',
    answer:
      'Non. Vous pouvez démarrer progressivement, puis brancher vos boutiques et vos sources de dépenses quand vous êtes prêt.',
    keywords: ['intégrations', 'début', 'progressif', 'connecter', 'plus tard'],
    published: true,
    lastReviewed: REVIEWED,
    source: SOURCE_PRODUCT,
  },
  {
    id: 'premiers-pas',
    categoryId: 'inscription',
    question: 'Par où commencer après la création du compte ?',
    answer:
      'Créez votre boutique, ajoutez vos produits et commencez à saisir ou importer vos commandes. Vous pouvez brancher ensuite vos intégrations et vos sources de dépenses, sans tout configurer le premier jour.',
    keywords: ['débuter', 'commencer', 'premiers pas', 'onboarding', 'boutique', 'produits'],
    links: [{ href: '/features/ventes', label: 'Gérer les commandes' }],
    published: true,
    lastReviewed: REVIEWED,
    source: SOURCE_PRODUCT,
  },
  // ── Forfaits & tarifs ───────────────────────────────────────────
  {
    id: 'tarifs-officiels',
    categoryId: 'forfaits',
    question: 'Où consulter les tarifs officiels ?',
    answer:
      'Les montants, la durée et les droits de chaque offre sont affichés sur la page Tarifs, alimentée par le catalogue public. C’est la seule source officielle pour les prix et les quotas.',
    keywords: ['tarifs', 'prix', 'offres', 'catalogue', 'montant', 'combien', 'coût'],
    links: [{ href: '/pricing', label: 'Voir les tarifs' }],
    popular: true,
    published: true,
    lastReviewed: REVIEWED,
    source: SOURCE_CATALOG,
  },
  {
    id: 'multi-boutiques',
    categoryId: 'forfaits',
    question: 'Puis-je gérer plusieurs boutiques ?',
    answer:
      'Oui. Le nombre de boutiques dépend de l’offre : il est indiqué dans le tableau de comparaison des tarifs.',
    keywords: ['boutiques', 'stores', 'multi-boutiques', 'plusieurs', 'nombre'],
    links: [{ href: '/pricing', label: 'Comparer les offres' }],
    published: true,
    lastReviewed: REVIEWED,
    source: SOURCE_CATALOG,
  },
  {
    id: 'paiement-offre',
    categoryId: 'forfaits',
    question: 'Comment se passe le paiement d’une offre payante ?',
    answer:
      'Le paiement se fait par virement bancaire, puis l’équipe Jisra vérifie le règlement. Un justificatif seul n’active jamais un abonnement ; le paiement en ligne n’est pas disponible.',
    keywords: ['paiement', 'virement', 'règlement', 'activation', 'justificatif', 'banque'],
    links: [{ href: '/subscribe', label: 'Récapitulatif de souscription' }],
    popular: true,
    published: true,
    lastReviewed: REVIEWED,
    source: SOURCE_CATALOG,
  },
  {
    id: 'annuel',
    categoryId: 'forfaits',
    question: 'L’abonnement annuel est-il prélevé chaque mois ?',
    answer:
      'Non. L’annuel est payé en une seule fois pour 12 mois, sans prélèvement mensuel automatique.',
    keywords: ['annuel', 'année', '12 mois', 'prélèvement', 'mensuel'],
    published: true,
    lastReviewed: REVIEWED,
    source: SOURCE_CATALOG,
  },
  {
    id: 'credits-ia',
    categoryId: 'forfaits',
    question: 'Qu’est-ce que les crédits IA ?',
    answer:
      'Les crédits IA correspondent à l’usage de l’assistant intelligent de Jisra. Chaque offre inclut un quota mensuel indiqué dans le tableau de comparaison.',
    keywords: ['crédits', 'ia', 'assistant', 'quota', 'usage', 'intelligence artificielle'],
    links: [{ href: '/pricing', label: 'Voir les quotas' }],
    published: true,
    lastReviewed: REVIEWED,
    source: SOURCE_CATALOG,
  },
  {
    id: 'transporteurs-inclus',
    categoryId: 'forfaits',
    question: 'Les transporteurs sont-ils inclus dans toutes les offres ?',
    answer:
      'Non. Les intégrations transporteurs disponibles sont listées sur /catalogue-integrations, mais le nombre inclus dépend de l’offre (colonne « Intégrations livraison »). Une intégration disponible dans Jisra n’est pas nécessairement incluse dans chaque offre.',
    keywords: ['transporteurs', 'livraison', 'inclus', 'offres', 'intégrations'],
    links: [{ href: '/catalogue-integrations', label: 'Voir les transporteurs' }, { href: '/pricing', label: 'Comparer les offres' }],
    published: true,
    lastReviewed: REVIEWED,
    source: SOURCE_CATALOG,
  },
  {
    id: 'quotas-offres',
    categoryId: 'forfaits',
    question: 'Quels quotas distinguent les offres ?',
    answer:
      'Les offres se distinguent par le nombre de commandes par mois, le nombre de boutiques, les crédits assistant IA, les intégrations livraison, les agents de confirmation, l’automatisation Facebook Ads et l’accès API. Les valeurs exactes figurent sur /pricing.',
    keywords: ['quotas', 'limites', 'offres', 'commandes', 'boutiques', 'agents', 'api'],
    links: [{ href: '/pricing', label: 'Tableau comparatif' }],
    published: true,
    lastReviewed: REVIEWED,
    source: SOURCE_CATALOG,
  },
  {
    id: 'choisir-offre',
    categoryId: 'forfaits',
    question: 'Comment choisir mon offre ?',
    answer:
      'Comparez d’abord votre volume de commandes, le nombre de boutiques et vos besoins en assistant IA, livraison et API. Le tableau de la page Tarifs indique les droits de chaque offre ; l’équipe peut vous aider si le choix reste ouvert.',
    keywords: ['choisir', 'offre', 'adaptée', 'quedl', 'comparer', 'volume'],
    links: [{ href: '/pricing', label: 'Comparer les offres' }, { href: '/contact', label: 'Contacter l’équipe' }],
    published: true,
    lastReviewed: REVIEWED,
    source: SOURCE_CATALOG,
  },
  // ── Commandes & confirmation ────────────────────────────────────
  {
    id: 'recevoir-commandes',
    categoryId: 'commandes',
    question: 'Comment recevoir mes commandes dans Jisra ?',
    answer:
      'Vous pouvez saisir les commandes manuellement, les importer par fichier CSV ou recevoir celles de vos boutiques connectées YouCan et LightFunnels. Les informations client, les articles et le statut restent consultables dans l’espace Ventes.',
    keywords: ['commandes', 'recevoir', 'csv', 'import', 'saisie', 'youcan', 'lightfunnels'],
    links: [{ href: '/features/ventes', label: 'Gérer les commandes' }],
    popular: true,
    published: true,
    lastReviewed: REVIEWED,
    source: SOURCE_PRODUCT,
  },
  {
    id: 'agent-confirmation',
    categoryId: 'commandes',
    question: 'Qu’est-ce qu’un agent de confirmation ?',
    answer:
      'C’est un membre de l’équipe chargé de traiter les commandes à confirmer et de mettre à jour leur statut. Les actions disponibles dépendent du rôle qui lui est attribué.',
    keywords: ['agent', 'confirmation', 'rôle', 'équipe', 'statut', 'traiter'],
    links: [{ href: '/features/ventes', label: 'Voir le flux de confirmation' }],
    published: true,
    lastReviewed: REVIEWED,
    source: SOURCE_PRODUCT,
  },
  {
    id: 'statuts-commande',
    categoryId: 'commandes',
    question: 'Puis-je suivre et mettre à jour le statut de mes commandes ?',
    answer:
      'Oui. Les commandes disposent d’un statut consultable et modifiable selon les permissions de votre rôle. Les commandes à traiter et les confirmations sont regroupées dans le parcours de gestion.',
    keywords: ['statut', 'suivre', 'mettre à jour', 'commandes', 'confirmation'],
    published: true,
    lastReviewed: REVIEWED,
    source: SOURCE_PRODUCT,
  },
  // ── Livraison & transporteurs ───────────────────────────────────
  {
    id: 'transporteurs-disponibles',
    categoryId: 'livraison',
    question: 'Quels transporteurs sont disponibles ?',
    answer:
      'Jisra prend en charge plusieurs sociétés de livraison marocaines, notamment Rapid Delivery, digylog, forcelog, sendit, ameex, OZONE, Rushliv et Maroc Go. La liste à jour et le statut de chaque intégration figurent sur le catalogue public.',
    keywords: ['transporteurs', 'livraison', 'rapid delivery', 'digylog', 'forcelog', 'sendit', 'ameex', 'ozone', 'rushliv', 'maroc go'],
    links: [{ href: '/catalogue-integrations', label: 'Voir le catalogue' }],
    popular: true,
    published: true,
    lastReviewed: REVIEWED,
    source: SOURCE_INTEGRATIONS,
  },
  {
    id: 'creer-colis',
    categoryId: 'livraison',
    question: 'Comment créer un colis ?',
    answer:
      'Pour un transporteur configuré, vous pouvez créer un colis depuis Jisra. Un numéro de suivi est renseigné lorsque l’API du transporteur le renvoie.',
    keywords: ['colis', 'créer', 'expédition', 'suivi', 'numéro', 'transporteur'],
    links: [{ href: '/features/livraison', label: 'Gérer les livraisons' }],
    published: true,
    lastReviewed: REVIEWED,
    source: SOURCE_PRODUCT,
  },
  {
    id: 'suivi-transporteur',
    categoryId: 'livraison',
    question: 'Le suivi Jisra remplace-t-il celui du transporteur ?',
    answer:
      'Non. Les statuts transmis par les transporteurs pris en charge peuvent être rapprochés de vos commandes, mais Jisra ne remplace pas le suivi fourni par le transporteur. Une synchronisation ou un statut non reconnu demande une vérification.',
    keywords: ['suivi', 'tracking', 'transporteur', 'statut', 'remplacer'],
    links: [{ href: '/features/livraison', label: 'Comprendre le suivi' }],
    published: true,
    lastReviewed: REVIEWED,
    source: SOURCE_PRODUCT,
  },
  {
    id: 'bons-ramassage',
    categoryId: 'livraison',
    question: 'Que sont les bons de ramassage et les étiquettes ?',
    answer:
      'Selon le transporteur configuré, vous pouvez regrouper vos colis dans un bon de ramassage et accéder aux documents d’expédition disponibles, comme les étiquettes.',
    keywords: ['bon de ramassage', 'étiquettes', 'labels', 'ramassage', 'documents'],
    links: [{ href: '/features/livraison', label: 'Voir les expéditions' }],
    published: true,
    lastReviewed: REVIEWED,
    source: SOURCE_PRODUCT,
  },
  // ── Stock, produits & fournisseurs ──────────────────────────────
  {
    id: 'suivi-stock',
    categoryId: 'stock',
    question: 'Comment suivre mon stock ?',
    answer:
      'Les quantités sont suivies par produit ou par variante. Vous enregistrez les entrées, les ajustements et les mouvements liés aux commandes, puis retrouvez l’historique des mouvements.',
    keywords: ['stock', 'inventaire', 'quantité', 'mouvement', 'ajustement', 'entrée'],
    links: [{ href: '/features/stock', label: 'Gérer le stock' }],
    popular: true,
    published: true,
    lastReviewed: REVIEWED,
    source: SOURCE_PRODUCT,
  },
  {
    id: 'variantes-produits',
    categoryId: 'stock',
    question: 'Puis-je gérer des variantes de produits ?',
    answer:
      'Oui. Les produits peuvent être déclinés en variantes, chacune disposant de ses propres valeurs d’options et de son suivi.',
    keywords: ['variantes', 'produits', 'sku', 'options', 'déclinaison', 'taille', 'couleur'],
    links: [{ href: '/features/stock', label: 'Voir les produits et variantes' }],
    published: true,
    lastReviewed: REVIEWED,
    source: SOURCE_PRODUCT,
  },
  {
    id: 'fournisseurs',
    categoryId: 'stock',
    question: 'Comment gérer mes fournisseurs et mes achats ?',
    answer:
      'Le module fournisseurs tient un ledger des achats et des paiements. Les achats fournisseur peuvent alimenter le stock, puis être retrouvés dans l’historique des mouvements.',
    keywords: ['fournisseurs', 'achats', 'ledger', 'paiements', 'approvisionnement'],
    links: [{ href: '/features/stock', label: 'Voir le stock lié aux achats' }],
    published: true,
    lastReviewed: REVIEWED,
    source: SOURCE_PRODUCT,
  },
  // ── Publicité & rentabilité ─────────────────────────────────────
  {
    id: 'depenses-ads',
    categoryId: 'publicite',
    question: 'Comment suivre mes dépenses Facebook Ads ?',
    answer:
      'Vous pouvez importer ou saisir les dépenses publicitaires, puis consulter les indicateurs calculés sur la période choisie. Les coûts peuvent être rapprochés des produits et des commandes selon les données disponibles.',
    keywords: ['facebook ads', 'meta', 'publicité', 'dépenses', 'ads', 'roas', 'import'],
    links: [{ href: '/features/publicite', label: 'Voir la publicité et le ROI' }],
    popular: true,
    published: true,
    lastReviewed: REVIEWED,
    source: SOURCE_PRODUCT,
  },
  {
    id: 'profit-net',
    categoryId: 'publicite',
    question: 'Comment est calculé le vrai profit ?',
    answer:
      'Jisra combine revenus, coût produit, coûts publicitaires, livraison et coûts opérationnels pour calculer la rentabilité par commande.',
    keywords: ['profit', 'rentabilité', 'marge', 'coût', 'revenus', 'vrai profit'],
    links: [{ href: '/features/publicite', label: 'Comprendre le calcul' }],
    published: true,
    lastReviewed: REVIEWED,
    source: SOURCE_PRODUCT,
  },
  // ── Assistant IA & crédits ──────────────────────────────────────
  {
    id: 'assistant-ia',
    categoryId: 'assistant',
    question: 'Qu’est-ce que l’assistant IA de Jisra ?',
    answer:
      'C’est un assistant connecté à vos données qui répond en français à vos questions business. Les réponses s’appuient sur les données de votre espace ; l’accès dépend de votre offre et de vos crédits.',
    keywords: ['assistant', 'ia', 'intelligence artificielle', 'questions', 'business', 'copilote'],
    links: [{ href: '/features/assistant-ia', label: 'Découvrir l’assistant IA' }],
    published: true,
    lastReviewed: REVIEWED,
    source: SOURCE_PRODUCT,
  },
  {
    id: 'assistant-donnees',
    categoryId: 'assistant',
    question: 'L’assistant public accède-t-il à mes données privées ?',
    answer:
      'Non. L’assistant public de la page commerciale n’a accès ni aux commandes, ni aux boutiques, ni aux données privées. Il répond uniquement sur les offres, les fonctionnalités et l’inscription.',
    keywords: ['assistant', 'données', 'privées', 'sécurité', 'confidentialité', 'accès'],
    popular: true,
    published: true,
    lastReviewed: REVIEWED,
    source: SOURCE_PRODUCT,
  },
  // ── Intégrations & API ──────────────────────────────────────────
  {
    id: 'liste-integrations',
    categoryId: 'integrations',
    question: 'Où voir la liste des intégrations ?',
    answer:
      'Le catalogue public des intégrations présente les boutiques, transporteurs et outils connectables, avec leur statut de disponibilité.',
    keywords: ['intégrations', 'catalogue', 'liste', 'boutiques', 'transporteurs', 'outils'],
    links: [{ href: '/catalogue-integrations', label: 'Voir le catalogue' }],
    published: true,
    lastReviewed: REVIEWED,
    source: SOURCE_INTEGRATIONS,
  },
  {
    id: 'disponible-inclus',
    categoryId: 'integrations',
    question: 'Une intégration « disponible » est-elle incluse dans toutes les offres ?',
    answer:
      'Non. « Disponible » décrit le produit Jisra. Pour les transporteurs, le nombre inclus dépend du quota « intégrations livraison » de votre offre. Une intégration disponible n’est pas nécessairement incluse dans chaque offre.',
    keywords: ['disponible', 'inclus', 'offre', 'intégration', 'transporteur', 'quota'],
    links: [{ href: '/pricing', label: 'Voir les quotas' }],
    published: true,
    lastReviewed: REVIEWED,
    source: SOURCE_CATALOG,
  },
  {
    id: 'api',
    categoryId: 'integrations',
    question: 'Puis-je utiliser une API ?',
    answer:
      'L’accès API dépend de votre offre : la ligne « Accès API » du tableau comparatif indique s’il est inclus. La documentation publique décrit les points d’entrée disponibles.',
    keywords: ['api', 'documentation', 'développeur', 'accès', 'intégration'],
    links: [{ href: '/documentation', label: 'Documentation API' }, { href: '/pricing', label: 'Voir les offres' }],
    published: true,
    lastReviewed: REVIEWED,
    source: SOURCE_CATALOG,
  },
  // ── Sécurité, confidentialité & permissions ─────────────────────
  {
    id: 'isolation-donnees',
    categoryId: 'securite',
    question: 'Mes données sont-elles isolées entre boutiques ?',
    answer:
      'Oui. L’architecture est multi-tenant : les données sont rattachées à une boutique et l’accès est contrôlé par vos appartenances et vos rôles.',
    keywords: ['données', 'isolation', 'sécurité', 'multi-boutiques', 'tenant', 'accès'],
    published: true,
    lastReviewed: REVIEWED,
    source: SOURCE_PRODUCT,
  },
  {
    id: 'roles-permissions',
    categoryId: 'securite',
    question: 'Puis-je gérer les rôles de mon équipe ?',
    answer:
      'Oui. Les rôles disponibles couvrent le propriétaire, l’administrateur, le membre opérationnel et l’agent de confirmation. Chaque rôle dispose de permissions adaptées à ses tâches.',
    keywords: ['rôles', 'permissions', 'équipe', 'admin', 'propriétaire', 'agent'],
    links: [{ href: '/features', label: 'Voir les fonctionnalités' }],
    published: true,
    lastReviewed: REVIEWED,
    source: SOURCE_PRODUCT,
  },
  {
    id: 'suppression-donnees',
    categoryId: 'securite',
    question: 'Comment demander la suppression de mes données ?',
    answer:
      'La démarche est décrite sur la page dédiée à la suppression des données. Vous pouvez aussi contacter l’équipe pour être accompagné.',
    keywords: ['suppression', 'données', 'rgpd', 'effacer', 'compte', 'confidentialité'],
    links: [{ href: '/legal/suppression-des-donnees', label: 'Suppression des données' }],
    published: true,
    lastReviewed: REVIEWED,
    source: SOURCE_PRODUCT,
  },
  {
    id: 'confidentialite',
    categoryId: 'securite',
    question: 'Où sont les conditions et la politique de confidentialité ?',
    answer:
      'Les conditions d’utilisation, la politique de confidentialité et les mentions légales sont accessibles depuis le pied de page du site.',
    keywords: ['conditions', 'confidentialité', 'mentions légales', 'cgv', 'politique'],
    links: [
      { href: '/legal/conditions', label: 'Conditions' },
      { href: '/legal/confidentialite', label: 'Confidentialité' },
      { href: '/legal/mentions', label: 'Mentions légales' },
    ],
    published: true,
    lastReviewed: REVIEWED,
    source: SOURCE_PRODUCT,
  },
  // ── Facturation & assistance ────────────────────────────────────
  {
    id: 'contacter-equipe',
    categoryId: 'assistance',
    question: 'Comment contacter l’équipe Jisra ?',
    answer:
      'Vous pouvez écrire à contact@jisra.io ou utiliser la page Contact. Décrivez votre boutique, votre volume mensuel et vos outils actuels pour obtenir une réponse utile.',
    keywords: ['contact', 'équipe', 'support', 'email', 'aide', 'assistance'],
    links: [{ href: '/contact', label: 'Page contact' }],
    popular: true,
    published: true,
    lastReviewed: REVIEWED,
    source: SOURCE_PRODUCT,
  },
  {
    id: 'proposer-question',
    categoryId: 'assistance',
    question: 'Je ne trouve pas ma réponse, que faire ?',
    answer:
      'Vous pouvez proposer votre question depuis cette page. Elle est enregistrée pour examen par l’équipe Jisra ; aucune réponse n’est publiée automatiquement. En attendant, la page Contact reste disponible.',
    keywords: ['question', 'proposer', 'réponse', 'introuvable', 'suggestion', 'aide'],
    links: [{ href: '/contact', label: 'Contacter l’équipe' }],
    published: true,
    lastReviewed: REVIEWED,
    source: SOURCE_PRODUCT,
  },
]

/** Questions publiées uniquement. */
export const publishedFaqQuestions: FaqQuestion[] = faqQuestions.filter((q) => q.published)

export function getFaqByCategory(categoryId: string): FaqQuestion[] {
  return publishedFaqQuestions.filter((q) => q.categoryId === categoryId)
}

export function getPopularFaqQuestions(): FaqQuestion[] {
  return publishedFaqQuestions.filter((q) => q.popular)
}

export function getFaqQuestion(id: string): FaqQuestion | undefined {
  return publishedFaqQuestions.find((q) => q.id === id)
}

/** Normalisation accents/casse pour la recherche. */
function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/** Recherche légère : question, mots-clés et réponse. */
export function searchFaq(query: string): FaqQuestion[] {
  const term = normalize(query.trim())
  if (!term) return []
  return publishedFaqQuestions.filter((q) => {
    const haystack = normalize([q.question, q.keywords.join(' '), q.answer].join(' '))
    return haystack.includes(term)
  })
}

/** FAQ conservée sur /pricing (source unique). */
const PRICING_FAQ_IDS = ['jisra-maroc', 'jisra-excel', 'gratuit-evoluer', 'multi-boutiques', 'profit-net', 'integrations-debut', 'credits-ia', 'transporteurs-inclus', 'paiement-offre', 'annuel']

export const pricingFaqItems: PublicFaqItem[] = PRICING_FAQ_IDS
  .map((id) => getFaqQuestion(id))
  .filter((q): q is FaqQuestion => Boolean(q))
  .map(({ question, answer }) => ({ question, answer }))

/** FAQ courte affichée sur la page d'accueil (source unique). */
const HOME_FAQ_IDS = ['jisra-maroc', 'quest-ce-que-jisra', 'gratuit-evoluer', 'profit-net', 'assistant-donnees']

export const homeFaqItems: PublicFaqItem[] = HOME_FAQ_IDS
  .map((id) => getFaqQuestion(id))
  .filter((q): q is FaqQuestion => Boolean(q))
  .map(({ question, answer }) => ({ question, answer }))

/** Index compact pour l'assistant : sujets par catégorie, sans réponses complètes. */
export const faqAssistantTopics: { category: string; questions: string[] }[] = faqCategories
  .slice()
  .sort((a, b) => a.order - b.order)
  .map((category) => ({
    category: category.label,
    questions: getFaqByCategory(category.id).map((q) => q.question),
  }))
  .filter((entry) => entry.questions.length > 0)
