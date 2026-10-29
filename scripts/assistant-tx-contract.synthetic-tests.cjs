#!/usr/bin/env node
/**
 * Tests synthétiques — contrats de finalisation assistant (SQL 01/02/03b/05b).
 *
 * Exécution : `node scripts/assistant-tx-contract.synthetic-tests.cjs`
 *
 * Aucune base, aucun réseau, aucun fournisseur : les modules TypeScript sont
 * transpilés en mémoire, les dépendances Supabase sont remplacées par des
 * doubles, et les invariants SQL sont vérifiés par lecture de texte.
 *
 * Ces tests ne remplacent PAS les scénarios PostgreSQL à deux connexions
 * (docs/assistant/sql/postgres-two-connection-tests.sql, non exécuté).
 */
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const vm = require('node:vm')

const ROOT = process.cwd()
const SQL_DIR = path.join(ROOT, 'docs/assistant/sql')
const FINGERPRINT = 'a'.repeat(64)
const REQUEST_ID = '3f1c9d62-7c1a-4e2b-9d3a-5b6c7d8e9f01'

function createLoader(mocks = {}) {
  const cache = new Map()

  function load(relativePath) {
    const file = path.resolve(ROOT, relativePath)
    if (cache.has(file)) return cache.get(file).exports

    const module = { exports: {} }
    cache.set(file, module)

    const source = fs.readFileSync(file, 'utf8')
    const js = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
      fileName: file,
    }).outputText

    const requireShim = (id) => {
      if (Object.prototype.hasOwnProperty.call(mocks, id)) return mocks[id]
      if (id.startsWith('@/')) return load(`${id.slice(2)}.ts`)
      if (id.startsWith('.')) {
        const base = path.resolve(path.dirname(file), id)
        return load(path.relative(ROOT, base.endsWith('.ts') ? base : `${base}.ts`))
      }
      return require(id)
    }

    vm.runInThisContext(
      `(function(require, module, exports, __filename, __dirname){${js}\n})`,
      { filename: file },
    )(requireShim, module, module.exports, file, path.dirname(file))

    return module.exports
  }

  return load
}

