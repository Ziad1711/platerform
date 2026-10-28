import { createClient } from '@/lib/supabase/server'
import { ASSISTANT_BACKEND_WRITES_ENABLED, getAssistantBackendClient } from '@/lib/assistant/backend'
import { hasPermission, ROLE_PERMISSIONS, type Permission, type Role } from '@/lib/auth/permissions'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

/** Permission applicative requise pour utiliser l'assistant IA (source unique). */
export const ASSISTANT_PERMISSION: Permission = 'ai_assistant.use'

/**
 * Niveau d'accès financier, aligné sur `can_view_store_finances` (base) :
 * - `full`       : owner / admin / accountant ;
 * - `commercial` : marketer / viewer (aucun coût, marge ni profit) ;
 * - `none`       : tout autre cas.
 *
 * L'assistant recalcule des coûts et des marges : il exige donc un accès `full`
 * tant que les outils ne sont pas classés par niveau (contrat Agent 2).
 */
export type FinancialAccess = 'full' | 'commercial' | 'none'

export interface AssistantStoreScope {
  storeId: string
  role: Role | null
  financialAccess: FinancialAccess
}

function normalizeOrigin(value: string | null | undefined) {
  if (!value) return null

  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

export function getAllowedRequestOrigins(request: Request) {
  const allowed = new Set<string>()
  const requestOrigin = normalizeOrigin(request.url)
  const configuredOrigins = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.APP_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.SITE_URL,
    'https://jisra.io',
  ]

  if (requestOrigin) allowed.add(requestOrigin)

  for (const origin of configuredOrigins) {
    const normalized = normalizeOrigin(origin)
    if (normalized) allowed.add(normalized)
  }

  return allowed
}

export function assertTrustedOrigin(request: Request) {
  const originHeader = request.headers.get('origin')
  const refererHeader = request.headers.get('referer')
  const candidateOrigin = normalizeOrigin(originHeader) || normalizeOrigin(refererHeader)

  // Certains appels serveur-à-serveur / scripts non browser n'envoient pas Origin/Referer.
  if (!candidateOrigin) return

  const allowedOrigins = getAllowedRequestOrigins(request)
  if (!allowedOrigins.has(candidateOrigin)) {
    throw new Error('FORBIDDEN_ORIGIN')
  }
}

export function sanitizeInternalRedirectPath(rawPath: string | null | undefined, fallback = '/dashboard') {
  const value = String(rawPath || '').trim()
  if (!value) return fallback
  if (!value.startsWith('/')) return fallback
  if (value.startsWith('//')) return fallback
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value)) return fallback
  if (value.includes('\\')) return fallback
  return value
}

export async function requireAuthenticatedUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('UNAUTHORIZED')
  }

  return { supabase, user }
}

export async function verifyStoreAccess(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  storeId: string
) {
  const { data, error } = await supabase
    .from('store_members')
    .select('id, role')
    .eq('user_id', userId)
    .eq('store_id', storeId)
    .eq('status', 'active')
    .maybeSingle()

  if (error) {
    throw new Error('STORE_ACCESS_CHECK_FAILED')
  }

  if (!data) {
    throw new Error('FORBIDDEN_STORE')
  }

  return data
}

function toRole(value: string | null | undefined): Role | null {
  if (!value) return null
  return Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, value) ? (value as Role) : null
}

/** Règle locale identique à `can_view_store_finances` (jamais plus permissive). */
export function financialAccessFromRole(role: Role | null): FinancialAccess {
  if (!role) return 'none'
  if (role === 'owner' || role === 'admin' || role === 'accountant') return 'full'
  if (role === 'marketer' || role === 'viewer') return 'commercial'
  return 'none'
}

/**
 * Périmètre réel de l'utilisateur : appartenances actives ∪ boutiques possédées.
 * Les boutiques possédées sont incluses car la RLS (`stores.owner_user_id`,
 * `can_view_all_store_orders`) les autorise même sans ligne `store_members`.
 */
export async function getAccessibleStoreScopes(
  supabase: SupabaseServerClient,
  userId: string,
  signal?: AbortSignal
): Promise<AssistantStoreScope[]> {
  let membershipsQuery = supabase
    .from('store_members')
    .select('store_id, role')
    .eq('user_id', userId)
    .eq('status', 'active')

  if (signal) membershipsQuery = membershipsQuery.abortSignal(signal as never)

  let ownedQuery = supabase
    .from('stores')
    .select('id')
    .eq('owner_user_id', userId)

  if (signal) ownedQuery = ownedQuery.abortSignal(signal as never)

  const [memberships, owned] = await Promise.all([membershipsQuery, ownedQuery])

  if (memberships.error || owned.error) {
    throw new Error('STORE_ACCESS_CHECK_FAILED')
  }

  const scopes = new Map<string, AssistantStoreScope>()

  for (const row of memberships.data || []) {
    const storeId = String(row.store_id)
    const role = toRole(row.role)
    scopes.set(storeId, { storeId, role, financialAccess: financialAccessFromRole(role) })
  }

  for (const row of owned.data || []) {
    const storeId = String(row.id)
    scopes.set(storeId, { storeId, role: 'owner', financialAccess: 'full' })
  }

  return Array.from(scopes.values()).sort((a, b) => a.storeId.localeCompare(b.storeId))
}

