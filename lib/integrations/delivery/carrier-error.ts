// ============================================================
// Erreur transporteur structuree : remplace la classification par regex
// sur `error.message` (fragile, perte du code 401/403 chez Rapid/Maroc Go).
//
// Une panne transporteur expose toujours :
//  - code : categorie stable (auth / rate_limited / server / timeout / ...) ;
//  - httpStatus : code HTTP quand il existe ;
//  - retryAfterSeconds : delai recommande (Retry-After) ou null ;
//  - retryable : peut-on reessayer plus tard.
// ============================================================

export type CarrierErrorCode = 'auth' | 'rate_limited' | 'server' | 'timeout' | 'network' | 'unknown'

export class CarrierError extends Error {
  readonly code: CarrierErrorCode
  readonly httpStatus: number | null
  readonly retryAfterSeconds: number | null
  readonly retryable: boolean

  constructor(opts: {
    message: string
    code: CarrierErrorCode
    httpStatus?: number | null
    retryAfterSeconds?: number | null
    retryable?: boolean
  }) {
    super(opts.message)
    this.name = 'CarrierError'
    this.code = opts.code
    this.httpStatus = opts.httpStatus ?? null
    this.retryAfterSeconds = opts.retryAfterSeconds ?? null
    this.retryable =
      opts.retryable ??
      (opts.code === 'rate_limited' || opts.code === 'server' || opts.code === 'timeout' || opts.code === 'network')
  }
}

/** Parse un en-tete `Retry-After` (secondes OU date HTTP). */
export function parseRetryAfterSeconds(value: string | null): number | null {
  if (!value) return null
  const trimmed = value.trim()
  const seconds = Number(trimmed)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds)
  const date = Date.parse(trimmed)
  if (Number.isFinite(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000))
  return null
}

/** Construit une CarrierError a partir d'un statut HTTP et d'un Retry-After. */
export function carrierErrorFromStatus(opts: {
  status: number
  retryAfterSeconds?: number | null
  message: string
}): CarrierError {
  const { status } = opts
  let code: CarrierErrorCode = 'unknown'
  if (status === 401 || status === 403) code = 'auth'
  else if (status === 429) code = 'rate_limited'
  else if (status >= 500) code = 'server'
  return new CarrierError({
    message: opts.message,
    code,
    httpStatus: status,
    retryAfterSeconds: opts.retryAfterSeconds ?? null,
  })
}
