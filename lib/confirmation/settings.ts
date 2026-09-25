import { DEFAULT_MAX_ATTEMPTS } from './constants'
import type { ConfirmationSettings } from './types'

export const CONFIRMATION_SETTINGS_SELECT =
  'store_id, max_attempts, auto_cancel_on_max_attempts, require_cancellation_reason, require_callback_datetime'

export type ConfirmationSettingsRow = {
  store_id?: string | null
  max_attempts?: number | null
  auto_cancel_on_max_attempts?: boolean | null
  require_cancellation_reason?: boolean | null
  require_callback_datetime?: boolean | null
}

/**
 * Valeurs par défaut du store : 6 appels puis annulation automatique.
 * L'absence de ligne dans `confirmation_settings` ne doit jamais bloquer l'agent.
 */
export function normalizeSettings(
  row: ConfirmationSettingsRow | null,
  storeId: string
): ConfirmationSettings {
  return {
    store_id: storeId,
    max_attempts: Number(row?.max_attempts ?? DEFAULT_MAX_ATTEMPTS),
    auto_cancel_on_max_attempts: row?.auto_cancel_on_max_attempts !== false,
    require_cancellation_reason: row?.require_cancellation_reason !== false,
    require_callback_datetime: row?.require_callback_datetime !== false,
  }
}
