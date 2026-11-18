// Intentionally not an HTTP endpoint. Both the explicit invocation and the
// short expiry are required. No outbox, database writes or financial events.
import { createHash, randomUUID } from 'node:crypto'
import { sendMetaPayload } from '../lib/analytics/meta-transport.mjs'

const now = Date.now()
const expires = Date.parse(process.env.META_TEST_EXPIRES_AT ?? '')
const code = process.env.META_TEST_EVENT_CODE?.trim()
const token = process.env.META_CAPI_ACCESS_TOKEN?.trim()
const pixel = process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim()
if (process.argv.length !== 3 || process.argv[2] !== '--send-test' || !Number.isFinite(expires) ||
  expires <= now || expires > now + 15 * 60_000 || !/^TEST\d{4,12}$/.test(code ?? '') ||
  !token || pixel !== '1667072028155904' || process.env.JISRA_QUALIFICATION === '1' || process.env.JISRA_Q4_RUNNER === '1') {
  console.error('META_TEST_REFUSED: configuration absente, cible non autorisée ou fenêtre invalide.')
  process.exitCode = 2
} else {
  const subject = createHash('sha256').update(randomUUID()).digest('hex')
  for (const [event_name, path] of [['PageView', '/'], ['ViewContent', '/pricing']]) {
    const event_id = randomUUID()
    const result = await sendMetaPayload({ pixel, token, testCode: code, event: {
      event_name, event_id, event_time: Math.floor(Date.now() / 1000), action_source: 'website',
      event_source_url: new URL(path, 'https://jisra.io').href,
      user_data: { external_id: [subject], client_user_agent: 'Jisra Meta Test Events' },
    } })
    console.log(JSON.stringify({ event_name, event_id, ...result }))
    if (!result.ok) { process.exitCode = 1; break }
  }
}