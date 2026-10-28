/**
 * Validation runtime des réponses RPC analytiques.
 *
 * Les payloads proviennent d'une base : leur forme n'est pas garantie par
 * TypeScript. Toute réponse est donc validée avant lecture, et une réponse
 * invalide produit `invalid` — jamais des zéros ni une valeur partielle
 * silencieuse.
 */
import { z } from 'zod'
import type { KpiReaderPayload } from '@/lib/dashboard/kpi-reader'

const numericLike = z.union([z.number(), z.string()])

/** Entier strictement valide : pas de fraction, pas de négatif, pas de `NaN`. */
const counterLike = z.union([
  z.number().int().nonnegative().refine((value) => Number.isSafeInteger(value), {
    message: 'compteur hors plage sûre',
  }),
  z
    .string()
    .regex(/^\d+$/)
    .transform((value) => Number(value))
    .refine((value) => Number.isSafeInteger(value), { message: 'compteur hors plage sûre' }),
])

/** Décimal strict : chaîne décimale finie ou nombre JavaScript fini. */
const decimalLike = z.union([
  z.string().regex(/^-?\d+(\.\d+)?$/),
  z.number().finite(),
])

/** Nombre d'origine non fiable : `NaN`, `Infinity`, booléens, objets. */
const strictDecimal = decimalLike.refine((value) => typeof value === 'string' || Number.isFinite(value), {
  message: 'montant non fini',
})

export const KpiReaderPointSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  state: z.string().min(1),
  partial: z.boolean(),
  orders_count: z.number(),
  delivered_count: z.number(),
  cancelled_count: z.number(),
  returned_count: z.number(),
  pending_count: z.number(),
  unclassified_count: z.number(),
  revenue: numericLike,
  ads: numericLike,
  purchase_cost: numericLike.optional(),
  delivery_fee_cost: numericLike.optional(),
  contribution_margin: numericLike.optional(),
})

export const KpiReaderTotalsSchema = z.object({
  orders_count: z.number(),
  delivered_count: z.number(),
  cancelled_count: z.number(),
  returned_count: z.number(),
  refunded_count: z.number().optional(),
  refused_count: z.number().optional(),
  pending_count: z.number().optional(),
  unclassified_count: z.number().optional(),
  revenue: numericLike,
  revenue_estimated: numericLike,
  discount_amount: numericLike.optional(),
  delivery_charge_customer: numericLike.optional(),
  ads_tracked: numericLike.optional(),
  ads_fallback: numericLike.optional(),
  ad_spend_contract: numericLike,
  ads_daily_days: z.number().optional(),
  aov: numericLike.optional(),
  delivery_rate: numericLike,
  cpl: numericLike.optional(),
  cpa: numericLike.optional(),
  roas: numericLike.optional(),
  purchase_cost: numericLike.optional(),
  delivery_fee_cost: numericLike.optional(),
  confirmation_cost: numericLike.optional(),
  contribution_margin: numericLike.optional(),
  margin_rate: numericLike.optional(),
  quality: z.record(z.string(), z.unknown()).optional(),
})

export const KpiReaderStoreSchema = z.object({
  store_id: z.string().uuid(),
  access: z.enum(['full', 'commercial']),
  currency: z.string().min(1),
  tz: z.string().min(1),
  definition_version: z.number().int(),
  revision: z.union([z.string(), z.number()]).transform((value) => String(value)),
  last_rebuild_at: z.string().nullable().optional(),
  coverage: z.object({
    days_total: z.number(),
    days_aggregate: z.number(),
    days_direct: z.number(),
    days_dirty: z.number(),
    days_missing: z.number(),
    days_incompatible: z.number(),
    days_partial: z.number(),
  }),
  incomplete: z.boolean(),
  totals: KpiReaderTotalsSchema,
  points: z.array(KpiReaderPointSchema),
})

export const KpiReaderPayloadSchema = z.object({
  definition_version: z.number().int(),
  range: z.object({ from: z.string(), to: z.string() }),
  generated_at: z.string(),
  direct_budget: z.record(z.string(), z.unknown()).optional(),
  incomplete: z.boolean(),
  stores: z.array(KpiReaderStoreSchema),
  currencies: z.array(z.record(z.string(), z.unknown())).optional(),
})

export type KpiValidationResult =
  | { ok: true; payload: KpiReaderPayload; issues: [] }
  | { ok: false; issues: string[] }

/** Valide le payload V5 ; toute anomalie structurelle bloque l'interprétation. */
export function validateKpiPayload(raw: unknown): KpiValidationResult {
  const parsed = KpiReaderPayloadSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join('.') || 'payload'}: ${issue.message}`),
    }
  }
  return { ok: true, payload: parsed.data as unknown as KpiReaderPayload, issues: [] }
}

/**
 * Valide une **liste** de lignes RPC.
 *
 * Un objet non tabulaire (ex. `{ error: 'bad' }`) est un échec de contrat :
 * il ne doit jamais devenir un tableau vide, qui serait interprété comme
 * « aucune donnée » et donc comme un zéro réel.
 */
export function validateRows<T>(
  schema: z.ZodType<T>,
  raw: unknown,
): { ok: true; rows: T[] } | { ok: false; issues: string[] } {
  if (!Array.isArray(raw)) {
    return { ok: false, issues: [`ROW_SET_NOT_TABULAR:${raw === null ? 'null' : typeof raw}`] }
  }

  const parsed = z.array(schema).safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join('.') || 'row'}: ${issue.message}`),
    }
  }
  return { ok: true, rows: parsed.data }
}

export const ConfirmationFunnelRowSchema = z.object({
  total_orders: counterLike,
  confirmed_orders: counterLike,
  sent_orders: counterLike,
  waiting_pickup_orders: counterLike,
  delivered_orders: counterLike,
  returned_orders: counterLike,
  cancelled_orders: counterLike,
  pending_orders: counterLike,
})

export const AgentPerformanceRowSchema = z.object({
  agent_id: z.string().uuid().nullable(),
  agent_name: z.string().nullable(),
  total_orders: counterLike,
  confirmed_orders: counterLike,
  delivered_orders: counterLike,
  rejected_orders: counterLike,
  potential_commission: strictDecimal.nullable().optional(),
  earned_commission: strictDecimal.nullable().optional(),
  paid_commission: strictDecimal.nullable().optional(),
  confirmation_rate: strictDecimal.nullable().optional(),
})

export const CityPerformanceRowSchema = z.object({
  city: z.string().nullable(),
  total_orders: counterLike,
  confirmed_orders: counterLike,
  delivered_orders: counterLike,
  returned_orders: counterLike,
  cancelled_orders: counterLike,
  total_revenue: strictDecimal.nullable(),
})

export const TopProductRowSchema = z.object({
  product_id: z.string().uuid().nullable(),
  product_name: z.string().nullable(),
  total_quantity: counterLike.nullable(),
  total_revenue: strictDecimal.nullable(),
  profit: strictDecimal.nullable(),
})

export type ConfirmationFunnelRow = z.infer<typeof ConfirmationFunnelRowSchema>
export type AgentPerformanceRpcRow = z.infer<typeof AgentPerformanceRowSchema>
export type CityPerformanceRpcRow = z.infer<typeof CityPerformanceRowSchema>
export type TopProductRpcRow = z.infer<typeof TopProductRowSchema>
