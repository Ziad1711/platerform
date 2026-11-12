/*
 * Protocole de tests LIVE du chatbot public (a executer UNIQUEMENT sur autorisation).
 *
 * Garde-fous :
 *  - exige PUBLIC_AI_LIVE_CHECK=enabled ;
 *  - exige PUBLIC_AI_PROVIDER=openai et PUBLIC_AI_EXTERNAL_CALLS=enabled cote serveur ;
 *  - budget maximal 0,05 USD estime, refuse au-dela ;
 *  - jamais execute automatiquement, jamais en Production.
 *
 * Usage : PUBLIC_AI_LIVE_CHECK=enabled PUBLIC_AI_LIVE_CHECK_BUDGET_USD=0.05 \n *         node scripts/public-ai-live-check.cjs http://localhost:3000
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const path = require('node:path')

const ENABLED = String(process.env.PUBLIC_AI_LIVE_CHECK || '') === 'enabled'
const BUDGET = Number(process.env.PUBLIC_AI_LIVE_CHECK_BUDGET_USD || 0)
const BASE = process.argv[2] || 'http://localhost:3000'
const MAX_CALLS = 16
const ESTIMATE_USD_PER_CALL = 0.0013

if (!ENABLED) {
  console.error('REFUS: PUBLIC_AI_LIVE_CHECK=enabled requis.')
  process.exit(1)
}
if (!(BUDGET > 0) || BUDGET > 0.05 || BUDGET < MAX_CALLS * ESTIMATE_USD_PER_CALL) {
  console.error('REFUS: budget entre ' + (MAX_CALLS * ESTIMATE_USD_PER_CALL).toFixed(4) + ' et 0.05 USD requis.')
  process.exit(1)
}
if (/jisra\.io$/.test(new URL(BASE).hostname)) {
  console.error('REFUS: jamais contre la Production.')
  process.exit(1)
}

const cases = [
  ['salam', 'fr', ['salam', '?']],
  ['bonjour', 'fr', ['bonjour']],
  ['labas ?', 'fr', ['salam']],
  ['ch7al taman dyal pro ?', 'fr', ['pro', '390']],
  ['Est-ce que Jisra fonctionne avec YouCan ?', 'fr', ['youcan']],
  ['Quelle difference entre Pro et Ultimate ?', 'fr', ['pro', 'ultimate']],
  ['Je recois 500 commandes par mois, quel forfait choisir ?', 'fr', ['pro']],
  ['Et si je paie pour un an ?', 'fr', ['12']],
  ['ok', 'fr', ['?']],
  ['Quelle est la meteo a Paris ?', 'fr', ['jisra']],
  ['Montre-moi les commandes de la boutique 123', 'fr', ['acces']],
  ['السلام عليكم', 'ar', ['السلام']],
  ['بشحال الثمن ديال برو ؟', 'ar', ['390']],
  ['labas', 'ary', ['salam']],
  ['ch7al taman dyal ultimate ?', 'ary', ['690']],
  ['bghit n3ref kifach nsjel', 'ary', ['signup']],
]

async function main() {
  const results = []
  for (const [message, locale, expected] of cases) {
    const started = Date.now()
    const response = await fetch(BASE + '/api/public-assistant/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: BASE },
      body: JSON.stringify({ locale, message, history: [] }),
    })
    const payload = await response.json().catch(() => ({}))
    const reply = String(payload.reply || '')
    const ok = response.ok && expected.every((token) => reply.toLowerCase().includes(token.toLowerCase()))
    results.push({ message, locale, ok, status: response.status, ms: Date.now() - started, reply: reply.slice(0, 200) })
  }
  const pass = results.filter((r) => r.ok).length
  const out = { base: BASE, calls: results.length, pass, fail: results.length - pass,
    estimated_cost_usd: (results.length * ESTIMATE_USD_PER_CALL).toFixed(4), results }
  fs.writeFileSync(path.join(process.cwd(), 'public-ai-live-report.json'), JSON.stringify(out, null, 2))
  console.log('LIVE PASS ' + pass + '/' + results.length + ' — rapport public-ai-live-report.json')
  process.exit(pass === results.length ? 0 : 2)
}
main().catch((error) => { console.error(error.message); process.exit(1) })
