import crypto from 'crypto'

const ENCRYPTION_PREFIX = 'v1'

function getEncryptionKey() {
  const raw = process.env.INTEGRATIONS_ENCRYPTION_KEY || ''
  if (!raw) throw new Error('MISSING_INTEGRATIONS_ENCRYPTION_KEY')

  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) throw new Error('INVALID_INTEGRATIONS_ENCRYPTION_KEY')

  return key
}

export function isEncryptedSecret(value: string | null | undefined) {
  return String(value || '').startsWith(`${ENCRYPTION_PREFIX}:`)
}

export function encryptSecret(value: string) {
  const plain = String(value || '')
  if (!plain) return ''
  if (isEncryptedSecret(plain)) return plain

  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return `${ENCRYPTION_PREFIX}:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`
}

export function decryptSecret(value: string) {
  const secret = String(value || '')
  if (!secret) return ''
  if (!isEncryptedSecret(secret)) return secret

  const [prefix, ivRaw, tagRaw, payloadRaw] = secret.split(':')
  if (prefix !== ENCRYPTION_PREFIX || !ivRaw || !tagRaw || !payloadRaw) {
    throw new Error('INVALID_ENCRYPTED_SECRET_FORMAT')
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(ivRaw, 'base64'))
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64'))

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payloadRaw, 'base64')),
    decipher.final(),
  ])

  return decrypted.toString('utf8')
}