/** Compatibilité : identifiants de boutiques accessibles, ordre déterministe. */
export async function getAccessibleStoreIds(
  supabase: SupabaseServerClient,
  userId: string,
  signal?: AbortSignal
) {
  const scopes = await getAccessibleStoreScopes(supabase, userId, signal)
  return scopes.map((scope) => scope.storeId)
}

/**
 * Niveau financier réel d'une boutique. La base reste la source de vérité via
 * `can_view_store_finances` (SECURITY DEFINER, auth.uid()) ; le repli local
 * applique exactement la même règle et ne peut jamais élever le niveau.
 */
export async function resolveFinancialAccess(
  supabase: SupabaseServerClient,
  storeId: string,
  role: Role | null
): Promise<FinancialAccess> {
  const { data, error } = await supabase.rpc('can_view_store_finances', { p_store_id: storeId })
  if (!error && data === true) return 'full'
  return financialAccessFromRole(role)
}

/**
 * Contrôle d'entrée de l'assistant : appartenance active, permission
 * `ai_assistant.use`, puis niveau financier `full`.
 *
 * `full` est exigé car les outils actuels renvoient coûts, marges et profit :
 * un profil `commercial` ne peut pas encore être servi sans fuite financière
 * (contrat d'outils classés attendu côté Agent 2).
 */
export async function requireAssistantPermission(
  supabase: SupabaseServerClient,
  userId: string,
  storeId?: string | null
): Promise<AssistantStoreScope> {
  const scopes = await getAccessibleStoreScopes(supabase, userId)
  const requested = String(storeId || '').trim()

  const scope = requested
    ? scopes.find((item) => item.storeId === requested)
    : scopes.find((item) => hasPermission(item.role, ASSISTANT_PERMISSION))

  if (requested && !scope) throw new Error('FORBIDDEN_STORE')
  if (!scope || !hasPermission(scope.role, ASSISTANT_PERMISSION)) {
    throw new Error('FORBIDDEN_PERMISSION')
  }

  const financialAccess = await resolveFinancialAccess(supabase, scope.storeId, scope.role)
  return { ...scope, financialAccess }
}

/**
 * Contrôle d'entrée du chat analytique : appartenance active, permission
 * `ai_assistant.use`, puis niveau financier `full` sur la boutique analysée.
 *
 * `full` est exigé car les outils actuels renvoient coûts, marges et profit :
 * un profil `commercial` ne peut pas encore être servi sans fuite financière
 * (contrat d'outils classés attendu côté Agent 2).
 */
export async function requireAssistantStoreAccess(
  supabase: SupabaseServerClient,
  userId: string,
  storeId?: string | null
): Promise<AssistantStoreScope> {
  if (storeId) {
    const scope = await requireAssistantPermission(supabase, userId, storeId)
    if (scope.financialAccess !== 'full') throw new Error('FORBIDDEN_FINANCIAL_SCOPE')
    return scope
  }

  const scopes = await getAccessibleStoreScopes(supabase, userId)
  const permitted = scopes.filter((item) => hasPermission(item.role, ASSISTANT_PERMISSION))
  if (permitted.length === 0) throw new Error('FORBIDDEN_PERMISSION')

  for (const candidate of permitted) {
    const financialAccess = await resolveFinancialAccess(supabase, candidate.storeId, candidate.role)
    if (financialAccess === 'full') return { ...candidate, financialAccess }
  }

  throw new Error('FORBIDDEN_FINANCIAL_SCOPE')
}

/**
 * Contrôle d'accès à une conversation existante : la permission
 * `ai_assistant.use` suffit pour lire/renommer/supprimer son propre historique
 * (aucune donnée financière n'y est exposée), mais elle doit être portée sur la
 * boutique de la conversation. Une conversation historique sans boutique
 * (`store_id` null) reste autorisée dès qu'un périmètre est permis.
 */
