/**
 * Vérification blacklist côté confirmation.
 * Reprend exactement la logique utilisée dans la page Ventes :
 * entrées manuelles + nombre de statuts à risque atteint, avec possibilité
 * d'autorisation explicite (motif `__allow_override__`).
 */

const ALLOW_REASON = '__allow_override__'

export function normalizePhoneForBlacklist(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '')
  if (!digits) return ''
  return digits.length >= 9 ? digits.slice(-9) : digits
}

export async function getBlacklistedPhones(
  supabase: any,
  storeId: string,
  phones: Array<string | null | undefined>
): Promise<Set<string>> {
  const blacklisted = new Set<string>()
  const normalized = Array.from(
    new Set(phones.map(normalizePhoneForBlacklist).filter(Boolean))
  )

  if (normalized.length === 0) return blacklisted

  const { data: rule, error: ruleError } = await supabase
    .from('blacklist_rules')
    .select('is_enabled, max_status_hits, status_filters')
    .eq('store_id', storeId)
    .maybeSingle()

  // Un souci de règle blacklist ne doit jamais bloquer le travail de confirmation.
  if (ruleError || !rule || rule.is_enabled === false) return blacklisted

  const allowSet = new Set<string>()

  // Le dernier segment de 9 chiffres couvre tous les formats marocains stockés.
  const phoneFilter = normalized.map((phone) => `phone.like.%${phone}`).join(',')

  const [{ data: entries }, statusFiltersResult] = await Promise.all([
    supabase
      .from('blacklist_entries')
      .select('phone, reason')
      .eq('store_id', storeId)
      .or(phoneFilter)
      .limit(500),
    Promise.resolve(Array.isArray(rule.status_filters) ? rule.status_filters : null),
  ])

  for (const entry of (entries || []) as any[]) {
    const phone = normalizePhoneForBlacklist(entry?.phone)
    if (!phone) continue
    if (String(entry?.reason || '') === ALLOW_REASON) {
      allowSet.add(phone)
    } else {
      blacklisted.add(phone)
    }
  }

  const threshold = Number(rule.max_status_hits || 0)
  const statusFilters =
    statusFiltersResult && statusFiltersResult.length > 0
      ? statusFiltersResult
      : ['returned_not_stocked', 'returned_stocked']

  if (threshold > 0) {
    const { data: riskyOrders } = await supabase
      .from('orders')
      .select('phone')
      .eq('store_id', storeId)
      .in('status', statusFilters)
      .or(phoneFilter)
      .limit(2000)

    const counts: Record<string, number> = {}
    for (const row of (riskyOrders || []) as any[]) {
      const phone = normalizePhoneForBlacklist(row?.phone)
      if (!phone) continue
      counts[phone] = (counts[phone] || 0) + 1
    }

    for (const [phone, count] of Object.entries(counts)) {
      if (count >= threshold) blacklisted.add(phone)
    }
  }

  allowSet.forEach((phone) => blacklisted.delete(phone))

  return blacklisted
}
