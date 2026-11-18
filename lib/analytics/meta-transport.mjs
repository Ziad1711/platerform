/** Shared CAPI transport. Normal traffic never reads a test code from the environment. */
export async function sendMetaPayload({ pixel, token, event, testCode }) {
  if (!/^\d{5,25}$/.test(pixel) || !token || (testCode !== undefined && !/^TEST\d{4,12}$/.test(testCode))) {
    return { ok: false, status: 0, received: 0, errorCode: null }
  }
  try {
    const response = await fetch(`https://graph.facebook.com/v25.0/${pixel}/events`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(4000), cache: 'no-store',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [event], ...(testCode ? { test_event_code: testCode } : {}) }),
    })
    const result = await response.json().catch(() => null)
    const received = Number.isSafeInteger(result?.events_received) ? result.events_received : 0
    const errorCode = Number.isSafeInteger(result?.error?.code) ? result.error.code : null
    return { ok: response.ok && received === 1 && !result?.error, status: response.status, received, errorCode }
  } catch { return { ok: false, status: 0, received: 0, errorCode: null } }
}