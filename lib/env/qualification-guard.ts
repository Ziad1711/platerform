/**
 * Isolation de l'environnement de qualification Jisra.
 *
 * Objectif : rendre impossible, depuis un déploiement de qualification, toute
 * connexion à Supabase Cloud Production, tout usage des secrets de production
 * et tout appel à un fournisseur réel.
 *
 * Principes :
 * - Aucun impact lorsque `JISRA_QUALIFICATION` n'est pas `'1'` : la production
 *   conserve exactement son comportement actuel.
 * - En qualification, l'hôte Supabase doit appartenir à une liste blanche
 *   explicite (variable `JISRA_QUALIFICATION_SUPABASE_HOSTS`, sinon l'hôte
 *   auto-hébergé de référence).
 * - Toute anomalie lève `QualificationIsolationError` : le déploiement doit
 *   échouer bruyamment plutôt que fonctionner sur une cible interdite.
 */

export const PRODUCTION_PROJECT_REF = 'attvfeoqgbxsnnsllatt'
export const CLOUD_SUPABASE_SUFFIX = '.supabase.co'
/** Pile Q4 isolée (port 8443). */
export const LEGACY_Q4_HOST = 'supabase-qualif.jisra.io'
/** Seule cible autorisée en qualification, indépendamment de la liste blanche. */
export const DEFAULT_QUALIFICATION_HOST = 'supabase-qualif.jisra.io'
export const DEFAULT_QUALIFICATION_ORIGIN = 'https://supabase-qualif.jisra.io:8443'

export type SupabaseTargetKind =
  | 'production'
  | 'cloud-other'
  | 'qualification'
  | 'unknown'
  | 'missing'

export class QualificationIsolationError extends Error {
  readonly reason: string

  constructor(reason: string) {
    super(`QUALIFICATION_ISOLATION_DENIED: ${reason}`)
    this.name = 'QualificationIsolationError'
    this.reason = reason
  }
}

function hostOf(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null
  try {
    return new URL(rawUrl).hostname.toLowerCase()
  } catch {
    return null
  }
}

/** Hôte Supabase effectivement configuré (jamais la valeur de la clé). */
export function supabaseHost(): string | null {
  return hostOf(process.env.NEXT_PUBLIC_SUPABASE_URL)
}

/** Liste blanche des origines complètes autorisées en qualification. */
export function qualificationOrigins(): string[] {
  const raw = process.env.JISRA_QUALIFICATION_SUPABASE_ORIGINS
  const origins = (raw ? raw.split(',') : [])
    .map((o) => o.trim().toLowerCase().replace(/\/+$/, ''))
    .filter(Boolean)
  return origins.length > 0 ? origins : [DEFAULT_QUALIFICATION_ORIGIN]
}

/** Origine normalisée (protocole + hostname + port explicite). */
export function supabaseOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!raw) return null
  try {
    const u = new URL(raw)
    const port = u.port || (u.protocol === 'https:' ? '443' : '80')
    return `${u.protocol}//${u.hostname.toLowerCase()}:${port}`
  } catch {
    return null
  }
}

/** Production Q3 : toujours interdite en qualification. */
export const FORBIDDEN_ORIGINS: readonly string[] = ['https://supabase.jisra.io:443']

/** Nature de la cible Supabase configurée. */
export function supabaseTargetKind(): SupabaseTargetKind {
  const host = supabaseHost()
  const origin = supabaseOrigin()
  if (!host || !origin) return 'missing'
  if (host === 'supabase.jisra.io') return 'production'
  if (host === `${PRODUCTION_PROJECT_REF}${CLOUD_SUPABASE_SUFFIX}`) return 'production'
  if (host.endsWith(CLOUD_SUPABASE_SUFFIX)) return 'cloud-other'
  if (qualificationOrigins().includes(origin)) return 'qualification'
  return 'unknown'
}

/** Mode qualification explicitement déclaré par l'environnement. */
export function isQualificationMode(): boolean {
  return process.env.JISRA_QUALIFICATION === '1' || process.env.NEXT_PUBLIC_JISRA_QUALIFICATION === '1'
}

/**
 * Vérifie l'isolation. Sans effet en production ; lève en qualification si une
 * condition n'est pas respectée.
 */