const results = []
function check(id, name, run) {
  try {
    const detail = run()
    results.push({ id, name, pass: true, detail: detail ?? '' })
  } catch (error) {
    results.push({ id, name, pass: false, detail: error instanceof Error ? error.message : String(error) })
  }
}
async function checkAsync(id, name, run) {
  try {
    const detail = await run()
    results.push({ id, name, pass: true, detail: detail ?? '' })
  } catch (error) {
    results.push({ id, name, pass: false, detail: error instanceof Error ? error.message : String(error) })
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message} (attendu ${expected}, obtenu ${actual})`)
}

function readSql(name) {
  return fs.readFileSync(path.join(SQL_DIR, name), 'utf8')
}

function createFakeBackend() {
  const inserts = []
  const client = {
    from(table) {
      return {
        insert(payload) {
          inserts.push({ table, payload })
          const chain = {
            select: () => chain,
            single: async () => ({
              data: {
                id: 'assistant-message-1',
                thread_id: payload.thread_id,
                role: payload.role,
                content: payload.content,
                credits_used: payload.credits_used,
                metadata: payload.metadata,
                created_at: '2026-10-29T00:00:00.000Z',
              },
              error: null,
            }),
            then: (resolve, reject) => Promise.resolve({ data: null, error: null }).then(resolve, reject),
          }
          return chain
        },
      }
    },
  }
  return { client, inserts }
}

async function runContractTests() {
  process.env.ASSISTANT_IDEMPOTENCY_REGISTRY = 'enabled'
  const idempotency = createLoader()('lib/assistant/idempotency.ts')

  await checkAsync('T01', 'begin renvoie thread_id pour rejouer une 1re question sans thread', async () => {
    const supabase = {
      rpc: async () => ({
        data: [
          {
            state: 'completed',
            attempt_token: '11111111-1111-4111-8111-111111111111',
            thread_id: 'thread-created-1',
            assistant_message_id: 'assistant-message-1',
            credit_status: 'charged',
          },
        ],
        error: null,
      }),
    }
    const outcome = await idempotency.beginAssistantRequest(supabase, {
      requestId: REQUEST_ID,
      fingerprint: FINGERPRINT,
      storeId: 'store-1',
      threadId: null,
    })
    assertEqual(outcome.status, 'replay', 'statut')
    assertEqual(outcome.threadId, 'thread-created-1', 'threadId rejoué')
    assertEqual(outcome.creditStatus, 'charged', 'statut de débit réel')
    return outcome.threadId
  })

  await checkAsync('T02', 'begin distingue conflit, occupation et indisponibilité', async () => {
    const cases = [
      { message: 'IDEMPOTENCY_CONFLICT', expected: 'conflict' },
      { message: 'IDEMPOTENCY_IN_PROGRESS', expected: 'in_progress' },
      { message: 'IDEMPOTENCY_LEASE_BUSY', expected: 'in_progress' },
    ]
    for (const item of cases) {
      const supabase = { rpc: async () => ({ data: null, error: { message: item.message } }) }
      const outcome = await idempotency.beginAssistantRequest(supabase, {
        requestId: REQUEST_ID,
        fingerprint: FINGERPRINT,
        storeId: 'store-1',
        threadId: null,
      })
      assertEqual(outcome.status, item.expected, item.message)
    }
    let threw = false
    try {
      await idempotency.beginAssistantRequest(
        { rpc: async () => ({ data: null, error: { message: 'boom' } }) },
        { requestId: REQUEST_ID, fingerprint: FINGERPRINT, storeId: 'store-1', threadId: null }
      )
    } catch (error) {
      threw = error instanceof Error && error.message === 'ASSISTANT_BACKEND_UNAVAILABLE'
    }
    assert(threw, 'erreur inconnue doit être ASSISTANT_BACKEND_UNAVAILABLE')
    return '3 cas + erreur inconnue'
  })

  await checkAsync('T03', 'complete transmet consommation et débit (7 paramètres)', async () => {
    let captured = null
    const supabase = {
      rpc: async (name, args) => {
        captured = { name, args }
        return { error: null }
      },
    }
    const ok = await idempotency.completeAssistantRequest(
      supabase,
      { userId: 'user-1', requestId: REQUEST_ID, attemptToken: 'tok-1' },
      'assistant-message-1',
      'charged',
      7,
      7
    )
    assertEqual(ok, true, 'clôture acceptée')
    assertEqual(captured.name, 'rpc_assistant_complete_request', 'RPC')
    assertEqual(captured.args.p_credits_consumed, 7, 'consommé')
    assertEqual(captured.args.p_credits_charged, 7, 'débité')
    assertEqual(captured.args.p_credit_status, 'charged', 'statut')
    return JSON.stringify(captured.args)
  })

  await checkAsync('T04', 'complete refuse les combinaisons de crédits incohérentes', async () => {
    let calls = 0
    const supabase = {
      rpc: async () => {
        calls += 1
        return { error: null }
      },
    }
    const identity = { userId: 'user-1', requestId: REQUEST_ID, attemptToken: 'tok-1' }
    assertEqual(
      await idempotency.completeAssistantRequest(supabase, identity, 'm-1', 'charged', 3, 5),
      false,
      'débit > consommation'
    )
    assertEqual(
      await idempotency.completeAssistantRequest(supabase, identity, 'm-1', 'insufficient', 3, 3),
      false,
      'débit sur insuffisant'
    )
    assertEqual(
      await idempotency.completeAssistantRequest(supabase, identity, 'm-1', 'charged', 3, 1),
      false,
      'débit partiel sur statut chargé'
    )
    assertEqual(
      await idempotency.completeAssistantRequest(supabase, identity, null, 'charged', 3, 3),
      false,
      'message absent'
    )
    assertEqual(calls, 0, 'aucun appel SQL pour un cas invalide')
    return '4 refus locaux'
  })

  await checkAsync('T05', 'complete refuse un débit sur un statut non facturé', async () => {
    let called = false
    const supabase = {
      rpc: async () => {
        called = true
        return { error: null }
      },
    }
    const ok = await idempotency.completeAssistantRequest(
      supabase,
      { userId: 'user-1', requestId: REQUEST_ID, attemptToken: 'tok-1' },
      'm-1',
      'not_charged',
      4,
      4
    )
    assertEqual(ok, false, 'statut non facturé avec débit > 0')
    assertEqual(called, false, 'aucun appel SQL')
    return 'refusé localement'
  })

  function loadAtomicFinalization(rpcImpl) {
    process.env.ASSISTANT_FINALIZE_ATOMIC = 'enabled'
    const completeCalls = []
    const backend = {
      rpc: rpcImpl,
      from: () => {
        throw new Error('le chemin atomique ne doit pas écrire en PostgREST direct')
      },
    }
    const mocked = {
      '@/lib/assistant/chat': {
        addMessage: async () => {
          throw new Error('écriture séquentielle interdite en mode atomique')
        },
        touchThread: async () => {},
      },
      '@/lib/assistant/credits': { chargeCredits: async () => ({ status: 'charged' }) },
      '@/lib/assistant/idempotency': {
        ASSISTANT_IDEMPOTENCY_REGISTRY_ENABLED: true,
        completeAssistantRequest: async (...args) => {
          completeCalls.push(args)
          return true
        },
      },
      '@/lib/assistant/backend': { requireAssistantBackendClient: () => backend },
    }
    return { finalization: createLoader(mocked)('lib/assistant/finalization.ts'), completeCalls }
  }

  const baseInput = {
    supabase: {},
    threadId: 'thread-1',
    userId: 'user-1',
    storeId: 'store-1',
    requestId: REQUEST_ID,
    fingerprint: FINGERPRINT,
    attemptToken: 'tok-1',
    intent: 'sales_summary',
    userMessage: 'Question synthétique',
    assistantContent: 'Réponse synthétique',
    assistantMetadata: { request_id: REQUEST_ID },
    creditsUsed: 6,
    provider: {
      text: 'Réponse synthétique',
      inputTokens: 100,
      outputTokens: 50,
      providerName: 'synthetic',
      modelName: 'audit',
      providerCostUsd: 0.002,
    },
    nextTitle: 'Titre',
  }

  await checkAsync('T06', 'atomique : consommation et débit lus depuis la RPC', async () => {
    const { finalization } = loadAtomicFinalization(async () => ({
      data: [
        {
          assistant_message: { id: 'assistant-message-1', role: 'assistant' },
          credit_status: 'charged',
          replayed: false,
          credits_consumed: 6,
          credits_charged: 6,
        },
      ],
      error: null,
    }))
    const result = await finalization.finalizeAssistantTurn(baseInput)
    assertEqual(result.atomic, true, 'atomique')
    assertEqual(result.replayed, false, 'non rejoué')
    assertEqual(result.creditStatus, 'charged', 'statut')
    assertEqual(result.creditsConsumed, 6, 'consommé')
    assertEqual(result.creditsCharged, 6, 'débité')
    assertEqual(result.warning, null, 'aucun avertissement')
    return `${result.creditsConsumed}/${result.creditsCharged}`
  })

  await checkAsync('T07', 'insuffisant : réponse conservée, débit nul, statut explicite', async () => {
    const { finalization } = loadAtomicFinalization(async () => ({
      data: [
        {
          assistant_message: { id: 'assistant-message-1', role: 'assistant' },
          credit_status: 'insufficient',
          replayed: false,
          credits_consumed: 6,
          credits_charged: 0,
        },
      ],
      error: null,
    }))
    const result = await finalization.finalizeAssistantTurn(baseInput)
    assertEqual(result.creditStatus, 'insufficient', 'statut')
    assertEqual(result.creditsConsumed, 6, 'consommation tracée')
    assertEqual(result.creditsCharged, 0, 'aucun débit')
    assert(result.warning !== null, 'avertissement remonté')
    return result.creditStatus
  })

  await checkAsync('T08', 'rejeu atomique : débit d’origine conservé, aucun nouveau débit', async () => {
    const { finalization } = loadAtomicFinalization(async () => ({
      data: [
        {
          assistant_message: { id: 'assistant-message-1', role: 'assistant' },
          credit_status: 'charged',
          replayed: true,
          credits_consumed: 4,
          credits_charged: 4,
        },
      ],
      error: null,
    }))
    const result = await finalization.finalizeAssistantTurn(baseInput)
    assertEqual(result.replayed, true, 'rejeu signalé')
    assertEqual(result.creditsCharged, 4, 'débit d’origine relu')
    return 'replayed'
  })

  await checkAsync('T09', 'erreur RPC : aucune reprise séquentielle silencieuse', async () => {
    const { finalization, completeCalls } = loadAtomicFinalization(async () => ({
      data: null,
      error: { code: 'P0001', message: 'IDEMPOTENCY_LEASE_LOST' },
    }))
    let code = null
    try {
      await finalization.finalizeAssistantTurn(baseInput)
    } catch (error) {
      code = error instanceof Error ? error.message : 'unknown'
    }
    assertEqual(code, 'FINALIZE_RPC_FAILED', 'erreur remontée')
    assertEqual(completeCalls.length, 0, 'aucune clôture séquentielle')
    return code
  })

  await checkAsync('T10', 'registre actif sans jeton : refus avant tout appel SQL', async () => {
    let called = false
    const { finalization } = loadAtomicFinalization(async () => {
      called = true
      return { data: null, error: null }
    })
    let code = null
    try {
      await finalization.finalizeAssistantTurn({ ...baseInput, attemptToken: null })
    } catch (error) {
      code = error instanceof Error ? error.message : 'unknown'
    }
    assertEqual(code, 'IDEMPOTENCY_TOKEN_MISMATCH', 'jeton obligatoire')
    assertEqual(called, false, 'aucun appel SQL')
    return code
  })

  function loadSequentialFinalization(chargeStatus) {
    delete process.env.ASSISTANT_FINALIZE_ATOMIC
    const { client, inserts } = createFakeBackend()
    const completeCalls = []
    const mocked = {
      '@/lib/assistant/chat': {
        addMessage: async () => ({ id: 'user-message-1' }),
        touchThread: async () => {},
      },
      '@/lib/assistant/credits': { chargeCredits: async () => ({ status: chargeStatus }) },
      '@/lib/assistant/idempotency': {
        ASSISTANT_IDEMPOTENCY_REGISTRY_ENABLED: true,
        completeAssistantRequest: async (...args) => {
          completeCalls.push(args)
          return true
        },
      },
      '@/lib/assistant/backend': { requireAssistantBackendClient: () => client },
    }
    return { finalization: createLoader(mocked)('lib/assistant/finalization.ts'), inserts, completeCalls }
  }

  await checkAsync('T11', 'séquentiel : journal ai_usage par le backend, clôture chiffrée', async () => {
    const { finalization, inserts, completeCalls } = loadSequentialFinalization('charged')
    const result = await finalization.finalizeAssistantTurn(baseInput)
    assertEqual(result.atomic, false, 'non atomique annoncé')
    assertEqual(result.replayed, false, 'non rejoué')
    assertEqual(result.creditsConsumed, 6, 'consommé')
    assertEqual(result.creditsCharged, 6, 'débité')
    const usage = inserts.find((item) => item.table === 'ai_usage')
    assert(usage, 'ai_usage doit être inséré')
    assertEqual(usage.payload.user_id, 'user-1', 'imputation utilisateur')
    assertEqual(usage.payload.credits_used, 6, 'consommation journalisée')
    assertEqual(completeCalls.length, 1, 'clôture unique')
    assertEqual(completeCalls[0][4], 6, 'consommé transmis')
    assertEqual(completeCalls[0][5], 6, 'débité transmis')
    return 'usage backend-only'
  })

  await checkAsync('T12', 'séquentiel insuffisant : débit nul et statut propagé', async () => {
    const { finalization, completeCalls } = loadSequentialFinalization('insufficient')
    const result = await finalization.finalizeAssistantTurn(baseInput)
    assertEqual(result.creditStatus, 'insufficient', 'statut')
    assertEqual(result.creditsConsumed, 6, 'consommation tracée')
    assertEqual(result.creditsCharged, 0, 'aucun débit')
    assertEqual(completeCalls[0][4], 6, 'consommé transmis')
    assertEqual(completeCalls[0][5], 0, 'débité nul transmis')
    assert(result.warning !== null, 'avertissement remonté')
    return result.creditStatus
  })

  await checkAsync('T13', 'séquentiel sans jeton : aucune clôture registre', async () => {
    const { finalization, completeCalls } = loadSequentialFinalization('charged')
    await finalization.finalizeAssistantTurn({ ...baseInput, attemptToken: null })
    assertEqual(completeCalls.length, 0, 'clôture sans jeton interdite')
    return 'aucune clôture'
  })

  process.env.ASSISTANT_CREDIT_RESERVATION = 'enabled'
  const credits = createLoader()('lib/assistant/credits.ts')

  await checkAsync('T14', 'réservation refusée sans jeton, transmise avec jeton', async () => {
    let captured = null
    const supabase = {
      rpc: async (name, args) => {
        captured = { name, args }
        return { error: null }
      },
    }
    const withoutToken = await credits.reserveCreditsForRequest(supabase, 12, {
      requestId: REQUEST_ID,
      attemptToken: null,
    })
    assertEqual(withoutToken.status, 'unavailable', 'sans jeton')
    assertEqual(captured, null, 'aucun appel SQL')

    const withToken = await credits.reserveCreditsForRequest(supabase, 12, {
      requestId: REQUEST_ID,
      attemptToken: 'tok-1',
    })
    assertEqual(withToken.status, 'reserved', 'avec jeton')
    assertEqual(captured.name, 'rpc_assistant_reserve_credits', 'RPC')
    assertEqual(captured.args.p_credits, 12, 'montant estimé')
    return 'réservation informative'
  })

  await checkAsync('T15', 'réservation en erreur ⇒ unavailable ; libération conditionnelle', async () => {
    const failing = { rpc: async () => ({ error: { message: 'IDEMPOTENCY_LEASE_LOST' } }) }
    const reserved = await credits.reserveCreditsForRequest(failing, 5, {
      requestId: REQUEST_ID,
      attemptToken: 'tok-1',
    })
    assertEqual(reserved.status, 'unavailable', 'échec SQL')

    const ok = { rpc: async () => ({ error: null }) }
    assertEqual(
      await credits.releaseCreditReservation(ok, { requestId: REQUEST_ID, attemptToken: 'tok-1' }),
      true,
      'libération'
    )
    assertEqual(
      await credits.releaseCreditReservation(ok, { requestId: REQUEST_ID, attemptToken: null }),
      false,
      'libération sans jeton refusée'
    )
    return 'unavailable + release'
  })

  await checkAsync('T16', 'aucun crédit n’est présenté comme « réservé = garanti »', async () => {
    const source = fs.readFileSync(path.join(ROOT, 'lib/assistant/credits.ts'), 'utf8')
    assert(source.includes('INFORMATIVE'), 'statut informatif documenté')
    assert(source.includes('aucun solde'), 'absence de verrou de solde documentée')
    return 'réservation informative'
  })
}

/* ------------------------------------------------------------------------ */
/* Invariants SQL — lecture de texte, aucun accès base                       */
/* ------------------------------------------------------------------------ */

function extractFunction(source, name) {
  const start = source.indexOf(`create or replace function public.${name}(`)
  if (start < 0) return null
  const end = source.indexOf('\n$$;', start)
  return end < 0 ? null : source.slice(start, end)
}

function runStaticChecks() {
  const sql01 = readSql('01_assistant_privileges.proposed.sql')
  const sql02 = readSql('02_assistant_thread_scope_rls.proposed.sql')
  const sql03 = readSql('03b_assistant_idempotency_registry_v2.proposed.sql')
  const sql05 = readSql('05b_assistant_finalization_v2.proposed.sql')

  check('S01', '03b begin renvoie thread_id (rejeu d’une 1re question)', () => {
    const body = extractFunction(sql03, 'rpc_assistant_begin_request')
    assert(body, 'fonction begin introuvable')
    const returns = body.slice(0, body.indexOf('language'))
    assert(/thread_id uuid/.test(returns), 'thread_id absent du RETURNS TABLE')
    assert(/assistant_message_id uuid/.test(returns), 'assistant_message_id absent')
    return 'contrat complet'
  })

  check('S02', 'baux mesurés à clock_timestamp, jamais à now()', () => {
    for (const [label, source] of [['03b', sql03], ['05b', sql05]]) {
      assert(!/lease_until\s*[<>]=?\s*now\(\)/.test(source), `${label}: comparaison de bail avec now()`)
      assert(!/now\(\)\s*[<>]=?\s*lease_until/.test(source), `${label}: comparaison de bail avec now()`)
    }
    assert(/clock_timestamp\(\) \+ public\.assistant_lease_interval\(\)/.test(sql03), 'bail non horodaté')
    assert(/lease_until <= v_now/.test(sql03), '03b: frontière de bail absente')
    assert(/lease_until <= v_now/.test(sql05), '05b: frontière de bail absente')
    return 'clock_timestamp uniquement'
  })

  check('S03', '05b expose consommation et débit, réservé à service_role', () => {
    const body = extractFunction(sql05, 'rpc_assistant_finalize_request')
    assert(body, 'finalize introuvable')
    const returns = body.slice(0, body.indexOf('language'))
    assert(/credits_consumed integer/.test(returns), 'credits_consumed absent du retour')
    assert(/credits_charged integer/.test(returns), 'credits_charged absent du retour')
    assert(/replayed boolean/.test(returns), 'replayed absent du retour')
    assert(/from public, anon, authenticated/.test(sql05), 'révocation incomplète')
    assert(/to service_role/.test(sql05), 'grant service_role absent')
    return 'contrat + privilèges'
  })

  check('S04', 'chaque rpc_assistant_* créée est précédée de son drop', () => {
    for (const [label, source] of [['03b', sql03], ['05b', sql05]]) {
      const pattern = /create or replace function public\.(rpc_assistant_[a-z_]+)\(/g
      let match
      while ((match = pattern.exec(source)) !== null) {
        const name = match[1]
        const dropIndex = source.indexOf(`drop function if exists public.${name}(`)
        assert(dropIndex >= 0, `${label}: aucun drop pour ${name}`)
        assert(dropIndex < match.index, `${label}: drop de ${name} après création`)
      }
    }
    return 'drops ordonnés'
  })

  check('S05', 'policies rejouables (drop du nom courant avant create)', () => {
    for (const [label, source] of [['01', sql01], ['02', sql02]]) {
      const pattern = /create policy ([a-z_]+) on public\.([a-z_]+)/g
      let match
      while ((match = pattern.exec(source)) !== null) {
        const [, name, table] = match
        const dropIndex = source.indexOf(`drop policy if exists ${name} on public.${table}`)
        assert(dropIndex >= 0, `${label}: ${name} sans drop`)
        assert(dropIndex < match.index, `${label}: drop de ${name} après création`)
      }
    }
    return 'policies rejouables'
  })

  check('S06', 'rôles SQL alignés sur lib/auth/permissions.ts', () => {
    const permissions = fs.readFileSync(path.join(ROOT, 'lib/auth/permissions.ts'), 'utf8')
    const block = permissions.slice(
      permissions.indexOf('export const ROLE_PERMISSIONS'),
      permissions.indexOf('export function hasPermission')
    )
    const roles = ['owner', 'admin', 'confirmation', 'delivery', 'stock_manager', 'accountant', 'marketer', 'viewer']
    const expected = roles
      .filter((role) => {
        const match = block.match(new RegExp(`${role}: \\[([\\s\\S]*?)\\]`, 'm'))
        return Boolean(match && match[1].includes("'ai_assistant.use'"))
      })
      .sort()

    const useBody = extractFunction(sql02, 'assistant_role_allows_use')
    assert(useBody, 'assistant_role_allows_use introuvable')
    const useList = (useBody.match(/in \(([^)]*)\)/) || [])[1]
    assert(useList, 'liste de rôles introuvable')
    const sqlRoles = (useList.match(/'([a-z_]+)'/g) || []).map((item) => item.replace(/'/g, '')).sort()

    assertEqual(sqlRoles.join(','), expected.join(','), 'rôles `ai_assistant.use`')
    assert(/role in \('owner', 'admin', 'accountant'\)/.test(sql02), 'accès financier full non aligné')
    return expected.join(',')
  })
}

function runMoreStaticChecks() {
  const files = [
    ['01', readSql('01_assistant_privileges.proposed.sql')],
    ['02', readSql('02_assistant_thread_scope_rls.proposed.sql')],
    ['03b', readSql('03b_assistant_idempotency_registry_v2.proposed.sql')],
    ['05b', readSql('05b_assistant_finalization_v2.proposed.sql')],
  ]

  check('S07', 'aucune RPC assistant exécutable par public/anon', () => {
    for (const [label, source] of files) {
      assert(!/grant[^;]*rpc_assistant_[^;]*\bto\b[^;]*\banon\b/.test(source), `${label}: grant à anon`)
      assert(!/grant[^;]*rpc_assistant_[^;]*\bto\b[^;]*\bpublic\b/.test(source), `${label}: grant à public`)
    }
    const all = files.map(([, source]) => source).join('\n')
    for (const fn of ['complete_request', 'finalize_request']) {
      const pattern = new RegExp(`grant execute on function public\\.rpc_assistant_${fn}[^;]*authenticated`)
      assert(!pattern.test(all), `${fn} accordée à authenticated`)
    }
    return 'grants restreints'
  })

  check('S08', 'intégrité ai_usage : écriture serveur uniquement', () => {
    assert(/revoke insert, update, delete on public\.ai_usage from authenticated/.test(files[0][1]), '01 ne révoque pas ai_usage')
    assert(/drop policy if exists ai_usage_insert_own_scoped_store/.test(files[0][1]), 'policy d insertion client non retirée')
    const finalization = fs.readFileSync(path.join(ROOT, 'lib/assistant/finalization.ts'), 'utf8')
    assert(finalization.includes("backend.from('ai_usage')"), 'journal non écrit par le backend')
    assert(!finalization.includes("input.supabase.from('ai_usage')"), 'journal encore écrit par le client')
    return 'backend-only'
  })

  check('S09', 'ordre des verrous identité → conversation → registre', () => {
    const sql03 = files[2][1]
    const sql05 = files[3][1]
    const begin = extractFunction(sql03, 'rpc_assistant_begin_request')
    const bind = extractFunction(sql03, 'rpc_assistant_bind_request_thread')
    const complete = extractFunction(sql03, 'rpc_assistant_complete_request')
    const finalize = extractFunction(sql05, 'rpc_assistant_finalize_request')

    const assertOrder = (label, body, registreMarker) => {
      assert(body, `${label}: fonction introuvable`)
      const identity = body.indexOf('assistant_lock_identity')
      const thread = body.indexOf('assistant_lock_thread')
      const registre = body.indexOf(registreMarker)
      assert(identity >= 0 && thread >= 0 && registre >= 0, `${label}: marqueurs manquants`)
      assert(identity < thread, `${label}: conversation verrouillée avant l'identité`)
      assert(thread < registre, `${label}: registre verrouillé avant la conversation`)
    }

    assertOrder('begin', begin, 'insert into public.assistant_requests')
    // `bind` lit le registre SANS verrou pour connaître la boutique : le verrou
    // effectif (marqueur `for update`) doit rester APRÈS la conversation.
    assertOrder('bind', bind, 'for update')
    assertOrder('complete', complete, 'for update')
    assertOrder('finalize', finalize, 'for update')

    for (const [label, body] of [['begin', begin], ['bind', bind], ['complete', complete], ['finalize', finalize]]) {
      const lastThreadLock = body.lastIndexOf('assistant_lock_thread')
      const firstRegistreLock = body.indexOf('for update')
      assert(lastThreadLock < firstRegistreLock, `${label}: verrou de conversation tardif`)
    }
    return 'ordre unique'
  })
}