export async function assertThreadScopeAccess(
  supabase: SupabaseServerClient,
  userId: string,
  threadStoreId: string | null | undefined
): Promise<AssistantStoreScope[]> {
  const scopes = await getAccessibleStoreScopes(supabase, userId)
  const permitted = scopes.filter((item) => hasPermission(item.role, ASSISTANT_PERMISSION))

  if (permitted.length === 0) throw new Error('FORBIDDEN_PERMISSION')

  if (threadStoreId && !permitted.some((item) => item.storeId === threadStoreId)) {
    throw new Error('FORBIDDEN_STORE')
  }

  return permitted
}

/**
 * Combinaisons de drapeaux : une configuration incohérente est bloquée avant
 * toute écriture, jamais corrigée silencieusement en cours de route.
 *
 * | Registre | Réservation | Finalisation atomique | Backend | Verdict |
 * |---|---|---|---|---|
 * | off | off | off | requis | séquentiel toléré (écritures assistant via backend) |
 * | on  | off | off | requis | idempotent, finalisation séquentielle |
 * | on  | on  | off | requis | incohérent : la réservation exige la finalisation atomique |
 * | on  | any | on  | requis | cible recommandée |
 * | off | any | on  | requis | incohérent : la finalisation atomique exige le registre |
 * | any | any | any | absent | bloqué (écriture fiable impossible) |
 */
export function assertAssistantRuntimeFlags() {
  const registry =
    (process.env.ASSISTANT_IDEMPOTENCY_REGISTRY || '').trim().toLowerCase() === 'enabled'
  const reservation =
    (process.env.ASSISTANT_CREDIT_RESERVATION || '').trim().toLowerCase() === 'enabled'
  const atomic = (process.env.ASSISTANT_FINALIZE_ATOMIC || '').trim().toLowerCase() === 'enabled'

  if (atomic && !registry) throw new Error('ASSISTANT_FLAGS_INCOHERENT')
  if (reservation && !atomic) throw new Error('ASSISTANT_FLAGS_INCOHERENT')

  if (ASSISTANT_BACKEND_WRITES_ENABLED && !getAssistantBackendClient()) {
    throw new Error('ASSISTANT_BACKEND_UNAVAILABLE')
  }
}

/** Borne une opération asynchrone (aucune promesse pendante au-delà du budget). */
export function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  code = 'ASSISTANT_TIMEOUT'
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(code)), Math.max(1, timeoutMs))
    operation.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

const PUBLIC_ERROR_MESSAGES: Record<string, string> = {
  UNAUTHORIZED: 'Session expirée. Reconnectez-vous.',
  FORBIDDEN_STORE: 'Vous n’avez pas accès à cette boutique.',
  FORBIDDEN_ORIGIN: 'Origine de la requête non autorisée.',
  FORBIDDEN_PERMISSION: 'Votre rôle ne permet pas d’utiliser l’assistant IA.',
  FORBIDDEN_FINANCIAL_SCOPE:
    'L’assistant IA est réservé aux profils ayant accès aux données financières de cette boutique.',
  NO_ACCESSIBLE_STORE: 'Aucune boutique accessible.',
  NO_STORE_SELECTED: 'Sélectionnez une boutique.',
  INVALID_REQUEST: 'Requête invalide.',
  INVALID_STORE_ID: 'Identifiant de boutique invalide.',
  IDEMPOTENCY_KEY_REQUIRED: 'Identifiant de requête obligatoire. Rechargez la page et réessayez.',
  IDEMPOTENCY_CONFLICT: 'Cette requête a déjà été utilisée avec un contenu différent.',
  IDEMPOTENCY_IN_PROGRESS: 'Cette demande est déjà en cours de traitement.',
  IDEMPOTENCY_LEASE_LOST: 'Cette tentative a expiré. Relancez la demande.',
  IDEMPOTENCY_TOKEN_MISMATCH: 'Tentative invalide : jeton de réservation absent ou obsolète.',
  ASSISTANT_BACKEND_UNAVAILABLE: 'Écriture fiable indisponible : le service est momentanément bloqué.',
  ASSISTANT_FLAGS_INCOHERENT: 'Configuration assistant incohérente : action bloquée.',
  FINALIZE_RPC_FAILED: 'La finalisation de la réponse a échoué. Aucun débit n’a été confirmé.',
  REQUEST_ABORTED: 'Demande interrompue (changement de périmètre ou délai dépassé).',
  EMPTY_MESSAGE: 'Votre message est vide.',
  MESSAGE_TOO_LONG: 'Votre message dépasse la longueur autorisée.',
  STORE_ACCESS_CHECK_FAILED: 'Vérification des accès impossible pour le moment.',
  THREAD_NOT_FOUND: 'Conversation introuvable.',
  THREAD_STORE_MISMATCH: 'Cette conversation appartient à une autre boutique.',
  THREADS_LIST_FAILED: 'Conversations indisponibles.',
  THREAD_CREATE_FAILED: 'Création de conversation impossible.',
  THREAD_FETCH_FAILED: 'Conversation indisponible.',
  THREAD_UPDATE_FAILED: 'Mise à jour de la conversation impossible.',
  THREAD_TOUCH_FAILED: 'Mise à jour de la conversation impossible.',
  THREAD_DELETE_FAILED: 'Suppression de la conversation impossible.',
  INVALID_THREAD_ACTION: 'Action de conversation invalide.',
  INVALID_THREAD_TITLE: 'Titre de conversation invalide.',
  MESSAGES_LIST_FAILED: 'Messages indisponibles.',
  MESSAGE_CREATE_FAILED: 'Enregistrement du message impossible.',
  INSUFFICIENT_CREDITS: 'Crédits IA insuffisants.',
  WALLET_FETCH_FAILED: 'Service de crédits indisponible.',
  WALLET_CREATE_FAILED: 'Service de crédits indisponible.',
  WALLET_DEBIT_FAILED: 'Service de crédits indisponible.',
  RATE_LIMITED: 'Trop de requêtes. Réessayez dans quelques instants.',
  CONCURRENT_REQUEST: 'Une demande est déjà en cours. Patientez un instant.',
  ASSISTANT_TIMEOUT: 'L’assistant a mis trop de temps à répondre.',
  ASSISTANT_PROVIDER_FAILED: 'Le service IA est momentanément indisponible.',
  ASSISTANT_ERROR: 'Une erreur est survenue. Réessayez.',
  QUOTA_ORDER_LIMIT_REACHED: 'Quota de commandes atteint.',
  QUOTA_STORES_LIMIT_REACHED: 'Quota de boutiques atteint.',
}

