const keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_id', 'utm_content', 'campaign_id', 'adset_id', 'ad_id', 'fbclid'] as const
export const metaObjectId = /^\d{5,25}$/

export function acquisitionTouch(query: URLSearchParams) {
  const touch: Record<string, string> = {}
  for (const key of keys) {
    const value = query.get(key)?.trim()
    if (!value || query.getAll(key).length !== 1) continue
    if (key === 'fbclid' ? /^[\w-]{1,250}$/.test(value) : key.endsWith('_id') && key !== 'utm_id'
      ? metaObjectId.test(value) : /^[\p{L}\p{N} ._+-]{1,120}$/u.test(value)) touch[key] = value
  }
  // A direct visit or another channel is not a Meta touch.
  if (!touch.fbclid && !/^(fb|ig|facebook|instagram|meta|msg|an)$/.test(touch.utm_source?.toLowerCase() ?? '')) return null
  if (!touch.campaign_id && metaObjectId.test(touch.utm_id ?? '')) touch.campaign_id = touch.utm_id
  return touch
}