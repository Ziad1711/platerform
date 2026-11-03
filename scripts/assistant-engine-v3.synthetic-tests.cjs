#!/usr/bin/env node
/**
 * Tests du moteur analytique V3 (périodes multiples, comparabilité, blocs,
 * localisation, budgets, états vocaux).
 *
 * Exécution : `node scripts/assistant-engine-v3.synthetic-tests.cjs`
 *
 * Aucune base, aucun réseau, aucun fournisseur : uniquement des modules purs.
 */
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const vm = require('node:vm')

const ROOT = process.cwd()
const cache = new Map()

function loadFile(absolutePath) {
  const key = absolutePath.replace(/\\/g, '/')
  if (cache.has(key)) return cache.get(key)

  const module = { exports: {} }
  const js = ts.transpileModule(fs.readFileSync(absolutePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: absolutePath,
  }).outputText

  const resolveCandidate = (base) => {
    for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
    }
    return null
  }

  const requireShim = (id) => {
    if (id.startsWith('@/')) {
      const resolved = resolveCandidate(path.resolve(ROOT, id.slice(2)))
      if (resolved) return loadFile(resolved)
    }
    if (id.startsWith('./') || id.startsWith('../')) {
      const resolved = resolveCandidate(path.resolve(path.dirname(absolutePath), id))
      if (resolved) return loadFile(resolved)
    }
    return require(id)
  }

  vm.runInThisContext(`(function(require, module, exports){${js}\n})`, { filename: absolutePath })(
    requireShim,
    module,
    module.exports,
  )
  cache.set(key, module.exports)
  return module.exports
}

