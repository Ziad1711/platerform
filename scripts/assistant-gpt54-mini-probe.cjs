/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Sonde GPT-5.4 mini — script ISOLÉ, hors application.
 * `--dry-run` par défaut (aucun réseau), `--live` requis pour un appel réel,
 * `--self-test` pour vérifier les garde-fous. La clé n'est jamais affichée.
 * Limites : 20 appels, 400 tokens de sortie, 0,02 $ par échange.
 */
const HARD_MAX_CALLS = 20
const HARD_MAX_USD_PER_EXCHANGE = 0.02
const MAX_OUTPUT_TOKENS = 400
const MODEL = 'gpt-5.4-mini'
const PRICE_INPUT_PER_MILLION = 0.75
const PRICE_OUTPUT_PER_MILLION = 4.5
const ENDPOINT = 'https://api.openai.com/v1/chat/completions'

const DRY_RUN = !process.argv.includes('--live')
const SELF_TEST = process.argv.includes('--self-test')
/** Vérifie le chargement de la clé SANS aucun appel réseau. */
const CHECK_KEY = process.argv.includes('--check-key')

/** Valeur numérique d'une option `--nom valeur`, bornée par un plafond absolu. */
function readOption(name, fallback, hardMax) {
  const index = process.argv.indexOf(name)
  if (index === -1) return fallback
  const raw = process.argv[index + 1]
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) throw new Error(`OPTION_INVALIDE:${name}`)
  if (value > hardMax) throw new Error(`OPTION_HORS_PLAFOND:${name}`)
  return value
}

// Plafonds effectifs : jamais supérieurs aux limites absolues (20 appels, 0,02 $/échange).
const MAX_CALLS = Math.floor(readOption('--calls', HARD_MAX_CALLS, HARD_MAX_CALLS))
const MAX_USD_PER_EXCHANGE = HARD_MAX_USD_PER_EXCHANGE
const MAX_CUMULATIVE_USD = readOption('--max-usd', MAX_CALLS * MAX_USD_PER_EXCHANGE, MAX_CALLS * MAX_USD_PER_EXCHANGE)


function estimateCostUsd(inputTokens, outputTokens) {
  const value =
    (inputTokens / 1_000_000) * PRICE_INPUT_PER_MILLION +
    (outputTokens / 1_000_000) * PRICE_OUTPUT_PER_MILLION
  return Number(value.toFixed(6))
}

function maxInputTokensForBudget(maxOutputTokens = MAX_OUTPUT_TOKENS) {
  const outputCost = (maxOutputTokens / 1_000_000) * PRICE_OUTPUT_PER_MILLION
  const remaining = MAX_USD_PER_EXCHANGE - outputCost
  if (remaining <= 0) return 0
  return Math.floor((remaining / PRICE_INPUT_PER_MILLION) * 1_000_000)
}

function buildRequestBody(prompt) {
  return {
    model: MODEL,
    reasoning_effort: 'none',
    max_completion_tokens: MAX_OUTPUT_TOKENS,
    messages: [
      { role: 'system', content: 'Réponds uniquement par un JSON {"ok":true,"n":<entier>}.' },
      { role: 'user', content: prompt },
    ],
  }
}

function assertBudgetAllowed(callIndex, inputTokens, outputTokens, cumulativeUsd) {
  if (callIndex >= MAX_CALLS) throw new Error('BUDGET_MAX_CALLS_REACHED')
  if (outputTokens > MAX_OUTPUT_TOKENS) throw new Error('BUDGET_MAX_OUTPUT_TOKENS')
  const cost = estimateCostUsd(inputTokens, outputTokens)
  if (cost > MAX_USD_PER_EXCHANGE) throw new Error('BUDGET_MAX_USD_PER_EXCHANGE')
  if (cumulativeUsd + cost > MAX_CUMULATIVE_USD) throw new Error('BUDGET_CUMULATIVE_REACHED')
  return cost
}

