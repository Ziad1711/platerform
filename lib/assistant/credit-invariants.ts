/**
 * Invariants financiers de la finalisation, isolés du registre.
 *
 * Module neutre : la finalisation les importe directement, ce qui évite qu'un
 * double de test remplaçant le registre ne neutralise silencieusement la
 * validation. Aucune valeur RPC incohérente ne doit passer.
 */
export function invalidFinalizeResponse(reason: string): never {
  console.error('[assistant] finalize_response_invalid', { reason })
  throw new Error('ASSISTANT_BACKEND_UNAVAILABLE')
}

function asNonNegativeInteger(value: unknown, field: string): number {
  const numeric = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value
  if (typeof numeric !== 'number' || !Number.isSafeInteger(numeric) || numeric < 0) {
    invalidFinalizeResponse(field)
  }
  return numeric
}

/** Compteurs de finalisation : entiers ≥ 0 et débit ≤ consommation. */
export function validateFinalizeCounters(raw: unknown): { consumed: number; charged: number } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalidFinalizeResponse('finalize_row')

  const row = raw as Record<string, unknown>
  const consumed = asNonNegativeInteger(row.credits_consumed, 'credits_consumed')
  const charged = asNonNegativeInteger(row.credits_charged, 'credits_charged')
  if (charged > consumed) invalidFinalizeResponse('credits_charged_gt_consumed')

  return { consumed, charged }
}
