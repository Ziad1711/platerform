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
/** Contrôles asynchrones : attendus avant l'impression du rapport. */
const pendingChecks = []
function check(id, name, run) {
  const pass = (detail) => results.push({ id, name, pass: true, detail: detail ?? '' })
  const fail = (error) => results.push({ id, name, pass: false, detail: error instanceof Error ? error.message : String(error) })
  try {
    const value = run()
    if (value && typeof value.then === 'function') {
      pendingChecks.push(value.then(pass).catch(fail))
      return
    }
    pass(value)
  } catch (error) {
    fail(error)
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

check('B03', 'drapeaux : moteur V2 strictement opt-in, repli direct fermé', () => {
  assertEqual(policy.isEngineV2Enabled({}), false, 'moteur V2 fermé sans configuration')
  for (const value of ['true', '1', 'on', 'yes', 'typo', 'ENABLED?', '', 'disabled']) {
    assertEqual(policy.isEngineV2Enabled({ ASSISTANT_ENGINE_V2: value }), false, `valeur « ${value} » refusée`)
  }
  assertEqual(policy.isEngineV2Enabled({ ASSISTANT_ENGINE_V2: 'enabled' }), true, 'activation explicite')
  assertEqual(policy.isEngineV2Enabled({ ASSISTANT_ENGINE_V2: ' ENABLED ' }), true, 'casse et espaces tolérés')
  assertEqual(policy.isHistoryDirectFallbackEnabled({}), false, 'repli direct désactivé par défaut')
  assertEqual(
    policy.isHistoryDirectFallbackEnabled({ ASSISTANT_HISTORY_DIRECT_FALLBACK: 'enabled' }),
    true,
    'activation explicite',
  )
  assertEqual(policy.isNarrativeEnabled({}), true, 'rédaction active (parité de facturation)')
  assertEqual(policy.isNarrativeEnabled({ ASSISTANT_NARRATIVE: 'disabled' }), false, 'rédaction désactivable')
  assertEqual(policy.isDeepeningEnabled({}), true, 'approfondissement actif')
  assertEqual(policy.isDistributedAdmissionEnabled({}), false, 'admission distribuée fermée par défaut')
  assertEqual(
    policy.isDistributedAdmissionEnabled({ ASSISTANT_DISTRIBUTED_ADMISSION: 'true' }),
    false,
    'admission distribuée : seule la valeur enabled ouvre',
  )
  assertEqual(policy.isPlannerLlmEnabled({ ASSISTANT_PLANNER: 'deterministic' }), false, 'plan déterministe')
  assertEqual(policy.isPlannerLlmEnabled({}), true, 'plan LLM dans le moteur V2 (opt-in)')
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

/* -------------------------------------------------------------------------- */
/* 10. Contre-exemples de l'audit NO-GO                                       */
/* -------------------------------------------------------------------------- */

// Planificateur désactivé pour ces contrôles : aucun appel réseau n'est possible.
process.env.ASSISTANT_PLANNER = 'deterministic'

function aliasMetrics(overrides = {}) {
  const contract = loadTs('lib/assistant/analytics-contract.ts')
  const metrics = {}
  for (const [alias, name] of Object.entries(contract.KPI_METRIC_ALIASES)) {
    const unit = alias === 'deliveryRate' ? 'percent' : String(alias).includes('Orders') ? 'count' : 'decimal'
    const base = unit === 'percent'
      ? { value: '75.00', numerator: 75, denominator: 100 }
      : unit === 'count'
        ? { value: '100', count: 100 }
        : { value: '1000.00' }
    metrics[name] = {
      ...base, unit, state: 'complete', definition: '',
      numerator: base.numerator ?? null, denominator: base.denominator ?? null,
      ...(overrides[alias] ?? {}),
    }
  }
  return metrics
}

function engineWindow(window, values = {}) {
  const metrics = aliasMetrics(values)
  const store = {
    storeId: 'store-a', currency: 'MAD', timeZone: 'Africa/Casablanca', access: 'full',
    definitionVersion: 1, revision: '1', lastRebuildAt: null, state: 'complete', days: [],
    metrics,
    coverage: { days_total: 30, days_aggregate: 30, days_direct: 0, days_dirty: 0, days_missing: 0, days_incompatible: 0, days_partial: 0 },
  }
  return {
    windowId: window.id, range: window.range, failure: null, durationMs: 1,
    kpis: {
      contractVersion: 2, state: 'complete', range: window.range, source: 'test',
      generatedAt: null, limits: [], issues: [], stores: [store],
    },
  }
}

let dimensionCalls = 0
let capturedStoreIds = []
cache.set(
  path.resolve(ROOT, 'lib/assistant/engine/executor.ts').replace(/\\/g, '/'),
  {
    readWindows: async ({ windows, storeIds }) => {
      capturedStoreIds = [...storeIds]
      const map = new Map()
      windows.forEach((window, index) => {
        map.set(window.id, engineWindow(window, index === 0 ? {} : { totalOrders: { value: '80', count: 80 } }))
      })
      return map
    },
    readDimension: async ({ dimension, reading }) => {
      dimensionCalls += 1
      return {
        dimension,
        windowId: reading.windowId,
        data: { meta: { state: 'complete' }, rows: [{ city: 'Casablanca', orders: 12, revenue: '1500.00' }] },
        failure: null,
      }
    },
    isDimensionSupported: () => true,
  },
)
cache.set(
  path.resolve(ROOT, 'lib/assistant/providers/index.ts').replace(/\\/g, '/'),
  {
    getAssistantProvider: () => ({
      chat: async () => ({
        text: '{"summary":"Les deux periodes evoluent de facon contrastee."}',
        inputTokens: 12, outputTokens: 6,
        providerName: 'mock', modelName: 'mock', providerCostUsd: 0,
      }),
    }),
  },
)

async function runEngine(message, extra = {}) {
  const engine = loadTs('lib/assistant/agent/engine.ts')
  return engine.runAnalyticEngine({
    supabase: {}, scopeStoreIds: ['store-a'], scopeContext: {}, intent: 'period_comparison',
    range: { start: '2026-09-01', end: '2026-11-01' },
    userMessage: message, conversationHistory: [], providerModel: 'mock', language: 'fr',
    ...extra,
  })
}

check('R01', 'quatre périodes : trois comparaisons réellement publiées', async () => {
  const outcome = await runEngine('Compare septembre et octobre 2026 avec septembre et octobre 2025')
  const tables = outcome.structuredResponse.document.blocks.filter((block) => block.type === 'table')
  assertEqual(tables.length, 3, 'deux comparaisons mensuelles + le bilan combiné')
  const titles = tables.map((block) => block.table.title).join(' | ')
  assert(/septembre 2026/i.test(titles), 'comparaison septembre')
  assert(/octobre 2026/i.test(titles), 'comparaison octobre')
  return titles
})

check('R02', 'deux mois de la même année : vraie comparaison, ordre du texte', () => {
  const built = request.buildAnalysisRequest({
    message: 'Compare septembre 2026 avec octobre 2026',
    intent: 'period_comparison',
    resolvedRange: { from: '2026-09-01', to: '2026-11-01' },
    access: 'full',
    maxPeriods: 6,
  })
  assertEqual(built.plan.pairs.length, 1, 'une comparaison intra-année')
  assertEqual(built.plan.pairs[0].relation, 'previous_period', 'relation dédiée')

  const reversed = request.buildAnalysisRequest({
    message: 'Compare octobre 2025 avec octobre 2026',
    intent: 'period_comparison',
    resolvedRange: { from: '2025-10-01', to: '2026-11-01' },
    access: 'full',
    maxPeriods: 6,
  })
  const pair = reversed.plan.pairs[0]
  const current = reversed.plan.periods.find((period) => period.id === pair.currentId)
  assertEqual(current.year, 2025, 'la période citée en premier reste la période courante')
})

check('R03', 'écart négatif : le signe est conservé', () => {
  const compose = loadTs('lib/assistant/blocks/compose.ts')
  assertEqual(compose.formatDelta('-12', 'decimal', 'MAD'), '−12 MAD', 'baisse en montant')
  assertEqual(compose.formatDelta('12', 'decimal', 'MAD'), '+12 MAD', 'hausse en montant')
  assertEqual(compose.formatDelta('0', 'count', null), '0', 'zéro neutre')
  assertEqual(compose.formatDelta('3.50', 'percent', null), '+3.50 pts', 'taux en points')
  assertEqual(compose.formatDelta(null, 'decimal', 'MAD'), '—', 'valeur absente')
})

check('R04', 'taux multi-boutiques : pondéré par les numérateurs', () => {
  const compose = loadTs('lib/assistant/blocks/compose.ts')
  const stores = [
    { currency: 'MAD', metrics: { deliveryRate: { value: '0.00', unit: 'percent', state: 'complete', numerator: 0, denominator: 10 } } },
    { currency: 'MAD', metrics: { deliveryRate: { value: '90.00', unit: 'percent', state: 'complete', numerator: 90, denominator: 100 } } },
  ]
  const snapshot = compose.readMetricFromReading({ kpis: { stores } }, 'deliveryRate')
  assertEqual(snapshot.value, '81.82', 'recalcul 90 / 110, arrondi commercial')
  assertEqual(snapshot.unit, 'percent', 'unité conservée')
})

check('R05', 'métrique explicitement demandée : la marge reste en tête', () => {
  const built = request.buildAnalysisRequest({
    message: 'Quelle est ma marge ce mois-ci ?',
    intent: 'business_overview',
    resolvedRange: { from: '2026-10-01', to: '2026-11-01' },
    access: 'full',
    maxPeriods: 6,
  })
  assertEqual(built.metrics[0], 'contributionMargin', 'la métrique demandée passe en premier')
  assert(built.requestedMetrics.includes('contributionMargin'), 'demande conservée')
})

check('R06', 'ventilation demandée : réellement rendue, jamais lue pour rien', async () => {
  dimensionCalls = 0
  const outcome = await runEngine('Compare septembre et octobre 2026 avec septembre et octobre 2025 par ville')
  const payload = JSON.stringify(outcome.structuredResponse.document)
  assert(dimensionCalls > 0, 'la dimension a été lue')
  assert(payload.includes('Casablanca'), 'la ventilation apparaît dans la réponse')
  return `${dimensionCalls} lecture(s)`
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

check('R07', 'timeout technique ≠ absence de données', () => {
  const history = loadTs('lib/assistant/engine/history.ts')
  const timeout = history.assessWindow({
    windowId: 'p0', range: { from: '2026-09-01', to: '2026-10-01' }, failure: null, durationMs: 1,
    kpis: { state: 'missing', stores: [], issues: ['KPI_READER_TIMEOUT'], limits: [] },
  })
  assertEqual(timeout.kind, 'source_unavailable', 'timeout reconnu comme panne')
  assertEqual(timeout.comparable, false, 'aucune comparaison sur une panne')

  const noAggregate = history.assessWindow({
    windowId: 'p1', range: { from: '2025-09-01', to: '2025-10-01' }, failure: null, durationMs: 1,
    kpis: { state: 'missing', stores: [], issues: [], limits: [] },
  })
  assertEqual(noAggregate.kind, 'no_coverage', 'absence d’agrégat distincte')
})

check('R08', 'population vide prouvée seulement avec couverture complète', () => {
  const history = loadTs('lib/assistant/engine/history.ts')
  const store = (missingDays) => ({
    storeId: 's', currency: 'MAD', access: 'full', definitionVersion: 1, state: 'partial',
    metrics: { orders: { value: '0', count: 0, unit: 'count', state: 'complete' } },
    days: [],
    coverage: { days_total: 30, days_aggregate: 30 - missingDays, days_direct: 0, days_dirty: 0, days_missing: missingDays, days_incompatible: 0, days_partial: 0 },
  })
  const partial = history.assessWindow({
    windowId: 'p', range: { from: '2026-09-01', to: '2026-10-01' }, failure: null, durationMs: 1,
    kpis: { state: 'partial', stores: [store(5)], issues: [], limits: [] },
  })
  assertEqual(partial.kind, 'coverage_partial', 'couverture partielle non concluante')

  const full = history.assessWindow({
    windowId: 'p', range: { from: '2026-09-01', to: '2026-10-01' }, failure: null, durationMs: 1,
    kpis: { state: 'partial', stores: [store(0)], issues: [], limits: [] },
  })
  assertEqual(full.kind, 'genuinely_empty', 'couverture complète : zéro réel')
})

check('R09', 'cohorte immature : réserve explicite', () => {
  const comparability = loadTs('lib/assistant/semantic/comparability.ts')
  const side = (endsAt) => ({
    metrics: { deliveredOrders: metric(90) }, state: 'complete', days: 30,
    definitionVersion: 1, endsAt,
  })
  const decision = comparability.decideMetricComparability({
    metric: 'deliveredOrders',
    current: side('2026-10-31'),
    baseline: side('2025-10-31'),
    access: 'full',
    today: '2026-10-30',
  })
  assert(decision.reasons.includes('reason.cohort_immature'), 'réserve de maturité')
  assertEqual(decision.decision, 'comparable_with_reserve', 'pas de refus global')
})

check('R10', 'crédits : usage nul ou inconnu jamais facturé', () => {
  const credits = loadTs('lib/assistant/credits.ts')
  assertEqual(credits.computeCreditsUsed(0, 0), 0, 'échec fournisseur : aucun crédit')
  assertEqual(credits.computeCreditsUsed(10, 40), 2, 'usage mesuré facturable')

  const deterministic = credits.resolveUsageBilling({ kind: 'deterministic' })
  assertEqual(deterministic.billable, false, 'réponse déterministe gratuite')
  const unknown = credits.resolveUsageBilling({ kind: 'provider', inputTokens: null, outputTokens: null, usageKnown: false })
  assertEqual(unknown.billable, false, 'usage inconnu non facturé')
  assertEqual(unknown.usageKnown, false, 'usage inconnu ≠ zéro')
  const cancelled = credits.resolveUsageBilling({ kind: 'cancelled', inputTokens: 500, outputTokens: 100 })
  assertEqual(cancelled.creditsConsumed, 0, 'annulation non facturée')
  const measured = credits.resolveUsageBilling({ kind: 'provider', inputTokens: 500, outputTokens: 100, usageKnown: true })
  assertEqual(measured.billable, true, 'usage mesuré facturé')
  assertEqual(measured.creditsConsumed, 24, 'calcul sur tokens réels')
})


check('R11', 'annulation propagée : aucune analyse finalisée', async () => {
  const controller = new AbortController()
  controller.abort()
  let thrown = ''
  try {
    await runEngine('Compare septembre et octobre 2026 avec septembre et octobre 2025', { signal: controller.signal })
  } catch (error) {
    thrown = error instanceof Error ? error.message : String(error)
  }
  assertEqual(thrown, 'ASSISTANT_ABORTED', 'abandon explicite')
})

check('R12', 'anglais et formulations mixtes : dimensions reconnues', () => {
  assertEqual(request.detectDimensions('Show revenue by city and product').join(','), 'city,product', 'anglais')
  assertEqual(request.detectDimensions('CA par ville et statut').join(','), 'city,status', 'français')
  assertEqual(request.detectMetrics('Quel est mon chiffre d’affaires ?')[0], 'revenue', 'métrique française')
  assertEqual(request.detectMetrics('show me the revenue')[0], 'revenue', 'métrique anglaise')
  assertEqual(request.detectDimensions('ch7al men commande f Casablanca').length, 0, 'aucune dimension inventée')
})

check('R13', 'narration : causalité, chiffres et affirmations non prouvées refusés', () => {
  const engine = loadTs('lib/assistant/agent/engine.ts')
  const facts = ['revenue | CA réalisé | septembre 2026=412 | septembre 2025=398 | ecart=14 (up)']
  const directions = { revenue: 'up' }
  assertEqual(engine.isGroundedNarrative('La baisse est causée par vos publicités.', facts), false, 'causalité refusée')
  assertEqual(engine.isGroundedNarrative('Les commandes sont à 412 cette période.', facts), false, 'chiffre refusé')
  assertEqual(
    engine.isGroundedNarrative('Les ventes se sont effondrées.', facts, { claims: [], directions }),
    false,
    'affirmation directionnelle non déclarée refusée',
  )
  assertEqual(
    engine.isGroundedNarrative('Les ventes se sont effondrées.', facts, {
      claims: [{ metric: 'revenue', direction: 'down' }],
      directions,
    }),
    false,
    'direction contraire aux faits refusée',
  )
  assertEqual(
    engine.isGroundedNarrative('Le chiffre d’affaires progresse sur la période comparée.', facts, {
      claims: [{ metric: 'revenue', direction: 'up' }],
      directions,
    }),
    true,
    'affirmation confirmée par les faits acceptée',
  )
  assertEqual(
    engine.isGroundedNarrative('Advertising drove the decline.', facts, {
      claims: [{ metric: 'revenue', direction: 'down' }],
      directions,
    }),
    false,
    'causalité anglaise refusée',
  )
  assertEqual(engine.isGroundedNarrative('Les volumes progressent.', []), false, 'aucun fait = aucune narration')
})

check('R14', 'arrêt vocal sans transcription, envoi explicite', () => {
  const voice = loadTs('lib/assistant/voice-state.ts')
  let state = voice.initialVoiceState()
  state = voice.reduceVoice(state, { type: 'start' })
  state = voice.reduceVoice(state, { type: 'stop' })
  assertEqual(state.phase, 'recorded', 'arrêt = prêt à envoyer')
  assertEqual(voice.canSend(state), true, 'envoi possible')
  assertEqual(voice.isBusy(state), false, 'aucune transcription lancée')
  state = voice.reduceVoice(state, { type: 'send' })
  assertEqual(state.phase, 'transcribing', 'seul l’envoi transcrit')
  const cancelled = voice.reduceVoice(voice.reduceVoice(voice.initialVoiceState(), { type: 'start' }), { type: 'cancel' })
  assertEqual(cancelled.phase, 'idle', 'annulation nettoie la session')
})

check('R15', 'cibles tactiles vocales : 44 px réels', () => {
  const source = fs.readFileSync(path.resolve(ROOT, 'components/assistant/assistant-voice-panel.tsx'), 'utf8')
  const buttons = source.match(/className="[^"]*inline-flex[^"]*rounded-full[^"]*"/g) ?? []
  assertEqual(buttons.length, 3, 'trois boutons dans le panneau')
  for (const button of buttons) {
    assert(/\bh-11\b/.test(button) && /\bw-11\b/.test(button), `cible trop petite : ${button}`)
    assert(!/\bh-9\b/.test(button) && !/\bw-9\b/.test(button), `classe 36 px résiduelle : ${button}`)
  }
})

check('R16', 'périmètre de boutiques : uniquement celui autorisé', async () => {
  capturedStoreIds = []
  await runEngine('Compare septembre et octobre 2026 avec septembre et octobre 2025')
  assertEqual(capturedStoreIds.join(','), 'store-a', 'aucune boutique hors périmètre')
  const source = fs.readFileSync(path.resolve(ROOT, 'lib/assistant/agent/engine.ts'), 'utf8')
  assert(!/\.from\(\s*['"]/.test(source), 'aucune lecture de table directe')
  assert(!/\.rpc\(/.test(source), 'aucun appel RPC direct dans le moteur')
})

check('R17', 'question simple : les KPI sont publiés sans comparaison', async () => {
  const outcome = await runEngine('Quelle est ma marge en septembre 2026 ?')
  const blocks = outcome.structuredResponse.document.blocks
  const kpi = blocks.find((block) => block.type === 'kpi')
  assert(kpi, 'bloc KPI présent')
  assert(kpi.items.some((item) => item.id === 'contributionMargin'), 'marge publiée')
  assert(blocks[0].text !== 'Aucune valeur chiffrée fiable ne peut être publiée pour cette demande.', 'pas de faux vide')
})

check('R18', 'le plan ne peut ni effacer ni déclasser une demande explicite', () => {
  const engine = loadTs('lib/assistant/agent/engine.ts')
  const base = request.buildAnalysisRequest({
    message: 'Mon CA par ville et produit en septembre 2026',
    intent: 'dashboard_summary',
    resolvedRange: { from: '2026-09-01', to: '2026-10-01' },
    access: 'full',
    maxPeriods: 6,
  })
  assertEqual(base.dimensions.join(','), 'city,product', 'dimensions demandées')
  const planned = engine.applyDynamicPlan(base, {
    schema: 1,
    metrics: ['purchaseCost', 'deliveryCost', 'confirmationCost', 'totalOrders', 'adSpend'],
    dimensions: ['agent'],
    needsSeries: false,
    rationale: '',
  })
  assertEqual(planned.dimensions.join(','), 'city,product,agent', 'demandes conservées puis enrichies')

  const margin = request.buildAnalysisRequest({
    message: 'Quelle est ma marge ce mois-ci ?',
    intent: 'business_overview',
    resolvedRange: { from: '2026-10-01', to: '2026-11-01' },
    access: 'full',
    maxPeriods: 6,
  })
  const withPlan = engine.applyDynamicPlan(margin, {
    schema: 1,
    metrics: ['purchaseCost', 'deliveryCost', 'confirmationCost'],
    dimensions: [],
    needsSeries: false,
    rationale: '',
  })
  assertEqual(withPlan.metrics[0], 'contributionMargin', 'métrique demandée toujours en tête')
})

check('R19', 'schéma de plan strict : version et propriétés inconnues refusées', () => {
  const planner = loadTs('lib/assistant/agent/planner.ts')
  const context = { allowedMetrics: ['revenue'], allowedDimensions: ['city'] }
  assertEqual(planner.parseDynamicPlan({ operations: [{ kind: 'metric', metric: 'revenue' }] }, context), null, 'version absente')
  assertEqual(
    planner.parseDynamicPlan({ schema: 1, operations: [{ kind: 'metric', metric: 'revenue', sql: 'x' }] }, context),
    null,
    'propriété inconnue dans une opération',
  )
  assertEqual(
    planner.parseDynamicPlan({ schema: 1, operations: [{ kind: 'metric', metric: 'revenue' }], storeIds: ['x'] }, context),
    null,
    'propriété inconnue au niveau racine',
  )
  assertEqual(
    planner.parseDynamicPlan({ schema: 1, operations: [{ kind: 'sql', query: 'select 1' }] }, context),
    null,
    'opération inconnue',
  )
  const valid = planner.parseDynamicPlan({ schema: 1, operations: [{ kind: 'metric', metric: 'revenue' }] }, context)
  assert(valid && valid.metrics[0] === 'revenue', 'plan valide accepté')
})

check('R20', 'dérivées : aucun écart quand la source n’est pas comparable', () => {
  const compose = loadTs('lib/assistant/blocks/compose.ts')
  const comparability = loadTs('lib/assistant/semantic/comparability.ts')
  const dict = i18n.resolveDictionary('fr', 'latin')
  const metricOf = (value, unit = 'decimal') => ({
    value: String(value), count: unit === 'count' ? Number(value) : null, unit,
    state: 'complete', definition: '', numerator: null, denominator: null,
  })
  const store = (revenue) => ({
    storeId: 's', currency: 'MAD', access: 'full', definitionVersion: 1, state: 'complete', days: [],
    metrics: { orders: metricOf('100', 'count'), revenue: metricOf(revenue) },
    coverage: { days_total: 30, days_aggregate: 30, days_direct: 0, days_dirty: 0, days_missing: 0, days_incompatible: 0, days_partial: 0 },
  })
  const reading = (windowId, revenue) => ({
    windowId, range: { from: '2026-09-01', to: '2026-10-01' }, failure: null,
    kpis: { state: 'complete', stores: [store(revenue)], issues: [], limits: [] },
  })
  const source = (metrics, version, days = 30) => ({ metrics, definitionVersion: version, days, state: 'complete' })
  const deltas = [
    comparability.computeMetricDelta({
      metric: 'revenue',
      current: source({ revenue: metricOf('100') }, 2),
      baseline: source({ revenue: metricOf('80') }, 1, 31),
      access: 'full',
    }),
    comparability.computeMetricDelta({
      metric: 'totalOrders',
      current: source({ totalOrders: metricOf('100', 'count') }, 1),
      baseline: source({ totalOrders: metricOf('90', 'count') }, 1, 31),
      access: 'full',
    }),
  ]
  const table = compose.buildComparisonTable({
    dict, script: 'latin', currentLabel: 'septembre 2026', baselineLabel: 'septembre 2025',
    currentDays: 30, baselineDays: 31, currency: 'MAD',
    currentReading: reading('p0', '100'), baselineReading: reading('p1', '80'), deltas,
  })
  const revenueRow = table.rows.find((row) => row.key === 'revenue')
  const revenuePerDay = table.rows.find((row) => row.key === 'revenuePerDay')
  assertEqual(revenueRow.cells[3].value, '—', 'total non comparable : pas d’écart')
  assertEqual(revenuePerDay, undefined, 'dérivée non comparable absente')
  assert(table.rows.find((row) => row.key === 'ordersPerDay'), 'dérivée comparable conservée')
})

check('R21', 'aucune population vide prouvée sans boutique lue', () => {
  const history = loadTs('lib/assistant/engine/history.ts')
  const assessment = history.assessWindow({
    windowId: 'p0', range: { from: '2026-09-01', to: '2026-10-01' }, failure: null,
    kpis: { state: 'empty', stores: [], issues: [], limits: [] },
  })
  assert(assessment.kind !== 'genuinely_empty', 'absence non prouvée sans boutique')
})

check('R22', 'usage fournisseur inconnu : non facturé et marqué inconnu', () => {
  const credits = loadTs('lib/assistant/credits.ts')
  const billing = credits.resolveUsageBilling({ kind: 'provider', inputTokens: 0, outputTokens: 0, usageKnown: false })
  assertEqual(billing.billable, false, 'aucun débit sur usage inconnu')
  assertEqual(billing.usageKnown, false, 'usage inconnu conservé')
})

check('R24', 'pourcentage : arrondi commercial, pas troncature', () => {
  const decimal = loadTs('lib/assistant/analytics-decimal.ts')
  assertEqual(decimal.percentOfCounts(90, 110), '81.82', '90 / 110 arrondi')
  assertEqual(decimal.percentOfCounts(1, 3), '33.33', '1 / 3 arrondi')
  assertEqual(decimal.percentOfCounts(0, 10), '0', 'zéro réel affiché sans décimale inutile')
  assertEqual(decimal.percentOfCounts(1, 0), null, 'dénominateur nul refusé')
})

const passed = results.filter((result) => result.pass).length
const failedCount = results.length - passed

Promise.all(pendingChecks).then(() => {
  const finalPassed = results.filter((result) => result.pass).length
  const finalFailed = results.length - finalPassed
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.id} ${result.name}${result.detail ? ` — ${result.detail}` : ''}`)
  }
  console.log(`\n${finalPassed}/${results.length} PASS — ${finalFailed} FAIL`)
  process.exitCode = finalFailed === 0 ? 0 : 1
})