function selfTest() {
  const results = []
  const check = (name, fn) => {
    try {
      fn()
      results.push([name, 'PASS', ''])
    } catch (error) {
      results.push([name, 'FAIL', error instanceof Error ? error.message : 'erreur'])
    }
  }
  const rejects = (fn, code) => {
    try {
      fn()
      return false
    } catch (error) {
      return error instanceof Error && error.message === code
    }
  }

  check('G01 dry-run par défaut', () => {
    if (!DRY_RUN) throw new Error('dry-run attendu sans --live')
  })
  check('G02 requête conforme (ni temperature ni max_tokens)', () => {
    const body = buildRequestBody('test')
    if (body.model !== MODEL) throw new Error('modèle')
    if (body.reasoning_effort !== 'none') throw new Error('reasoning_effort')
    if (body.max_completion_tokens !== MAX_OUTPUT_TOKENS) throw new Error('max_completion_tokens')
    if ('temperature' in body || 'max_tokens' in body) throw new Error('paramètre interdit')
  })
  check('G03 coût calculé depuis les tokens', () => {
    const cost = estimateCostUsd(1_000_000, 1_000_000)
    if (Math.abs(cost - (PRICE_INPUT_PER_MILLION + PRICE_OUTPUT_PER_MILLION)) > 1e-6) throw new Error('coût')
    if (estimateCostUsd(0, 0) !== 0) throw new Error('zéro')
  })
  check('G04 budget entrée compatible avec 0,02 $', () => {
    const maxInput = maxInputTokensForBudget()
    if (maxInput <= 0) throw new Error('budget nul')
    if (estimateCostUsd(maxInput, MAX_OUTPUT_TOKENS) > MAX_USD_PER_EXCHANGE) throw new Error('dépassement')
  })
  check('G05 plafond 20 appels', () => {
    if (!rejects(() => assertBudgetAllowed(MAX_CALLS, 100, 100, 0), 'BUDGET_MAX_CALLS_REACHED')) {
      throw new Error('plafond appels non appliqué')
    }
  })
  check('G06 sortie > 400 tokens refusée', () => {
    if (!rejects(() => assertBudgetAllowed(0, 100, MAX_OUTPUT_TOKENS + 1, 0), 'BUDGET_MAX_OUTPUT_TOKENS')) {
      throw new Error('plafond sortie non appliqué')
    }
  })
  check('G07 échange > 0,02 $ refusé', () => {
    if (!rejects(() => assertBudgetAllowed(0, maxInputTokensForBudget() + 10_000, MAX_OUTPUT_TOKENS, 0), 'BUDGET_MAX_USD_PER_EXCHANGE')) {
      throw new Error('plafond par échange non appliqué')
    }
  })
  check('G08 budget cumulé refusé', () => {
    if (!rejects(() => assertBudgetAllowed(0, 100, 100, MAX_CUMULATIVE_USD), 'BUDGET_CUMULATIVE_REACHED')) {
      throw new Error('plafond cumulé non appliqué')
    }
  })
  check('G10 --calls borné par le plafond absolu', () => {
    if (HARD_MAX_CALLS !== 20) throw new Error('plafond absolu modifié')
    if (MAX_CALLS > HARD_MAX_CALLS) throw new Error('plafond effectif incohérent')
    if (readOption('--absent', 7, 20) !== 7) throw new Error('valeur par défaut incorrecte')
  })
  check('G11 plafond par échange inchangé', () => {
    if (MAX_USD_PER_EXCHANGE !== HARD_MAX_USD_PER_EXCHANGE) throw new Error('plafond par échange affaibli')
  })
  check('G12 budget cumulé jamais supérieur à appels × 0,02 $', () => {
    if (MAX_CUMULATIVE_USD > MAX_CALLS * HARD_MAX_USD_PER_EXCHANGE + 1e-9) throw new Error('budget cumulé trop élevé')
  })
  check('G13 placeholder rejeté (cause UND_ERR_INVALID_ARG)', () => {
    if (sanitizeApiKey('<nouvelle clé dédiée>').issue !== 'placeholder') throw new Error('placeholder accepté')
  })
  check('G14 clé non-ASCII ou avec espace rejetée', () => {
    if (sanitizeApiKey('sk-abcé123').issue !== 'non_ascii') throw new Error('non_ascii accepté')
    if (sanitizeApiKey('sk-abc 123').issue !== 'espace_interne') throw new Error('espace accepté')
  })
  check('G15 clé CRLF normalisée, préfixe vérifié', () => {
    const sanitized = sanitizeApiKey('  sk-abc123\r\n')
    if (sanitized.key !== 'sk-abc123') throw new Error('normalisation')
    if (sanitizeApiKey('abc123').issue !== 'prefixe') throw new Error('préfixe non vérifié')
  })
  check('G16 empreinte non réversible et sans valeur', () => {
    const fingerprint = keyFingerprint('sk-abc123')
    if (!/^[0-9a-f]{12}$/.test(fingerprint)) throw new Error('empreinte')
    if (fingerprint.includes('sk-')) throw new Error('valeur fuitée')
  })
  check('G09 aucun appel réseau hors --live', () => {
    if (!DRY_RUN) throw new Error('self-test doit rester en dry-run')
  })

  for (const [name, status, detail] of results) console.log(`${status}  ${name}${detail ? `  ${detail}` : ''}`)
  const failed = results.filter(([, status]) => status !== 'PASS')
  console.log(`\nTotal sonde : ${results.length - failed.length}/${results.length} PASS`)
  return failed.length === 0
}

