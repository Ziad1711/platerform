import { NextResponse } from 'next/server'
import { requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { hasPermission, type Role } from '@/lib/auth/permissions'
import { getConfirmationErrorStatus } from '@/lib/confirmation/api-errors'
import {
  CONFIRMATION_FILTERS,
  CONFIRMATION_ORDER_SELECT,
  applyQueueFilter,
  applyQueueOrder,
  normalizeQueueFilter,
  normalizeSortOrder,
} from '@/lib/confirmation/queries'
import { CONFIRMATION_SETTINGS_SELECT, normalizeSettings } from '@/lib/confirmation/settings'
import { getBlacklistedPhones, normalizePhoneForBlacklist } from '@/lib/confirmation/blacklist'
import type { ConfirmationQueueFilter, ConfirmationSortOrder } from '@/lib/confirmation/types'

const DEFAULT_LIMIT = 40
const MAX_LIMIT = 100

/**
 * Deux vues, même autorisation et même périmètre :
 *
 * - `queue` (défaut) : commandes + réglages, strictement ce qu'il faut pour
 *   afficher la file et ouvrir les actions. C'est le chemin critique.
 * - `secondary` : compteurs de files et avertissement blacklist, demandés APRÈS
 *   la première réponse. Ni leur coût ni leur échec ne retarde ou ne supprime
 *   l'affichage des commandes.
 */
type QueueView = 'queue' | 'secondary' | 'counts' | 'blacklist'

type QueueSupabase = Awaited<ReturnType<typeof requireAuthenticatedUser>>['supabase']

type QueueScope = {
  supabase: QueueSupabase
  storeId: string
  /** Périmètre agent : `null` = toute la boutique (selon le rôle). */
  agentScopeId: string | null
  filter: ConfirmationQueueFilter
  sort: ConfirmationSortOrder
  search: string
  limit: number
  offset: number
  nowIso: string
  todayStart: string | null
}

function parseView(raw: string | null): QueueView {
  if (raw === 'secondary' || raw === 'counts' || raw === 'blacklist') return raw
  return 'queue'
}

function parseLimit(raw: string | null) {
  const parsed = Number(raw || DEFAULT_LIMIT)
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT
  return Math.min(Math.trunc(parsed), MAX_LIMIT)
}

function parseOffset(raw: string | null) {
  const parsed = Number(raw || 0)
  if (!Number.isFinite(parsed) || parsed < 0) return 0
  return Math.trunc(parsed)
}

function searchFilter(search: string) {
  return `customer_name.ilike.%${search}%,phone.ilike.%${search}%,tracking_number.ilike.%${search}%`
}

/**
 * Résout une seule fois l'identité, l'accès à la boutique et le périmètre agent.
 * Les deux vues partagent exactement les mêmes règles : aucune vue secondaire ne
 * peut élargir ce que la vue principale autorise.
 */
async function resolveQueueScope(
  request: Request
): Promise<{ error: NextResponse } | QueueScope> {
  const { supabase, user } = await requireAuthenticatedUser()
  const params = new URL(request.url).searchParams

  const storeId = String(params.get('storeId') || '').trim()
  if (!storeId) {
    return { error: NextResponse.json({ error: 'MISSING_STORE_ID' }, { status: 400 }) }
  }

  const member = await verifyStoreAccess(supabase, user.id, storeId)
  if (!hasPermission(member.role as Role, 'confirmation.view')) {
    return { error: NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 }) }
  }

  // Périmètre agent : un agent de confirmation ne voit que ses propres commandes.
  let agentScopeId: string | null = null
  if (member.role === 'confirmation') {
    const { data: agent } = await supabase
      .from('confirmation_agents')
      .select('id')
      .eq('store_id', storeId)
      .eq('member_id', member.id)
      .maybeSingle()
    agentScopeId = agent?.id ? String(agent.id) : '00000000-0000-0000-0000-000000000000'
  }

  const filter = normalizeQueueFilter(params.get('filter'))
  const sort = normalizeSortOrder(params.get('sort'), filter)

  return {
    supabase,
    storeId,
    agentScopeId,
    filter,
    sort,
    search: String(params.get('search') || '').trim(),
    limit: parseLimit(params.get('limit')),
    offset: parseOffset(params.get('offset')),
    nowIso: new Date().toISOString(),
    todayStart: String(params.get('todayStart') || '').trim() || null,
  }
}

