/**
 * Messages métier des limites d'offre Jisra.
 *
 * Les codes sont levés par la base (migrations 20260928020100 et suivantes) au
 * moment de la création : `orders` (quota mensuel de commandes) et `stores`.
 * L'interface et les routes API traduisent ces codes en message utilisateur.
 */
export const QUOTA_MESSAGES: Record<string, string> = {
  QUOTA_ORDER_LIMIT_REACHED:
    "Limite de commandes de votre offre Jisra atteinte pour ce mois. Passez à une offre supérieure pour continuer à enregistrer des commandes.",
  QUOTA_STORES_LIMIT_REACHED:
    "Limite de stores de votre offre Jisra atteinte. Passez à une offre supérieure pour créer un store supplémentaire.",
}

/** Code de quota contenu dans un message d'erreur, sinon null. */
export function quotaCodeFromMessage(message?: string | null): string | null {
  if (!message) return null

  return Object.keys(QUOTA_MESSAGES).find((code) => message.includes(code)) || null
}

/** Le code transmis est-il un code de quota d'offre connu ? */
export function isQuotaCode(code?: string | null): boolean {
  if (!code) return false

  return Object.keys(QUOTA_MESSAGES).includes(code)
}

/** Message utilisateur associé à une erreur de quota, sinon null. */
export function describeQuotaError(message?: string | null): string | null {
  const code = quotaCodeFromMessage(message)

  return code ? QUOTA_MESSAGES[code] : null
}
