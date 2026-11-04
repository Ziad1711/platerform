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

check('C06', 'couverture partielle : valeurs conservées sans faux écart', () => {
  const result = comparability.computeMetricDelta({
    metric: 'totalOrders',
    current: side({ totalOrders: metric(100, 'partial') }, 30, 1, 'partial'),
    baseline: side({ totalOrders: metric(90) }, 30),
    access: 'full',
  })
  assertEqual(result.comparability.decision, 'side_by_side_only', 'populations non alignées')
  assertEqual(result.delta, null, 'aucune variation interprétable')
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
  assertEqual(state.phase, 'encoding', 'conversion locale avant disponibilité')
  state = voice.reduceVoice(state, { type: 'encoded' })
  assertEqual(state.phase, 'recorded', 'arrêt = prêt à envoyer, pas envoi')
  assertEqual(voice.canSend(state), true, 'envoi possible après arrêt')
})

check('V02', 'envoyer pendant la capture attend la conversion puis transcrit', () => {
  const state = voice.reduceVoice(voice.initialVoiceState(1), { type: 'start' })
  assertEqual(voice.canSend(state), true, 'envoi accessible pendant la capture')
  const stopping = voice.reduceVoice(state, { type: 'send' })
  assertEqual(stopping.phase, 'encoding', 'aucun appel avant conversion')
  assertEqual(voice.reduceVoice(stopping, { type: 'encoded' }).phase, 'transcribing', 'transcription après conversion')
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
  state = voice.reduceVoice(state, { type: 'encoded' })
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

/* -------------------------------------------------------------------------- */
/* 12. Agent : interprétation fusionnée, validation stricte, budgets          */
/* -------------------------------------------------------------------------- */

const interpretation = loadTs('lib/assistant/agent/interpretation.ts')
const answerModule = loadTs('lib/assistant/agent/answer.ts')

const AGENT_PAYLOAD = {
  schema: 1,
  locale: 'darija',
  intent: 'analysis',
  periods: [
    { kind: 'month', year: 2026, month: 9 },
    { kind: 'month', year: 2026, month: 10 },
    { kind: 'month', year: 2025, month: 9 },
    { kind: 'month', year: 2025, month: 10 },
  ],
  comparisons: [{ current: 0, baseline: 2 }, { current: 1, baseline: 3 }],
  metrics: ['revenue', 'totalOrders'],
  dimensions: ['city'],
  wantsSeries: false,
  tools: [{ tool: 'read_kpis' }, { tool: 'read_dimension', dimension: 'city' }],
  clarify: null,
}

const DARIJA_MESSAGE = 'قارن ليا شتنبر وأكتوبر ديال هاد العام مع نفس الشهور ديال العام اللي فات'

check('AG01', 'interprétation validée : quatre fenêtres et trois correspondances', () => {
  const parsed = interpretation.parseInterpretation(JSON.stringify(AGENT_PAYLOAD), 'full', DARIJA_MESSAGE)
  assert(parsed !== null, 'interprétation acceptée')
  assertEqual(parsed.plan.periods.length, 4, 'quatre fenêtres')
  assertEqual(parsed.plan.pairs.length, 3, 'trois correspondances')
  assertEqual(parsed.metrics.join(','), 'revenue,totalOrders', 'métriques du modèle')
  assertEqual(parsed.dimensions.join(','), 'city', 'dimension validée')
})

check('AG02', 'texte libre ou JSON invalide : aucune interprétation inventée', () => {
  assertEqual(interpretation.parseInterpretation('je pense que septembre est meilleur', 'full', DARIJA_MESSAGE), null, 'texte refusé')
  assertEqual(interpretation.parseInterpretation('{"schema":1}', 'full', DARIJA_MESSAGE), null, 'schéma incomplet refusé')
})

check('AG03', 'périodes incohérentes : clarification, jamais exécution partielle', () => {
  const mixed = { ...AGENT_PAYLOAD, periods: [{ kind: 'month', year: 2026, month: 9 }, { kind: 'range', from: '2026-10-01', to: '2026-11-01' }] }
  assertEqual(interpretation.parseInterpretation(JSON.stringify(mixed), 'full', DARIJA_MESSAGE), null, 'conventions mélangées')
  const inverted = { ...AGENT_PAYLOAD, periods: [{ kind: 'range', from: '2026-11-01', to: '2026-10-01' }], comparisons: [] }
  assertEqual(interpretation.parseInterpretation(JSON.stringify(inverted), 'full', DARIJA_MESSAGE), null, 'bornes inversées')
  const badIndex = { ...AGENT_PAYLOAD, periods: [{ kind: 'range', from: '2026-09-01', to: '2026-10-01' }], comparisons: [{ current: 0, baseline: 5 }] }
  assertEqual(interpretation.parseInterpretation(JSON.stringify(badIndex), 'full', DARIJA_MESSAGE), null, 'indice hors bornes')
})

check('AG04', 'SQL ou table dans le plan : rejeté par le schéma strict', () => {
  const injected = { ...AGENT_PAYLOAD, sql: 'select * from orders' }
  assertEqual(interpretation.parseInterpretation(JSON.stringify(injected), 'full', DARIJA_MESSAGE), null, 'propriété inconnue refusée')
  const badTool = { ...AGENT_PAYLOAD, tools: [{ tool: 'run_sql' }] }
  assertEqual(interpretation.parseInterpretation(JSON.stringify(badTool), 'full', DARIJA_MESSAGE), null, 'outil inconnu refusé')
})

check('AG05', 'métriques et dimensions hors catalogue : filtrées, jamais exécutées', () => {
  const payload = { ...AGENT_PAYLOAD, metrics: ['revenue', 'satisfaction'], dimensions: ['city', 'weather'] }
  const parsed = interpretation.parseInterpretation(JSON.stringify(payload), 'full', DARIJA_MESSAGE)
  assert(parsed !== null, 'interprétation acceptée')
  assertEqual(parsed.metrics.includes('satisfaction'), false, 'métrique inconnue retirée')
  assertEqual(parsed.dimensions.join(','), 'city', 'dimension inconnue retirée')
})

check('AG06', 'réponse explicative : chiffres et preuves inconnues refusés', () => {
  const allowed = new Set(['p0:metric:revenue'])
  const valid = answerModule.sanitizeAgentAnswer(JSON.stringify({
    schema: 1, summary: 'La période comparée montre une évolution nette.',
    hypotheses: [{ factIds: ['p0:metric:revenue'], text: 'La saisonnalité peut expliquer une partie de l’écart.' }],
    recommendations: [],
  }), allowed)
  assert(valid !== null, 'réponse sans chiffre acceptée')
  assertEqual(valid.hypotheses.length, 1, 'hypothèse conservée')
  const withDigits = answerModule.sanitizeAgentAnswer(JSON.stringify({
    schema: 1, summary: 'Le CA a progressé de 12 %.', hypotheses: [], recommendations: [],
  }), allowed)
  assertEqual(withDigits, null, 'résumé chiffré refusé')
  const unknownFact = answerModule.sanitizeAgentAnswer(JSON.stringify({
    schema: 1, summary: 'Évolution notable.', hypotheses: [{ factIds: ['inconnu'], text: 'Hypothèse.' }], recommendations: [],
  }), allowed)
  assertEqual(unknownFact, null, 'preuve inconnue refusée')
})

check('AG07', 'budgets IA : appels, tokens et coût plafonnés', () => {
  const tracker = policy.createBudgetTracker({ ...policy.DEFAULT_BUDGETS, maxProviderCalls: 1, maxTotalTokens: 100, maxEstimatedCostUsd: 0.001 }, () => 0)
  tracker.consumeProviderCall()
  let calls = 0
  try { tracker.consumeProviderCall() } catch (error) { calls += 1; assertEqual(error.code, 'BUDGET_AI_CALLS', 'code appels') }
  assertEqual(calls, 1, 'second appel refusé')
  let tokens = 0
  try { tracker.consumeUsage({ tokens: 500, costUsd: 0 }) } catch (error) { tokens += 1; assertEqual(error.code, 'BUDGET_AI_TOKENS', 'code tokens') }
  assertEqual(tokens, 1, 'plafond tokens appliqué')
  const cost = policy.createBudgetTracker({ ...policy.DEFAULT_BUDGETS, maxEstimatedCostUsd: 0.001 }, () => 0)
  let costHits = 0
  try { cost.consumeUsage({ tokens: 1, costUsd: 0.5 }) } catch (error) { costHits += 1; assertEqual(error.code, 'BUDGET_AI_COST', 'code coût') }
  assertEqual(costHits, 1, 'plafond coût appliqué')
})

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
  assertEqual(current.year, 2026, 'la comparaison année-sur-année utilise une référence antérieure')
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
    engine.isGroundedNarrative('CA réalisé : en hausse.', facts, {
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
  state = voice.reduceVoice(state, { type: 'encoded' })
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

/* -------------------------------------------------------------------------- */
/* 11. Contre-exemples de l'audit final (P1)                                   */
/* -------------------------------------------------------------------------- */

const PROVIDERS_MODULE = path.resolve(ROOT, 'lib/assistant/providers/index.ts').replace(/\\/g, '/')

/** Remplace le fournisseur du cache, puis restaure l'état initial. */
async function withProvider(provider, run) {
  const original = cache.get(PROVIDERS_MODULE)
  const previousGetter = original?.getAssistantProvider
  if (original) original.getAssistantProvider = () => provider
  else cache.set(PROVIDERS_MODULE, { getAssistantProvider: () => provider })
  try {
    return await run()
  } finally {
    if (original) { original.getAssistantProvider = previousGetter; cache.set(PROVIDERS_MODULE, original) }
    else cache.delete(PROVIDERS_MODULE)
  }
}

function failingProvider(usage) {
  return {
    chat: async () => {
      const error = new Error('OPENAI_EMPTY_RESPONSE')
      error.usage = usage
      throw error
    },
  }
}

const FINAL_FACTS = [
  'revenue | CA réalisé | septembre 2026=412 | aout 2026=500 | ecart=-88 (down)',
  'totalOrders | Commandes | septembre 2026=120 | aout 2026=100 | ecart=20 (up)',
]

/**
 * Sérialise les contrôles qui partagent le fournisseur simulé et les variables
 * d'environnement : un test d'annulation ne doit jamais interrompre un autre.
 */
let serialChain = Promise.resolve()
function serial(task) {
  const next = serialChain.then(task, task)
  serialChain = next.then(() => undefined, () => undefined)
  return next
}

/** Restaure une variable d'environnement, y compris son absence d'origine. */
function restoreEnv(name, value) {
  if (typeof value === 'string') process.env[name] = value
  else delete process.env[name]
}

check('X01', 'narration : une phrase contraire au fait calculé est refusée', () => {
  const engine = loadTs('lib/assistant/agent/engine.ts')
  const claims = [{ metric: 'totalOrders', direction: 'up' }]
  assertEqual(
    engine.isGroundedNarrative('Le chiffre d’affaires est en hausse.', FINAL_FACTS, { claims }),
    false,
    'direction contraire refusée malgré un claim valide',
  )
  assertEqual(
    engine.isGroundedNarrative('CA réalisé : en baisse. Commandes : en hausse.', FINAL_FACTS),
    true,
    'constats conformes acceptés',
  )
})

check('X02', 'narration : causalité refusée même avec un claim valide', () => {
  const engine = loadTs('lib/assistant/agent/engine.ts')
  assertEqual(
    engine.isGroundedNarrative('Le chiffre d’affaires baisse grâce aux publicités.', FINAL_FACTS, {
      claims: [{ metric: 'revenue', direction: 'down' }],
    }),
    false,
    'cause non prouvée refusée',
  )
})

check('X03', 'narration : appréciation ou métrique absente du digest refusée', () => {
  const engine = loadTs('lib/assistant/agent/engine.ts')
  assertEqual(engine.isGroundedNarrative('Tous les clients sont satisfaits.', FINAL_FACTS), false, 'appréciation sans donnée')
  assertEqual(engine.isGroundedNarrative('Les marges progressent.', FINAL_FACTS), false, 'métrique absente du digest')
})

check('X04', 'narration : repli déterministe construit sur les faits', () => {
  const engine = loadTs('lib/assistant/agent/engine.ts')
  const fallback = engine.buildFactNarrative(FINAL_FACTS, 'fr', 'latin')
  assert(fallback.length > 0, 'synthèse produite')
  assertEqual(engine.isGroundedNarrative(fallback, FINAL_FACTS), true, 'repli vérifiable')
  return fallback
})

check('X05', 'planner : usage mesuré conservé sur réponse vide', async () => {
  const planner = loadTs('lib/assistant/agent/planner.ts')
  const usage = {
    text: '', inputTokens: 600, outputTokens: 40, providerName: 'openai',
    modelName: 'gpt-5.4-mini', providerCostUsd: 0.00063, usageKnown: true, usageState: 'failed',
  }
  const outcome = await planner.requestDynamicPlan({
    message: 'Mes ventes', locale: 'fr',
    context: { allowedMetrics: ['revenue'], allowedDimensions: ['city'] },
    financialAccess: 'full', model: 'mock', provider: failingProvider(usage),
  })
  assert(outcome.usage, 'usage conservé malgré l’échec')
  assertEqual(outcome.usage.inputTokens, 600, 'tokens entrants conservés')
  assertEqual(outcome.usage.outputTokens, 40, 'tokens sortants conservés')
  assertEqual(outcome.usage.usageState, 'failed', 'échec classé')
  const deepening = await planner.requestDeepeningPlan({
    message: 'Mes ventes', locale: 'fr', facts: ['revenue | CA réalisé | septembre 2026=412'],
    executedDimensions: [], context: { allowedMetrics: [], allowedDimensions: ['city'] },
    model: 'mock', provider: failingProvider(usage),
  })
  assertEqual(deepening.usage?.inputTokens, 600, 'approfondissement : usage conservé')
})

check('X06', 'engine : consommation d’un appel échoué jamais offerte', () => serial(async () => {
  const previousPlanner = process.env.ASSISTANT_PLANNER
  const previousNarrative = process.env.ASSISTANT_NARRATIVE
  process.env.ASSISTANT_PLANNER = 'llm'
  process.env.ASSISTANT_NARRATIVE = 'disabled'
  try {
    const outcome = await withProvider(failingProvider({
      text: '', inputTokens: 600, outputTokens: 40, providerName: 'openai',
      modelName: 'gpt-5.4-mini', providerCostUsd: 0.00063, usageKnown: true, usageState: 'failed',
    }), () => runEngine('Montre mes ventes', { intent: 'dashboard_summary' }))

    assertEqual(outcome.providerUsage.inputTokens, 1200, 'deux appels échoués cumulés')
    assertEqual(outcome.providerUsage.outputTokens, 80, 'sorties cumulées')
    assertEqual(outcome.providerUsage.usageState, 'failed', 'échec classé')
    assertEqual(outcome.providerUsage.usageKnown, true, 'usage connu conservé')

    const credits = loadTs('lib/assistant/credits.ts')
    const providerFailed = credits.resolveProviderFailed(outcome.providerUsage)
    assertEqual(providerFailed, false, 'échec mesuré non classé comme gratuit')
    const billing = credits.resolveUsageBilling({
      kind: credits.resolveUsageKind({
        cancelled: false,
        providerName: outcome.providerUsage.providerName,
        providerFailed,
      }),
      inputTokens: outcome.providerUsage.inputTokens,
      outputTokens: outcome.providerUsage.outputTokens,
      usageKnown: outcome.providerUsage.usageKnown !== false,
    })
    assertEqual(billing.billable, true, 'consommation connue facturable')
    assert(billing.creditsConsumed > 0, 'aucune gratuité accidentelle')
    return `${outcome.providerUsage.inputTokens}/${outcome.providerUsage.outputTokens} tokens, ${billing.creditsConsumed} crédit(s)`
  } finally {
    restoreEnv('ASSISTANT_PLANNER', previousPlanner)
    restoreEnv('ASSISTANT_NARRATIVE', previousNarrative)
  }
}))

check('X07', 'usage partiel : un succès et un échec restent cumulés', () => {
  const engine = loadTs('lib/assistant/agent/engine.ts')
  const merged = engine.mergeUsage(
    { text: '', inputTokens: 600, outputTokens: 40, providerName: 'openai', modelName: 'm', providerCostUsd: 0.001, usageKnown: true, usageState: 'failed' },
    { text: 'ok', inputTokens: 100, outputTokens: 20, providerName: 'openai', modelName: 'm', providerCostUsd: 0.0002, usageKnown: true, usageState: 'measured' },
  )
  assertEqual(merged.inputTokens, 700, 'entrée cumulée')
  assertEqual(merged.outputTokens, 60, 'sortie cumulée')
  assertEqual(merged.usageState, 'partial', 'tour partiel')
  assertEqual(merged.usageKnown, true, 'usage connu')
})

check('X08', 'KPI explicites : aucune métrique demandée perdue', () => serial(async () => {
  const outcome = await runEngine(
    'Donne le chiffre d’affaires, les commandes, les commandes livrées, annulées et retournées',
    { intent: 'dashboard_summary' },
  )
  const kpi = outcome.structuredResponse.document.blocks.find((block) => block.type === 'kpi')
  assert(kpi, 'bloc KPI publié')
  const ids = kpi.items.map((item) => item.id)
  for (const expected of ['revenue', 'totalOrders', 'deliveredOrders', 'cancelledOrders', 'returnedOrders']) {
    assert(ids.includes(expected), `métrique demandée absente : ${expected}`)
  }
  return ids.join(',')
}))

check('X09', 'CA + détail par ville : le total global reste publié', () => serial(async () => {
  const outcome = await runEngine('Donne le chiffre d’affaires et le détail par ville', { intent: 'dashboard_summary' })
  const blocks = outcome.structuredResponse.document.blocks
  const kpi = blocks.find((block) => block.type === 'kpi')
  assert(kpi && kpi.items.some((item) => item.id === 'revenue'), 'KPI global conservé')
  assert(JSON.stringify(blocks).includes('Casablanca'), 'ventilation publiée')
}))

check('X10', 'question simple : approfondissement réellement déclenché', () => serial(async () => {
  const previousPlanner = process.env.ASSISTANT_PLANNER
  const previousNarrative = process.env.ASSISTANT_NARRATIVE
  process.env.ASSISTANT_PLANNER = 'llm'
  process.env.ASSISTANT_NARRATIVE = 'disabled'
  const prompts = []
  const provider = {
    chat: async (request) => {
      prompts.push(request.messages[0].content)
      const plan = prompts.length === 1
        ? { schema: 1, operations: [], needsSeries: false, rationale: '' }
        : { schema: 1, operations: [{ kind: 'dimension', dimension: 'city' }], needsSeries: false, rationale: '' }
      return {
        text: JSON.stringify(plan), inputTokens: 10, outputTokens: 5,
        providerName: 'mock', modelName: 'mock', providerCostUsd: 0, usageKnown: true, usageState: 'measured',
      }
    },
  }
  try {
    const outcome = await withProvider(provider, () => runEngine('Analyse mes ventes', { intent: 'dashboard_summary' }))
    assertEqual(prompts.length, 2, 'deux passes fournisseur')
    assert(prompts[1].includes('Faits vérifiés'), 'seconde passe guidée par les faits')
    assert(JSON.stringify(outcome.structuredResponse.document).includes('Casablanca'), 'ventilation publiée')
  } finally {
    restoreEnv('ASSISTANT_PLANNER', previousPlanner)
    restoreEnv('ASSISTANT_NARRATIVE', previousNarrative)
  }
}))

check('X11', 'annulation pendant une opération asynchrone : aucune finalisation', () => serial(async () => {
  const previousPlanner = process.env.ASSISTANT_PLANNER
  const previousNarrative = process.env.ASSISTANT_NARRATIVE
  process.env.ASSISTANT_PLANNER = 'llm'
  process.env.ASSISTANT_NARRATIVE = 'disabled'
  const controller = new AbortController()
  try {
    // 1. Annulation pendant la planification (fournisseur dynamique).
    let code = ''
    try {
      await withProvider({
        chat: async () => {
          controller.abort()
          throw new Error('OPENAI_ABORTED')
        },
      }, () => runEngine('Compare septembre 2026 et octobre 2026', { signal: controller.signal }))
    } catch (error) {
      code = error instanceof Error ? error.message : String(error)
    }
    assertEqual(code, 'ASSISTANT_ABORTED', 'abandon propagé, aucune finalisation')

    // 2. Annulation déjà signalée au moment de la rédaction : le fournisseur
    //    n'est jamais sollicité pour publier une réponse.
    const engine = loadTs('lib/assistant/agent/engine.ts')
    const aborted = new AbortController()
    aborted.abort()
    let narrativeCode = ''
    try {
      await engine.requestNarrative({
        request: { profile: { locale: 'fr', script: 'latin', direction: 'ltr' }, question: 'Mes ventes' },
        facts: ['revenue | CA réalisé | septembre 2026=412'],
        model: 'mock',
        signal: aborted.signal,
      })
    } catch (error) {
      narrativeCode = error instanceof Error ? error.message : String(error)
    }
    assertEqual(narrativeCode, 'ASSISTANT_ABORTED', 'rédaction abandonnée')
  } finally {
    restoreEnv('ASSISTANT_PLANNER', previousPlanner)
    restoreEnv('ASSISTANT_NARRATIVE', previousNarrative)
  }
}))

check('X12', 'échec sans mesure : toujours gratuit (politique conservée)', () => {
  const credits = loadTs('lib/assistant/credits.ts')
  assertEqual(
    credits.resolveProviderFailed({ usageState: 'failed', usageKnown: false, inputTokens: 0, outputTokens: 0 }),
    true,
    'échec non mesuré classé comme échec',
  )
  const billing = credits.resolveUsageBilling({
    kind: credits.resolveUsageKind({ cancelled: false, providerName: 'openai', providerFailed: true }),
    inputTokens: 0,
    outputTokens: 0,
    usageKnown: false,
  })
  assertEqual(billing.billable, false, 'aucun débit sans mesure')
  assertEqual(billing.creditsConsumed, 0, 'consommation nulle')
})

check('X13', 'engine : narration non prouvée remplacée par une synthèse factuelle', () => serial(async () => {
  const previousPlanner = process.env.ASSISTANT_PLANNER
  const previousNarrative = process.env.ASSISTANT_NARRATIVE
  process.env.ASSISTANT_PLANNER = 'deterministic'
  process.env.ASSISTANT_NARRATIVE = 'enabled'
  try {
    const outcome = await runEngine('Compare septembre 2026 et octobre 2026')
    const summary = outcome.structuredResponse.document.blocks[0].text
    assert(!/contrast/i.test(summary), 'texte du modèle non vérifié refusé')
    const document = outcome.structuredResponse.document
    assert(loadTs('lib/assistant/blocks/compose.ts').validateDocumentEvidence(document), 'tous les blocs sont prouvés')
    assert(document.blocks.some((block) => block.type === 'analysis'), 'analyse contextualisée conservée')
    return summary
  } finally {
    restoreEnv('ASSISTANT_PLANNER', previousPlanner)
    restoreEnv('ASSISTANT_NARRATIVE', previousNarrative)
  }
}))

check('Y01', 'texte libre : métriques inversées, satisfaction et expansion toujours refusées', () => {
  const engine = loadTs('lib/assistant/agent/engine.ts')
  for (const text of [
    'Le chiffre d’affaires augmente et les commandes baissent.',
    'Le chiffre d’affaires baisse et tous les clients sont satisfaits.',
    'Le chiffre d’affaires finance désormais une expansion internationale.',
  ]) {
    assertEqual(engine.isGroundedNarrative(text, FINAL_FACTS, {
      claims: [{ metric: 'totalOrders', direction: 'up' }],
    }), false, text)
  }
  const contradictory = [...FINAL_FACTS, 'revenue | CA réalisé | autre paire | ecart=1 (up)']
  assert(!engine.buildFactNarrative(contradictory, 'fr', 'latin').includes('CA réalisé'), 'pas de direction globale ambiguë')
})

check('Y02', 'moteur : texte trompeur jamais publié malgré des observations valides', () => serial(async () => {
  const previousPlanner = process.env.ASSISTANT_PLANNER
  const previousNarrative = process.env.ASSISTANT_NARRATIVE
  process.env.ASSISTANT_PLANNER = 'deterministic'
  process.env.ASSISTANT_NARRATIVE = 'enabled'
  try {
    const out = await withProvider({ chat: async () => ({
      text: JSON.stringify({ summary: 'Les commandes progressent et tous les clients sont satisfaits.',
        observations: [{ metric: 'totalOrders', direction: 'up' }] }),
      inputTokens: 600, outputTokens: 40, providerName: 'mock', modelName: 'mock', providerCostUsd: 0.001, usageKnown: true,
    }) }, () => runEngine('Compare septembre 2026 et octobre 2026'))
    assert(!out.structuredResponse.message_text.includes('satisfaits'), 'assertion libre absente')
    assert(loadTs('lib/assistant/blocks/compose.ts').validateDocumentEvidence(out.structuredResponse.document), 'phrases construites depuis les preuves')
    assertEqual(out.providerUsage.inputTokens, 600, 'appel simulé réellement utilisé')
  } finally {
    restoreEnv('ASSISTANT_PLANNER', previousPlanner)
    restoreEnv('ASSISTANT_NARRATIVE', previousNarrative)
  }
}))

check('Y03', 'budget : usage conservé après planner ou narration hors délai', () => serial(async () => {
  const originalNow = Date.now
  const previousPlanner = process.env.ASSISTANT_PLANNER
  const previousNarrative = process.env.ASSISTANT_NARRATIVE
  let elapsed = 0
  Date.now = () => originalNow() + elapsed
  const provider = { chat: async () => {
    elapsed = 21000
    return { text: JSON.stringify({ schema: 1, operations: [], needsSeries: false, rationale: '' }),
      inputTokens: 600, outputTokens: 40, providerName: 'openai', modelName: 'mock', providerCostUsd: 0.00063, usageKnown: true }
  } }
  try {
    for (const phase of ['planner', 'narrative']) {
      elapsed = 0
      process.env.ASSISTANT_PLANNER = phase === 'planner' ? 'llm' : 'deterministic'
      process.env.ASSISTANT_NARRATIVE = phase === 'narrative' ? 'enabled' : 'disabled'
      const out = await withProvider(provider, () => runEngine('Compare septembre 2026 et octobre 2026'))
      assertEqual(out.providerUsage.inputTokens, 600, `${phase}: entrée conservée`)
      assertEqual(out.providerUsage.outputTokens, 40, `${phase}: sortie conservée`)
      assertEqual(out.providerUsage.usageKnown, true, `${phase}: usage mesuré`)
      assertEqual(out.providerUsage.providerCostUsd, 0.00063, `${phase}: coût conservé`)
      assert((out.structuredResponse.warnings ?? []).some((w) => /budget/.test(w)), `${phase}: limite explicite`)
      const credits = loadTs('lib/assistant/credits.ts')
      const billing = credits.resolveUsageBilling({ kind: 'provider', ...out.providerUsage })
      assert(billing.billable && billing.creditsConsumed > 0, `${phase}: aucune gratuité accidentelle`)
    }
  } finally {
    Date.now = originalNow
    restoreEnv('ASSISTANT_PLANNER', previousPlanner)
    restoreEnv('ASSISTANT_NARRATIVE', previousNarrative)
  }
}))

check('ASTRA01', 'les mêmes mois conservent les deux années sans répétition', () => {
  for (const message of [
    'Compare septembre et octobre 2026 avec les mêmes mois de 2025',
    'قارن شتنبر وأكتوبر 2026 مع نفس الشهور ديال 2025',
    'Compare 2026: September and October with 2025: the same months',
  ]) {
    const assigned = periods.assignYears(periods.monthMentions(message), periods.yearMentions(message), 2026)
    const plan = periods.buildPeriodPlan({ months: assigned, comparisonIntent: true })
    assertEqual(plan.periods.length, 4, message)
    assertEqual(plan.pairs.length, 3, 'deux comparaisons mensuelles et un agrégat')
    for (const pair of plan.pairs) {
      const all = [...plan.periods, ...plan.groups]
      assert(all.find((p) => p.id === pair.currentId).year > all.find((p) => p.id === pair.baselineId).year, 'référence antérieure')
    }
  }
})

check('ASTRA02', 'le plafond refuse au lieu de supprimer une période', () => {
  let refused = false
  try {
    periods.buildPeriodPlan({ months: Array.from({ length: 7 }, (_, i) => ({ year: 2026, month: i + 1 })) })
  } catch (error) { refused = error.message === 'PLAN_PERIOD_LIMIT' }
  assert(refused, 'demande hors budget explicitement refusée')
})

check('ASTRA03', 'plan vide autorisé pour terminer l’approfondissement', () => {
  const planner = loadTs('lib/assistant/agent/planner.ts')
  const plan = planner.parseDynamicPlan({ schema: 1, operations: [], needsSeries: false }, { allowedMetrics: [], allowedDimensions: [] })
  assert(plan && plan.dimensions.length === 0, 'aucun détail supplémentaire')
})

check('ASTRA04', 'planner : fenêtres et comparaisons contrôlées, SQL refusé', () => {
  const planner = loadTs('lib/assistant/agent/planner.ts')
  const context = { allowedMetrics: ['revenue'], allowedDimensions: [] }
  const payload = {
    schema: 1, operations: [{ kind: 'metric', metric: 'revenue' }], needsSeries: false,
    periods: [
      { id: 'p0', from: '2026-09-01', to: '2026-10-01' },
      { id: 'p1', from: '2025-09-01', to: '2025-10-01' },
    ], comparisons: [{ currentId: 'p0', baselineId: 'p1' }],
  }
  assertEqual(planner.parseDynamicPlan(payload, context).periodPlan.periods.length, 2, 'plan accepté')
  assertEqual(planner.parseDynamicPlan({ ...payload, sql: 'select 1' }, context), null, 'SQL interdit')
  assertEqual(planner.parseDynamicPlan({ ...payload, comparisons: [] }, context), null, 'fenêtres orphelines interdites')
  assertEqual(planner.parseDynamicPlan(payload, { ...context, semanticPeriods: false }), null, 'rollback respecte le flag')
  assertEqual(policy.isSemanticPlannerEnabled({}), false, 'nouvelle capacité fermée sans activation')
  assertEqual(policy.isSemanticPlannerEnabled({ ASSISTANT_SEMANTIC_PLANNER: 'enabled' }), true, 'activation explicite')
})

check('ASTRA05', 'question réelle abrégée : quatre périodes jusque dans le document', () => serial(async () => {
  const outcome = await runEngine('Compare septembre et octobre 2026 avec les mêmes mois de 2025')
  const doc = outcome.structuredResponse.document
  assertEqual(doc.analysis.periodPlan.periods.length, 4, 'mémoire conserve les fenêtres')
  const tables = doc.blocks.filter((block) => block.type === 'table')
  assertEqual(tables.length, 3, 'toutes les comparaisons publiées')
  assert(tables.some((block) => /2025/.test(block.table.title)), 'référence visible')
}))

check('ASTRA06', 'baisse publiée : aucun verdict attribué à la mauvaise période', () => serial(async () => {
  const outcome = await runEngine('Compare octobre 2026 avec septembre 2026')
  const insights = outcome.structuredResponse.document.blocks.filter((block) => block.type === 'analysis')
  assert(insights.length > 0, 'constat publié')
  assert(insights.every((block) => block.claims.every((claim) => !/meilleur|plus faible/.test(claim.text))), 'direction descriptive uniquement')
}))

check('ASTRA07', 'exécuteur réel : un budget épuisé conserve les fenêtres déjà lues', () => serial(async () => {
  const modulePath = path.resolve(ROOT, 'lib/assistant/engine/executor.ts').replace(/\\/g, '/')
  const readerPath = path.resolve(ROOT, 'lib/assistant/analytics-reader.ts').replace(/\\/g, '/')
  const savedExecutor = cache.get(modulePath)
  const savedReader = cache.get(readerPath)
  cache.delete(modulePath)
  cache.set(readerPath, { readAssistantKpis: async (_client, _stores, range) => ({ state: 'empty', range, stores: [], issues: [] }) })
  try {
    const executor = loadTs('lib/assistant/engine/executor.ts')
    const tracker = policy.createBudgetTracker({ ...policy.DEFAULT_BUDGETS, maxConcurrentReads: 1, maxWindowReads: 1 })
    const windows = [0, 1, 2].map((index) => ({ id: `p${index}`, range: { from: '2026-09-01', to: '2026-10-01' } }))
    const readings = await executor.readWindows({ supabase: {}, storeIds: ['store-a'], windows, tracker })
    assertEqual(readings.size, 3, 'chaque fenêtre possède un résultat explicite')
    assert(readings.get('p0').kpis !== null, 'première lecture conservée')
    assertEqual(readings.get('p1').budgetExceeded, true, 'lecture restante non exécutée')
  } finally {
    if (savedExecutor) cache.set(modulePath, savedExecutor); else cache.delete(modulePath)
    if (savedReader) cache.set(readerPath, savedReader); else cache.delete(readerPath)
  }
}))

check('ASTRA08', 'années relatives avec mois : aucune référence perdue', () => {
  const built = request.buildAnalysisRequest({
    message: 'Compare septembre et octobre cette année avec les mêmes mois de l’année dernière',
    intent: 'period_comparison', resolvedRange: { from: '2026-09-01', to: '2026-11-01' },
    access: 'full', maxPeriods: 6, now: new Date('2026-11-04T12:00:00Z'),
  })
  assertEqual(built.plan.periods.length, 4, 'deux mois dans chacune des années')
})

check('ASTRA09', 'colonne valide après une première ligne nulle : aucune disparition', () => {
  const compose = loadTs('lib/assistant/blocks/compose.ts')
  const table = compose.buildDimensionTable({
    dict: i18n.resolveDictionary('fr', 'latin'), script: 'latin', currency: 'MAD',
    reading: { dimension: 'product', windowId: 'p0', failure: null, data: {
      meta: { state: 'partial', limits: ['Classement limité : la somme ne représente pas le total.'] },
      rows: [{ productName: 'A', revenue: null, profit: null }, { productName: 'B', revenue: '150', profit: '40' }],
    } },
  })
  assert(table.columns.some((column) => column.key === 'revenue'), 'colonne CA conservée')
  assert(table.caption.includes('hors publicité'), 'définition du profit jointe au tableau')
})

check('ASTRA10', 'registre partagé : chiffres et conclusions falsifiés refusés', () => serial(async () => {
  const { structuredResponse } = await runEngine('Compare septembre et octobre 2026 avec les mêmes mois de 2025')
  const compose = loadTs('lib/assistant/blocks/compose.ts')
  const document = structuredResponse.document
  assert(compose.validateDocumentEvidence(document), 'document réel prouvé')
  const altered = structuredClone(document)
  altered.blocks.find((block) => block.type === 'table').table.rows[0].cells[1].value = '999999'
  assertEqual(compose.validateDocumentEvidence(altered), false, 'mauvais chiffre refusé')
  const contradiction = structuredClone(document)
  contradiction.blocks.find((block) => block.type === 'analysis').claims[0].text = 'La baisse prouve que les clients sont satisfaits.'
  assertEqual(compose.validateDocumentEvidence(contradiction), false, 'cause et contradiction refusées')
  for (const fact of document.evidence) {
    assert(fact.storeIds.length && fact.range.from && fact.population && fact.provenance.length, 'provenance complète')
  }
}))

check('ASTRA11', 'parcours multilingue moteur et composant React réels', () => serial(async () => {
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const Blocks = loadTs('components/assistant/assistant-blocks.tsx').default
  const compose = loadTs('lib/assistant/blocks/compose.ts')
  for (const question of [
    'Compare septembre et octobre 2026 avec les mêmes mois de 2025',
    'قارن شتنبر وأكتوبر 2026 مع نفس الشهور ديال 2025',
    'قارن سبتمبر وأكتوبر 2026 مع نفس الشهور في 2025',
    'Compare September and October 2026 with the same months of 2025',
  ]) {
    const outcome = await runEngine(question)
    const document = outcome.structuredResponse.document
    assertEqual(document.analysis.periodPlan.periods.length, 4, 'quatre fenêtres')
    assert(compose.validateDocumentEvidence(document), 'preuve dans chaque langue')
    const html = renderToStaticMarkup(React.createElement(Blocks, { document }))
    assert(html.includes('2025') && html.includes('2026'), 'années visibles dans React')
    assert(!html.includes('999999') && html.includes('data-analysis-kind'), 'analyse structurée rendue')
  }
}))

check('ASTRA17', 'darija : « هاد العام » + « العام اللي فات » conservent quatre fenêtres', () => {
  for (const message of [
    'قارن ليا شتنبر وأكتوبر ديال هاد العام مع نفس الشهور ديال العام اللي فات',
    'قارن ليا أكتوبر ونونبر ديال هاد العام مع نفس الشهور ديال العام اللي فات',
  ]) {
    const built = request.buildAnalysisRequest({
      message,
      intent: 'period_comparison',
      resolvedRange: { from: '2026-01-01', to: '2026-11-04' },
      access: 'full',
      maxPeriods: 6,
      now: new Date('2026-11-04T12:00:00.000Z'),
    })
    assertEqual(built.plan.periods.length, 4, `quatre fenêtres (obtenu ${built.plan.periods.length}) : ${message}`)
    assertEqual(built.plan.pairs.length, 3, `trois correspondances (obtenu ${built.plan.pairs.length}) : ${message}`)
    // Quatre mois élémentaires + deux agrégats pluri-mois effectivement lus.
    assertEqual(request.planWindows(built.plan).length, 6, `fenêtres planifiées (obtenu ${request.planWindows(built.plan).length}) : ${message}`)
    const years = [...new Set(built.plan.periods.map((period) => period.year))]
    assertEqual(years.length, 2, `deux années distinctes (obtenu ${years.join(',')})`)
    assertEqual(Math.max(...years) - Math.min(...years), 1, 'années consécutives')
  }
})

check('ASTRA18', 'darija : variantes « لي فات » / « هذا العام » et formulation française', () => {
  for (const message of [
    'قارن ليا شتنبر وأكتوبر ديال هذا العام مع نفس الشهور ديال العام لي فات',
    'قارن ليا شتنبر وأكتوبر ديال هاد العام مع نفس الشهور ديال العام اللي فات',
    'Compare septembre et octobre de cette année avec les mêmes mois de l’année dernière',
  ]) {
    const built = request.buildAnalysisRequest({
      message,
      intent: 'period_comparison',
      resolvedRange: { from: '2026-01-01', to: '2026-11-04' },
      access: 'full',
      maxPeriods: 6,
      now: new Date('2026-11-04T12:00:00.000Z'),
    })
    assertEqual(built.plan.periods.length, 4, `quatre fenêtres (obtenu ${built.plan.periods.length}) : ${message}`)
    const years = [...new Set(built.plan.periods.map((period) => period.year))]
    assertEqual(Math.max(...years) - Math.min(...years), 1, `années consécutives : ${message}`)
  }
})

check('ASTRA12', 'relance : ces mois et année précédente conservent métrique et contexte', () => serial(async () => {
  const outcome = await runEngine('Compare le CA de septembre et octobre 2025 avec les mêmes mois de 2024')
  const previousAnalysis = outcome.structuredResponse.document.analysis
  for (const message of ['Et par ville pour ces mois ?', 'By city for these months']) {
    const built = request.buildAnalysisRequest({ message, previousAnalysis,
      intent: 'period_comparison', resolvedRange: { from: '2026-11-01', to: '2026-11-05' }, access: 'full', maxPeriods: 6 })
    assertEqual(built.plan.periods[0].range.from, '2025-09-01', 'pas de retour à 2026')
    assert(built.requestedMetrics.includes('revenue') && built.dimensions.includes('city'), 'métrique et dimension conservées')
  }
  const previousYear = request.buildAnalysisRequest({ message: 'Et ces mois de l’année précédente ?', previousAnalysis,
    intent: 'period_comparison', resolvedRange: { from: '2026-11-01', to: '2026-11-05' }, access: 'full', maxPeriods: 6 })
  assert(previousYear.plan.periods.some((period) => period.year === 2024), 'année précédente relative à 2025')
}))

check('ASTRA13', 'ventilations : contributions comparées sans transformer un top en total', () => serial(async () => {
  const outcome = await runEngine('Compare septembre 2026 et octobre 2026 par ville')
  const document = outcome.structuredResponse.document
  assert(document.evidence.some((fact) => fact.kind === 'comparison' && fact.dimension === 'city'), 'même ville lue sur les deux fenêtres')
  assert(document.evidence.filter((fact) => fact.kind === 'dimension').every((fact) => fact.population === 'dimension_population'), 'population identifiée')
  assert(loadTs('lib/assistant/blocks/compose.ts').validateDocumentEvidence(document), 'preuve commune')
}))

check('ASTRA14', 'sélection explicative réelle : texte libre et indexes inventés ne sont jamais publiés', () => serial(async () => {
  const oldPlanner = process.env.ASSISTANT_PLANNER, oldNarrative = process.env.ASSISTANT_NARRATIVE
  process.env.ASSISTANT_PLANNER = 'deterministic'; process.env.ASSISTANT_NARRATIVE = 'enabled'
  try {
    const out = await withProvider({ chat: async (input) => {
      assert(input.systemPrompt.includes('parcours explicatif'), 'vrai contrat explicatif transmis')
      return { text: JSON.stringify({ selections: [0], summary: 'La publicité cause toutes les pertes.' }),
        inputTokens: 50, outputTokens: 10, providerName: 'mock', modelName: 'mock', providerCostUsd: 0, usageKnown: true }
    } }, () => runEngine('Compare septembre 2026 et octobre 2026'))
    const analysis = out.structuredResponse.document.blocks.find((block) => block.type === 'analysis')
    assertEqual(analysis.claims.length, 1, 'ordre et sélection du modèle appliqués')
    assert(!out.structuredResponse.message_text.includes('cause'), 'aucune causalité libre')
  } finally { restoreEnv('ASSISTANT_PLANNER', oldPlanner); restoreEnv('ASSISTANT_NARRATIVE', oldNarrative) }
}))

check('ASTRA15', 'registre : direction inversée, devise et périmètre altérés rejetés', () => serial(async () => {
  const out = await runEngine('Compare septembre 2026 et octobre 2026')
  const validate = loadTs('lib/assistant/blocks/compose.ts').validateDocumentEvidence
  for (const mutation of [
    (fact) => { fact.direction = fact.direction === 'up' ? 'down' : 'up' },
    (fact) => { fact.parents.reverse() },
  ]) {
    const doc = structuredClone(out.structuredResponse.document)
    mutation(doc.evidence.find((fact) => fact.kind === 'comparison' && fact.direction !== 'flat'))
    assertEqual(validate(doc), false, 'comparaison falsifiée refusée')
  }
}))

check('ASTRA16', 'décomposition vérifiée uniquement si l’identité comptable ferme', () => serial(async () => {
  const out = await runEngine('Analyse ma marge en septembre 2026')
  const compose = loadTs('lib/assistant/blocks/compose.ts')
  const facts = structuredClone(out.structuredResponse.document.evidence)
  const values = { revenue: '1000', purchaseCost: '200', deliveryCost: '100', confirmationCost: '50', adSpend: '150', contributionMargin: '500' }
  for (const fact of facts) if (values[fact.metric]) fact.value = values[fact.metric]
  const req = request.buildAnalysisRequest({ message: 'Ma marge en septembre 2026', intent: 'profit_analysis', access: 'full', maxPeriods: 6,
    resolvedRange: { from: '2026-09-01', to: '2026-10-01' } })
  assert(compose.buildEvidenceClaims(facts, req).some((claim) => claim.kind === 'decomposition'), 'identité exacte expliquée')
  facts.find((fact) => fact.metric === 'contributionMargin').value = '501'
  assert(!compose.buildEvidenceClaims(facts, req).some((claim) => claim.kind === 'decomposition'), 'écart non expliqué rejeté')
}))

check('AG08', 'orchestrateur réel : un appel fusionné pilote le plan validé', () => serial(async () => {
  const provider = {
    chat: async () => ({
      text: JSON.stringify(AGENT_PAYLOAD),
      inputTokens: 200, outputTokens: 80, providerName: 'mock', modelName: 'mock',
      providerCostUsd: 0.0002, usageKnown: true, usageState: 'measured',
    }),
  }
  const previous = process.env.ASSISTANT_AGENT_LLM
  process.env.ASSISTANT_AGENT_LLM = 'enabled'
  try {
    const outcome = await withProvider(provider, () => runEngine(DARIJA_MESSAGE))
    const document = outcome.structuredResponse.document
    assertEqual(document.analysis.periodPlan.periods.length, 4, 'quatre fenêtres dans le document')
    assert(outcome.activitySteps.some((step) => step.label === 'Interprétation'), 'étape Interprétation tracée')
    assert(outcome.providerUsage.inputTokens >= 200, 'usage de l’interprétation comptabilisé')
  } finally {
    if (previous === undefined) delete process.env.ASSISTANT_AGENT_LLM
    else process.env.ASSISTANT_AGENT_LLM = previous
  }
}))

check('AG09', 'agent indisponible : repli annoncé, jamais silencieux', () => serial(async () => {
  const previous = process.env.ASSISTANT_AGENT_LLM
  process.env.ASSISTANT_AGENT_LLM = 'enabled'
  try {
    const outcome = await withProvider(failingProvider(undefined), () => runEngine('Compare septembre 2026 avec octobre 2026'))
    const warnings = (outcome.structuredResponse.warnings ?? []).join(' ')
    assert(warnings.includes('Compréhension automatique indisponible'), 'limitation annoncée')
  } finally {
    if (previous === undefined) delete process.env.ASSISTANT_AGENT_LLM
    else process.env.ASSISTANT_AGENT_LLM = previous
  }
}))

check('AG10', 'finalisation : cause RPC conservée, jamais masquée en générique', () => {
  const finalizeError = loadTs('lib/assistant/finalize-error.ts')
  assertEqual(finalizeError.toFinalizeError('IDEMPOTENCY_TOKEN_MISMATCH').message, 'IDEMPOTENCY_TOKEN_MISMATCH', 'cause connue conservée')
  assertEqual(finalizeError.toFinalizeError('FORBIDDEN_STORE').message, 'FORBIDDEN_STORE', 'refus boutique conservé')
  assertEqual(finalizeError.toFinalizeError('DEADLOCK_DETECTED').message, 'FINALIZE_RPC_FAILED', 'cause inconnue bornée')
  assertEqual(finalizeError.toFinalizeError('').message, 'FINALIZE_RPC_FAILED', 'message vide borné')

  // Le mapping public reste vérifié à la source : `security.ts` importe des
  // modules Next indisponibles hors runtime, on ne le charge donc pas ici.
  const source = fs.readFileSync(path.join(ROOT, 'lib/assistant/security.ts'), 'utf8')
  for (const code of ['IDEMPOTENCY_LEASE_LOST', 'IDEMPOTENCY_TOKEN_MISMATCH', 'FORBIDDEN_STORE']) {
    assert(source.includes(`${code}:`), `message public présent : ${code}`)
  }
  assert(source.includes("if (message === 'IDEMPOTENCY_LEASE_LOST') return 409"), 'statut 409 pour bail perdu')
  assert(source.includes("if (message === 'IDEMPOTENCY_REPLAY_UNAVAILABLE') return 409"), 'statut 409 pour rejeu indisponible')
  assert(source.includes('FINALIZE_RPC_FAILED:'), 'repli générique conservé')
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
