/**
 * Tests ciblés du candidat final — local, sans réseau ni base.
 * Couvre : compteurs de finalisation, rejets du registre, clé de retry.
 */
// Le registre doit être actif pour tester ses transitions.
process.env.ASSISTANT_IDEMPOTENCY_REGISTRY = 'enabled'

const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const ROOT = path.resolve(__dirname, '..')

const results = []
const check = async (name, fn) => {
  try {
    await fn()
    results.push([name, 'PASS', ''])
  } catch (error) {
    results.push([name, 'FAIL', error instanceof Error ? error.message : 'erreur'])
  }
}

async function main() {
  const idem = await import(pathToFileURL(path.join(ROOT, 'lib/assistant/idempotency.ts')).href)
  const retry = await import(pathToFileURL(path.join(ROOT, 'lib/assistant/retry-key.ts')).href)

  const UUID = '11111111-1111-4111-8111-111111111111'
  const rejects = (fn) => {
    try {
      fn()
      return null
    } catch (error) {
      return error instanceof Error ? error.message : 'erreur'
    }
  }
  const client = (reply) => ({ rpc: async () => reply })
  const identity = { requestId: 'r', storeId: 's', threadId: null, fingerprint: 'f'.repeat(64) }

  await check('F01 compteurs valides', () => {
    assert.deepEqual(idem.validateFinalizeCounters({ credits_consumed: 3, credits_charged: 3 }), { consumed: 3, charged: 3 })
  })
  await check('F02 débit > consommation rejeté', () => {
    assert.equal(rejects(() => idem.validateFinalizeCounters({ credits_consumed: 2, credits_charged: 3 })), 'ASSISTANT_BACKEND_UNAVAILABLE')
  })
  await check('F03 compteur négatif rejeté', () => {
    assert.equal(rejects(() => idem.validateFinalizeCounters({ credits_consumed: -1, credits_charged: 0 })), 'ASSISTANT_BACKEND_UNAVAILABLE')
  })
  await check('F04 compteur flottant rejeté', () => {
    assert.equal(rejects(() => idem.validateFinalizeCounters({ credits_consumed: 1.5, credits_charged: 1 })), 'ASSISTANT_BACKEND_UNAVAILABLE')
  })
  await check('F05 bigint texte accepté', () => {
    assert.deepEqual(idem.validateFinalizeCounters({ credits_consumed: '4', credits_charged: '0' }), { consumed: 4, charged: 0 })
  })
  await check('F06 réponse non objet rejetée', () => {
    assert.equal(rejects(() => idem.validateFinalizeCounters(null)), 'ASSISTANT_BACKEND_UNAVAILABLE')
  })

  await check('R01 acquisition valide', async () => {
    const out = await idem.beginAssistantRequest(
      client({ data: [{ state: 'in_progress', attempt_token: UUID, credit_status: 'not_charged' }], error: null }),
      identity
    )
    assert.equal(out.status, 'proceed')
    assert.equal(out.attemptToken, UUID)
  })
  await check('R02 rejeu conserve le statut de débit', async () => {
    const out = await idem.beginAssistantRequest(
      client({ data: [{ state: 'completed', attempt_token: UUID, thread_id: UUID, assistant_message_id: UUID, credit_status: 'charged' }], error: null }),
      identity
    )
    assert.equal(out.status, 'replay')
    assert.equal(out.creditStatus, 'charged')
    assert.equal(out.threadId, UUID)
  })
  await check('R03 jeton absent bloqué avant IA', async () => {
    await assert.rejects(
      idem.beginAssistantRequest(client({ data: [{ state: 'in_progress', credit_status: 'not_charged' }], error: null }), identity),
      /ASSISTANT_BACKEND_UNAVAILABLE/
    )
  })
  await check('R04 statut financier inconnu bloqué', async () => {
    await assert.rejects(
      idem.beginAssistantRequest(
        client({ data: [{ state: 'completed', attempt_token: UUID, thread_id: UUID, credit_status: 'gratuit' }], error: null }),
        identity
      ),
      /ASSISTANT_BACKEND_UNAVAILABLE/
    )
  })
  await check('R05 conflit et occupation distingués', async () => {
    const conflict = await idem.beginAssistantRequest(client({ data: null, error: { message: 'IDEMPOTENCY_CONFLICT' } }), identity)
    const busy = await idem.beginAssistantRequest(client({ data: null, error: { message: 'IDEMPOTENCY_IN_PROGRESS' } }), identity)
    assert.equal(conflict.status, 'conflict')
    assert.equal(busy.status, 'in_progress')
  })
  await check('R06 RPC indisponible => erreur fermée', async () => {
    await assert.rejects(
      idem.beginAssistantRequest(client({ data: null, error: { message: 'function does not exist', code: '42883' } }), identity),
      /ASSISTANT_BACKEND_UNAVAILABLE/
    )
  })

  const base = { userId: 'u1', storeId: 's1', threadId: 't1', message: 'Analyse mes ventes' }
  await check('K01 même périmètre => même clé', () => {
    assert.equal(retry.buildRetryKey(base), retry.buildRetryKey({ ...base }))
  })
  await check('K02 boutique différente => clé différente', () => {
    assert.notEqual(retry.buildRetryKey(base), retry.buildRetryKey({ ...base, storeId: 's2' }))
  })
  await check('K03 compte différent => clé différente', () => {
    assert.notEqual(retry.buildRetryKey(base), retry.buildRetryKey({ ...base, userId: 'u2' }))
  })
  await check('K04 conversation différente => clé différente', () => {
    assert.notEqual(retry.buildRetryKey(base), retry.buildRetryKey({ ...base, threadId: 't2' }))
  })
  await check('K05 contenu différent => clé différente', () => {
    assert.notEqual(retry.buildRetryKey(base), retry.buildRetryKey({ ...base, message: 'Analyse mon stock' }))
  })
  await check('K06 espaces normalisés => même clé', () => {
    assert.equal(retry.buildRetryKey(base), retry.buildRetryKey({ ...base, message: '  Analyse   mes ventes  ' }))
  })
  await check('K07 retry identique réutilise le requestId', () => {
    const pending = { key: retry.buildRetryKey(base), requestId: 'req-1' }
    assert.equal(retry.resolveRetryRequestId(pending, base, () => 'req-2').requestId, 'req-1')
  })
  await check('K08 changement de boutique => nouveau requestId', () => {
    const pending = { key: retry.buildRetryKey(base), requestId: 'req-1' }
    assert.equal(retry.resolveRetryRequestId(pending, { ...base, storeId: 's2' }, () => 'req-2').requestId, 'req-2')
  })
  await check('K09 générateur indisponible => null', () => {
    assert.equal(retry.resolveRetryRequestId(null, base, () => null), null)
  })

  const failed = results.filter(([, status]) => status !== 'PASS')
  for (const [name, status, detail] of results) console.log(`${status}  ${name}${detail ? `  ${detail}` : ''}`)
  console.log(`\nTotal : ${results.length - failed.length}/${results.length} PASS`)
  process.exitCode = failed.length === 0 ? 0 : 1

}

main().catch((error) => {
  console.error('SUITE CRASH', error)
  process.exitCode = 1
})