/**
 * En-têtes HTTP : Undici lève `UND_ERR_INVALID_ARG` dès qu'une valeur contient
 * un espace interne, un caractère non-ASCII ou un saut de ligne. Une clé
 * recopiée (placeholder `<...>`, `é`, retour chariot) produit exactement cette
 * erreur, sans aucun appel facturable. On normalise puis on refuse explicitement.
 */
function sanitizeApiKey(raw) {
  if (typeof raw !== 'string') return { key: null, issue: 'absent' }

  const key = raw.replace(/[\r\n\t]/g, '').trim()
  if (!key) return { key: null, issue: 'vide' }
  if (/^<.*>$/.test(key)) return { key: null, issue: 'placeholder' }
  // Un espace (0x20) sort aussi de la plage imprimable : tester l'espace d'abord
  // garantit un diagnostic exact (`espace_interne` plutôt que `non_ascii`).
  if (/\s/.test(key)) return { key: null, issue: 'espace_interne' }
  if (/[^\x21-\x7E]/.test(key)) return { key: null, issue: 'non_ascii' }
  if (!key.startsWith('sk-')) return { key: null, issue: 'prefixe' }
  return { key, issue: null }
}

/** Empreinte non réversible pour vérifier qu'une clé est chargée sans l'afficher. */
function keyFingerprint(key) {
  if (!key) return null
  return require('node:crypto').createHash('sha256').update(key).digest('hex').slice(0, 12)
}

/** Clé lue depuis l'environnement ou depuis un fichier HORS dépôt (`--key-file`). */
function resolveApiKey() {
  const fromEnv = sanitizeApiKey(process.env.OPENAI_API_KEY)
  if (fromEnv.key) return { key: fromEnv.key, source: 'env', issue: null }

  const index = process.argv.indexOf('--key-file')
  if (index !== -1) {
    const filePath = process.argv[index + 1]
    if (!filePath) return { key: null, source: 'file', issue: 'chemin_absent' }
    const resolved = require('node:path').resolve(filePath)
    const repoRoot = require('node:path').resolve(__dirname, '..')
    if (resolved.startsWith(repoRoot)) {
      // Une clé ne doit jamais résider dans le dépôt (risque de commit).
      return { key: null, source: 'file', issue: 'fichier_dans_le_depot' }
    }
    try {
      const sanitized = sanitizeApiKey(require('node:fs').readFileSync(resolved, 'utf8'))
      return { key: sanitized.key, source: 'file', issue: sanitized.issue }
    } catch {
      return { key: null, source: 'file', issue: 'fichier_illisible' }
    }
  }

  return { key: null, source: 'env', issue: fromEnv.issue ?? 'absent' }
}

