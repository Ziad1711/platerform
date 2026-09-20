import { z } from 'zod'

/** UUID accepté, chaîne vide/null converties en `null` pour les champs optionnels. */
const optionalUuid = z.preprocess((value) => {
  if (value === null || value === undefined) return null
  const raw = String(value).trim()
  return raw === '' ? null : raw
}, z.string().uuid().nullable())

const positiveQuantity = z.coerce.number().int().positive().max(10000)

const optionalAmount = z.coerce.number().nonnegative().max(100000000).optional()

const optionalText = (max: number) =>
  z.preprocess((value) => {
    if (value === null || value === undefined) return undefined
    const raw = String(value).trim()
    return raw === '' ? undefined : raw
  }, z.string().max(max).optional())

const optionalDate = z.preprocess((value) => {
  if (value === null || value === undefined) return undefined
  const raw = String(value).trim()
  return raw === '' ? undefined : raw
}, z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Date invalide (format ISO 8601 attendu)')
  .optional())

export const availabilityBodySchema = z.object({
  items: z
    .array(
      z.object({
        product_id: z.string().trim().uuid('product_id doit être un UUID Jisra'),
        product_variant_id: optionalUuid,
        quantity: positiveQuantity,
      })
    )
    .min(1, 'Au moins un article est requis')
    .max(100, 'Maximum 100 articles par vérification'),
})

export const orderItemSchema = z.object({
  product_id: z.string().trim().uuid('product_id doit être un UUID Jisra'),
  product_name: optionalText(200),
  product_sku: optionalText(120),
  product_variant_id: optionalUuid,
  quantity: positiveQuantity,
  unit_selling_price: optionalAmount,
})

export const orderBodySchema = z.object({
  idempotency_key: z.string().trim().min(1, 'idempotency_key est requis').max(190),
  external_order_id: z.string().trim().min(1, 'external_order_id est requis').max(190),
  customer_name: z.string().trim().min(1, 'customer_name est requis').max(190),
  phone: optionalText(40),
  city: optionalText(120),
  address: optionalText(500),
  total_selling_price: optionalAmount,
  delivery_charge_to_customer: optionalAmount,
  delivery_note: optionalText(500),
  discount_type: z.enum(['fixed', 'amount', 'percentage']).optional(),
  discount_value: optionalAmount,
  discount_amount: optionalAmount,
  subtotal_amount: optionalAmount,
  source: z.enum(['organic', 'ads', 'recommendation']).optional(),
  order_date: optionalDate,
  items: z
    .array(orderItemSchema)
    .min(1, 'Au moins un article est requis')
    .max(100, 'Maximum 100 articles par commande'),
})

export type AvailabilityBody = z.infer<typeof availabilityBodySchema>
export type OrderBody = z.infer<typeof orderBodySchema>

export type ValidationDetail = { field: string; message: string }

export function toValidationDetails(error: z.ZodError): ValidationDetail[] {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join('.') : 'body',
    message: issue.message,
  }))
}
