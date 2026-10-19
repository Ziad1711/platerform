import type { SupabaseClient } from '@supabase/supabase-js'
import type { KpiReaderMode } from './kpi-reader-flag'

export const KPI_ROLLOUT_POLL_MS = 5_000
export const KPI_ROLLOUT_TTL_MS = 15_000
export const KPI_ROLLOUT_SHADOW_STALE_MS = 10 * 60 * 1_000

export function isKpiRolloutFresh(
  updatedAt: number,
  now: number,
  ttl = KPI_ROLLOUT_TTL_MS,
): boolean {
  return updatedAt > 0 && now - updatedAt <= ttl
}

/** Une réponse d'une version antérieure ne doit jamais réactiver un mode. */
export function acceptsConfigVersion(incoming: string, latest: number): boolean {
  const version = Number(incoming)
  return Number.isFinite(version) && version >= latest
}

export function resolveKpiRolloutMode(
  payload: KpiRolloutPayload | undefined,
  fresh: boolean,
): KpiReaderMode {
  if (!payload || !fresh) return 'legacy'
  if (payload.kill_switch) return 'legacy'
  return payload.selection_mode
}

export interface KpiRolloutStore {
  store_id: string
  effective_mode: KpiReaderMode
  cohort_mode: 'shadow' | 'v5' | null
}

export interface KpiRolloutPayload {
  config_version: string
  kill_switch: boolean
  requested_mode: KpiReaderMode
  selection_mode: KpiReaderMode
  shadow_sample_pct: number
  readiness: { rbl4: boolean; tzdata: boolean; backend: boolean }
  generated_at: string
  expires_at: string
  stores: KpiRolloutStore[]
}

export interface KpiRolloutEntry {
  payload: KpiRolloutPayload
  seq: number
}

/**
 * Décision unique d'acceptation d'une réponse de configuration :
 * - séquence non antérieure à la dernière transition legacy ;
 * - version non antérieure à la version maximale reçue.
 */
export function acceptsRolloutEntry(
  entry: KpiRolloutEntry,
  minAcceptedSeq: number,
  latestVersion: number,
): boolean {
  return (
    entry.seq >= minAcceptedSeq &&
    acceptsConfigVersion(entry.payload.config_version, latestVersion)
  )
}

export interface KpiShadowCheckPayload {
  comparable: boolean
  match: boolean
  reason?: string
  diff_count: number | null
  diff_fields: string[]
}

export async function fetchKpiRollout(
  supabase: SupabaseClient,
  storeIds: string[],
): Promise<KpiRolloutPayload> {
  const { data, error } = await supabase.rpc('rpc_dashboard_kpi_rollout', {
    p_store_ids: storeIds,
  })
  if (error) throw error
  return data as KpiRolloutPayload
}

export async function fetchKpiShadowCheck(
  supabase: SupabaseClient,
  storeId: string,
  date: string,
): Promise<KpiShadowCheckPayload> {
  const { data, error } = await supabase.rpc('rpc_dashboard_kpi_shadow_check', {
    p_store_id: storeId,
    p_date: date,
  })
  if (error) throw error
  return data as KpiShadowCheckPayload
}

export async function reportKpiRolloutEvent(
  supabase: SupabaseClient,
  input: {
    storeIds: string[]
    mode: KpiReaderMode
    event: string
    widget?: string
    durationMs?: number
    errorCode?: string
    configVersion?: string
    details?: Record<string, unknown>
  },
): Promise<void> {
  if (input.storeIds.length === 0) return
  try {
    await supabase.rpc('rpc_dashboard_kpi_rollout_event', {
      p_store_ids: input.storeIds,
      p_mode: input.mode,
      p_event: input.event,
      p_widget: input.widget ?? null,
      p_duration_ms: input.durationMs ?? null,
      p_error_code: input.errorCode ?? null,
      p_config_version: input.configVersion ? Number(input.configVersion) : null,
      p_details: input.details ?? {},
    })
  } catch {
    // La télémétrie ne doit jamais bloquer ni casser le Dashboard.
  }
}