function describeFetchError(error) {
  const cause = error && typeof error === 'object' ? error.cause : undefined
  return {
    message: error instanceof Error ? error.message : 'erreur inconnue',
    causeCode: cause && typeof cause === 'object' ? cause.code ?? null : null,
    causeErrno: cause && typeof cause === 'object' ? cause.errno ?? null : null,
    causeHost: cause && typeof cause === 'object' ? cause.hostname ?? null : null,
    causePort: cause && typeof cause === 'object' ? cause.port ?? null : null,
  }
}

async function runLive() {
  const resolved = resolveApiKey()
  if (!resolved.key) {
    // Aucune valeur de clé n'est journalisée : seulement la cause.
    throw new Error(`OPENAI_API_KEY_INVALID:${resolved.source}:${resolved.issue}`)
  }
  const apiKey = resolved.key
  console.log(`INFO  clé chargée depuis ${resolved.source} (empreinte ${keyFingerprint(apiKey)})`)

  let cumulativeUsd = 0
  for (let index = 0; index < MAX_CALLS; index += 1) {
    const startedAt = Date.now()
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(buildRequestBody('Réponds au format demandé.')),
    }).catch((error) => {
      // Remonte la cause réseau (code DNS/TCP/TLS) sans réessayer ni fuiter de secret.
      console.log(`FAIL  appel ${index + 1} : ${JSON.stringify(describeFetchError(error))}`)
      process.exitCode = 1
      return null
    })
    if (!response) return
    if (!response.ok) {
      console.log(`FAIL  appel ${index + 1} : HTTP ${response.status}`)
      process.exitCode = 1
      return
    }
    const payload = await response.json()
    const inputTokens = Number(payload?.usage?.prompt_tokens || 0)
    const outputTokens = Number(payload?.usage?.completion_tokens || 0)
    const cost = assertBudgetAllowed(index, inputTokens, outputTokens, cumulativeUsd)
    cumulativeUsd = Number((cumulativeUsd + cost).toFixed(6))
    const latencyMs = Date.now() - startedAt
    console.log(`PASS  appel ${index + 1} : in=${inputTokens} out=${outputTokens} coût=${cost} cumul=${cumulativeUsd} latence=${latencyMs}ms`)
    if (cumulativeUsd >= MAX_CALLS * MAX_USD_PER_EXCHANGE) break
  }
}

if (SELF_TEST) {
  process.exitCode = selfTest() ? 0 : 1
} else if (CHECK_KEY) {
  // Diagnostic de chargement : ne révèle jamais la valeur de la clé.
  const resolved = resolveApiKey()
  console.log(JSON.stringify({
    mode: 'check-key',
    source: resolved.source,
    loaded: Boolean(resolved.key),
    fingerprint: keyFingerprint(resolved.key),
    issue: resolved.issue,
  }))
  process.exitCode = resolved.key ? 0 : 2
} else if (DRY_RUN) {
  console.log(JSON.stringify({ mode: 'dry-run', model: MODEL, maxCalls: MAX_CALLS, maxOutputTokens: MAX_OUTPUT_TOKENS, maxUsdPerExchange: MAX_USD_PER_EXCHANGE, maxInputTokens: maxInputTokensForBudget(), body: buildRequestBody('exemple') }, null, 2))
} else {
  runLive().catch((error) => {
    console.error('PROBE FAILED', JSON.stringify(describeFetchError(error)))
    process.exitCode = 1
  })
}

