// ============================================================
// Verification de la signature des webhooks AMEEX
//
// IMPORTANT : la documentation AMEEX fournie ne precise pas l'algorithme
// de signature, ni les octets signes, ni le format de l'en-tete. Cette
// implementation est donc volontairement CONSERVATRICE (fail-closed) :
//  - elle ne valide jamais un evenement en l'absence de secret configure ;
//  - elle est parametrable par variables d'environnement afin de pouvoir
//    etre alignee sur la specification reelle d'AMEEX sans changement de code.
//
// Hypotheses par defaut (a confirmer aupres d'AMEEX) :
//  - en-tete : X-Ameex-Signature
//  - algorithme : HMAC-SHA256 sur le corps brut de la requete
//  - encodage : hexadecimal (base64 egalement accepte)
// ============================================================

import { createHmac, timingSafeEqual } from 'crypto'

export const AMEEX_WEBHOOK_SIGNATURE_HEADER_DEFAULT = 'x-ameex-signature'

export function getAmeexSignatureHeaderName(): string {
  return (process.env.AMEEX_WEBHOOK_SIGNATURE_HEADER || AMEEX_WEBHOOK_SIGNATURE_HEADER_DEFAULT).trim().toLowerCase()
}

function getSignatureAlgorithm(): string {
  return (process.env.AMEEX_WEBHOOK_SIGNATURE_ALGORITHM || 'sha256').trim().toLowerCase()
}

function getSignatureEncoding(): string {
  return (process.env.AMEEX_WEBHOOK_SIGNATURE_ENCODING || 'hex').trim().toLowerCase()
}

/** Retire un eventuel prefixe du type `sha256=` ou `v1=`. */
function stripSignaturePrefix(value: string): string {
  const raw = String(value || '').trim()
  const eqIndex = raw.indexOf('=')
  if (eqIndex > 0 && /^[a-z0-9_-]+$/i.test(raw.slice(0, eqIndex))) {
    return raw.slice(eqIndex + 1).trim()
  }
  return raw
}

function safeEqual(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(provided, 'utf8')
  if (a.length !== b.length || a.length === 0) return false
  return timingSafeEqual(a, b)
}

function computeDigest(rawBody: string, secret: string, encoding: string): string {
  return createHmac(getSignatureAlgorithm(), secret).update(rawBody, 'utf8').digest(encoding as 'hex')
}

export type AmeexSignatureCheck = {
  valid: boolean
  present: boolean
  reason: string
}

/**
 * Verifie la signature d'une requete webhook AMEEX.
 * Ne leve jamais d'exception : retourne un resultat explicite.
 */
export function verifyAmeexWebhookSignature(params: {
  rawBody: string
  headers: Headers
  secret: string
}): AmeexSignatureCheck {
  const { rawBody, headers, secret } = params

  if (!secret) {
    return { valid: false, present: false, reason: 'secret_not_configured' }
  }

  const headerName = getAmeexSignatureHeaderName()
  const headerValue = stripSignaturePrefix(headers.get(headerName) || '')

  if (!headerValue) {
    return { valid: false, present: false, reason: 'signature_header_missing' }
  }

  const encodings = getSignatureEncoding() === 'base64' ? ['base64', 'hex'] : ['hex', 'base64']

  for (const encoding of encodings) {
    let digest = ''
    try {
      digest = computeDigest(rawBody, secret, encoding)
    } catch {
      return { valid: false, present: true, reason: 'signature_computation_failed' }
    }
    if (safeEqual(digest, encoding === 'hex' ? headerValue.toLowerCase() : headerValue)) {
      return { valid: true, present: true, reason: 'signature_valid' }
    }
  }

  return { valid: false, present: true, reason: 'signature_mismatch' }
}