export function getErrorStatus(error: unknown) {
  const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR'

  if (message === 'UNAUTHORIZED') return 401
  if (message === 'FORBIDDEN_STORE') return 403
  if (message === 'FORBIDDEN_ORIGIN') return 403
  if (message === 'FORBIDDEN_PERMISSION') return 403
  if (message === 'FORBIDDEN_FINANCIAL_SCOPE') return 403
  if (message === 'NO_ACCESSIBLE_STORE') return 403
  if (message === 'NO_STORE_SELECTED') return 400
  if (message === 'INVALID_REQUEST') return 400
  if (message === 'INVALID_STORE_ID') return 400
  if (message === 'EMPTY_MESSAGE') return 400
  if (message === 'MESSAGE_TOO_LONG') return 413
  if (message === 'INVALID_THREAD_ACTION') return 400
  if (message === 'INVALID_THREAD_TITLE') return 400
  if (message === 'IDEMPOTENCY_KEY_REQUIRED') return 400
  if (message === 'IDEMPOTENCY_CONFLICT') return 409
  if (message === 'IDEMPOTENCY_IN_PROGRESS') return 409
  if (message === 'IDEMPOTENCY_LEASE_LOST') return 409
  if (message === 'IDEMPOTENCY_TOKEN_MISMATCH') return 409
  if (message === 'ASSISTANT_BACKEND_UNAVAILABLE') return 503
  if (message === 'ASSISTANT_FLAGS_INCOHERENT') return 503
  if (message === 'FINALIZE_RPC_FAILED') return 502
  if (message === 'REQUEST_ABORTED') return 408
  if (message === 'THREAD_NOT_FOUND') return 404
  if (message === 'THREAD_STORE_MISMATCH') return 409
  if (message === 'RATE_LIMITED') return 429
  if (message === 'CONCURRENT_REQUEST') return 429
  if (message === 'INSUFFICIENT_CREDITS') return 402
  if (message === 'ASSISTANT_TIMEOUT') return 504
  if (message === 'ASSISTANT_PROVIDER_FAILED') return 502
  if (message.startsWith('QUOTA_')) return 403

  return 500
}

/**
 * Erreur exposable au client : jamais de message brut (base, fournisseur IA,
 * SQL). Seuls les codes connus sont transmis avec un libellé français.
 */
export function toPublicError(error: unknown): { code: string; message: string; status: number } {
  const status = getErrorStatus(error)
  const raw = error instanceof Error ? error.message : ''
  const isKnown = Object.prototype.hasOwnProperty.call(PUBLIC_ERROR_MESSAGES, raw)
  const isQuota = raw.startsWith('QUOTA_')

  return {
    code: isKnown || isQuota ? raw : 'ASSISTANT_ERROR',
    message: isKnown
      ? PUBLIC_ERROR_MESSAGES[raw]
      : isQuota
        ? PUBLIC_ERROR_MESSAGES.QUOTA_ORDER_LIMIT_REACHED
        : PUBLIC_ERROR_MESSAGES.ASSISTANT_ERROR,
    status,
  }
}
