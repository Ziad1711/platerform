#!/usr/bin/env node
/**
 * Tests synthétiques du moteur analytique et du rendu (P1-10 → P1-20).
 *
 * Exécution : `node scripts/assistant-analytics-p1.synthetic-tests.cjs`
 *
 * Aucuna donnée de production, aucun réseau, aucune écriture en base :
 * les modules TypeScript sont transpilés en mémoire et leurs dépendances
 * Supabase/fournisseur sont remplacées par des doubles.
 */
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const vm = require('node:vm')

const ROOT = process.cwd()

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
        jsx: ts.JsxEmit.ReactJSX,
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
function assert(condition, message) {
  if (!condition) throw new Error(message)
}
function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message} (attendu ${expected}, obtenu ${actual})`)
}
function assertNoDigits(text, message) {
  if (/\d/.test(text)) throw new Error(`${message} — chiffres trouvés : ${text}`)
}
/**
 * Interdit les montants et les grands nombres issus de données. Un libellé de
 * période (« 7 derniers jours ») reste autorisé : ce n'est pas une mesure.
 */
function assertNoAmounts(text, message) {
  if (/\d{3,}/.test(text) || /\b\d+\s*(MAD|EUR|USD|DH)\b/.test(text)) {
    throw new Error(`${message} — montants trouvés : ${text}`)
  }
}

module.exports = { createLoader, check, assert, assertEqual, assertNoDigits, results }

/* -------------------------------------------------------------------------- */
/* Doubles                                                                     */
/* -------------------------------------------------------------------------- */

function metric(value, state = 'complete', unit = 'decimal', extra = {}) {
  return {
    value,
    count: unit === 'count' && value !== null ? Number(value) : null,
    unit,
    state,
    definition: 'synthetic',
    numerator: extra.numerator ?? null,
    denominator: extra.denominator ?? null,
  }
}

function envelope(state, metrics, extra = {}) {
  return {
    contractVersion: 2,
    kind: 'kpis',
    state,
    range: { from: '2026-01-01', to: '2026-01-08' },
    timeZone: 'Africa/Casablanca',
    currency: 'MAD',
    definitionVersions: [1],
    access: { store: 'full' },
    coverage: [],
    metrics,
    stores: [],
    limits: extra.limits ?? [],
    issues: extra.issues ?? [],
  }
}

function section(state, rows, currencies = ['MAD'], notices = []) {
  return {
    meta: { contractVersion: 2, section: 'synthetic', state, source: 'synthetic', currencies, notices, issues: [], limits: [] },
    rows,
    totals: {},
  }
}

function agentMocks({ toolDataByTool, providerText, session }) {
  const shared = session ?? { kpis: async () => ({}) }
  return {
    '@/lib/assistant/providers': {
      getAssistantProvider: () => ({
        chat: async () => ({ text: providerText, inputTokens: 10, outputTokens: 10, providerName: 'mock', modelName: 'mock', providerCostUsd: 0 }),
      }),
    },
    '@/lib/assistant/prompt': { buildAgentSystemPrompt: () => '', buildAgentUserPrompt: () => '' },
    '@/lib/assistant/analytics-reader': {
      createAssistantAnalyticsSession: () => shared,
      resolveAssistantBusinessRange: (range) => (typeof range === 'object' && range && 'from' in range
        ? range
        : { from: '2026-01-01', to: '2026-01-08' }),
    },
    '@/lib/assistant/agent/tools': {
      buildToolPlan: (intent) => (toolDataByTool.order ?? ['getDashboardKPIs']).map((toolName) => ({ toolName, reason: 'synthetic' })),
      executeAgentTool: async ({ toolName }) => ({ toolName, data: toolDataByTool[toolName] ?? section('unavailable', []) }),
    },
  }
}

const AGENT_INPUT = {
  supabase: {},
  scopeStoreIds: ['store'],
  scopeContext: {
    scopeStoreIds: ['store'],
    displayStoreId: 'store',
    displayStoreName: 'Store test',
    displayCurrency: 'MAD',
    userMainCurrency: 'MAD',
  },
  intent: 'dashboard_summary',
  range: '7d',
  userMessage: 'Analyse mes ventes',
  conversationHistory: [],
  providerModel: 'mock',
}

async function runAgent(mocks, overrides = {}) {
  const load = createLoader(mocks)
  const agent = load('lib/assistant/agent/index.ts')
  return agent.runSecureAssistantAgent({ ...AGENT_INPUT, ...overrides })
}


/* -------------------------------------------------------------------------- */
/* P1-12 / P1-10 : validation IA et assainissement numérique                   */
/* -------------------------------------------------------------------------- */

async function main() {
  const responseModule = createLoader({})('lib/assistant/response.ts')

  check('P1-12a', 'JSON invalide neutralisé sans exception', () => {
    const parsed = responseModule.parseAssistantLlmOutput('{ "message_text": "oops" , ')
    assert(parsed.issues.includes('LLM_OUTPUT_INVALID_JSON'), `issues=${JSON.stringify(parsed.issues)}`)
    assert(typeof parsed.output.message_text === 'string', 'texte brut attendu')
    return parsed.issues.join(',')
  })

  check('P1-12b', 'Champs mal typés supprimés (suggestions string, warnings objets)', () => {
    const parsed = responseModule.parseAssistantLlmOutput(
      '{"message_text":"ok","suggestions":"bad","warnings":[{}],"conversation_title":"Titre"}',
    )
    assert(parsed.output.suggestions === undefined, 'suggestions aurait dû être supprimé')
    assert(parsed.output.warnings === undefined, 'warnings aurait dû être supprimé')
    assertEqual(parsed.output.message_text, 'ok', 'message_text conservé')
    assert(parsed.issues.length > 0, 'anomalies attendues')
    return parsed.issues.join(',')
  })

  check('P1-10a', 'Montant non vérifié retiré du texte IA', () => {
    const clean = responseModule.sanitizeExplanation(
      'Le CA est 999999 MAD. Le CA vérifié est 100.00 MAD.',
      ['100.00'],
    )
    assert(!clean.text.includes('999999'), `texte conservé : ${clean.text}`)
    assert(clean.text.includes('100.00'), 'montant vérifié conservé')
    assert(clean.rejectedAmounts.includes('999999'), 'montant rejeté signalé')
    return `rejetés=${clean.rejectedAmounts.join('|')}`
  })

  check('P1-10b', 'Aucun chiffre toléré quand aucune valeur vérifiée', () => {
    const clean = responseModule.sanitizeExplanation('Environ 12 500 MAD sur 30 jours.', [])
    assertNoDigits(clean.text, 'texte sans valeur vérifiée')
    return clean.rejectedAmounts.join('|')
  })

  check('P1-13a', 'Graphique journalier : valeur numérique + libellé exact + devise', () => {
    const chart = responseModule.buildDailyChart(
      {
        kind: 'daily',
        state: 'complete',
        days: [
          { date: '2026-01-01', revenue: '120.50', currency: 'MAD', state: 'complete' },
          { date: '2026-01-02', revenue: '0', currency: 'MAD', state: 'empty' },
        ],
      },
      'MAD',
    )
    assert(chart !== null, 'graphique attendu')
    assert(chart.points.every((point) => typeof point.value === 'number'), 'value numérique attendu')
    assertEqual(chart.points[0].valueLabel, '120.50 MAD', 'libellé exact')
    return `${chart.points.length} points`
  })

  check('P1-14a', 'Points missing/forbidden filtrés du graphique', () => {
    const chart = responseModule.buildDailyChart(
      {
        kind: 'daily',
        state: 'partial',
        days: [
          { date: '2026-01-01', revenue: '10', currency: 'MAD', state: 'forbidden' },
          { date: '2026-01-02', revenue: '20', currency: 'MAD', state: 'complete' },
          { date: '2026-01-03', revenue: '30', currency: 'MAD', state: 'complete' },
        ],
      },
      'MAD',
    )
    assert(chart !== null, 'graphique attendu')
    assertEqual(chart.points.length, 2, 'deux points traçables')
    assert(chart.points.every((point) => point.valueLabel.endsWith('MAD')), 'devise par point')
    assert(chart.warnings.some((warning) => warning.includes('écarté')), 'avertissement de filtrage')
    return chart.warnings.join('|')
  })

  check('P1-14b', 'Refus de mélange de devises dans une série', () => {
    const chart = responseModule.buildDailyChart(
      {
        kind: 'daily',
        state: 'complete',
        days: [
          { date: '2026-01-01', revenue: '10', currency: 'MAD', state: 'complete' },
          { date: '2026-01-02', revenue: '20', currency: 'EUR', state: 'complete' },
        ],
      },
      'MAD',
    )
    assertEqual(chart, null, 'aucune série multidevise')
    return 'null'
  })

  check('P1-13b', 'Section interdite : aucun graphique produit', () => {
    const chart = responseModule.buildStructuredResponseFromContext('top_products', 'texte', {
      products: section('forbidden', [{ productName: 'A', revenue: '10' }]),
    })
    assertEqual(chart.chart, false, 'chart doit rester désactivé')
    return 'chart=false'
  })

  check('P1-13c', 'Section complète : graphique bar avec value numérique', () => {
    const built = responseModule.buildStructuredResponseFromContext('top_products', 'texte', {
      products: section('complete', [
        { productName: 'A', revenue: '15.75' },
        { productName: 'B', revenue: '4.25' },
      ]),
    })
    assertEqual(built.chart, true, 'graphique attendu')
    assert(built.chart_data.every((row) => typeof row.value === 'number'), 'value numérique')
    assert(built.chart_data.every((row) => typeof row.valueLabel === 'string'), 'valueLabel')
    return `${built.chart_data.length} barres`
  })


/* -------------------------------------------------------------------------- */
/* P1-15 / P1-16 : comparaisons explicites et relatives                        */
/* -------------------------------------------------------------------------- */

  const intents = createLoader({})('lib/assistant/intents.ts')

  check('P1-15a', 'Paire explicite : ordre du texte (mars → janvier)', () => {
    const pair = intents.resolveComparisonPeriods('compare mars 2026 et janvier 2026')
    assert(pair !== null, 'paire attendue')
    assertEqual(pair.current.from, '2026-03-01', 'courante = mars (citée en premier)')
    assertEqual(pair.current.to, '2026-04-01', 'fin de mars')
    assertEqual(pair.baseline.from, '2026-01-01', 'référence = janvier')
    assertEqual(pair.labels.current, 'mars 2026', 'libellé courant')
    return `${pair.labels.current} vs ${pair.labels.baseline}`
  })

  check('P1-15b', 'Paire inversée respectée (janvier → mars)', () => {
    const pair = intents.resolveComparisonPeriods('compare janvier 2026 et mars 2026')
    assertEqual(pair.current.from, '2026-01-01', 'courante = janvier')
    assertEqual(pair.baseline.from, '2026-03-01', 'référence = mars')
    return `${pair.labels.current} vs ${pair.labels.baseline}`
  })

  check('P1-15c', 'Période primaire = premier mois cité', () => {
    const range = intents.resolveRangeFromQuestion('compare mars 2026 et janvier 2026')
    assert(range && typeof range === 'object' && 'start' in range, 'période absolue attendue')
    assert(range.start.startsWith('2026-02-28') || range.start.startsWith('2026-03-01'), `start=${range.start}`)
    return range.start
  })

  check('P1-16a', 'Périodes relatives : ce mois vs mois dernier', () => {
    const pair = intents.resolveComparisonPeriods('compare ce mois et le mois dernier')
    assert(pair !== null, 'paire relative attendue')
    assert(pair.current.from > pair.baseline.from, 'courante postérieure à la référence')
    assertEqual(pair.labels.current, 'ce mois', 'libellé courant')
    assertEqual(pair.labels.baseline, 'le mois dernier', 'libellé référence')
    return `${pair.current.from}..${pair.current.to} vs ${pair.baseline.from}..${pair.baseline.to}`
  })

  check('P1-16b', 'Périodes relatives : 7 jours vs 30 jours', () => {
    const pair = intents.resolveComparisonPeriods('compare les 7 derniers jours et les 30 derniers jours')
    assert(pair !== null, 'paire attendue')
    assertEqual(pair.labels.current, 'les 7 derniers jours', 'libellé courant')
    assertEqual(pair.labels.baseline, 'les 30 derniers jours', 'libellé référence')
    return '7d vs 30d'
  })

  check('P1-16c', 'Comparaison indéterminable refusée', () => {
    assertEqual(intents.resolveComparisonPeriods('compare mes ventes'), null, 'aucune paire inventée')
    return 'null'
  })

/* -------------------------------------------------------------------------- */
/* P1-17 / P1-18 / P1-19 : contrats RPC et exactitude                          */
/* -------------------------------------------------------------------------- */

  const validation = createLoader({})('lib/assistant/analytics-rpc-validation.ts')
  const decimal = createLoader({})('lib/assistant/analytics-decimal.ts')

  check('P1-17a', 'Payload RPC non tabulaire rejeté (objet)', () => {
    const outcome = validation.validateRows(validation.CityPerformanceRowSchema, { error: 'bad' })
    assertEqual(outcome.ok, false, 'doit être rejeté')
    assert(outcome.issues[0].includes('ROW_SET_NOT_TABULAR'), outcome.issues[0])
    return outcome.issues[0]
  })

  check('P1-17b', 'Payload RPC `null` rejeté', () => {
    const outcome = validation.validateRows(validation.ConfirmationFunnelRowSchema, null)
    assertEqual(outcome.ok, false, 'doit être rejeté')
    return outcome.issues[0]
  })

  check('P1-18a', 'Compteurs fractionnaires ou négatifs rejetés', () => {
    const base = {
      city: 'Casa',
      confirmed_orders: 1,
      delivered_orders: 1,
      returned_orders: 0,
      cancelled_orders: 0,
      total_revenue: '10',
    }
    assertEqual(validation.CityPerformanceRowSchema.safeParse({ ...base, total_orders: 3.5 }).success, false, 'fraction')
    assertEqual(validation.CityPerformanceRowSchema.safeParse({ ...base, total_orders: -2 }).success, false, 'négatif')
    assertEqual(validation.CityPerformanceRowSchema.safeParse({ ...base, total_orders: '12abc' }).success, false, 'texte')
    assertEqual(validation.CityPerformanceRowSchema.safeParse({ ...base, total_orders: '12' }).success, true, 'entier texte')
    return 'fraction/négatif/texte refusés'
  })

  check('P1-18b', 'Montants invalides rejetés', () => {
    const row = { product_id: null, product_name: 'P', total_quantity: 1, profit: null }
    assertEqual(validation.TopProductRowSchema.safeParse({ ...row, total_revenue: 'NaN' }).success, false, 'NaN')
    assertEqual(validation.TopProductRowSchema.safeParse({ ...row, total_revenue: Number.POSITIVE_INFINITY }).success, false, 'Infinity')
    assertEqual(validation.TopProductRowSchema.safeParse({ ...row, total_revenue: '12.50' }).success, true, 'décimal valide')
    return 'NaN/Infinity refusés'
  })

  check('P1-19a', 'Montant JavaScript non sûr non revendiqué exact', () => {
    assertEqual(decimal.toDecimalText(9007199254740993), null, 'au-delà de 2^53 rejeté')
    const read = decimal.decimalFromRpc(9007199254740993)
    assertEqual(read.exact, false, 'marqué inexact')
    return `value=${read.value} exact=${read.exact}`
  })

  check('P1-19b', 'Chaîne décimale exacte conservée', () => {
    const read = decimal.decimalFromRpc('9007199254740993.01')
    assertEqual(read.exact, true, 'chaîne exacte')
    assertEqual(read.value, '9007199254740993.01', 'valeur conservée')
    assertEqual(decimal.sumDecimals(['0.1', '0.2']), '0.3', 'somme exacte')
    return read.value
  })


/* -------------------------------------------------------------------------- */
/* P1-10 / P1-11 / P1-12 : orchestrateur et réponses                           */
/* -------------------------------------------------------------------------- */

  const mocksInvented = agentMocks({
    providerText: JSON.stringify({ message_text: 'Le CA est 999999 MAD, un résultat excellent.' }),
    toolDataByTool: {
      order: ['getDashboardKPIs'],
      getDashboardKPIs: envelope('complete', {
        totalOrders: metric('3', 'complete', 'count'),
        revenue: metric('100.00'),
      }),
    },
  })

  const invented = await runAgent(mocksInvented)
  check('P1-10c', 'Orchestrateur : chiffre inventé retiré de la réponse finale', () => {
    const text = invented.structuredResponse.message_text
    assert(!text.includes('999999'), `chiffre inventé conservé : ${text}`)
    assert(text.includes('100.00'), 'faits vérifiés présents')
    assert(
      (invented.structuredResponse.warnings ?? []).some((warning) => warning.includes('Chiffre non vérifié retiré')),
      'avertissement de retrait attendu',
    )
    return text.split('\n')[0]
  })

  const blockedMocks = agentMocks({
    providerText: JSON.stringify({ message_text: 'Le stock est de 42 unités et le CA de 1500 MAD.' }),
    toolDataByTool: {
      order: ['getStockSummary'],
      getStockSummary: section('unavailable', [], ['MAD'], ['Stock par variante non disponible.']),
    },
  })
  const blocked = await runAgent(blockedMocks, { intent: 'stock_analysis', userMessage: 'Analyse mon stock' })

  check('P1-11a', 'Outil unavailable : réponse déterministe sans aucun chiffre inventé', () => {
    const structured = blocked.structuredResponse
    assertNoAmounts(structured.message_text, 'message déterministe')
    assert(!structured.message_text.includes('42'), 'valeur IA "42" retirée')
    assertEqual(structured.chart, false, 'aucun graphique')
    assert((structured.warnings ?? []).length > 0, 'avertissements propagés')
    return structured.message_text
  })

  const forbiddenMocks = agentMocks({
    providerText: JSON.stringify({ message_text: 'Le CA est 500 MAD.' }),
    toolDataByTool: {
      order: ['getDashboardKPIs'],
      getDashboardKPIs: envelope('forbidden', {
        revenue: metric(null, 'forbidden'),
        contributionMargin: metric(null, 'forbidden'),
      }),
    },
  })
  const forbidden = await runAgent(forbiddenMocks)

  check('P1-11b', 'État forbidden : refus explicite, aucun montant, résumé vide', () => {
    const structured = forbidden.structuredResponse
    assertNoAmounts(structured.message_text, 'message de refus')
    assert(!structured.message_text.includes('500'), 'montant IA retiré')
    assert((structured.message_text || '').toLowerCase().includes('refus'), structured.message_text)
    assertEqual((structured.metrics_summary ?? []).length, 0, 'aucune métrique affichée')
    assertEqual(structured.chart, false, 'aucun graphique')
    return structured.message_text
  })

  const marginMocks = agentMocks({
    providerText: JSON.stringify({ message_text: 'Bonne dynamique.' }),
    toolDataByTool: {
      order: ['getDashboardKPIs'],
      getDashboardKPIs: envelope('complete', {
        revenue: metric('1000.00'),
        contributionMargin: metric('250.00'),
      }),
    },
  })
  const margin = await runAgent(marginMocks)

  check('P1-12d', 'Marge contributive distinguée du bénéfice net', () => {
    const text = margin.structuredResponse.message_text
    assert(text.includes('Marge contributive'), 'libellé contributif attendu')
    assert(text.includes('n’est pas un bénéfice net'), 'avertissement de séparation attendu')
    assert(!/profit net/i.test(text), 'aucun « profit net »')
    return 'marge ≠ bénéfice net'
  })

  const emptyMocks = agentMocks({
    providerText: JSON.stringify({ message_text: 'Aucune vente sur la période.' }),
    toolDataByTool: {
      order: ['getDashboardKPIs'],
      getDashboardKPIs: envelope('empty', {
        totalOrders: metric('0', 'empty', 'count'),
        revenue: metric('0', 'empty'),
      }),
    },
  })
  const empty = await runAgent(emptyMocks)

  check('P1-12f', 'État empty : zéro réel explicite, sans graphique', () => {
    const structured = empty.structuredResponse
    assert(structured.message_text.includes('zéro réel'), structured.message_text)
    assertEqual(structured.chart, false, 'aucun graphique sans valeur')
    return structured.message_text
  })


/* -------------------------------------------------------------------------- */
/* P1-20 : comparabilité, couverture et fraîcheur                              */
/* -------------------------------------------------------------------------- */

  const storeId = '11111111-1111-4111-8111-111111111111'

  function kpiPayload(access, overrides = {}) {
    const now = new Date().toISOString()
    return {
      definition_version: 1,
      range: { from: '2026-01-01', to: '2026-02-01' },
      generated_at: now,
      incomplete: false,
      stores: [
        {
          store_id: storeId,
          access,
          currency: 'MAD',
          tz: 'Africa/Casablanca',
          definition_version: 1,
          revision: '1',
          last_rebuild_at: now,
          coverage: {
            days_total: 31,
            days_aggregate: 31,
            days_direct: 0,
            days_dirty: 0,
            days_missing: 0,
            days_incompatible: 0,
            days_partial: 0,
            ...(overrides.coverage ?? {}),
          },
          incomplete: Boolean(overrides.incomplete ?? false),
          totals: {
            orders_count: 10,
            delivered_count: 8,
            cancelled_count: 1,
            returned_count: 1,
            revenue: '1000.00',
            revenue_estimated: '0',
            ad_spend_contract: '100.00',
            delivery_rate: '80',
            contribution_margin: '250.00',
          },
          points: [],
        },
      ],
    }
  }

  function readerWith(payloads) {
    let index = 0
    const load = createLoader({
      '@/lib/dashboard/kpi-reader': {
        fetchDashboardKpiReader: async () => payloads[Math.min(index++, payloads.length - 1)],
        hasFinancialTotals: (store) => store.access === 'full',
        KPI_READER_RPC_V2: 'rpc_dashboard_kpi_reader_v2',
      },
    })
    return load('lib/assistant/analytics-reader.ts')
  }

  const accessReader = readerWith([kpiPayload('full'), kpiPayload('commercial')])
  const accessComparison = await accessReader.compareAssistantPeriods(
    {}, [storeId], { from: '2026-01-01', to: '2026-02-01' }, { from: '2025-12-01', to: '2026-01-01' },
  )

  check('P1-20a', 'Accès différents entre périodes ⇒ comparaison refusée', () => {
    assertEqual(accessComparison.state, 'partial', 'état partiel')
    assert(accessComparison.deltas.every((delta) => delta.delta === null), 'aucun écart calculé')
    assert(
      accessComparison.notices.some((notice) => notice.includes('accès')),
      accessComparison.notices.join('|'),
    )
    return accessComparison.notices[0]
  })

  const coverageReader = readerWith([
    kpiPayload('full'),
    kpiPayload('full', { coverage: { days_missing: 2, days_aggregate: 29 } }),
  ])
  const coverageComparison = await coverageReader.compareAssistantPeriods(
    {}, [storeId], { from: '2026-01-01', to: '2026-02-01' }, { from: '2025-12-01', to: '2026-01-01' },
  )

  check('P1-20b', 'Couverture différente ⇒ aucun écart monétaire', () => {
    assertEqual(coverageComparison.state, 'partial', 'état partiel')
    assert(coverageComparison.deltas.every((delta) => delta.delta === null), 'écarts bloqués')
    assert(
      coverageComparison.notices.some((notice) => notice.includes('couverture')),
      coverageComparison.notices.join('|'),
    )
    return coverageComparison.notices[0]
  })

  const freshReader = readerWith([kpiPayload('full'), kpiPayload('full')])
  const freshComparison = await freshReader.compareAssistantPeriods(
    {}, [storeId], { from: '2026-01-01', to: '2026-02-01' }, { from: '2025-12-01', to: '2026-01-01' },
  )

  check('P1-20c', 'Périodes comparables : écarts exacts et fraîcheur exposée', () => {
    assertEqual(freshComparison.state, 'complete', 'comparaison complète')
    const revenue = freshComparison.deltas.find((delta) => delta.metric === 'revenue')
    assert(revenue && revenue.delta === '0', `écart attendu 0, obtenu ${JSON.stringify(revenue)}`)
    assert(freshComparison.freshness, 'fraîcheur exposée')
    assertEqual(freshComparison.freshness.stale, false, 'lecture fraîche')
    return 'delta revenue=0'
  })


/* -------------------------------------------------------------------------- */
/* Séparation des comparaisons dans l'outil                                    */
/* -------------------------------------------------------------------------- */

  const toolsLoad = createLoader({
    '@/lib/assistant/analytics-reader': {
      createAssistantAnalyticsSession: () => ({
        supabase: {},
        storeIds: ['store'],
        range: { from: '2026-01-01', to: '2026-01-08' },
        kpis: async () => ({}),
      }),
      resolveAssistantBusinessRange: () => ({ from: '2026-01-01', to: '2026-01-08' }),
      buildKpiEnvelope: () => null,
      compareAssistantPeriods: async () => ({ kind: 'periods' }),
      compareAssistantStores: async () => ({ kind: 'stores' }),
    },
    '@/lib/assistant/analytics-sections': {
      readConfirmationSection: async () => ({}),
      readAgentSection: async () => ({}),
      readCitySection: async () => ({}),
    },
    '@/lib/assistant/analytics-products': {
      readProductSection: async () => ({}),
      readRecentOrdersSection: async () => ({}),
      readDeliverySection: () => ({}),
      readStockSection: () => ({}),
    },
  })
  const tools = toolsLoad('lib/assistant/agent/tools.ts')
  const toolInput = {
    supabase: {},
    storeIds: ['store'],
    storeContext: { storeId: 'store', storeName: 'S', storeCurrency: 'MAD', userMainCurrency: 'MAD' },
    range: '7d',
    toolName: 'getStoreComparison',
    userMessage: 'compare',
  }

  const periodsResult = await tools.executeAgentTool({
    ...toolInput,
    comparisonBaseline: { from: '2025-12-01', to: '2026-01-01' },
  })
  const storesResult = await tools.executeAgentTool({ ...toolInput })

  check('P1-16d', 'Séparation periods/stores sans ambiguïté', () => {
    assertEqual(periodsResult.data.kind, 'periods', 'référence explicite ⇒ periods')
    assertEqual(storesResult.data.kind, 'stores', 'sans référence ⇒ stores')
    return `${periodsResult.data.kind}/${storesResult.data.kind}`
  })

/* -------------------------------------------------------------------------- */
/* Rapport                                                                     */
/* -------------------------------------------------------------------------- */

  check('A01', '100.00 n’autorise jamais 10000 MAD', () => {
    const clean = responseModule.sanitizeNarrative('Le CA est 10000 MAD.')
    assert(!clean.text.includes('10000'), clean.text)
    return clean.rejectedAmounts.join('|')
  })

  check('A02', 'Un compteur ne peut pas devenir un montant', () => {
    const clean = responseModule.sanitizeNarrative('Le CA est 3 MAD.')
    assert(!clean.text.includes('3 MAD'), clean.text)
    return 'association retirée'
  })

  check('A03', 'Les nombres en lettres sont retirés sans données', () => {
    const clean = responseModule.sanitizeNarrative('Le stock vaut mille dirhams.')
    assertEqual(clean.text, '', 'narratif chiffré supprimé')
    return clean.rejectedAmounts.join('|')
  })

  check('A04', 'Comparaison relative classée period_comparison', () => {
    assertEqual(intents.resolveIntent('compare ce mois et le mois dernier'), 'period_comparison', 'intent relatif')
    return 'period_comparison'
  })

  check('A04b', 'Salutation suivie d’une question n’est pas un simple greeting', () => {
    assertEqual(intents.resolveIntent('bonsoir'), 'greeting', 'salutation seule')
    assertEqual(intents.resolveIntent('Bonjour !'), 'greeting', 'salutation ponctuée')
    assertEqual(
      intents.resolveIntent('bonsoir, que pensez vous de ma performance'),
      'performance_request',
      'question précédée d’une salutation'
    )
    assert(
      intents.resolveIntent('salut, montre-moi mes ventes') !== 'greeting',
      'salutation + ventes ne doit pas être un greeting'
    )
    return 'greeting strict'
  })

  check('A05', 'Comparaison MM/YYYY résolue dans l’ordre', () => {
    const pair = intents.resolveComparisonPeriods('compare 03/2026 et 01/2026')
    assert(pair, 'paire numérique attendue')
    assertEqual(pair.current.from, '2026-03-01', 'courante mars')
    assertEqual(pair.baseline.from, '2026-01-01', 'référence janvier')
    return `${pair.labels.current} vs ${pair.labels.baseline}`
  })

  check('A06', 'Tooltip exact lu depuis item.payload.valueLabel', () => {
    const source = fs.readFileSync(path.join(ROOT, 'components/assistant/assistant-chart-card.tsx'), 'utf8')
    assert(source.includes('item?.payload'), 'payload Recharts non lu')
    assert(source.includes('<Tooltip formatter={renderTooltipValue}'), 'formatter non raccordé')
    return 'payload.valueLabel'
  })

  check('A07', 'Fraîcheur fondée sur last_rebuild_at, pas generated_at', () => {
    const source = fs.readFileSync(path.join(ROOT, 'lib/assistant/analytics-reader.ts'), 'utf8')
    assert(source.includes('Date.parse(oldestRebuildAt)'), 'âge de reconstruction absent')
    assert(source.includes('COMPARISON_AGGREGATES_STALE'), 'stale ne bloque pas la comparaison')
    return 'aggregate freshness'
  })

  check('A08', 'days_partial et métriques partial bloquent les deltas complets', () => {
    const source = fs.readFileSync(path.join(ROOT, 'lib/assistant/analytics-reader.ts'), 'utf8')
    assert(source.includes('store.coverage.days_partial === 0'), 'days_partial non contrôlé')
    assert(source.includes("metric.state !== 'complete' && metric.state !== 'empty'"), 'métrique partielle sommée')
    return 'partial blocked'
  })

  check('A09', 'Aucun number RPC n’est déclaré exact', () => {
    const read = decimal.decimalFromRpc(0.1)
    assertEqual(read.exact, false, 'number JavaScript doit rester inexact')
    assertEqual(decimal.toDecimalText(0.1), null, 'pas de texte exact revendiqué')
    return JSON.stringify(read)
  })

  check('A10', 'Stock/livraison inclus dans les avertissements propagés', () => {
    const source = fs.readFileSync(path.join(ROOT, 'lib/assistant/agent/index.ts'), 'utf8')
    assert(source.includes('toolData.getStockSummary'), 'stock absent')
    assert(source.includes('toolData.getDeliveryPerformance'), 'livraison absente')
    return 'sections propagated'
  })

  check('A11', 'Chaque point graphique conserve storeId et refuse plusieurs boutiques', () => {
    const source = fs.readFileSync(path.join(ROOT, 'lib/assistant/response.ts'), 'utf8')
    assert(source.includes('storeId: row.storeId'), 'storeId non conservé')
    assert(source.includes('if (stores.size !== 1) return null'), 'multi-boutiques non refusé')
    return 'store identity preserved'
  })

  const failed = results.filter((item) => !item.pass)
  const reportLines = []
  const width = Math.max(...results.map((item) => item.name.length), 40)

  reportLines.push('', '=== Tests synthétiques — assistant analytique (P1-10 → P1-20) ===', '')
  for (const item of results) {
    const status = item.pass ? 'PASS' : 'FAIL'
    reportLines.push(`${status}  ${item.id.padEnd(8)} ${item.name.padEnd(width)}  ${item.detail}`)
  }
  reportLines.push('', `Total : ${results.length - failed.length}/${results.length} PASS`, '')

  const report = reportLines.join('\n')
  console.log(report)

  // Rapport facultatif sur disque (utile en environnement sans TTY).
  const reportPath = process.env.P1_REPORT_PATH
  if (reportPath) {
    fs.writeFileSync(reportPath, report, 'utf8')
  }

  if (failed.length > 0) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error('Erreur fatale des tests synthétiques :', error)
  process.exitCode = 1
})