function runTailStaticChecks() {
  const files = [
    ['01', readSql('01_assistant_privileges.proposed.sql')],
    ['02', readSql('02_assistant_thread_scope_rls.proposed.sql')],
    ['03b', readSql('03b_assistant_idempotency_registry_v2.proposed.sql')],
    ['05b', readSql('05b_assistant_finalization_v2.proposed.sql')],
  ]

  check('S10', 'fichiers SQL équilibrés (dollar-quotes, begin/commit uniques)', () => {
    for (const [label, source] of files) {
      const delimiters = (source.match(/\$\$/g) || []).length
      assertEqual(delimiters % 2, 0, `${label}: dollar-quotes non appariés (${delimiters})`)
      assertEqual((source.match(/^begin;$/gm) || []).length, 1, `${label}: begin;`)
      assertEqual((source.match(/^commit;$/gm) || []).length, 1, `${label}: commit;`)
    }
    return '4 fichiers équilibrés'
  })

  check('S11', 'schéma de base inchangé (aucun create table chat_*/ai_usage)', () => {
    const baseTables = new Set(['chat_threads', 'chat_messages', 'ai_usage', 'ai_credit_wallets'])
    for (const [label, source] of files) {
      const pattern = /create table\s+(?:if not exists\s+)?(?:public\.)?([a-z_]+)/gi
      let match
      while ((match = pattern.exec(source)) !== null) {
        const table = match[1].toLowerCase()
        assert(!baseTables.has(table), `${label}: création interdite de la table ${table}`)
      }
    }
    return 'base préservée'
  })

  check('S12', 'route : pas d’atomicité affirmée sur rejeu, solde = débit réel', () => {
    const route = fs.readFileSync(path.join(ROOT, 'app/api/assistant/chat/route.ts'), 'utf8')
    assert(route.includes('finalization_atomic: null'), 'rejeu registre encore marqué atomique')
    assert(route.includes('finalization.creditsCharged'), 'solde non fondé sur le débit réel')
    assert(!route.includes("finalization.creditStatus === 'charged' ? creditsUsed : 0"), 'débit déduit du statut')
    assert(route.includes('credit_status: null'), 'repli sans registre invente un statut de débit')
    return 'route alignée'
  })
  check('S13', 'tous les GRANT/REVOKE sont DANS la transaction', () => {
    for (const [label, source] of files) {
      const commitIndex = source.indexOf('\ncommit;')
      assert(commitIndex > 0, `${label}: commit introuvable`)
      const statement = /^(grant|revoke) [^\n]*?(?=\n(?!\s)|$)/gm
      let match
      while ((match = statement.exec(source)) !== null) {
        const end = match.index + match[0].length
        assert(match.index < commitIndex, `${label}: ${match[0].slice(0, 48)}… après le COMMIT`)
        assert(end > match.index, `${label}: instruction vide`)
      }
    }
    return 'privilèges transactionnels'
  })
}