/** File filtrée et triée, dans le périmètre de la boutique et de l'agent. */
function buildOrdersQuery(scope: QueueScope, columns: string): any {
  let query = scope.supabase.from('orders').select(columns).eq('store_id', scope.storeId)
  if (scope.agentScopeId) {
    query = query.eq('confirmation_agent_id', scope.agentScopeId)
  }
  query = applyQueueFilter(query, scope.filter, scope.nowIso)
  query = applyQueueOrder(query, scope.filter, scope.sort)
  if (scope.search) {
    query = query.or(searchFilter(scope.search))
  }
  return query
}


/** Compteurs des files : ne lèvent jamais, un compteur en échec est simplement omis. */
async function readFilterCounts(
  scope: QueueScope
): Promise<{ counts: Record<string, number>; countsAvailable: boolean }> {
  const results = await Promise.allSettled(
    CONFIRMATION_FILTERS.map(async (candidate) => {
      let countQuery = scope.supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('store_id', scope.storeId)
      if (scope.agentScopeId) {
        countQuery = countQuery.eq('confirmation_agent_id', scope.agentScopeId)
      }
      countQuery = applyQueueFilter(countQuery, candidate, scope.nowIso)
      if (scope.search) {
        countQuery = countQuery.or(searchFilter(scope.search))
      }
      const { count, error } = await countQuery
      if (error) throw error
      return [candidate, count || 0] as const
    })
  )

  const counts: Record<string, number> = {}
  let countsAvailable = true

  for (const result of results) {
    if (result.status === 'fulfilled') {
      counts[result.value[0]] = result.value[1]
    } else {
      countsAvailable = false
      console.error('CONFIRMATION_COUNT_FAILED', result.reason)
    }
  }

  // Une commande en attente est forcément dans l'une des trois files ci-dessous.
  if (
    counts.to_process !== undefined &&
    counts.to_callback !== undefined &&
    counts.late !== undefined
  ) {
    counts.pendingTotal = counts.to_process + counts.to_callback + counts.late
  }

  return { counts, countsAvailable }
}

/** Compteurs du jour : clés omises en cas d'échec, jamais remplacées par zéro. */
async function readTodayCounts(scope: QueueScope): Promise<Record<string, number>> {
  if (!scope.todayStart) return {}

  const todayStart = scope.todayStart
  const buildQuery = (statuses: string[]) => {
    let query = scope.supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', scope.storeId)
      .in('status', statuses)
      .gte('confirmation_last_action_at', todayStart)
    if (scope.agentScopeId) {
      query = query.eq('confirmation_agent_id', scope.agentScopeId)
    }
    return query
  }

  const [confirmed, cancelled] = await Promise.allSettled([
    buildQuery(['confirmed']),
    buildQuery(['cancelled']),
  ])

  const today: Record<string, number> = {}
  if (confirmed.status === 'fulfilled' && !confirmed.value.error) {
    today.confirmedToday = confirmed.value.count || 0
  } else if (confirmed.status === 'rejected') {
    console.error('CONFIRMATION_TODAY_CONFIRMED_COUNT_FAILED', confirmed.reason)
  }
  if (cancelled.status === 'fulfilled' && !cancelled.value.error) {
    today.cancelledToday = cancelled.value.count || 0
  } else if (cancelled.status === 'rejected') {
    console.error('CONFIRMATION_TODAY_CANCELLED_COUNT_FAILED', cancelled.reason)
  }
  return today
}

/**
 * Avertissement blacklist des seules commandes de la page affichée. Les
 * téléphones ne sont jamais fournis par le client : ils sont relus ici, avec le
 * même filtre et le même périmètre agent que la liste.
 */
