export type PublicAssistantLink = { href: string; label: string }
export type PublicAssistantRoute = PublicAssistantLink & { keywords: string[] }

/**
 * Routes publiques autorisées dans le chatbot. Elles restent accessibles même
 * si le catalogue des prix est momentanément indisponible.
 * Aucun autre href ne doit être rendu comme lien.
 */
export const PUBLIC_ASSISTANT_ROUTES: PublicAssistantRoute[] = [
  {
    href: '/pricing',
    label: 'Voir les tarifs',
    keywords: ['pricing', 'price', 'plans', 'cost', 'tarif', 'forfait', 'combien', 'coûte', 'coute', 'coût', 'cout', 'الأسعار', 'السعر', 'الثمن', 'الأثمنة', 'بشحال', 'taman', 'ch7al'],
  },
  {
    href: '/signup',
    label: 'Créer un compte',
    keywords: ['signup', 'sign up', 'inscri', 'register', 'create account', 'التسجيل', 'حساب', 'nsjel', 'nsejjel'],
  },
  {
    href: '/login',
    label: 'Se connecter',
    keywords: ['login', 'sign in', 'connexion', 'se connecter', 'الدخول', 'تسجيل الدخول'],
  },
  {
    href: '/subscribe',
    label: 'Récapitulatif de souscription',
    keywords: ['subscribe', 'subscription', 'souscription', 'récapitulatif', 'recapitulatif', 'الاشتراك'],
  },
  {
    href: '/contact',
    label: 'Contact',
    keywords: ['contact', 'تواصل', 'الاتصال'],
  },
  {
    href: '/catalogue-integrations',
    label: 'Intégrations',
    keywords: ['integration', 'intégration', 'transporteur', 'carrier', 'التكاملات', 'التوصيل'],
  },
  {
    href: '/faq',
    label: 'Questions fréquentes',
    keywords: ['faq', 'question', 'questions', 'aide', 'help', 'أسئلة', 'مساعدة'],
  },
  {
    href: '/features',
    label: 'Fonctionnalités',
    keywords: ['fonctionnalite', 'fonctionnalité', 'features', 'module', 'الميزات', 'الوظائف'],
  },
  {
    href: '/documentation',
    label: 'Documentation API',
    keywords: ['documentation', 'api documentation', 'documentation api', 'التوثيق'],
  },
]

function normalize(value: string) {
  return value
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\u064b-\u0652\u0670\u0640]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Liens réellement mentionnés (route exacte ou mot-clé), limités à 3. */
export function linksFromReply(reply: string, max = 3): PublicAssistantLink[] {
  const text = normalize(reply)
  const links: PublicAssistantLink[] = []
  for (const route of PUBLIC_ASSISTANT_ROUTES) {
    const matched = text.includes(normalize(route.href))
      || route.keywords.some((keyword) => text.includes(normalize(keyword)))
    if (!matched) continue
    links.push({ href: route.href, label: route.label })
    if (links.length >= max) break
  }
  return links
}

export function isPublicAssistantHref(href: string) {
  return PUBLIC_ASSISTANT_ROUTES.some((route) => route.href === href)
}
