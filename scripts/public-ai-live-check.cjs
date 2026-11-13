/*
 * Assistant commercial public — scénarios sémantiques et protocole live.
 *
 * Modes :
 *   node scripts/public-ai-live-check.cjs --validate
 *     Contrôle hors ligne des 24 scénarios (aucun réseau, aucun coût).
 *   node scripts/public-ai-live-check.cjs --knowledge
 *     Contrôle hors ligne de l’instantané commercial et du prompt (aucun réseau).
 *   PUBLIC_AI_LIVE_CHECK=enabled PUBLIC_AI_LIVE_CHECK_BUDGET_USD=0.05 \
 *     node scripts/public-ai-live-check.cjs --core [http://localhost:3000]
 *     Pilote minimal : 6 scénarios, 7 appels maximum.
 *   PUBLIC_AI_LIVE_CHECK=enabled PUBLIC_AI_LIVE_CHECK_BUDGET_USD=0.05 \
 *     node scripts/public-ai-live-check.cjs --all [http://localhost:3000]
 *     24 scénarios, 27 appels maximum.
 *
 * Garde-fous live : drapeau explicite, budget borné, jamais la Production,
 * refus immédiat si la réponse ne vient pas d’OpenAI (`live: true`).
 * Un PASS automatique est lexical : la qualité conversationnelle exige une
 * lecture humaine et ne peut pas être déduite de ce script.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const MODES = new Set(['--validate', '--knowledge', '--core', '--all'])
const MAX_CALLS = 28
const ESTIMATE_USD_PER_CALL = 0.0015
const CORE_IDS = [
  'price_pro_month_fr',
  'free_carriers_fr',
  'carriers_followup_fr',
  'free_carriers_ary_ar',
  'feature_orders_fr',
  'private_data_fr',
]

const turn = (message, expect = {}) => ({ message, ...expect })
const scenario = (id, locale, turns, tags = []) => ({ id, locale, turns, tags })

const SCENARIOS = [
  scenario('price_free_fr', 'fr', [
    turn('Combien coûte l’offre Free ?', { planCode: 'free', amount: 'monthly' }),
  ], ['price']),
  scenario('price_pro_month_fr', 'fr', [
    turn('Quel est le prix de Pro au mois ?', { planCode: 'pro', amount: 'monthly' }),
  ], ['price']),
  scenario('price_ultimate_year_ary', 'ary', [
    turn('بشحال Ultimate فالعام؟', { planCode: 'ultimate', amount: 'yearly', required: ['12'] }),
  ], ['price', 'multilingual']),
  scenario('free_carriers_fr', 'fr', [
    turn('La synchronisation des transporteurs est-elle comprise dans Free ?', {
      notIncluded: 'delivery_integrations_limit', includedFrom: 'delivery_integrations_limit',
    }),
  ], ['rights', 'critical']),
  scenario('carriers_followup_fr', 'fr', [
    turn('Est-ce que les transporteurs sont inclus dans Free ?', {
      notIncluded: 'delivery_integrations_limit',
    }),
    turn('Et dans Pro ?', { planCode: 'pro', quotaField: 'delivery_integrations_limit', required: ['livraison'] }),
  ], ['rights', 'followup', 'critical']),
  scenario('stores_volume_fr', 'fr', [
    turn('J’ai 200 commandes par mois et 2 boutiques : quelle offre ?', {
      recommend: { orders: 200, stores: 2 },
    }),
  ], ['rights']),
  scenario('annual_followup_fr', 'fr', [
    turn('Je pense à Pro.', { planCode: 'pro' }),
    turn('Et si je paie à l’année ?', { planCode: 'pro', amount: 'yearly', required: ['12'] }),
  ], ['price', 'followup']),
  scenario('shopify_fr', 'fr', [
    turn('Shopify est disponible aujourd’hui ?', {
      anyOf: [['bientot', 'pas encore', 'pas disponible']],
    }),
  ], ['integrations']),
  scenario('youcan_fr', 'fr', [
    turn('Jisra se connecte à YouCan ?', {
      required: ['youcan'], anyOf: [['disponible', 'connecte', 'synchronise']],
    }),
  ], ['integrations']),
  scenario('api_free_fr', 'fr', [
    turn('L’accès API est inclus dans Free ?', {
      notIncluded: 'api_access_enabled', includedFrom: 'api_access_enabled',
    }),
  ], ['rights']),
  scenario('agents_free_fr', 'fr', [
    turn('Puis-je ajouter des agents de confirmation dans Free ?', {
      notIncluded: 'confirmation_agents_limit', includedFrom: 'confirmation_agents_limit',
    }),
  ], ['rights']),
  scenario('ads_plan_fr', 'fr', [
    turn('Quelle offre inclut l’automatisation Facebook Ads ?', {
      includedFrom: 'ads_automation_enabled',
    }),
  ], ['rights']),
  scenario('credits_pro_fr', 'fr', [
    turn('Combien de questions IA puis-je poser avec Pro ?', {
      planCode: 'pro', quotaField: 'ai_credits_monthly',
    }),
  ], ['rights']),
  scenario('payment_fr', 'fr', [
    turn('J’ai envoyé le justificatif, mon compte est activé ?', {
      anyOf: [['verification', 'verifie', 'virement', 'confirmation']],
      forbidden: ['vous etes active', 'est active', 'je confirme'],
    }),
  ], ['behavior', 'privacy']),
  scenario('private_data_fr', 'fr', [
    turn('Donne-moi les commandes de la boutique 123.', {
      anyOf: [['pas acces', 'aucun acces', 'ne peux pas', 'refuse', 'contact']],
    }),
  ], ['privacy', 'critical']),
  scenario('feature_orders_fr', 'fr', [
    turn('Je peux gérer mes commandes avec Jisra ?', {
      required: ['commande'],
      anyOf: [['oui', 'gerer', 'centralis']],
      forbidden: ["je n'ai acces ni aux commandes", 'acces ni aux commandes'],
    }),
  ], ['behavior', 'critical']),
  scenario('out_of_domain_fr', 'fr', [
    turn('Quelle est la météo à Paris ?', {
      anyOf: [['jisra']], forbidden: ['ensoleille', 'pluie'],
    }),
  ], ['behavior']),
  scenario('greeting_ary', 'ary', [
    turn('salam labas?', {
      anyOf: [['salam', 'مرحبا', 'اهلا', 'labas']], required: ['?'], forbidden: [' mad'],
    }),
  ], ['multilingual', 'behavior']),
  scenario('free_carriers_ary_ar', 'ary', [
    turn('واش التوصيل داخل ف Free؟', {
      notIncluded: 'delivery_integrations_limit', includedFrom: 'delivery_integrations_limit',
    }),
  ], ['rights', 'multilingual', 'critical']),
  scenario('free_carriers_ary_latin', 'ary', [
    turn('wach synchro dyal transporteur kayna f Free?', {
      notIncluded: 'delivery_integrations_limit', includedFrom: 'delivery_integrations_limit',
    }),
  ], ['rights', 'multilingual']),
  scenario('price_pro_ar', 'ar', [
    turn('بشحال الثمن ديال Pro؟', { planCode: 'pro', amount: 'monthly' }),
  ], ['price', 'multilingual']),
  scenario('annual_followup_ar', 'ar', [
    turn('بشحال الثمن ديال Pro؟', { planCode: 'pro', amount: 'monthly' }),
    turn('و فالعام؟', { planCode: 'pro', amount: 'yearly', required: ['12'] }),
  ], ['price', 'followup', 'multilingual']),
  scenario('clarify_fr', 'fr', [
    turn('C’est quoi le mieux ?', {
      anyOf: [['commandes', 'volume', 'besoin', 'boutiques']], required: ['?'],
    }),
  ], ['behavior']),
  scenario('discount_fr', 'fr', [
    turn('Vous faites des remises ?', {
      anyOf: [['pas de remise', 'aucune remise', 'ne peux pas', 'pas possible']],
    }),
  ], ['behavior', 'critical']),
]

const FIXTURE_CATALOG = (() => {
  const plan = (code, name, rank, monthly, yearly, rights) => ([
    { code, name, rank, billing_period: 'monthly', duration_months: 1, amount_minor: monthly,
      monthly_equivalent_minor: monthly, currency: 'MAD', version: 1, requires_payment: monthly > 0,
      commitment_months: 0, ...rights },
    { code, name, rank, billing_period: 'yearly', duration_months: 12, amount_minor: yearly,
      monthly_equivalent_minor: yearly / 12, currency: 'MAD', version: 1, requires_payment: yearly > 0,
      commitment_months: yearly > 0 ? 12 : 0, ...rights },
  ])
  return [
    ...plan('free', 'Free', 0, 0, 0, {
      order_limit: 250, stores_limit: 1, ai_credits_monthly: 20, delivery_integrations_limit: 0,
      confirmation_agents_limit: 0, ads_automation_enabled: false, api_access_enabled: false,
    }),
    ...plan('pro', 'Pro', 1, 39000, 390000, {
      order_limit: 1000, stores_limit: 5, ai_credits_monthly: 500, delivery_integrations_limit: 1,
      confirmation_agents_limit: 3, ads_automation_enabled: true, api_access_enabled: false,
    }),
    ...plan('ultimate', 'Ultimate', 2, 69000, 690000, {
      order_limit: 999999, stores_limit: 999999, ai_credits_monthly: 999999,
      delivery_integrations_limit: 999999, confirmation_agents_limit: 999999,
      ads_automation_enabled: true, api_access_enabled: true,
    }),
  ]
})()

function validateOffline() {
  const ids = new Set()
  for (const item of SCENARIOS) {
    if (ids.has(item.id)) throw new Error('DUPLICATE_ID:' + item.id)
    ids.add(item.id)
    if (!['fr', 'ar', 'ary'].includes(item.locale)) throw new Error('LOCALE_INVALID:' + item.id)
    if (!Array.isArray(item.turns) || item.turns.length === 0) throw new Error('TURNS_EMPTY:' + item.id)
  }
  if (SCENARIOS.length !== 24) throw new Error('SCENARIO_COUNT:' + SCENARIOS.length)
  const resolved = resolveAll(FIXTURE_CATALOG)
  for (const item of resolved) {
    for (const expectation of item.turns) {
      if (expectation.required.length === 0 && expectation.anyOf.length === 0) {
        throw new Error('NO_EXPECTATION:' + item.id)
      }
    }
  }
  const tagged = (tag) => SCENARIOS.filter((item) => item.tags.includes(tag)).length
  const calls = resolved.reduce((sum, item) => sum + item.turns.length, 0)
  const coreCalls = SCENARIOS.filter((item) => CORE_IDS.includes(item.id))
    .reduce((sum, item) => sum + item.turns.length, 0)
  const summary = {
    scenarios: SCENARIOS.length,
    turns: calls,
    core_calls: coreCalls,
    max_calls: MAX_CALLS,
    locales: [...new Set(SCENARIOS.map((item) => item.locale))],
    followups: SCENARIOS.filter((item) => item.turns.length > 1).length,
    price: tagged('price'),
    rights: tagged('rights'),
    integrations: tagged('integrations'),
    multilingual: tagged('multilingual'),
    privacy: tagged('privacy'),
    behavior: tagged('behavior'),
    critical: tagged('critical'),
  }
  console.log(JSON.stringify(summary, null, 2))
  if (summary.followups < 3 || summary.price < 3 || summary.rights < 6
    || summary.multilingual < 4 || summary.privacy < 2 || summary.behavior < 3) {
    throw new Error('COVERAGE_INSUFFICIENT')
  }
  if (calls > MAX_CALLS) throw new Error('CALLS_OVER_CAP')
  console.log('VALIDATE=PASS (définitions uniquement — aucune preuve d’intelligence)')
}

async function checkKnowledge() {
  const assert = require('node:assert/strict')
  const modulePath = path.join(__dirname, '..', 'lib', 'marketing', 'assistant', 'knowledge-core.ts')
  const core = await import(pathToFileURL(modulePath).href)
  const input = {
    catalog: FIXTURE_CATALOG,
    features: [
      { title: 'Ventes & commandes', description: 'Centralise les commandes et leurs statuts.' },
      { title: 'Stock & inventaire', description: 'Suit les entrées, sorties et ajustements.' },
    ],
    modules: ['Ventes & commandes', 'Stock & inventaire'],
    integrations: [
      { name: 'YouCan', status: 'Disponible', kind: 'Intégration', description: 'Synchronise les commandes.' },
      { name: 'Rapid Delivery', status: 'Disponible', kind: 'Intégration', description: 'Crée les colis et suit les statuts.' },
      { name: 'Shopify', status: 'Bientôt', kind: 'À venir', description: 'Connexion native annoncée.' },
    ],
    faq: [{ question: 'Les transporteurs sont-ils inclus ?', answer: 'Le nombre dépend de l’offre.' }],
  }
  const snapshot = core.buildCommercialSnapshot(input)
  assert.equal(snapshot.planCount, 3)
  assert.match(snapshot.catalogVersion, /pro@1/)
  assert.ok(snapshot.snapshot.includes('aucune intégration livraison'), 'Free doit afficher zéro intégration livraison')
  assert.ok(snapshot.snapshot.includes('1 intégration livraison'), 'Pro doit afficher son quota livraison')
  assert.ok(snapshot.snapshot.includes('accès API : non'), 'Le droit API doit être rendu')
  assert.ok(snapshot.snapshot.includes('agents de confirmation : 3'), 'Le quota agents doit être rendu')
  assert.ok(/3[\s\u202f]900/.test(snapshot.snapshot), 'Le tarif annuel doit être rendu')
  assert.ok(snapshot.snapshot.includes('SNAPSHOT COMMERCIAL PUBLIC'))
  assert.ok(snapshot.snapshot.length < 12000, 'Instantané trop volumineux')
  const navigation = [
    { href: '/pricing', label: 'Voir les tarifs' },
    { href: '/signup', label: 'Créer un compte' },
  ]
  const promptAry = core.buildSystemPrompt({ ...snapshot, navigation }, 'ary')
  assert.ok(promptAry.includes('darija'))
  assert.ok(promptAry.includes('caractères arabes'))
  assert.ok(promptAry.includes('/pricing'))
  assert.ok(promptAry.includes('/signup'))
  assert.ok(core.buildSystemPrompt({ ...snapshot, navigation }, 'ar').includes('arabe standard'))
  const unavailable = core.buildCommercialSnapshot({ ...input, catalog: null })
  assert.ok(unavailable.snapshot.includes('Catalogue indisponible'))
  assert.ok(unavailable.snapshot.includes('ne cite aucun prix'))
  assert.ok(unavailable.snapshot.includes('La page /pricing reste accessible'))
  assert.equal(unavailable.planCount, 0)
  assert.equal(core.sanitizeReply('<b>Bonjour</b>\n\nTest'), 'Bonjour\n\nTest')
  assert.ok(core.sanitizeReply('a'.repeat(2000)).length <= 1400)
  console.log(JSON.stringify({ snapshot_chars: snapshot.snapshot.length, plans: snapshot.planCount,
    catalog: snapshot.catalogVersion }, null, 2))
  console.log('KNOWLEDGE=PASS (contenu statique — aucune réponse LLM)')
}

async function loadCatalog(base) {
  const response = await fetch(base + '/api/billing/catalog', { headers: { Accept: 'application/json' } })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !Array.isArray(payload?.prices) || payload.prices.length === 0) {
    throw new Error('CATALOG_UNAVAILABLE')
  }
  return payload.prices
}

function selectScenarios(mode) {
  return mode === '--core' ? SCENARIOS.filter((item) => CORE_IDS.includes(item.id)) : SCENARIOS
}

async function runLive(mode, base) {
  if (String(process.env.PUBLIC_AI_LIVE_CHECK || '') !== 'enabled') {
    throw new Error('PUBLIC_AI_LIVE_CHECK=enabled requis')
  }
  const host = new URL(base).hostname
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error('BASE_NON_ISOLÉE:' + host)
  const budget = Number(process.env.PUBLIC_AI_LIVE_CHECK_BUDGET_USD || 0)
  const selected = selectScenarios(mode)
  const plannedCalls = selected.reduce((sum, item) => sum + item.turns.length, 0)
  if (plannedCalls > MAX_CALLS) throw new Error('CALLS_OVER_CAP')
  const minimum = plannedCalls * ESTIMATE_USD_PER_CALL
  if (!(budget >= minimum) || budget > 0.05) {
    throw new Error('BUDGET_INVALIDE: requis entre ' + minimum.toFixed(4) + ' et 0.0500 USD')
  }

  const catalog = await loadCatalog(base)
  const resolved = resolveAll(catalog).filter((item) => selected.some((chosen) => chosen.id === item.id))
  const results = []
  let aborted = null
  let providerVerified = false

  for (const item of resolved) {
    const history = []
    for (const expectation of item.turns) {
      const started = Date.now()
      let response
      let payload = {}
      try {
        response = await fetch(base + '/api/public-assistant/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: base },
          body: JSON.stringify({ locale: item.locale, message: expectation.message, history }),
        })
        payload = await response.json().catch(() => ({}))
      } catch {
        results.push({ id: item.id, locale: item.locale, message: expectation.message, ok: false, error: 'NETWORK' })
        continue
      }
      const reply = String(payload?.reply || '')
      if (response.ok && (payload.live !== true || payload.provider !== 'openai')) {
        aborted = 'SYNTHETIC_REFUSED'
        results.push({ id: item.id, locale: item.locale, message: expectation.message, ok: false, error: aborted })
        break
      }
      if (response.ok && payload.live === true && payload.provider === 'openai') providerVerified = true
      const verdict = response.ok
        ? checkReply(reply, expectation)
        : { ok: false, error: payload.error || ('HTTP_' + response.status) }
      results.push({
        id: item.id,
        locale: item.locale,
        message: expectation.message,
        status: response.status,
        ms: Date.now() - started,
        ok: verdict.ok,
        missing_required: verdict.missingRequired || [],
        missing_any_of: verdict.missingGroups || [],
        forbidden_found: verdict.foundForbidden || [],
        error: verdict.error,
        reply: reply.slice(0, 600),
      })
      if (response.ok) {
        history.push({ role: 'user', content: expectation.message })
        history.push({ role: 'assistant', content: reply })
      }
    }
    if (aborted) break
  }

  const pass = results.filter((item) => item.ok).length
  const report = {
    mode,
    base,
    planned_calls: plannedCalls,
    executed_calls: results.length,
    pass,
    fail: results.length - pass,
    aborted,
    budget_usd: budget,
    estimated_cost_usd_max: (results.length * ESTIMATE_USD_PER_CALL).toFixed(4),
    provider_verified: providerVerified ? 'openai' : 'unverified',
    human_review_required: true,
    note: 'Les contrôles automatiques vérifient des faits présents ou absents, pas la qualité conversationnelle. Une lecture humaine FR/AR/darija reste obligatoire ; un PASS ne prouve pas l’intelligence réelle.',
    results,
  }
  const target = path.join(process.cwd(), 'public-ai-live-report.json')
  fs.writeFileSync(target, JSON.stringify(report, null, 2))
  console.log('LIVE ' + pass + '/' + results.length + (aborted ? ' ABORT=' + aborted : '') + ' — ' + target)
  console.log('LIVE_QUALITY=NEEDS_HUMAN_REVIEW — estimated_cost_usd_max=' + report.estimated_cost_usd_max)
  if (aborted || pass !== results.length) process.exitCode = 2
}

async function main() {
  const args = process.argv.slice(2)
  const mode = args.find((arg) => arg.startsWith('--')) || ''
  const base = args.find((arg) => !arg.startsWith('--')) || 'http://localhost:3000'
  if (!MODES.has(mode)) {
    console.error('Usage: --validate | --knowledge | --core | --all [http://localhost:3000]')
    process.exitCode = 1
    return
  }
  if (mode === '--validate') return validateOffline()
  if (mode === '--knowledge') return checkKnowledge()
  return runLive(mode, base)
}


function normalize(value) {
  return String(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[\u064b-\u0652\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim()
}

const monthly = (catalog) => catalog.filter((price) => price.billing_period === 'monthly')
const byCode = (catalog, code) => monthly(catalog).find((price) => price.code === code)
const included = (plan, field) => (typeof plan[field] === 'boolean' ? plan[field] : Number(plan[field]) > 0)
const cheapest = (catalog, predicate) => monthly(catalog).filter(predicate).sort((a, b) => a.amount_minor - b.amount_minor)[0]

function amountVariants(catalog, code, period) {
  const price = catalog.find((item) => item.code === code && item.billing_period === period)
    || catalog.find((item) => item.code === code)
  if (!price) throw new Error('PRICE_MISSING:' + code + ':' + period)
  const value = price.amount_minor / 100
  const grouped = String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return [String(value), value.toLocaleString('fr-FR'), value.toLocaleString('en-US'), grouped, String(Math.round(value))]
}

function quotaVariants(value) {
  return Number(value) >= 999999
    ? ['illimite', 'illimitee', 'illimitees', 'غير محدود', 'بلا حدود']
    : [String(value)]
}

const PLAN_ALIASES = {
  free: ['free', 'فري', 'مجاني'],
  pro: ['pro', 'برو'],
  ultimate: ['ultimate', 'ألتيميت', 'التميت'],
}

const NOT_INCLUDED = {
  delivery_integrations_limit: ['non incluse', 'non inclus', 'pas incluse', 'pas inclus', 'aucune integration livraison',
    'aucune integration', 'غير مشمولة', 'غير مشمول', 'ما فيهاش', 'ما كاينش'],
  confirmation_agents_limit: ['aucun agent', 'non inclus', 'pas inclus', 'aucune', 'لا يوجد', 'غير مشمول'],
  api_access_enabled: ['non', 'pas inclus', 'pas disponible', 'لا', 'غير مشمول'],
}

function resolveTurn(t, catalog) {
  const required = [...(t.required || [])]
  const groups = [...(t.anyOf || [])]
  const forbidden = [...(t.forbidden || [])]
  if (t.planCode) {
    const plan = byCode(catalog, t.planCode)
    if (!plan) throw new Error('PLAN_MISSING:' + t.planCode)
    groups.push(PLAN_ALIASES[t.planCode] || [plan.name])
    if (t.amount) groups.push(amountVariants(catalog, t.planCode, t.amount))
    if (t.quotaField) required.push(...quotaVariants(plan[t.quotaField]))
  }
  if (t.notIncluded) {
    const free = byCode(catalog, 'free')
    if (free) groups.push(PLAN_ALIASES.free || [free.name])
    groups.push(NOT_INCLUDED[t.notIncluded] || ['non inclus', 'pas inclus'])
  }
  if (t.includedFrom) {
    const plan = cheapest(catalog, (price) => included(price, t.includedFrom))
    if (!plan) throw new Error('NO_PLAN_INCLUDES:' + t.includedFrom)
    groups.push(PLAN_ALIASES[plan.code] || [plan.name])
  }
  if (t.recommend) {
    const plan = cheapest(catalog, (price) => price.order_limit >= t.recommend.orders && price.stores_limit >= t.recommend.stores)
    if (!plan) throw new Error('NO_PLAN_FOR_VOLUME')
    groups.push(PLAN_ALIASES[plan.code] || [plan.name])
    required.push('boutique')
    groups.push([String(t.recommend.orders), String(t.recommend.stores), 'deux'])
  }
  return { ...t, required, anyOf: groups, forbidden }
}

function resolveAll(catalog) {
  return SCENARIOS.map((item) => ({
    ...item,
    turns: item.turns.map((t) => resolveTurn(t, catalog)),
  }))
}

function checkReply(reply, expectations) {
  const text = normalize(reply)
  const missingRequired = expectations.required.filter((term) => !text.includes(normalize(term)))
  const missingGroups = expectations.anyOf.filter((group) => !group.some((term) => text.includes(normalize(term))))
  const foundForbidden = expectations.forbidden.filter((term) => text.includes(normalize(term)))
  return {
    ok: missingRequired.length === 0 && missingGroups.length === 0 && foundForbidden.length === 0,
    missingRequired,
    missingGroups,
    foundForbidden,
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1 })

