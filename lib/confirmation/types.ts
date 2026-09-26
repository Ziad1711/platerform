import type { ConfirmationAction } from './constants'

export type ConfirmationSettings = {
  store_id: string
  max_attempts: number
  auto_cancel_on_max_attempts: boolean
  require_cancellation_reason: boolean
  require_callback_datetime: boolean
}

export type ConfirmationQueueFilter =
  | 'to_process'
  | 'to_callback'
  | 'late'
  | 'confirmed'
  | 'cancelled'
  | 'all'

/** Ordre d'affichage des commandes dans une file. */
export type ConfirmationSortOrder = 'recent' | 'oldest' | 'callback'

export type ConfirmationOrder = {
  id: string
  store_id: string
  customer_name: string | null
  phone: string | null
  city: string | null
  address: string | null
  status: string
  order_date: string | null
  total_selling_price: number | null
  delivery_charge_to_customer: number | null
  delivery_company_id: string | null
  tracking_number: string | null
  delivery_note: string | null
  confirmation_attempt_count: number
  next_callback_at: string | null
  confirmation_last_action_at: string | null
  cancellation_reason_code: string | null
  cancellation_note: string | null
  confirmation_agent_id: string | null
  confirmation_agents?: { name: string | null } | null
  confirmation_assigned_at: string | null
  confirmation_assignment_source: string | null
  /** Avertissement calculé côté serveur, informatif uniquement. */
  is_blacklisted?: boolean
  delivery_companies?: { name: string | null } | null
  order_items?: Array<{
    product_id: string | null
    product_variant_id: string | null
    quantity: number | null
    product_name_override: string | null
    unit_selling_price: number | null
    products: {
      name: string | null
      product_images: Array<{
        image_url: string | null
        is_primary: boolean | null
        sort_order: number | null
      }> | null
    } | null
  }> | null
}

export type ConfirmationEvent = {
  id: string
  order_id: string
  actor_user_id: string | null
  agent_id: string | null
  event_type: string
  from_status: string | null
  to_status: string | null
  attempt_number: number | null
  callback_at: string | null
  reason_code: string | null
  note: string | null
  created_at: string
}

export type ConfirmationActionInput = {
  orderId: string
  action: ConfirmationAction
  callbackAt?: string | null
  reasonCode?: string | null
  note?: string | null
  expectedStatus?: string | null
  expectedAttemptCount?: number | null
}

export type ConfirmationActionResponse = {
  orderId: string
  action: ConfirmationAction
  fromStatus: string
  status: string
  attemptCount: number
  attemptNumber: number | null
  maxAttempts: number
  autoCancelled: boolean
  limitReached: boolean
  /** Résultat de la création du colis, uniquement pour l'action CONFIRM. */
  parcel?: {
    created: boolean
    trackingNumber: string | null
    warning: string | null
  }
}
