// ============================================================
// Registre des transporteurs pour la synchronisation du suivi.
//
// Un seul endroit decrit, par transporteur :
//  - la colonne de suivi portee par la commande ;
//  - les statuts de commande exclus du suivi automatique ;
//  - le mapping transporteur -> statuts internes (fonctions existantes,
//    aucune regle n'est dupliquee ici) ;
//  - les regles de progression propres au transporteur (AMEEX) ;
//  - la date d'evenement transporteur quand elle est fiable.
//
// Fichier strictement serveur : les credentials sont uniquement LUS, le
// format de stockage existant n'est jamais modifie ici.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptSecret, isEncryptedSecret } from '@/lib/security/crypto'
import {
  getRapidDeliveryStateName,
  mapRapidDeliveryStateToOrderStatus,
  trackRapidDeliveryParcel,
} from '@/lib/integrations/rapid-delivery'
import {
  getMarocGoDeliveryStateName,
  mapMarocGoDeliveryStateToOrderStatus,
  trackMarocGoDeliveryParcel,
} from '@/lib/integrations/maroc-go-delivery'
import { getRushlivStateName, mapRushlivStateToOrderStatus, trackRushlivParcel } from '@/lib/integrations/rushliv'
import { getAmeexCredentials } from '@/lib/integrations/ameex-credentials'
import {
  AMEEX_DELIVERY_STATUS_STAGE,
  AMEEX_ORDER_STATUS_STAGE,
  resolveAmeexStatus,
} from '@/lib/integrations/ameex-status'
import { trackAmeexParcel } from '@/lib/integrations/ameex'
import { getSenditCredentials } from '@/lib/integrations/sendit-credentials'
import { mapSenditStatusToOrderStatus, trackSenditParcel } from '@/lib/integrations/sendit'
import { mapDigylogStatusToOrderStatus, getOrderInfos } from '@/lib/integrations/digylog'
import { ozoneAdapter } from './ozone-adapter'
import { forcelogAdapter } from './forcelog-adapter'

type AdminClient = SupabaseClient<any, 'public', any>

/** Statut normalise, independant du transporteur. */
export type TrackedStatus = {
  rawStatus: string
  orderStatus: string | null
  deliveryStatus: string | null
  statusDateField: string | null
  /** Date d'evenement fournie par le transporteur (ISO) si fiable, sinon null. */
  eventAt: string | null
  /** false = statut non reconnu : aucun statut ne doit etre applique. */
  recognized: boolean
}

export type TrackingTracker = (trackingKey: string, opts?: { signal?: AbortSignal }) => Promise<TrackedStatus>

/** Regles de progression propres a un transporteur (ex : AMEEX). */
export type TrackingStatusGuards = {
  statusAllowed?: (current: string | null, target: string) => boolean
  deliveryAllowed?: (current: string | null, target: string) => boolean
}

export type DeliveryTrackingProvider = {
  slug: string
  /** Colonne `orders` portant la cle de suivi de ce transporteur. */
  trackingColumn: string
  /** Statuts de commande pour lesquels le suivi automatique est inutile. */
  excludedStatuses: string[]
  /** Statuts depuis lesquels la commande ne progresse plus. */
  terminalOrderStatuses: string[]
  guards?: TrackingStatusGuards
  loadTracker: (params: {
    admin: AdminClient
    storeId: string
    integrationId: string
    userId: string
  }) => Promise<TrackingTracker>
}

/** Statuts exclus communs aux transporteurs historiques (comportement inchange). */
const COMMON_EXCLUDED_STATUSES = ['new', 'delivered', 'returned_not_stocked', 'returned_stocked', 'refused', 'confirmed']

/** AMEEX conserve son propre referentiel (cancelled inclus, new/confirmed suivis). */
const AMEEX_EXCLUDED_STATUSES = ['delivered', 'refused', 'cancelled', 'returned_not_stocked', 'returned_stocked']

function toTerminalStatuses(excluded: string[]): string[] {
  return Array.from(new Set([...excluded, 'cancelled']))
}

/** Lecture stricte du credential : jamais de reecriture du format stocke. */
async function readIntegrationToken(admin: AdminClient, integrationId: string): Promise<string> {
  const { data, error } = await admin.from('integrations').select('id, access_token').eq('id', integrationId).single()
  if (error) throw error

  const raw = String(data?.access_token || '')
  if (!raw) throw new Error('INTEGRATION_TOKEN_MISSING')

  return isEncryptedSecret(raw) ? decryptSecret(raw) : raw
}

