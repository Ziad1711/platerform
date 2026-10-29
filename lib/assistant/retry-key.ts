/**
 * Clé de rejeu frontend : lie compte, boutique, conversation et contenu.
 *
 * Un changement de compte, de boutique ou de conversation produit une clé
 * différente : l'identifiant de requête d'un autre périmètre n'est jamais réutilisé.
 */
export interface RetryScope {
  userId: string | null
  storeId: string | null
  threadId: string | null
  message: string
}

const SEPARATOR = '\u0000'

export function buildRetryKey(scope: RetryScope): string {
  const message = scope.message.trim().replace(/\s+/g, ' ')
  return [scope.userId ?? '', scope.storeId ?? '', scope.threadId ?? 'new', message].join(SEPARATOR)
}

/** Identifiant à réutiliser : uniquement si le périmètre et le contenu sont identiques. */
export function resolveRetryRequestId(
  pending: { key: string; requestId: string } | null,
  scope: RetryScope,
  generate: () => string | null
): { key: string; requestId: string } | null {
  const key = buildRetryKey(scope)
  if (pending && pending.key === key) return { key, requestId: pending.requestId }

  const requestId = generate()
  return requestId ? { key, requestId } : null
}
