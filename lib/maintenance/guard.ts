/**
 * Gel des écritures pendant la fenêtre de bascule.
 *
 * Activé par `JISRA_MAINTENANCE_MODE === '1'`. Sans cette variable, le comportement
 * de l'application est inchangé.
 *
 * Règles :
 * - routes de traitement (cron, webhooks fournisseurs, API publique) : refusées,
 *   même pour le compte pilote ; seule la réception persistante YouCan est permise ;
 * - compte pilote explicitement autorisé (`JISRA_MAINTENANCE_ALLOWED_EMAILS`) : accès
 *   applicatif complet (lecture et écriture) pour valider la nouvelle production ;
 * - autres utilisateurs : pages et écritures refusées (503) ; lectures d'API permises
 *   pour le diagnostic ; assets statiques servis.
 *
 * Limite connue : les écritures émises directement par le navigateur vers Supabase
 * (supabase-js) ne traversent pas ce middleware. Le gel fort en base reste nécessaire.
 */

export const MAINTENANCE_ENV = 'JISRA_MAINTENANCE_MODE'
export const PILOT_ENV = 'JISRA_MAINTENANCE_ALLOWED_EMAILS'

const PROCESSING_PREFIXES = [
  '/api/cron/',
  '/api/public/v1/',
  '/api/integrations/youcan/webhook',
  '/api/integrations/lightfunnels/webhook',
  '/api/integrations/ameex/webhook',
  '/api/integrations/digylog/webhook',
]

const STATIC_PREFIXES = ['/_next/', '/static/', '/icons/', '/images/', '/marketing/']

// Pages strictement necessaires a l'authentification : sans elles, le compte pilote
// ne pourrait pas ouvrir de session pendant la maintenance (aucune donnee exposee).
const AUTH_ALLOWED = ['/login', '/auth/']

// Rattrapage operateur : import YouCan par plage, reserve au compte pilote.
const OPERATOR_CATCHUP_PREFIXES = ['/api/integrations/youcan/sync']

// Routes provoquant un effet reel chez un fournisseur : interdites pendant la
// maintenance, meme pour le pilote (les lectures GET restent disponibles).
const PROVIDER_EFFECT_PREFIXES = [
  '/api/integrations/youcan/connect',
  '/api/integrations/youcan/disconnect',
  '/api/integrations/youcan/parcels',
  '/api/integrations/youcan/variants/configure',
  '/api/integrations/rapid-delivery',
  '/api/integrations/maroc-go-delivery',
  '/api/integrations/rushliv',
  '/api/integrations/ozone',
  '/api/integrations/ameex',
  '/api/integrations/digylog',
  '/api/integrations/forcelog',
  '/api/integrations/sendit',
  '/api/integrations/lightfunnels',
  '/api/integrations/facebook-ads',
  '/api/integrations/custom-site',
]
const STATIC_FILES = ['/favicon.ico', '/manifest.json', '/robots.txt']

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function maintenanceEnabled(): boolean {
  return process.env[MAINTENANCE_ENV] === '1'
}

/** Liste normalisée des emails pilotes autorisés. */
export function maintenancePilotEmails(): string[] {
  return (process.env[PILOT_ENV] || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
}

export function isMaintenancePilot(email?: string | null): boolean {
  if (!email) return false
  return maintenancePilotEmails().includes(email.trim().toLowerCase())
}

function isStaticAsset(pathname: string): boolean {
  if (STATIC_FILES.includes(pathname)) return true
  return STATIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

export type MaintenanceDecision = {
  reason: string
  /** true pour une page HTML, false pour une réponse JSON d'API. */
  asPage: boolean
}

/**
 * Décision de blocage, ou `null` si la requête peut passer.
 * `pilot` provient d'une identité vérifiée côté serveur, jamais d'un en-tête client.
 */
export function maintenanceDecision(
  pathname: string,
  method: string,
  pilot = false
): MaintenanceDecision | null {
  if (!maintenanceEnabled()) return null

  const normalizedMethod = (method || 'GET').toUpperCase()
  const isApi = pathname.startsWith('/api')

  // Exception étroite : la route vérifie la signature et conserve l'événement
  // sans importer de commande pendant la maintenance. Aucune autre API ouverte.
  if (pathname === '/api/integrations/youcan/webhook/order-create' && normalizedMethod === 'POST') return null

  // 1. Traitement automatique : jamais ouvert, pilote compris.
  for (const prefix of PROCESSING_PREFIXES) {
    if (pathname.startsWith(prefix)) {
      return { reason: 'traitement automatique suspendu pendant la bascule', asPage: false }
    }
  }

  // 2. Rattrapage operateur : import YouCan par plage, reserve au compte pilote.
  if (pilot && OPERATOR_CATCHUP_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return null

  // 3. Effets fournisseurs : interdits pendant la maintenance, pilote compris
  //    (les lectures GET restent disponibles pour l'interface).
  if (!READ_METHODS.has(normalizedMethod)) {
    for (const prefix of PROVIDER_EFFECT_PREFIXES) {
      if (pathname.startsWith(prefix)) {
        return { reason: 'appel fournisseur suspendu pendant la bascule', asPage: !isApi }
      }
    }
  }

  // 4. Authentification : indispensable pour que le pilote ouvre une session.
  if (AUTH_ALLOWED.some((prefix) => pathname === prefix || pathname.startsWith(prefix))) return null

  // 5. Compte pilote : acces applicatif complet.
  if (pilot) return null

  // 3. Écritures : refusées hors pilote.
  if (!READ_METHODS.has(normalizedMethod)) {
    return { reason: 'ecriture suspendue pendant la bascule', asPage: !isApi }
  }

  // 5. Lectures d'API : permises pour le diagnostic.
  if (isApi) return null

  // 6. Assets statiques.
  if (isStaticAsset(pathname)) return null

  return { reason: 'application indisponible pendant la bascule', asPage: true }
}

export function maintenanceHeaders(retryAfterSeconds = 300): Record<string, string> {
  return {
    'Retry-After': String(retryAfterSeconds),
    'Cache-Control': 'no-store',
  }
}

/** Corps HTML minimal (aucune dépendance, aucun accès base). */
export function maintenanceHtml(reason: string): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Jisra - maintenance</title>
<style>body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b0c;color:#f5f5f5}main{max-width:32rem;padding:2rem;text-align:center}h1{font-size:1.4rem;margin:0 0 .75rem}p{color:#a1a1aa;line-height:1.6;margin:0}</style>
</head><body><main><h1>Jisra est momentanement indisponible</h1>
<p>Une operation de maintenance est en cours. Aucune action n'est perdue : reessayez dans quelques minutes.</p>
<p style="margin-top:1rem;font-size:.8rem;color:#52525b">${reason}</p></main></body></html>`
}
