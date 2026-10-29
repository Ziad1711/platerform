/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Sonde analytique V2 — 3 cas synthétiques, aucun accès aux données clients.
 * Réutilise les prompts réels (`lib/assistant/prompt.ts`) si importables,
 * sinon une réplique documentée des mêmes règles.
 * Plafonds : 3 appels, 0,02 $/échange, 0,06 $ cumulés. Clé jamais affichée.
 */
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(__dirname, '..')
const MODEL = 'gpt-5.4-mini'
const MAX_CALLS = 3
const MAX_OUTPUT_TOKENS = 700
const USD_PER_CALL = 0.02
const USD_TOTAL = 0.06
const INPUT_PRICE = 0.75
const OUTPUT_PRICE = 4.5
const ENDPOINT = 'https://api.openai.com/v1/chat/completions'

const STORES = { storeId: '11111111-1111-4111-8111-111111111111', storeName: 'Boutique Synthétique', storeCurrency: 'MAD', userMainCurrency: 'MAD' }

function envelope(overrides) {
  return {
    contractVersion: 2,
    kind: 'kpis',
    state: 'complete',
    range: { from: '2026-09-01', to: '2026-09-08' },
    timeZone: 'Africa/Casablanca',
    currency: 'MAD',
    definitionVersions: [1],
    access: { [STORES.storeId]: 'full' },
    coverage: [],
    stores: [],
    limits: [],
    issues: [],
    metrics: {},
    ...overrides,
  }
}

const metric = (value, unit = 'decimal', state = 'complete') => ({ value, count: unit === 'count' ? Number(value) : null, unit, state, definition: 'V5 synthétique', numerator: null, denominator: null })

const CASES = [
  {
    id: 'V2-KPI',
    question: 'Analyse mon business sur la période : CA, commandes et marge contributive.',
    toolResults: {
      getDashboardKPIs: envelope({
        metrics: {
          totalOrders: metric('101', 'count'),
          deliveredOrders: metric('66', 'count'),
          revenue: metric('24107.00'),
          adSpend: metric('4200.00'),
          contributionMargin: metric('6030.50'),
        },
      }),
    },
    expect: ['24107', '101', '6030'],
    forbid: [/profit net/i],
  },
  {
    id: 'V2-COMPARE',
    question: 'Compare septembre 2026 à août 2026 sur le chiffre d’affaires.',
    toolResults: {
      getStoreComparison: {
        contractVersion: 2,
        kind: 'periods',
        state: 'complete',
        ranges: { current: { from: '2026-09-01', to: '2026-09-08' }, baseline: { from: '2026-08-01', to: '2026-09-01' } },
        currency: 'MAD',
        definitions: { current: [1], baseline: [1] },
        deltas: [{ metric: 'revenue', current: '24107.00', baseline: '22000.00', delta: '2107.00', state: 'complete', reason: null }],
        notices: [],
        issues: [],
      },
    },
    expect: ['2107', '22000'],
    forbid: [/invent/i],
  },
  {
    id: 'V2-FORBIDDEN',
    question: 'Donne-moi la marge contributive de cette période.',
    toolResults: {
      getProfitSummary: envelope({ state: 'forbidden', metrics: { contributionMargin: metric(null, 'decimal', 'forbidden') }, issues: ['KPI_NO_ACCESS'] }),
    },
    expect: [],
    forbid: [/24107/, /6030/],
    requireAll: [/acc[èe]s|refus|autoris|indisponible/i],
  },
]

function sanitizeKey(raw) {
  if (typeof raw !== 'string') return null
  const key = raw.replace(/[\r\n\t]/g, '').trim()
  if (!key || key.startsWith('<') || /[^\x21-\x7E]/.test(key) || !key.startsWith('sk-')) return null
  return key
}