function loadTs(relativePath) {
  return loadFile(path.resolve(ROOT, relativePath))
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

const periods = loadTs('lib/assistant/semantic/periods.ts')
const decimal = loadTs('lib/assistant/semantic/decimal.ts')
const comparability = loadTs('lib/assistant/semantic/comparability.ts')
const locale = loadTs('lib/assistant/semantic/locale.ts')
const request = loadTs('lib/assistant/semantic/request.ts')
const i18n = loadTs('lib/assistant/blocks/i18n.ts')
const sanitize = loadTs('lib/assistant/blocks/sanitize.ts')
const voice = loadTs('lib/assistant/voice-state.ts')
const policy = loadTs('lib/assistant/engine/policy.ts')
const history = loadTs('lib/assistant/engine/history.ts')

/* -------------------------------------------------------------------------- */
/* 1. Périodes multiples                                                      */
/* -------------------------------------------------------------------------- */

check('P01', 'quatre fenêtres conservées (sept/oct 2026 vs 2025)', () => {
  const message = 'Compare septembre et octobre 2026 avec septembre et octobre 2025'
  const months = periods.monthMentions(message)
  assertEqual(months.length, 4, 'quatre mois cités')
  const years = periods.yearMentions(message)
  const assigned = periods.assignYears(months, years, 2026)
  assertEqual(assigned.map((m) => `${m.year}-${m.month}`).join(','), '2026-9,2026-10,2025-9,2025-10', 'années attribuées')
  const plan = periods.buildPeriodPlan({ months: assigned })
  assertEqual(plan.periods.length, 4, 'quatre fenêtres')
  assertEqual(plan.kind, 'matrix', 'plan matriciel')
  assertEqual(plan.pairs.length, 3, 'trois correspondances (2 mois + 1 agrégat)')
})

check('P02', 'agrégat combiné par année uniquement si les mois sont contigus', () => {
  const contiguous = periods.buildPeriodPlan({
    months: [
      { year: 2026, month: 9 }, { year: 2026, month: 10 },
      { year: 2025, month: 9 }, { year: 2025, month: 10 },
    ],
  })
  assertEqual(contiguous.groups.length, 2, 'deux agrégats')
  assertEqual(contiguous.groups[0].range.from, '2026-09-01', 'début agrégat 2026')
  assertEqual(contiguous.groups[0].range.to, '2026-11-01', 'fin agrégat 2026')

  const sparse = periods.buildPeriodPlan({
    months: [
      { year: 2026, month: 1 }, { year: 2026, month: 10 },
      { year: 2025, month: 1 }, { year: 2025, month: 10 },
    ],
  })
  assertEqual(sparse.groups.length, 0, 'aucun agrégat si les mois ne sont pas contigus')
})

check('P03', 'mois arabes reconnus (شتنبر / أكتوبر)', () => {
  const months = periods.monthMentions('قارن شتنبر وأكتوبر 2026 مع شتنبر وأكتوبر 2025')
  assertEqual(months.length, 4, 'quatre mois arabes')
  const plan = periods.buildPeriodPlan({
    months: periods.assignYears(months, periods.yearMentions('قارن شتنبر وأكتوبر 2026 مع شتنبر وأكتوبر 2025'), 2026),
  })
  assertEqual(plan.periods[0].range.from, '2026-09-01', 'septembre 2026')
  assertEqual(plan.periods[2].range.from, '2025-09-01', 'septembre 2025')
})

check('P04', 'durée correcte des fenêtres 30 et 31 jours', () => {
  assertEqual(periods.periodDays({ id: 'a', months: [], range: { from: '2026-09-01', to: '2026-10-01' }, granularity: 'month', year: 2026, aggregated: false }), 30, 'septembre')
  assertEqual(periods.periodDays({ id: 'b', months: [], range: { from: '2026-10-01', to: '2026-11-01' }, granularity: 'month', year: 2026, aggregated: false }), 31, 'octobre')
})

check('P05', 'plan mono-période sans comparaison implicite', () => {
  const plan = periods.singlePeriodPlan({ from: '2026-10-01', to: '2026-11-01' })
  assertEqual(plan.kind, 'single', 'type')
  assertEqual(plan.pairs.length, 0, 'aucune paire inventée')
})

/* -------------------------------------------------------------------------- */
/* 2. Arithmétique décimale                                                   */
/* -------------------------------------------------------------------------- */

check('D01', 'division exacte sans flottant', () => {
  assertEqual(decimal.divideDecimal('24107.00', 30, 2), '803.57', 'CA / jour')
  assertEqual(decimal.divideDecimal('100', 3, 4), '33.3333', 'arrondi')
  assertEqual(decimal.divideDecimal('10', 0, 2), null, 'division par zéro refusée')
  assertEqual(decimal.divideDecimal('abc', 2, 2), null, 'entrée invalide refusée')
})

check('D02', 'somme et différence exactes', () => {
  assertEqual(decimal.sumDecimalText(['24107.00', '1500.50']), '25607.50', 'somme')
  assertEqual(decimal.sumDecimalText([]), null, 'somme vide refusée')
  assertEqual(decimal.subtractDecimalText('24107.00', '18000.00'), '6107.00', 'différence')
  assertEqual(decimal.compareDecimalText('24107.00', '18000.00'), 1, 'comparaison')
  assertEqual(decimal.compareDecimalText('0', '0.000'), 0, 'égalité')
})

/* -------------------------------------------------------------------------- */
/* 3. Comparabilité par métrique                                              */
/* -------------------------------------------------------------------------- */

function metric(value, state = 'complete', unit = 'count') {
  return {
    value: String(value),
    count: unit === 'count' ? Number(value) : null,
    unit,
    state,
    definition: '',
    numerator: null,
    denominator: null,
  }
}

function side(metrics, days, version = 1, state = 'complete') {
  return { metrics, state, days, definitionVersion: version }
}

check('C01', '30 vs 31 jours : comparable avec réserve, jamais un refus', () => {
  const result = comparability.computeMetricDelta({
    metric: 'totalOrders',
    current: side({ totalOrders: metric(412) }, 31),
    baseline: side({ totalOrders: metric(398) }, 30),
    access: 'full',
  })
  assertEqual(result.comparability.decision, 'comparable_with_reserve', 'décision')
  assert(result.comparability.reasons.includes('reason.duration_differs'), 'réserve de durée')
  assertEqual(result.comparability.needsDurationNormalization, true, 'normalisation demandée')
  assertEqual(result.delta, '14', 'écart calculé')
  assertEqual(result.direction, 'up', 'direction')
})

check('C02', 'mêmes durées et couverture complète : comparable', () => {
  const result = comparability.computeMetricDelta({
    metric: 'revenue',
    current: side({ revenue: metric('24107.00', 'complete', 'decimal') }, 30),
    baseline: side({ revenue: metric('20000.00', 'complete', 'decimal') }, 30),
    access: 'full',
  })
  assertEqual(result.comparability.decision, 'comparable', 'décision')
  assertEqual(result.delta, '4107.00', 'écart exact')
})

check('C03', 'métrique absente d’un côté : côte à côte sans écart', () => {
  const result = comparability.computeMetricDelta({
    metric: 'adSpend',
    current: side({ adSpend: metric('1200.00', 'complete', 'decimal') }, 30),
    baseline: side({}, 30),
    access: 'full',
  })
  assertEqual(result.comparability.decision, 'side_by_side_only', 'décision')
  assertEqual(result.delta, null, 'aucun écart inventé')
  assertEqual(result.current, '1200.00', 'valeur publiée conservée')
})

check('C04', 'métrique financière interdite en accès commercial', () => {
  const result = comparability.computeMetricDelta({
    metric: 'contributionMargin',
    current: side({ contributionMargin: metric('5000.00', 'complete', 'decimal') }, 30),
    baseline: side({ contributionMargin: metric('4000.00', 'complete', 'decimal') }, 30),
    access: 'commercial',
  })
  assertEqual(result.comparability.decision, 'forbidden', 'décision')
  assertEqual(result.delta, null, 'aucun écart')
})

check('C05', 'définitions différentes : côte à côte', () => {
  const result = comparability.computeMetricDelta({
    metric: 'deliveredOrders',
    current: side({ deliveredOrders: metric(200) }, 30, 2),
    baseline: side({ deliveredOrders: metric(190) }, 30, 1),
    access: 'full',
  })
  assertEqual(result.comparability.decision, 'side_by_side_only', 'décision')
  assert(result.comparability.reasons.includes('reason.definition_differs'), 'raison définitions')
})

check('C06', 'couverture partielle : réserve explicite', () => {
  const result = comparability.computeMetricDelta({
    metric: 'totalOrders',
    current: side({ totalOrders: metric(100, 'partial') }, 30, 1, 'partial'),
    baseline: side({ totalOrders: metric(90) }, 30),
    access: 'full',
  })
  assertEqual(result.comparability.decision, 'comparable_with_reserve', 'décision')
  assert(result.comparability.reasons.includes('reason.coverage_partial'), 'raison couverture')
})

/* -------------------------------------------------------------------------- */
/* 4. Localisation                                                            */
/* -------------------------------------------------------------------------- */

check('L01', 'détection darija arabe et latine', () => {
  assertEqual(locale.detectCommunicationProfile('واش القايدة مزيانة هاد الشهر').locale, 'darija', 'darija arabe')
  assertEqual(locale.detectCommunicationProfile('wach l-bi3 mzyan had chhar').locale, 'darija', 'darija latine')
  assertEqual(locale.detectCommunicationProfile('wach l-bi3 mzyan had chhar').direction, 'ltr', 'direction latine')
  assertEqual(locale.detectCommunicationProfile('واش القايدة مزيانة').direction, 'rtl', 'direction arabe')
})

check('L02', 'anglais détecté, français par défaut', () => {
  assertEqual(locale.detectCommunicationProfile('compare the revenue between september and october').locale, 'en', 'anglais')
  assertEqual(locale.detectCommunicationProfile('analyse mes ventes de septembre').locale, 'fr', 'français')
})

check('L03', 'titres localisés : aucun français résiduel en arabe', () => {
  const dict = i18n.resolveDictionary('ar', 'arabic')
  const french = i18n.resolveDictionary('fr', 'latin')
  const title = i18n.translate(dict, 'title.verdict')
  assert(title !== i18n.translate(french, 'title.verdict'), 'titre traduit')
  assert(!/[A-Za-z]/.test(title), `aucun latin dans le titre (${title})`)
  for (const key of ['title.figures', 'title.strengths', 'title.weaknesses', 'title.recommendations', 'notice.limits']) {
    const value = i18n.translate(dict, key)
    assert(!/[A-Za-z]{3,}/.test(value), `clé ${key} non localisée : ${value}`)
  }
})

check('L04', 'darija latine reste entièrement latine', () => {
  const dict = i18n.resolveDictionary('darija', 'latin')
  for (const key of ['title.verdict', 'voice.ready', 'absence.empty']) {
    const text = i18n.translate(dict, key)
    assert(!/[\u0600-\u06FF]/.test(text), `écriture arabe dans une réponse latine : ${text}`)
  }
})

check('L05', 'clé inconnue : chaîne vide, jamais un identifiant technique', () => {
  assertEqual(i18n.translate(i18n.resolveDictionary('fr', 'latin'), 'metric.inexistant'), '', 'clé inconnue')
})

check('L06', 'interpolation des paramètres', () => {
  const text = i18n.translate(i18n.resolveDictionary('fr', 'latin'), 'reason.duration_differs', {
    currentDays: 31,
    baselineDays: 30,
  })
  assert(text.includes('31') && text.includes('30'), `paramètres non interpolés : ${text}`)
})

/* -------------------------------------------------------------------------- */
/* 5. Nettoyage des textes publics                                            */
/* -------------------------------------------------------------------------- */

check('S01', 'codes internes retirés, chiffres conservés', () => {
  const cleaned = sanitize.sanitizePublicText('COMPARISON_NOT_FULLY_COMPUTABLE — 31 jours contre 30 jours')
  assert(!cleaned.text.includes('COMPARISON'), 'code retiré')
  assert(cleaned.text.includes('31') && cleaned.text.includes('30'), 'nombres conservés')
  assert(cleaned.removedCode, 'retrait signalé')
})

check('S02', 'références rpc_ jamais publiées', () => {
  const cleaned = sanitize.sanitizePublicText('Lecture rpc_dashboard_kpi_reader_v2 terminée')
  assert(!/rpc_/i.test(cleaned.text), `référence interne restante : ${cleaned.text}`)
})

check('S03', 'avertissements dédupliqués et nettoyés', () => {
  const list = sanitize.sanitizeWarnings([
    'KPI_READER_TIMEOUT',
    'kpi_reader_timeout',
    '  ',
    'Couverture partielle',
    'Couverture partielle',
  ])
  assertEqual(list.length, 1, 'une seule entrée utile')
  assertEqual(list[0], 'Couverture partielle', 'entrée conservée')
})

/* -------------------------------------------------------------------------- */
/* 6. États vocaux                                                            */
/* -------------------------------------------------------------------------- */

check('V01', 'arrêter ne déclenche jamais l’envoi', () => {
  let state = voice.initialVoiceState(1)
  state = voice.reduceVoice(state, { type: 'start' })
  assertEqual(state.phase, 'recording', 'enregistrement')
  state = voice.reduceVoice(state, { type: 'stop' })
  assertEqual(state.phase, 'recorded', 'arrêt = prêt à envoyer, pas envoi')
  assertEqual(voice.canSend(state), true, 'envoi possible après arrêt')
})

check('V02', 'envoi impossible pendant l’enregistrement', () => {
  const state = voice.reduceVoice(voice.initialVoiceState(1), { type: 'start' })
  assertEqual(voice.canSend(state), false, 'envoi refusé pendant l’enregistrement')
  assertEqual(voice.reduceVoice(state, { type: 'send' }).phase, 'recording', 'aucun changement')
})

check('V03', 'annulation invalide la session (callbacks tardifs ignorés)', () => {
  let state = voice.reduceVoice(voice.initialVoiceState(1), { type: 'start' })
  const previous = state.sessionId
  state = voice.reduceVoice(state, { type: 'cancel' })
  assertEqual(state.phase, 'idle', 'retour au repos')
  assert(state.sessionId > previous, 'session invalidée')
})

check('V04', 'transcription puis retour au repos', () => {
  let state = voice.reduceVoice(voice.initialVoiceState(0), { type: 'start' })
  state = voice.reduceVoice(state, { type: 'stop' })
  state = voice.reduceVoice(state, { type: 'send' })
  assertEqual(state.phase, 'transcribing', 'transcription')
  state = voice.reduceVoice(state, { type: 'transcribed' })
  assertEqual(state.phase, 'idle', 'repos')
})

/* -------------------------------------------------------------------------- */
/* 7. Budgets                                                                 */
/* -------------------------------------------------------------------------- */

check('B01', 'plafond de lectures appliqué', () => {
  const tracker = policy.createBudgetTracker({ ...policy.DEFAULT_BUDGETS, maxWindowReads: 2 }, () => 0)
  tracker.consumeRead()
  tracker.consumeRead()
  let failed = false
  try {
    tracker.consumeRead()
  } catch (error) {
    failed = error instanceof policy.EngineBudgetError && error.code === 'BUDGET_READS'
  }
  assert(failed, 'dépassement refusé')
})

check('B02', 'plafond de temps appliqué', () => {
  let now = 0
  const tracker = policy.createBudgetTracker({ ...policy.DEFAULT_BUDGETS, maxWallClockMs: 100 }, () => now)
  tracker.assertTime()
  now = 250
  let failed = false
  try {
    tracker.assertTime()
  } catch (error) {
    failed = error instanceof policy.EngineBudgetError && error.code === 'BUDGET_TIME'
  }
  assert(failed, 'durée dépassée refusée')
  assertEqual(tracker.canContinue(), false, 'poursuite impossible')
})

check('B03', 'drapeaux : moteur actif, repli direct inactif par défaut', () => {
  assertEqual(policy.isEngineV2Enabled({}), true, 'moteur V2 actif par défaut')
  assertEqual(policy.isEngineV2Enabled({ ASSISTANT_ENGINE_V2: 'disabled' }), false, 'désactivation possible')
  assertEqual(policy.isHistoryDirectFallbackEnabled({}), false, 'repli direct désactivé par défaut')
  assertEqual(
    policy.isHistoryDirectFallbackEnabled({ ASSISTANT_HISTORY_DIRECT_FALLBACK: 'enabled' }),
    true,
    'activation explicite',
  )
  assertEqual(policy.isNarrativeEnabled({}), true, 'rédaction active (parité de facturation)')
  assertEqual(policy.isNarrativeEnabled({ ASSISTANT_NARRATIVE: 'disabled' }), false, 'rédaction désactivable')
  assertEqual(policy.isDeepeningEnabled({}), true, 'approfondissement actif')
})

/* -------------------------------------------------------------------------- */
/* 8. Qualification de l'absence                                              */
/* -------------------------------------------------------------------------- */

function reading(kpisState, failure) {
  return { windowId: 'p0', range: { from: '2026-10-01', to: '2026-11-01' }, failure: failure ?? null, durationMs: 1, kpis: kpisState === null ? null : { contractVersion: 2, state: kpisState, range: {}, source: 'x', generatedAt: null, limits: [], issues: [], stores: [] } }
}

check('H01', 'échec technique ≠ absence de donnée', () => {
  assertEqual(history.assessWindow(reading(null, 'gateway_unavailable')).kind, 'source_unavailable', 'technique')
  assertEqual(history.assessWindow(reading(null, 'isolation_failure')).kind, 'access_denied', 'accès')
  assertEqual(history.assessWindow(reading('missing')).kind, 'no_coverage', 'couverture absente')
})

check('H02', 'population vide distinguée de l’absence de couverture', () => {
  const emptyStore = {
    storeId: 's1', currency: 'MAD', timeZone: 'Africa/Casablanca', access: 'full',
    definitionVersion: 1, revision: '1', lastRebuildAt: null, state: 'empty', days: [],
    metrics: { orders: { value: '0', count: 0, unit: 'count', state: 'empty', definition: '', numerator: null, denominator: null } },
    coverage: { days_total: 30, days_aggregate: 30, days_direct: 0, days_dirty: 0, days_missing: 0, days_incompatible: 0, days_partial: 0 },
  }
  const withStore = reading('empty')
  withStore.kpis.stores = [emptyStore]
  assertEqual(history.assessWindow(withStore).kind, 'genuinely_empty', 'vide réel')
})

check('H03', 'repli direct refusé par défaut, borné si activé', () => {
  const assessment = { windowId: 'p0', kind: 'no_coverage', hasValues: false, publishedMetrics: [], coverage: null, comparable: false }
  const range = { from: '2026-10-01', to: '2026-11-01' }
  assertEqual(history.decideHistoryStrategy({ assessment, range, env: {} }).reason, 'flag_disabled', 'drapeau fermé')
  assertEqual(
    history.decideHistoryStrategy({ assessment, range, env: { ASSISTANT_HISTORY_DIRECT_FALLBACK: 'enabled' } }).attemptDirect,
    true,
    'tentative bornée',
  )
  assertEqual(
    history.decideHistoryStrategy({ assessment, range: { from: '2025-01-01', to: '2026-12-01' }, env: { ASSISTANT_HISTORY_DIRECT_FALLBACK: 'enabled' } }).reason,
    'window_too_large',
    'fenêtre trop large refusée',
  )
})

/* -------------------------------------------------------------------------- */
/* 9. Garde-fous statiques                                                     */
/* -------------------------------------------------------------------------- */

check('G01', 'aucun SQL arbitraire produit par le moteur', () => {
  const files = ['lib/assistant/agent/engine.ts', 'lib/assistant/engine/executor.ts']
  for (const file of files) {
    const source = fs.readFileSync(path.resolve(ROOT, file), 'utf8')
    assert(!/\b(select|insert|update|delete)\s+\w+\s+from\b/i.test(source), `requête SQL détectée dans ${file}`)
    assert(!/\.rpc\(/.test(source), `appel RPC direct dans ${file}`)
  }
})

check('G02', 'aucun outil d’accès aux données exposé au modèle', () => {
  const source = fs.readFileSync(path.resolve(ROOT, 'lib/assistant/agent/engine.ts'), 'utf8')
  assert(!/tools\s*:/.test(source), 'aucune déclaration d’outil transmise au fournisseur')
  assert(!/tool_choice|function_call/.test(source), 'aucun appel d’outil')
})

check('G03', 'périodes multiples conservées dans la requête structurée', () => {
  const built = request.buildAnalysisRequest({
    message: 'Compare septembre et octobre 2026 avec septembre et octobre 2025',
    intent: 'period_comparison',
    resolvedRange: { from: '2026-09-01', to: '2026-11-01' },
    access: 'full',
    maxPeriods: 6,
  })
  assertEqual(built.plan.periods.length, 4, 'quatre fenêtres')
  assertEqual(built.plan.kind, 'matrix', 'plan matriciel')
  assertEqual(built.profile.locale, 'fr', 'langue')
})

check('G04', 'le tableau porte les valeurs, sans doublon KPI', () => {
  const compose = loadTs('lib/assistant/blocks/compose.ts')
  const dict = i18n.resolveDictionary('fr', 'latin')
  const table = compose.buildComparisonTable({
    dict,
    script: 'latin',
    currentLabel: 'octobre 2026',
    baselineLabel: 'octobre 2025',
    currentDays: 31,
    baselineDays: 31,
    currency: 'MAD',
    deltas: [{
      metric: 'totalOrders',
      current: '412',
      baseline: '398',
      delta: '14',
      direction: 'up',
      comparability: {
        metric: 'totalOrders',
        decision: 'comparable',
        reasons: [],
        daysCurrent: 31,
        daysBaseline: 31,
        durationDiffers: false,
        needsDurationNormalization: false,
      },
    }],
  })
  assert(table && table.rows.length === 1, 'une ligne de tableau')
  assertEqual(table.rows[0].cells[1].value, '412', 'valeur courante')
  assertEqual(table.rows[0].cells[3].value, '+14', 'écart signé')
})

check('G05', 'durées différentes : lignes normalisées ajoutées au tableau', () => {
  const compose = loadTs('lib/assistant/blocks/compose.ts')
  const dict = i18n.resolveDictionary('fr', 'latin')
  const store = {
    storeId: 's1', currency: 'MAD', timeZone: 'Africa/Casablanca', access: 'full',
    definitionVersion: 1, revision: '1', lastRebuildAt: null, state: 'complete', days: [],
    metrics: {
      orders: { value: '412', count: 412, unit: 'count', state: 'complete', definition: '', numerator: null, denominator: null },
    },
    coverage: { days_total: 31, days_aggregate: 31, days_direct: 0, days_dirty: 0, days_missing: 0, days_incompatible: 0, days_partial: 0 },
  }
  const build = (days) => ({
    windowId: 'p0',
    range: { from: '2026-10-01', to: '2026-11-01' },
    failure: null,
    durationMs: 1,
    kpis: { contractVersion: 2, state: 'complete', range: {}, source: 'x', generatedAt: null, limits: [], issues: [], stores: [store] },
  })
  const table = compose.buildComparisonTable({
    dict,
    script: 'latin',
    currentLabel: 'octobre 2026',
    baselineLabel: 'septembre 2026',
    currentDays: 31,
    baselineDays: 30,
    currency: 'MAD',
    currentReading: build(31),
    baselineReading: build(30),
    deltas: [{
      metric: 'totalOrders',
      current: '412',
      baseline: '398',
      delta: '14',
      direction: 'up',
      comparability: {
        metric: 'totalOrders',
        decision: 'comparable_with_reserve',
        reasons: ['reason.duration_differs'],
        daysCurrent: 31,
        daysBaseline: 30,
        durationDiffers: true,
        needsDurationNormalization: true,
      },
    }],
  })
  assert(table, 'tableau produit')
  const keys = table.rows.map((row) => row.key)
  assert(keys.includes('ordersPerDay'), `ligne normalisée manquante (${keys.join(',')})`)
  assert(table.caption && table.caption.length > 0, 'réserve rappelée en légende')
})

check('N01', 'narration sûre : aucun chiffre, aucun code', () => {
  const engine = loadTs('lib/assistant/agent/engine.ts')
  assertEqual(engine.isSafeNarrative('Les commandes progressent sur la periode comparee.'), true, 'texte sûr')
  assertEqual(engine.isSafeNarrative('Les commandes sont a 412 cette periode.'), false, 'chiffre refusé')
  assertEqual(engine.isSafeNarrative('KPI_READER_TIMEOUT sur la lecture.'), false, 'code refusé')
})

check('N02', 'narration appliquée au résumé seul', () => {
  const engine = loadTs('lib/assistant/agent/engine.ts')
  const response = {
    message_text: 'ancien resume',
    document: {
      version: 1, locale: 'fr', script: 'latin', direction: 'ltr', presentation: 'table',
      blocks: [
        { type: 'summary', text: 'ancien resume' },
        { type: 'table', table: { columns: [], rows: [] } },
      ],
    },
  }
  const next = engine.applyNarrative(response, 'nouveau resume qualitatif')
  assertEqual(next.document.blocks[0].text, 'nouveau resume qualitatif', 'résumé remplacé')
  assertEqual(next.document.blocks[1].type, 'table', 'bloc chiffré intact')
  assertEqual(next.message_text, 'nouveau resume qualitatif', 'texte aligné')
})

/* -------------------------------------------------------------------------- */
/* Rapport                                                                    */
/* -------------------------------------------------------------------------- */

const passed = results.filter((result) => result.pass).length
const failedCount = results.length - passed

for (const result of results) {
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.id} ${result.name}${result.detail ? ` — ${result.detail}` : ''}`)
}
console.log(`\n${passed}/${results.length} PASS — ${failedCount} FAIL`)
process.exit(failedCount === 0 ? 0 : 1)
