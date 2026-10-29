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
  check('G09 aucun appel réseau hors --live', () => {
    if (!DRY_RUN) throw new Error('self-test doit rester en dry-run')
  })

  for (const [name, status, detail] of results) console.log(`${status}  ${name}${detail ? `  ${detail}` : ''}`)
  const failed = results.filter(([, status]) => status !== 'PASS')
  console.log(`\nTotal sonde : ${results.length - failed.length}/${results.length} PASS`)
  return failed.length === 0
}

/** Décrit une erreur réseau sans exposer la clé ni le corps de réponse. */
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
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY absente')

  let cumulativeUsd = 0
  for (let index = 0; index < MAX_CALLS; index += 1) {
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
    console.log(`PASS  appel ${index + 1} : in=${inputTokens} out=${outputTokens} coût=${cost} cumul=${cumulativeUsd}`)
    if (cumulativeUsd >= MAX_CALLS * MAX_USD_PER_EXCHANGE) break
  }
}

if (SELF_TEST) {
  process.exitCode = selfTest() ? 0 : 1
} else if (DRY_RUN) {
  console.log(JSON.stringify({ mode: 'dry-run', model: MODEL, maxCalls: MAX_CALLS, maxOutputTokens: MAX_OUTPUT_TOKENS, maxUsdPerExchange: MAX_USD_PER_EXCHANGE, maxInputTokens: maxInputTokensForBudget(), body: buildRequestBody('exemple') }, null, 2))
} else {
  runLive().catch((error) => {
    console.error('PROBE FAILED', JSON.stringify(describeFetchError(error)))
    process.exitCode = 1
  })
}

