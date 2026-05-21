// ============================================================
// Logger structuré pour les opérations delivery
// Persiste les logs dans delivery_provider_logs
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { LogLevel, LogEntry } from './types'

type AdminClient = SupabaseClient<any, 'public', any>

/**
 * Crée un logger pour une intégration delivery spécifique
 */
export function createDeliveryLogger(params: {
  admin: AdminClient
  integrationId: string
  storeId: string
  userId: string
}) {
  const { admin, integrationId, storeId, userId } = params

  function log(level: LogLevel, action: string, message: string, details?: Record<string, unknown>) {
    const entry: LogEntry = {
      level,
      action,
      integrationId,
      storeId,
      userId,
      message,
      details,
      createdAt: new Date().toISOString(),
    }

    // Console fallback
    const prefix = `[delivery:${action}]`
    if (level === 'error') console.error(prefix, message, details || '')
    else if (level === 'warn') console.warn(prefix, message, details || '')
    else console.log(prefix, message, details || '')

    // Persist in DB (fire-and-forget, ne doit pas bloquer)
    Promise.resolve(
      admin.from('delivery_provider_logs').insert({
        level,
        action,
        integration_id: integrationId,
        store_id: storeId,
        user_id: userId,
        message,
        details: details || null,
        created_at: entry.createdAt,
      })
    ).then((result: { error: any }) => {
      if (result.error) console.error('[delivery:logger] failed to persist log', result.error)
    }).catch((err: unknown) => {
      console.error('[delivery:logger] failed to persist log', err)
    })

    return entry
  }

  return {
    info: (action: string, message: string, details?: Record<string, unknown>) => log('info', action, message, details),
    warn: (action: string, message: string, details?: Record<string, unknown>) => log('warn', action, message, details),
    error: (action: string, message: string, details?: Record<string, unknown>) => log('error', action, message, details),
  }
}

export type DeliveryLogger = ReturnType<typeof createDeliveryLogger>