/** Lecture tolerante d'un champ Digylog (racine, data ou order). */
function pickDigylogField(payload: unknown, keys: string[]): string {
  const containers: Array<Record<string, any>> = []
  if (payload && typeof payload === 'object') {
    const root = payload as Record<string, any>
    containers.push(root)
    if (root.data && typeof root.data === 'object' && !Array.isArray(root.data)) {
      containers.push(root.data as Record<string, any>)
    }
    if (root.order && typeof root.order === 'object') containers.push(root.order as Record<string, any>)
    if (Array.isArray(root.data) && root.data[0] && typeof root.data[0] === 'object') containers.push(root.data[0])
  }
  for (const container of containers) {
    for (const key of keys) {
      const value = container[key]
      if (value !== null && value !== undefined && String(value).trim() !== '') return String(value).trim()
    }
  }
  return ''
}

/**
 * Regles AMEEX : identiques a `applyAmeexStatusToOrder`, mais les referentiels
 * d'etapes viennent de `ameex-status.ts` (aucune table dupliquee). Elles sont
 * appliquees par l'ecriture conditionnelle partagee, qui ajoute la protection
 * de version (`updated_at`).
 */
const AMEEX_GUARDS: TrackingStatusGuards = {
  statusAllowed: (current, target) => {
    const currentStage = AMEEX_ORDER_STATUS_STAGE[String(current || '')] ?? 0
    const targetStage = AMEEX_ORDER_STATUS_STAGE[target] ?? 0
    if (targetStage > currentStage) return true
    return targetStage === 4 && currentStage === 4
  },
  deliveryAllowed: (current, target) => {
    const currentStage = AMEEX_DELIVERY_STATUS_STAGE[String(current || '')] ?? 0
    const targetStage = AMEEX_DELIVERY_STATUS_STAGE[target] ?? 0
    if (currentStage === 0 || targetStage === 0) return true
    return targetStage >= currentStage
  },
}

const RAPID_TRACKING_COLUMN = 'rapid_delivery_parcel_key'
const MAROC_GO_TRACKING_COLUMN = 'maroc_go_delivery_parcel_key'
const RUSHLIV_TRACKING_COLUMN = 'rushliv_parcel_key'
const GENERIC_TRACKING_COLUMN = 'tracking_number'
const SENDIT_TRACKING_COLUMN = 'sendit_parcel_code'
const FORCELOG_TRACKING_COLUMN = 'forcelog_parcel_key'
const AMEEX_TRACKING_COLUMN = 'ameex_parcel_code'
const DIGYLOG_TRACKING_COLUMN = 'digylog_tracking'

const rapidDeliveryProvider: DeliveryTrackingProvider = {
  slug: 'rapid-delivery',
  trackingColumn: RAPID_TRACKING_COLUMN,
  excludedStatuses: COMMON_EXCLUDED_STATUSES,
  terminalOrderStatuses: toTerminalStatuses(COMMON_EXCLUDED_STATUSES),
  async loadTracker({ admin, integrationId }) {
    const token = await readIntegrationToken(admin, integrationId)
    return async (trackingKey, opts) => {
      const payload = await trackRapidDeliveryParcel(token, trackingKey, { signal: opts?.signal })
      const stateName = getRapidDeliveryStateName(payload)
      const mapped = mapRapidDeliveryStateToOrderStatus(stateName)
      return {
        rawStatus: mapped.rawStatus,
        orderStatus: mapped.orderStatus,
        deliveryStatus: mapped.deliveryStatus,
        statusDateField: mapped.statusDateField,
        eventAt: null,
        // Un statut inconnu ne doit jamais etre traite comme un succes.
        recognized: mapped.orderStatus !== null,
      }
    }
  },
}