async function readPageBlacklist(
  scope: QueueScope
): Promise<{ blacklist: Record<string, boolean> | null; blacklistAvailable: boolean }> {
  const pageResult = await buildOrdersQuery(scope, 'id, phone').range(
    scope.offset,
    scope.offset + scope.limit - 1
  )

  if (pageResult.error) {
    console.error('CONFIRMATION_BLACKLIST_PAGE_FAILED', pageResult.error)
    return { blacklist: null, blacklistAvailable: false }
  }

  const rows = (pageResult.data || []) as Array<{ id: string; phone: string | null }>

  try {
    const blacklistedPhones = await getBlacklistedPhones(
      scope.supabase,
      scope.storeId,
      rows.map((row) => row.phone)
    )

    const blacklist: Record<string, boolean> = {}
    for (const row of rows) {
      const key = normalizePhoneForBlacklist(row.phone)
      blacklist[row.id] = key ? blacklistedPhones.has(key) : false
    }
    return { blacklist, blacklistAvailable: true }
  } catch (error) {
    // Avertissement informatif : son échec est signalé au client, jamais tu.
    console.error('CONFIRMATION_BLACKLIST_CHECK_FAILED', error)
    return { blacklist: null, blacklistAvailable: false }
  }
}

export async function GET(request: Request) {
  const view = parseView(new URL(request.url).searchParams.get('view'))

  try {
    const scope = await resolveQueueScope(request)
    if ('error' in scope) return scope.error

    if (view === 'counts') {
      // Compteurs uniquement : ils ne dépendent ni de la page ni du filtre ni du
      // tri, seuls la boutique, la recherche et le début de journée comptent.
      const countsPromise = readFilterCounts(scope)
      const todayPromise = readTodayCounts(scope)
      const [{ counts, countsAvailable }, todayCounts] = await Promise.all([
        countsPromise,
        todayPromise,
      ])

      return NextResponse.json({
        view,
        counts: { ...counts, ...todayCounts },
        countsAvailable,
      })
    }

    if (view === 'blacklist') {
      // Blacklist de la page courante uniquement : dépend du filtre, du tri et
      // de la page, jamais des compteurs.
      const blacklistResult = await readPageBlacklist(scope)
      return NextResponse.json({
        view,
        blacklist: blacklistResult.blacklist,
        blacklistAvailable: blacklistResult.blacklistAvailable,
      })
    }

    if (view === 'secondary') {
      // Compteurs et page des téléphones démarrent ensemble ; la blacklist ne
      // dépend que de la page, pas des compteurs.
      const countsPromise = readFilterCounts(scope)
      const todayPromise = readTodayCounts(scope)
      const blacklistResult = await readPageBlacklist(scope)
      const [{ counts, countsAvailable }, todayCounts] = await Promise.all([
        countsPromise,
        todayPromise,
      ])

      return NextResponse.json({
        view,
        counts: { ...counts, ...todayCounts },
        countsAvailable,
        blacklist: blacklistResult.blacklist,
        blacklistAvailable: blacklistResult.blacklistAvailable,
      })
    }

    // Chemin critique : commandes + réglages indispensables aux actions.
    const [ordersResult, settingsResult] = await Promise.all([
      buildOrdersQuery(scope, CONFIRMATION_ORDER_SELECT).range(
        scope.offset,
        scope.offset + scope.limit - 1
      ),
      scope.supabase
        .from('confirmation_settings')
        .select(CONFIRMATION_SETTINGS_SELECT)
        .eq('store_id', scope.storeId)
        .maybeSingle(),
    ])

    if (ordersResult.error) throw ordersResult.error
    if (settingsResult.error) throw settingsResult.error

    // Aucune donnée blacklist dans cette réponse : l'état reste explicitement
    // « vérification en cours » côté interface tant que la vue secondaire n'a
    // pas répondu. Un numéro n'est jamais présenté comme non blacklisté ici.
    const orders = ((ordersResult.data || []) as any[]).map((order) => ({
      ...order,
      blacklist_status: 'pending' as const,
    }))

    return NextResponse.json({
      view,
      settings: normalizeSettings(settingsResult.data, scope.storeId),
      orders,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CONFIRMATION_QUEUE_FETCH_FAILED'
    return NextResponse.json({ error: message }, { status: getConfirmationErrorStatus(message) })
  }
}
