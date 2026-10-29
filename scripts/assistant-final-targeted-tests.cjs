/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Tests ciblés du candidat final — local, sans réseau ni base.
 * Couvre : compteurs de finalisation, rejets du registre, clé de retry.
 */
// Le registre doit être actif pour tester ses transitions.
process.env.ASSISTANT_IDEMPOTENCY_REGISTRY = 'enabled'

const assert = require('node:assert/strict')
const fs = require('node:fs')
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
  const invariants = await import(pathToFileURL(path.join(ROOT, 'lib/assistant/credit-invariants.ts')).href)

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
    assert.deepEqual(invariants.validateFinalizeCounters({ credits_consumed: 3, credits_charged: 3 }), { consumed: 3, charged: 3 })
  })
  await check('F02 débit > consommation rejeté', () => {
    assert.equal(rejects(() => invariants.validateFinalizeCounters({ credits_consumed: 2, credits_charged: 3 })), 'ASSISTANT_BACKEND_UNAVAILABLE')
  })
  await check('F03 compteur négatif rejeté', () => {
    assert.equal(rejects(() => invariants.validateFinalizeCounters({ credits_consumed: -1, credits_charged: 0 })), 'ASSISTANT_BACKEND_UNAVAILABLE')
  })
  await check('F04 compteur flottant rejeté', () => {
    assert.equal(rejects(() => invariants.validateFinalizeCounters({ credits_consumed: 1.5, credits_charged: 1 })), 'ASSISTANT_BACKEND_UNAVAILABLE')
  })
  await check('F05 bigint texte accepté', () => {
    assert.deepEqual(invariants.validateFinalizeCounters({ credits_consumed: '4', credits_charged: '0' }), { consumed: 4, charged: 0 })
  })
  await check('F06 réponse non objet rejetée', () => {
    assert.equal(rejects(() => invariants.validateFinalizeCounters(null)), 'ASSISTANT_BACKEND_UNAVAILABLE')
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

  // ---------------------------------------------------------------------------
  // Lot A/B — verrou serveur global et allowlist du pilote privé
  // ---------------------------------------------------------------------------
  const access = await import(pathToFileURL(path.join(ROOT, 'lib/assistant/access.ts')).href)

  const ENV_KEYS = [
    'ASSISTANT_ENABLED',
    'ASSISTANT_ALLOWED_USER_IDS',
    'ASSISTANT_IDEMPOTENCY_REGISTRY',
    'ASSISTANT_FINALIZE_ATOMIC',
  ]
  const withEnv = async (overrides, fn) => {
    const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    try {
      return await fn()
    } finally {
      for (const key of ENV_KEYS) {
        if (saved[key] === undefined) delete process.env[key]
        else process.env[key] = saved[key]
      }
    }
  }

  const PILOT_USER = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
  const OTHER_USER = '11111111-2222-4333-8444-555555555555'
  const READY_ENV = {
    ASSISTANT_ENABLED: 'enabled',
    ASSISTANT_ALLOWED_USER_IDS: PILOT_USER,
    ASSISTANT_IDEMPOTENCY_REGISTRY: 'enabled',
    ASSISTANT_FINALIZE_ATOMIC: 'enabled',
  }

  await check('G01 verrou absent => chatbot fermé', () =>
    withEnv({ ...READY_ENV, ASSISTANT_ENABLED: undefined }, () =>
      assert.rejects(async () => access.assertAssistantEnabled(), /ASSISTANT_DISABLED/)
    )
  )
  await check('G02 verrou non explicite (true) => fermé', () =>
    withEnv({ ...READY_ENV, ASSISTANT_ENABLED: 'true' }, () =>
      assert.rejects(async () => access.assertAssistantAccess(PILOT_USER), /ASSISTANT_DISABLED/)
    )
  )
  await check('G03 allowlist absente => aucun UUID autorisé', () =>
    withEnv({ ...READY_ENV, ASSISTANT_ALLOWED_USER_IDS: undefined }, async () => {
      assert.equal(access.getAllowedAssistantUserIds().length, 0)
      await assert.rejects(async () => access.assertAssistantAccess(PILOT_USER), /ASSISTANT_NOT_ALLOWED/)
    })
  )
  await check('G04 allowlist email/joker ignorée', () =>
    withEnv({ ...READY_ENV, ASSISTANT_ALLOWED_USER_IDS: 'moi@example.com,*,' }, async () => {
      const parsed = access.parseAssistantAllowedUserIds(process.env.ASSISTANT_ALLOWED_USER_IDS)
      assert.equal(parsed.ids.length, 0)
      assert.equal(parsed.invalid, 2)
      await assert.rejects(async () => access.assertAssistantAccess(PILOT_USER), /ASSISTANT_NOT_ALLOWED/)
    })
  )
  await check('G05 pilote complet => accès autorisé', () =>
    withEnv(READY_ENV, async () => {
      assert.equal(access.isAssistantPilotReady(), true)
      access.assertAssistantAccess(PILOT_USER)
    })
  )
  await check('G06 registre désactivé => chatbot fermé', () =>
    withEnv({ ...READY_ENV, ASSISTANT_IDEMPOTENCY_REGISTRY: undefined }, () =>
      assert.rejects(async () => access.assertAssistantAccess(PILOT_USER), /ASSISTANT_PILOT_CONFIG_INCOMPLETE/)
    )
  )
  await check('G07 finalisation atomique désactivée => chatbot fermé', () =>
    withEnv({ ...READY_ENV, ASSISTANT_FINALIZE_ATOMIC: 'off' }, () =>
      assert.rejects(async () => access.assertAssistantAccess(PILOT_USER), /ASSISTANT_PILOT_CONFIG_INCOMPLETE/)
    )
  )
  await check('G08 UUID non listé => refus', () =>
    withEnv(READY_ENV, () =>
      assert.rejects(async () => access.assertAssistantAccess(OTHER_USER), /ASSISTANT_NOT_ALLOWED/)
    )
  )
  await check('G09 UUID listé en majuscules => autorisé', () =>
    withEnv({ ...READY_ENV, ASSISTANT_ALLOWED_USER_IDS: ` ${PILOT_USER.toUpperCase()} , ` }, async () => {
      assert.equal(access.isAssistantUserAllowed(PILOT_USER), true)
      access.assertAssistantAccess(PILOT_USER)
    })
  )
  await check('G10 utilisateur anonyme => refus', () =>
    withEnv(READY_ENV, async () => {
      await assert.rejects(async () => access.assertAssistantAccess(null), /ASSISTANT_NOT_ALLOWED/)
      await assert.rejects(async () => access.assertAssistantAccess(''), /ASSISTANT_NOT_ALLOWED/)
    })
  )
  await check('G11 identifiants client ignorés (liste = source unique)', () =>
    withEnv({ ...READY_ENV, ASSISTANT_ALLOWED_USER_IDS: PILOT_USER }, async () => {
      assert.equal(access.isAssistantUserAllowed(OTHER_USER), false)
      assert.equal(access.isAssistantUserAllowed(`${PILOT_USER} `), true)
    })
  )
  await check('G12 mode pilote => finalisation séquentielle interdite', () =>
    withEnv(READY_ENV, async () => {
      assert.throws(() => access.assertAtomicFinalizationRequired(false), /ASSISTANT_PILOT_CONFIG_INCOMPLETE/)
      access.assertAtomicFinalizationRequired(true)
    })
  )
  await check('G13 hors pilote => comportement séquentiel inchangé', () =>
    withEnv({ ...READY_ENV, ASSISTANT_ENABLED: undefined }, async () => {
      access.assertAtomicFinalizationRequired(false)
      assert.equal(access.isAssistantPilotEnforced(), false)
    })
  )
  await check('G14 noms de drapeaux financiers verrouillés', async () => {
    assert.deepEqual([...access.ASSISTANT_PILOT_REQUIRED_FLAGS], [
      'ASSISTANT_IDEMPOTENCY_REGISTRY',
      'ASSISTANT_FINALIZE_ATOMIC',
    ])
  })

  // ---------------------------------------------------------------------------
  // Lot C — suppression de boutique vs immuabilité du périmètre (statique)
  // ---------------------------------------------------------------------------
  const sql02 = fs.readFileSync(
    path.join(ROOT, 'docs/assistant/sql/02_assistant_thread_scope_rls.proposed.sql'),
    'utf8'
  )

  await check('D01 garde de conversation en security definer', async () => {
    assert.match(sql02, /create or replace function public\.assistant_thread_guard\(\)[\s\S]{0,300}security definer/)
  })
  await check('D02 détachement accepté seulement si la boutique a disparu', async () => {
    assert.match(
      sql02,
      /new\.store_id is null\s+and old\.store_id is not null\s+and not exists \(select 1 from public\.stores/
    )
  })
  await check('D03 rattachement arbitraire (NULL -> uuid) refusé', async () => {
    assert.doesNotMatch(sql02, /old\.store_id is null/)
    assert.match(sql02, /raise exception 'THREAD_STORE_IMMUTABLE'/)
  })
  await check('D04 immuabilité du propriétaire conservée', async () => {
    assert.match(sql02, /raise exception 'THREAD_OWNER_IMMUTABLE'/)
  })
  await check('D05 aucun historique supprimé par le correctif', async () => {
    assert.doesNotMatch(sql02, /delete\s+from\s+public\.chat_threads/i)
    assert.doesNotMatch(sql02, /delete\s+from\s+public\.chat_messages/i)
  })
  await check('D06 trigger rejouable sur chat_threads', async () => {
    assert.match(sql02, /drop trigger if exists trg_assistant_thread_guard on public\.chat_threads/)
    assert.match(sql02, /before update on public\.chat_threads/)
  })

  // ---------------------------------------------------------------------------
  // Lot E2 — registre : détachement à la suppression de boutique (statique)
  // ---------------------------------------------------------------------------
  const sql03b = fs.readFileSync(
    path.join(ROOT, 'docs/assistant/sql/03b_assistant_idempotency_registry_v2.proposed.sql'),
    'utf8'
  )
  const sql05b = fs.readFileSync(
    path.join(ROOT, 'docs/assistant/sql/05b_assistant_finalization_v2.proposed.sql'),
    'utf8'
  )

  await check('D07 registre : store_id détaché, jamais en cascade', async () => {
    assert.match(sql03b, /store_id\s+uuid\s+references public\.stores\(id\) on delete set null/)
    assert.doesNotMatch(sql03b, /store_id\s+uuid\s+not null references public\.stores\(id\)/)
    assert.doesNotMatch(sql03b, /references public\.stores\(id\) on delete cascade/)
  })
  await check('D08 registre : mise à niveau rejouable de la contrainte', async () => {
    assert.match(sql03b, /alter column store_id drop not null/)
    assert.match(sql03b, /confdeltype <> 'n'/)
    assert.match(
      sql03b,
      /add constraint assistant_requests_store_id_fkey\s+foreign key \(store_id\) references public\.stores\(id\) on delete set null/
    )
  })
  await check('D09 begin : ligne détachée = conflit, jamais un rejeu', async () => {
    assert.match(sql03b, /v_row\.store_id is distinct from p_store_id/)
    assert.doesNotMatch(sql03b, /v_row\.store_id <> p_store_id/)
  })
  await check('D10 complete : clôture facturable refusée sans boutique', async () => {
    assert.match(sql03b, /if v_row\.store_id is null then\s+raise exception 'IDEMPOTENCY_STORE_DETACHED'/)
  })
  await check('D11 finalize : périmètre comparé en NULL-safe', async () => {
    assert.match(sql05b, /v_row\.store_id is distinct from p_store_id/)
    assert.doesNotMatch(sql05b, /v_row\.store_id <> p_store_id/)
  })
  await check('D12 aucun débit possible via une boutique supprimée', async () => {
    assert.doesNotMatch(sql05b, /references public\.stores\(id\) on delete cascade/)
    assert.match(sql05b, /if not public\.assistant_can_use_store\(p_store_id, p_user_id\) then\s+raise exception 'FORBIDDEN_STORE'/)
    assert.match(sql03b, /if not public\.assistant_can_use_store\(v_row\.store_id, p_user_id\) then\s+raise exception 'FORBIDDEN_STORE'/)
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