const marocGoDeliveryProvider: DeliveryTrackingProvider = {
  slug: 'maroc-go-delivery',
  trackingColumn: MAROC_GO_TRACKING_COLUMN,
  excludedStatuses: COMMON_EXCLUDED_STATUSES,
  terminalOrderStatuses: toTerminalStatuses(COMMON_EXCLUDED_STATUSES),
  async loadTracker({ admin, integrationId }) {
    const token = await readIntegrationToken(admin, integrationId)
    return async (trackingKey, opts) => {
      const payload = await trackMarocGoDeliveryParcel(token, trackingKey, { signal: opts?.signal })
      const stateName = getMarocGoDeliveryStateName(payload)
      const mapped = mapMarocGoDeliveryStateToOrderStatus(stateName)
      return {
        rawStatus: mapped.rawStatus,
        orderStatus: mapped.orderStatus,
        deliveryStatus: mapped.deliveryStatus,
        statusDateField: mapped.statusDateField,
        eventAt: null,
        recognized: mapped.orderStatus !== null,
      }
    }
  },
}

const rushlivProvider: DeliveryTrackingProvider = {
  slug: 'rushliv',
  trackingColumn: RUSHLIV_TRACKING_COLUMN,
  excludedStatuses: COMMON_EXCLUDED_STATUSES,
  terminalOrderStatuses: toTerminalStatuses(COMMON_EXCLUDED_STATUSES),
  async loadTracker({ admin, integrationId }) {
    const token = await readIntegrationToken(admin, integrationId)
    return async (trackingKey, opts) => {
      const payload = await trackRushlivParcel(token, trackingKey, { signal: opts?.signal })
      const stateName = getRushlivStateName(payload)
      const mapped = mapRushlivStateToOrderStatus(stateName)
      return {
        rawStatus: mapped.rawStatus,
        orderStatus: mapped.orderStatus,
        deliveryStatus: mapped.deliveryStatus,
        statusDateField: mapped.statusDateField,
        eventAt: null,
        recognized: mapped.orderStatus !== null,
      }
    }
  },
}


