import 'server-only'

/** Vérification binaire indépendante du nom de fichier. Jamais de rendu inline. */
export function checkedProofMime(bytes: Buffer, mime: string) {
  const text = bytes.toString('latin1')
  if (mime === 'image/png' && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return mime
  if (mime === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return mime
  if (mime === 'application/pdf' && text.startsWith('%PDF-') && text.trimEnd().endsWith('%%EOF')
    && !/\/(JavaScript|JS|Launch|EmbeddedFile|OpenAction|AA|XFA|RichMedia)\b/i.test(text)) return mime
  throw new Error('PAYMENT_INVALID')
}