function readKey() {
  const fromEnv = sanitizeKey(process.env.OPENAI_API_KEY)
  if (fromEnv) return fromEnv
  const index = process.argv.indexOf('--key-file')
  if (index === -1) return null
  const file = path.resolve(process.argv[index + 1] || '')
  if (file.startsWith(ROOT)) return null
  try {
    return sanitizeKey(require('node:fs').readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

const cost = (input, output) => Number(((input / 1e6) * INPUT_PRICE + (output / 1e6) * OUTPUT_PRICE).toFixed(6))

async function loadPrompts() {
  try {
    const mod = await import(pathToFileURL(path.join(ROOT, 'lib/assistant/prompt.ts')).href)
    return { system: mod.buildAgentSystemPrompt, user: mod.buildAgentUserPrompt, source: 'lib/assistant/prompt.ts' }
  } catch {
    // Réplique fidèle si l'alias TS n'est pas résoluble hors bundler.
    const rules = [
      'Tu es un assistant analytique e-commerce. Réponds STRICTEMENT en JSON.',
      'Les valeurs des outils sont la seule source de vérité ; n inventе jamais de chiffre.',
      'États : complete, empty, partial, missing, forbidden, unavailable.',
      'empty = zéro réel ; missing/forbidden/unavailable = AUCUN chiffre, explique l absence.',
      'partial = valeur réelle incomplète, affiche-la avec réserve.',
      'Distingue marge contributive et bénéfice net ; ne nomme jamais la marge "profit net".',
      'Ne compare que des périodes de même devise et même couverture.',
      'Format : {"message_text":"...","suggestions":[],"warnings":[],"chart":false}',
    ].join('\n')
    return {
      source: 'replique-locale',
      system: () => rules,
      user: ({ userMessage, range, toolResults }) =>
        `## Contexte\nStore: ${STORES.storeName} (${STORES.storeCurrency})\nPériode: ${range}\n\n## Question utilisateur\n${userMessage}\n\n## Résultats des outils\n${JSON.stringify(toolResults, null, 2)}\n\nRéponds avec un objet JSON valide selon le format spécifié.`,
    }
  }
}

function digits(text) {
  return String(text || '').replace(/[^0-9]/g, '')
}

async function main() {
  const apiKey = readKey()
  if (!apiKey) {
    console.log('FAIL  clé absente ou invalide (--key-file hors dépôt attendu)')
    process.exitCode = 2
    return
  }

  const prompts = await loadPrompts()
  console.log(`INFO  prompts: ${prompts.source} | modèle: ${MODEL} | max ${MAX_CALLS} appels / ${USD_TOTAL} $`)

  let cumulative = 0
  const results = []

  for (const [index, testCase] of CASES.entries()) {
    if (index >= MAX_CALLS) break

    const range = '2026-09-01..2026-09-08'
    const systemPrompt = prompts.system('dashboard_summary', STORES)
    const userPrompt = prompts.user({
      userMessage: testCase.question,
      range,
      selectedTools: Object.keys(testCase.toolResults),
      toolResults: testCase.toolResults,
      storeContext: STORES,
    })

    const startedAt = Date.now()
    let response
    try {
      response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: MODEL,
          reasoning_effort: 'none',
          max_completion_tokens: MAX_OUTPUT_TOKENS,
          messages: [
            { role: 'system', content: typeof systemPrompt === 'string' ? systemPrompt : String(systemPrompt) },
            { role: 'user', content: userPrompt },
          ],
        }),
      })
    } catch (error) {
      console.log(`FAIL  ${testCase.id} : réseau (${(error && error.cause && error.cause.code) || 'inconnu'})`)
      process.exitCode = 1
      return
    }

    const latencyMs = Date.now() - startedAt
    if (!response.ok) {
      console.log(`FAIL  ${testCase.id} : HTTP ${response.status} — arrêt`)
      process.exitCode = 1
      return
    }

    const payload = await response.json()
    const inputTokens = Number(payload?.usage?.prompt_tokens || 0)
    const outputTokens = Number(payload?.usage?.completion_tokens || 0)
    const callCost = cost(inputTokens, outputTokens)

    if (callCost > USD_PER_CALL || cumulative + callCost > USD_TOTAL) {
      console.log(`FAIL  ${testCase.id} : budget dépassé (${callCost} $, cumul ${cumulative + callCost} $)`)
      process.exitCode = 1
      return
    }
    cumulative = Number((cumulative + callCost).toFixed(6))

    const text = String(payload?.choices?.[0]?.message?.content || '')
    const verdicts = []

    let parsed = null
    try {
      const start = text.indexOf('{')
      const end = text.lastIndexOf('}')
      parsed = JSON.parse(text.slice(start, end + 1))
      verdicts.push(['json_valide', true])
    } catch {
      verdicts.push(['json_valide', false])
    }

    const allText = `${text}\n${parsed ? JSON.stringify(parsed) : ''}`
    const normalized = digits(allText)
    for (const expected of testCase.expect) verdicts.push([`montant_${expected}`, normalized.includes(expected)])
    for (const forbidden of testCase.forbid || []) verdicts.push([`interdit_${forbidden.source.slice(0, 14)}`, !forbidden.test(allText)])
    for (const required of testCase.requireAll || []) verdicts.push([`attendu_${required.source.slice(0, 14)}`, required.test(allText)])

    const failed = verdicts.filter(([, ok]) => !ok)
    results.push({ id: testCase.id, failed: failed.map(([name]) => name), inputTokens, outputTokens, callCost, latencyMs })

    console.log(`${failed.length === 0 ? 'PASS' : 'FAIL'}  ${testCase.id}  in=${inputTokens} out=${outputTokens} coût=${callCost} latence=${latencyMs}ms${failed.length ? `  échecs=${failed.map(([n]) => n).join(',')}` : ''}`)
  }

  const failures = results.filter((r) => r.failed.length > 0)
  console.log(`\nTotal : ${results.length - failures.length}/${results.length} cas PASS | cumul=${cumulative} $ | tokens=${results.reduce((s, r) => s + r.inputTokens + r.outputTokens, 0)} | latence_moy=${Math.round(results.reduce((s, r) => s + r.latencyMs, 0) / Math.max(1, results.length))}ms`)
  process.exitCode = failures.length === 0 ? 0 : 1
}

main().catch((error) => {
  console.log(`FAIL  sonde analytique : ${error instanceof Error ? error.message : 'erreur'}`)
  process.exitCode = 1
})