export function assertQualificationIsolation(): void {
  if (!isQualificationMode()) return

  const host = supabaseHost()
  const origin = supabaseOrigin()
  if (!host || !origin) {
    throw new QualificationIsolationError('NEXT_PUBLIC_SUPABASE_URL absente ou invalide')
  }

  if (host.endsWith(CLOUD_SUPABASE_SUFFIX) || host === 'supabase.jisra.io') {
    throw new QualificationIsolationError(
      `hôte Supabase Cloud interdit en qualification (${host})`
    )
  }

  // Une liste blanche fournie par erreur ne peut jamais réautoriser Q3.
  if (FORBIDDEN_ORIGINS.includes(origin)) {
    throw new QualificationIsolationError(`origine Supabase interdite (${origin})`)
  }

  if (origin !== DEFAULT_QUALIFICATION_ORIGIN || !qualificationOrigins().includes(origin)) {
    throw new QualificationIsolationError(
      `origine Supabase hors liste blanche (${origin}) — autorisées : ${qualificationOrigins().join(', ')}`
    )
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new QualificationIsolationError('NEXT_PUBLIC_SUPABASE_ANON_KEY absente')
  }

  // Le secret de cron est un secret de production : sa présence en qualification
  // signifie qu'un secret de production a été copié dans cet environnement.
  if (process.env.CRON_SECRET) {
    throw new QualificationIsolationError('CRON_SECRET présent : secret de production interdit')
  }
  const externalSecrets = ['OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'ANTHROPIC_API_KEY',
    'YOUCAN_CLIENT_SECRET', 'FACEBOOK_APP_SECRET', 'JISRA_META_ADS_APP_SECRET', 'LIGHTFUNNELS_CLIENT_SECRET',
    'INTEGRATIONS_ENCRYPTION_KEY', 'META_CAPI_ACCESS_TOKEN', 'META_TEST_EVENT_CODE']
  if (externalSecrets.some((key) => process.env[key])) {
    throw new QualificationIsolationError('secret fournisseur interdit en qualification')
  }
}

/**
 * Routes interdites en qualification. Retourne le motif de blocage, ou null.
 * Les tâches planifiées et les intégrations fournisseurs sont neutralisées :
 * elles écriraient ou appelleraient des services réels.
 */
export function qualificationBlockedPath(pathname: string): string | null {
  if (!isQualificationMode()) return null
  const paymentRoute = pathname === '/api/billing/payment-requests'
    || /^\/api\/billing\/payment-requests\/[0-9a-f-]{36}(?:\/proofs)?$/i.test(pathname)
  const adminRoute = ['/api/admin/security', '/api/admin/payments', '/api/admin/bank-settings'].includes(pathname)
    || /^\/api\/admin\/payments\/[0-9a-f-]{36}$/i.test(pathname)
    || ['/api/admin/finance', '/api/admin/finance/export', '/api/admin/dashboard', '/api/admin/analytics', '/api/public-assistant/chat', '/api/public-assistant/contact'].includes(pathname)
    || /^\/api\/admin\/finance\/proofs\/[0-9a-f-]{36}$/i.test(pathname)
  if (pathname.startsWith('/api/') && pathname !== '/api/billing/catalog' && !adminRoute && !paymentRoute) return 'API hors facturation desactivee en qualification'
  // Finalisation locale d'une session Q4 : aucun callback fournisseur autorisé.
  if (pathname.startsWith('/auth/') && pathname !== '/auth/finish') return 'callbacks externes desactives en qualification'
  if (pathname.startsWith('/api/cron/')) return 'cron desactive en qualification'
  if (pathname.startsWith('/api/integrations/')) return 'integrations fournisseurs desactivees'
  return null
}

/** Indique si le lecteur KPI V5 peut s'activer pour la cible courante.
 *  - En qualification (pile Q3 de test) : drapeau explicite obligatoire.
 *  - Hors qualification (apres bascule, Production sur la meme origine auto-hebergee) :
 *    aucune regle de qualification ne doit bloquer le lecteur.
 */
export function kpiV5TargetAllowed(): boolean {
  const kind = supabaseTargetKind()
  if (kind !== 'qualification') return false
  if (isQualificationMode()) {
    return process.env.JISRA_KPI_V5_QUALIFICATION === '1'
  }
  return true
}
