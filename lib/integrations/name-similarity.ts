function levenshtein(a: string, b: string) {
  const left = Array.from(a)
  const right = Array.from(b)
  const dp = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0))

  for (let i = 0; i <= left.length; i += 1) dp[i][0] = i
  for (let j = 0; j <= right.length; j += 1) dp[0][j] = j

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    }
  }

  return dp[left.length][right.length]
}

export function normalizeIntegrationName(value: string) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '')
    .trim()
}

export function getNameSimilarity(left: string, right: string) {
  const a = normalizeIntegrationName(left)
  const b = normalizeIntegrationName(right)
  if (!a || !b) return 0
  if (a === b) return 1

  const distance = levenshtein(a, b)
  return 1 - distance / Math.max(a.length, b.length, 1)
}

export function isLikelyNameMatch(left: string, right: string, threshold = 0.8) {
  const a = normalizeIntegrationName(left)
  const b = normalizeIntegrationName(right)
  if (!a || !b) return false
  if (a === b) return true
  return getNameSimilarity(a, b) >= threshold
}