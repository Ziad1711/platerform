/** Messages renvoyés par les routes API du module de confirmation. */

const BAD_REQUEST_CODES = [
  'MISSING_STORE_ID',
  'MISSING_ORDER_ID',
  'INVALID_ACTION',
  'INVALID_MAX_ATTEMPTS',
  'MISSING_CALLBACK_DATETIME',
  'MISSING_CANCELLATION_REASON',
  'MISSING_CANCELLATION_NOTE',
  'INVALID_CALLBACK_DATETIME',
  'MISSING_CUSTOMER_NAME',
  'MISSING_PHONE',
  'MISSING_CITY',
  'MISSING_DELIVERY_COMPANY',
  'INVALID_ITEMS',
  'EMPTY_ITEMS',
  'INVALID_ITEM_PRODUCT',
  'INVALID_ITEM_QUANTITY',
  'INVALID_ITEM_PRICE',
  'PRODUCT_NOT_IN_STORE',
  'VARIANT_NOT_IN_PRODUCT',
  'DELIVERY_COMPANY_NOT_IN_STORE',
  'MISSING_ITEMS',
]

const CONFLICT_CODES = [
  'ORDER_NOT_CONFIRMABLE',
  'ORDER_ALREADY_UPDATED',
  'ORDER_NOT_EDITABLE',
  'ORDER_ALREADY_SHIPPED',
]

export function getConfirmationErrorStatus(message: string) {
  if (message === 'UNAUTHORIZED') return 401
  if (message === 'FORBIDDEN' || message === 'FORBIDDEN_STORE') return 403
  if (message === 'ORDER_NOT_FOUND') return 404
  if (CONFLICT_CODES.includes(message)) return 409
  if (BAD_REQUEST_CODES.includes(message)) return 400
  return 500
}

/** Les erreurs PostgREST encapsulent le message SQL : on teste par inclusion. */
export function resolveConfirmationErrorStatus(rawMessage: string) {
  const message = String(rawMessage || '')
  const codes = [
    'UNAUTHORIZED',
    'FORBIDDEN',
    'ORDER_NOT_FOUND',
    ...CONFLICT_CODES,
    ...BAD_REQUEST_CODES,
  ]
  for (const code of codes) {
    if (message.includes(code)) {
      return getConfirmationErrorStatus(code)
    }
  }
  return 500
}