function runAuditPackageChecks() {
  const base = path.join(SQL_DIR, 'neon-audit')
  const read = (rel) => fs.readFileSync(path.join(base, rel), 'utf8')

  check('P01', 'paquet neon-audit : tous les fichiers annoncés existent', () => {
    const expected = [
      'README.md', 'PROTOCOL.md', 'DEPENDENCIES.md',
      'sql/00_preflight.sql', 'sql/05_auth_shim.sql', 'sql/10_bootstrap_audit.sql',
      'sql/20_verify_schema_ready.sql', 'sql/30_fixtures.sql',
      'sql/90_assertions.sql', 'sql/99_cleanup.sql',
      'scenarios/sequential.sql', 'scenarios/concurrent_a.sql', 'scenarios/concurrent_b.sql',
      'scenarios/lease_a.sql', 'scenarios/lease_b.sql',
      'run/run_audit.sh', 'run/env.example',
      'connection/env.neon.example', 'connection/check_connection.sh',
      'connection/PREVALIDATION.md',
    ]
    for (const rel of expected) {
      assert(fs.existsSync(path.join(base, rel)), `manquant: ${rel}`)
    }
    return `${expected.length} fichiers`
  })

  check('P02', 'paquet neon-audit : dollar-quotes équilibrés', () => {
    const files = [
      'sql/05_auth_shim.sql', 'sql/10_bootstrap_audit.sql', 'sql/20_verify_schema_ready.sql',
      'sql/30_fixtures.sql', 'sql/90_assertions.sql', 'sql/99_cleanup.sql',
    ]
    for (const rel of files) {
      const count = (read(rel).match(/\$\$/g) || []).length
      assertEqual(count % 2, 0, `${rel}: ${count} délimiteurs`)
    }
    return 'équilibrés'
  })

  check('P03', 'paquet neon-audit : aucune référence production ou secrète', () => {
    const secretPatterns = [
      /db\.[a-z0-9]+\.supabase\.co/i,
      // Mot de passe littéral dans une URL (les ${VARIABLES} restent autorisés)
      /postgresql:\/\/(?!\$\{)[^<\s/]*:(?!\$\{)[^<\s@]+@/i,
      /SUPABASE_SERVICE_ROLE_KEY/i,
    ]
    // Motifs interdits dans les fichiers EXÉCUTABLES uniquement : la
    // documentation doit pouvoir citer les sources exclues (jisra-test,
    // projet de test Supabase) pour justifier leur rejet.
    const prodPatterns = [/jisra-test/i, /goqedvcdmgtejtyrawsp/i]

    const docs = ['README.md', 'PROTOCOL.md', 'DEPENDENCIES.md', 'connection/PREVALIDATION.md']
    const executables = [
      'sql/00_preflight.sql', 'sql/05_auth_shim.sql', 'sql/10_bootstrap_audit.sql',
      'sql/20_verify_schema_ready.sql', 'sql/30_fixtures.sql',
      'sql/90_assertions.sql', 'sql/99_cleanup.sql',
      'scenarios/sequential.sql', 'scenarios/concurrent_a.sql', 'scenarios/concurrent_b.sql',
      'scenarios/lease_a.sql', 'scenarios/lease_b.sql', 'run/env.example', 'run/run_audit.sh',
      'connection/env.neon.example', 'connection/check_connection.sh',
    ]

    for (const rel of [...docs, ...executables]) {
      const source = read(rel)
      for (const pattern of secretPatterns) {
        assert(!pattern.test(source), `${rel}: motif interdit ${pattern}`)
      }
    }
    for (const rel of executables.filter((item) => item !== 'sql/00_preflight.sql')) {
      const source = read(rel)
      for (const pattern of prodPatterns) {
        assert(!pattern.test(source), `${rel}: référence production ${pattern}`)
      }
    }

    // Le prévol contient volontairement la liste de blocage : c'est la garde.
    const preflight = read('sql/00_preflight.sql')
    assert(/jisra-test/.test(preflight), 'garde de nom absente du prévol')
    assert(/goqedvcdmgtejtyrawsp/.test(preflight), 'référence de test non bloquée')

    // Le modèle de connexion ne contient que des placeholders sur les champs
    // sensibles (hôte, base, rôle, mot de passe, CA).
    const envTemplate = read('connection/env.neon.example')
    const sensitive = ['PGHOST', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGSSLROOTCERT']
    let checked = 0
    for (const rawLine of envTemplate.split('\n')) {
      const line = rawLine.replace(/\r$/, '')
      const assignment = line.match(/^export\s+([A-Z_]+)=(.*)$/)
      if (!assignment) continue
      const [, name, rawValue] = assignment
      if (!sensitive.includes(name)) continue
      checked += 1
      const isPlaceholder = rawValue.startsWith("'<") || rawValue.includes('${')
      assert(isPlaceholder, `valeur littérale sur champ sensible : ${name}`)
    }
    assert(checked >= 5, `champs sensibles non vérifiés (${checked})`)
    return 'aucune référence sensible hors garde'
  })

  check('P04', 'paquet neon-audit : scénarios ancrés sur les fixtures', () => {
    for (const rel of ['scenarios/sequential.sql', 'scenarios/concurrent_a.sql', 'scenarios/concurrent_b.sql',
      'scenarios/lease_a.sql', 'scenarios/lease_b.sql']) {
      const source = read(rel)
      assert(source.includes('from audit.fx'), `${rel}: fixtures non lues`)
      assert(source.includes('\\gset'), `${rel}: aucune capture de variables`)
      assert(!/:owner_id/.test(source) || source.includes(":'owner_id'"), `${rel}: variable mal citée`)
    }
    return 'fixtures liées'
  })

  check('P05', 'paquet neon-audit : le runner ne référence que des fichiers existants', () => {
    const runner = read('run/run_audit.sh')
    const pattern = /\$HERE\/((?:sql|scenarios)\/[a-z0-9_]+\.sql)/g
    let match
    let count = 0
    while ((match = pattern.exec(runner)) !== null) {
      count += 1
      assert(fs.existsSync(path.join(base, match[1])), `référence absente: ${match[1]}`)
    }
    assert(count >= 9, `runner trop pauvre (${count} références)`)
    assert(runner.includes('AUDIT_URL'), 'runner sans AUDIT_URL')
    assert(runner.includes('sleep 3'), 'décalage A/B absent')
    return `${count} références`
  })

  check('P06', 'paquet neon-audit : rollback après débit réellement prouvé', () => {
    const sequential = read('scenarios/sequential.sql')
    assert(sequential.includes('install_late_failure'), 'injection absente')
    assert(sequential.includes("set_config('audit.fail_after_debit', 'on', true)"), 'trigger non armé')
    assert(sequential.includes('R13.late_after_debit'), 'cas R13 absent')
    assert(sequential.includes('R13.wallet_rolled_back'), 'invariant de solde absent')
    const bootstrap = read('sql/10_bootstrap_audit.sql')
    assert(/after update on public\.ai_credit_wallets/.test(bootstrap),
      'l\'erreur doit survenir APRÈS l\'écriture du débit')
    return 'échec tardif après débit'
  })
}

function report() {
  const failed = results.filter((item) => !item.pass)
  const width = Math.max(...results.map((item) => item.name.length), 40)
  const lines = ['', '=== Tests synthétiques — contrats de finalisation assistant ===', '']

  for (const item of results) {
    const status = item.pass ? 'PASS' : 'FAIL'
    lines.push(`${status}  ${item.id.padEnd(5)} ${item.name.padEnd(width)}  ${item.detail}`)
  }
  lines.push(
    '',
    `Total : ${results.length - failed.length}/${results.length} PASS`,
    'Rappel : ces tests ne valident AUCUNE transaction PostgreSQL réelle.',
    ''
  )

  const text = lines.join('\n')
  console.log(text)

  if (process.env.ASSISTANT_TX_REPORT_PATH) {
    fs.writeFileSync(process.env.ASSISTANT_TX_REPORT_PATH, text, 'utf8')
  }

  if (failed.length > 0) {
    process.exitCode = 1
  }
}

async function entrypoint() {
  await runContractTests()
  runStaticChecks()
  runMoreStaticChecks()
  runTailStaticChecks()
  runAuditPackageChecks()
  report()
}

entrypoint().catch((error) => {
  console.error('Erreur fatale des tests synthétiques :', error)
  process.exitCode = 1
})
