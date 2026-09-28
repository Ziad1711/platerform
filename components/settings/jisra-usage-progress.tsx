'use client'

/**
 * Consommation mensuelle d'une limite d'offre Jisra (commandes, crédits IA) :
 * chiffre réel, limite de l'offre appliquée et barre accessible.
 * Le chiffre affiché reste exact même au-delà de la limite ; seule la largeur de
 * la barre est plafonnée à 100 %.
 */

/** 999999 (ou plus) = convention « illimité » du catalogue d'offres. */
export const UNLIMITED_THRESHOLD = 999999

export function formatCount(value: number) {
  return value.toLocaleString('fr-FR')
}

export function isUnlimited(limit?: number | null) {
  return limit === null || limit === undefined || limit >= UNLIMITED_THRESHOLD
}

/** Limite lisible : « Illimité » pour la convention du catalogue, sinon le chiffre. */
export function formatLimit(limit?: number | null) {
  if (limit === null || limit === undefined) return '—'
  return isUnlimited(limit) ? 'Illimité' : formatCount(Number(limit))
}

export function formatPrice(price?: number | string | null) {
  const value = Number(price ?? 0)
  return Number.isFinite(value) ? value.toLocaleString('fr-FR') : '0'
}

/** Part consommée du quota, plafonnée à 100 % pour l'affichage de la barre. */
export function progressPercent(used: number, limit: number) {
  if (!Number.isFinite(limit) || limit <= 0) return 0
  return Math.min(100, Math.round((used / limit) * 100))
}

type UsageProgressProps = {
  label: string
  used: number
  limit?: number | null
  /** Libellé au singulier (« commande », « crédit »). */
  unitOne: string
  /** Libellé au pluriel (« commandes », « crédits »). */
  unitMany: string
  unlimitedMessage: string
  note?: string
}

export default function UsageProgress({
  label,
  used,
  limit,
  unitOne,
  unitMany,
  unlimitedMessage,
  note,
}: UsageProgressProps) {
  const unlimited = isUnlimited(limit)
  const numericLimit = unlimited ? null : Number(limit)
  const percent = numericLimit === null ? 0 : progressPercent(used, numericLimit)
  const remaining = numericLimit === null ? null : Math.max(0, numericLimit - used)
  const overQuota = numericLimit !== null && used > numericLimit
  const barClass = overQuota ? 'bg-red-500' : percent >= 80 ? 'bg-amber-500' : 'bg-primary'
  const plural = (count: number) => (count > 1 ? unitMany : unitOne)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-sm text-foreground">
          <span className={overQuota ? 'font-semibold text-red-600' : 'font-semibold'}>
            {formatCount(used)}
          </span>{' '}
          / {numericLimit === null ? 'Illimité' : formatCount(numericLimit)}
        </p>
      </div>

      {numericLimit === null ? (
        <p className="text-xs text-muted-foreground">{unlimitedMessage}</p>
      ) : (
        <>
          <div
            role="progressbar"
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={numericLimit}
            aria-valuenow={used}
            aria-valuetext={`${formatCount(used)} sur ${formatCount(numericLimit)} ${unitMany}`}
            className="h-2.5 w-full overflow-hidden rounded-full bg-secondary"
          >
            <div
              className={`h-full rounded-full transition-all duration-300 ${barClass}`}
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
            <span className={overQuota ? 'text-red-600' : 'text-muted-foreground'}>
              {overQuota
                ? `Quota dépassé de ${formatCount(used - numericLimit)} ${plural(used - numericLimit)}`
                : `Restant : ${formatCount(remaining ?? 0)} ${plural(remaining ?? 0)}`}
            </span>
            <span className="text-muted-foreground">{percent}% utilisés</span>
          </div>
          {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
        </>
      )}
    </div>
  )
}
