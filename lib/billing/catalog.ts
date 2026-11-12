import { z } from 'zod'

export const catalogPriceSchema = z.object({
  price_id: z.string().uuid(),
  plan_id: z.string().uuid(),
  code: z.string().min(1),
  name: z.string().min(1),
  rank: z.number().int().nonnegative(),
  billing_period: z.enum(['monthly', 'yearly']),
  duration_months: z.union([z.literal(1), z.literal(12)]),
  amount_minor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  currency: z.literal('MAD'),
  version: z.number().int().positive(),
  valid_from: z.string(),
  valid_until: z.string().nullable(),
  monthly_equivalent_minor: z.number().nonnegative(),
  requires_payment: z.boolean(),
  commitment_months: z.number().int().nonnegative(),
  order_limit: z.number().int(),
  stores_limit: z.number().int(),
  ai_credits_monthly: z.number().int(),
  delivery_integrations_limit: z.number().int(),
  confirmation_agents_limit: z.number().int(),
  ads_automation_enabled: z.boolean(),
  api_access_enabled: z.boolean(),
}).superRefine((price, ctx) => {
  if (price.duration_months !== (price.billing_period === 'monthly' ? 1 : 12)
    || price.requires_payment !== (price.amount_minor > 0)
    || price.commitment_months !== (price.requires_payment ? price.duration_months : 0)
    || Math.abs(price.monthly_equivalent_minor - price.amount_minor / price.duration_months) > 0.001) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Catalogue incohérent' })
  }
})

export const publicCatalogSchema = z.array(catalogPriceSchema).min(1)
export type CatalogPrice = z.infer<typeof catalogPriceSchema>