function toIsoOrNull(value: unknown): string | null {
  const raw = String(value || '').trim()
  if (!raw) return null

  // Date seule : minuit UTC assume et documente.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T00:00:00.000Z`

  // Horodatage : un fuseau explicite (Z ou +/-hh:mm) est respecte tel quel.
  const normalized = raw.replace(' ', 'T')
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized)
  const parsed = new Date(hasZone ? normalized : `${normalized}Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

const ozoneProvider: DeliveryTrackingProvider = {
  slug: 'ozone',
  trackingColumn: GENERIC_TRACKING_COLUMN,
  excludedStatuses: COMMON_EXCLUDED_STATUSES,
  terminalOrderStatuses: toTerminalStatuses(COMMON_EXCLUDED_STATUSES),
  async loadTracker({ admin, storeId, integrationId, userId }) {
    const token = await readIntegrationToken(admin, integrationId)
    const config = { integrationId, token, baseUrl: null, userId, storeId }
    return async (trackingKey, opts) => {
      const result = await ozoneAdapter.trackParcel(config, trackingKey, { signal: opts?.signal })
      return {
        rawStatus: result.rawStatus,
        orderStatus: result.orderStatus,
        deliveryStatus: result.deliveryStatus,
        statusDateField: result.statusDateField,
        eventAt: null,
        // Seul un statut reellement mappe compte comme reconnu.
        recognized: Boolean(result.orderStatus),
      }
    }
  },
}

const ameexProvider: DeliveryTrackingProvider = {
  slug: 'ameex',
  trackingColumn: AMEEX_TRACKING_COLUMN,
  excludedStatuses: AMEEX_EXCLUDED_STATUSES,
  terminalOrderStatuses: toTerminalStatuses(AMEEX_EXCLUDED_STATUSES),
  guards: AMEEX_GUARDS,
  async loadTracker({ admin, integrationId }) {
    const credentials = await getAmeexCredentials(admin, integrationId)
    return async (trackingKey, opts) => {
      const raw = await trackAmeexParcel(credentials.apiId, credentials.apiKey, trackingKey, { signal: opts?.signal })
      const parcel = (raw as any)?.Parcel
      const rawStatut = String(parcel?.STATUT || '').trim()
      const rawStatutS = String(parcel?.STATUT_S || '').trim()
      const resolved = resolveAmeexStatus(rawStatut, rawStatutS || undefined)
      return {
        rawStatus: resolved.rawStatus,
        orderStatus: resolved.orderStatus,
        deliveryStatus: resolved.deliveryStatus,
        statusDateField: resolved.statusDateField,
        eventAt: toIsoOrNull(parcel?.DATE || parcel?.STATUT_DATE),
        recognized: resolved.recognized,
      }
    }
  },
}

const digylogProvider: DeliveryTrackingProvider = {
  slug: 'digylog',
  trackingColumn: DIGYLOG_TRACKING_COLUMN,
  excludedStatuses: COMMON_EXCLUDED_STATUSES,
  terminalOrderStatuses: toTerminalStatuses(COMMON_EXCLUDED_STATUSES),
  async loadTracker({ admin, integrationId }) {
    // Lecture seule : le token Digylog brut n'est jamais reecrit ici.
    const token = await readIntegrationToken(admin, integrationId)
    const config = { token, referer: 'https://apiseller.digylog.com' }
    return async (trackingKey, opts) => {
      const raw = await getOrderInfos(config, trackingKey, { signal: opts?.signal })
      const statusLabel = pickDigylogField(raw, ['status', 'statusLabel', 'statut', 'Situation'])
      const statusId = pickDigylogField(raw, ['idStatus', 'statusId', 'IdStatus'])
      const eventAt = toIsoOrNull(pickDigylogField(raw, ['updatedAt', 'statusDate', 'date']))

      if (!statusLabel && !statusId) {
        // Statut illisible : aucun succes ne doit etre deduit.
        return {
          rawStatus: '',
          orderStatus: null,
          deliveryStatus: null,
          statusDateField: null,
          eventAt,
          recognized: false,
        }
      }

      const mapped = mapDigylogStatusToOrderStatus(statusLabel, statusId || undefined)
      return {
        rawStatus: statusLabel || statusId,
        orderStatus: mapped.orderStatus,
        deliveryStatus: mapped.deliveryStatus,
        statusDateField: mapped.statusDateField,
        eventAt,
        // Reconnu des qu'un etat a ete identifie (le repli inconnu seul est false).
        recognized: mapped.recognized !== false,
      }
    }
  },
}

const senditProvider: DeliveryTrackingProvider = {
  slug: 'sendit',
  trackingColumn: SENDIT_TRACKING_COLUMN,
  excludedStatuses: COMMON_EXCLUDED_STATUSES,
  terminalOrderStatuses: toTerminalStatuses(COMMON_EXCLUDED_STATUSES),
  async loadTracker({ admin, integrationId }) {
    const credentials = await getSenditCredentials(admin, integrationId)
    return async (trackingKey, opts) => {
      const raw = await trackSenditParcel(credentials.token, trackingKey, { signal: opts?.signal })
      const rawStatus = String((raw as any)?.data?.status || '').trim()
      const mapped = mapSenditStatusToOrderStatus(rawStatus)
      return {
        rawStatus,
        orderStatus: mapped.orderStatus,
        deliveryStatus: mapped.deliveryStatus,
        statusDateField: mapped.statusDateField,
        eventAt: null,
        recognized: Boolean(mapped.orderStatus),
      }
    }
  },
}

const forcelogProvider: DeliveryTrackingProvider = {
  slug: 'forcelog',
  trackingColumn: FORCELOG_TRACKING_COLUMN,
  excludedStatuses: COMMON_EXCLUDED_STATUSES,
  terminalOrderStatuses: toTerminalStatuses(COMMON_EXCLUDED_STATUSES),
  async loadTracker({ admin, storeId, integrationId, userId }) {
    const token = await readIntegrationToken(admin, integrationId)
    const config = { integrationId, token, baseUrl: null, userId, storeId }
    return async (trackingKey, opts) => {
      // L'adapter leve une erreur si ForceLog repond RESULT=ERROR : une erreur
      // transporteur n'est jamais convertie en succes.
      const result = await forcelogAdapter.trackParcel(config, trackingKey, { signal: opts?.signal })
      return {
        rawStatus: result.rawStatus,
        orderStatus: result.orderStatus,
        deliveryStatus: result.deliveryStatus,
        statusDateField: result.statusDateField,
        eventAt: null,
        recognized: Boolean(result.orderStatus),
      }
    }
  },
}

const trackingProviders: DeliveryTrackingProvider[] = [
  rapidDeliveryProvider,
  marocGoDeliveryProvider,
  rushlivProvider,
  ozoneProvider,
  ameexProvider,
  digylogProvider,
  senditProvider,
  forcelogProvider,
]

export function getTrackingProvider(slug: string): DeliveryTrackingProvider | null {
  const target = String(slug || '').trim()
  return trackingProviders.find((provider) => provider.slug === target) || null
}

export function getTrackingProviderSlugs(): string[] {
  return trackingProviders.map((provider) => provider.slug)
}

