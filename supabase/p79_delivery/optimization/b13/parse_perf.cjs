// Analyse des mesures B13 P7.10 (prefixe configurable via PERF_PREFIX).
const fs = require('node:fs')
const path = require('node:path')
const dir = path.join(__dirname, 'out')
const prefix = process.env.PERF_PREFIX || 'perf'

function quantile(values, q) {
  const a = [...values].sort((x, y) => x - y)
  if (!a.length) return null
  const pos = (a.length - 1) * q
  const lo = Math.floor(pos), hi = Math.ceil(pos)
  return a[lo] + (a[hi] - a[lo]) * (pos - lo)
}

function parseLog(file) {
  const out = {}
  let section = null, resultSeen = false
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trimEnd()
    const sec = line.match(/^SECTION:([a-z0-9_]+)/i)
    if (sec) { section = sec[1]; resultSeen = false; out[section] = out[section] || []; continue }
    if (/^\s*\(\d+ rows?\)\s*$/.test(line)) { resultSeen = true; continue }
    const t = line.match(/^Time:\s+([0-9]+(?:[.,][0-9]+)?)\s+ms/)
    if (t && section && resultSeen) {
      out[section].push(Number(t[1].replace(',', '.')))
      resultSeen = false
    }
  }
  return out
}

const fileRe = new RegExp('^' + prefix + '-(\\d+)-([A-Z0-9]+)\\.log$')
const files = fs.readdirSync(dir).filter((f) => fileRe.test(f))
const runs = files.map((f) => {
  const m = f.match(fileRe)
  return { file: f, round: Number(m[1]), variant: m[2], sections: parseLog(path.join(dir, f)) }
})

const sections = ['update_item_price', 'import_orders_600']
const variants = [...new Set(runs.map((r) => r.variant))].sort()
const result = { prefix, runs: runs.length, sections: {} }

for (const s of sections) {
  result.sections[s] = {}
  for (const v of variants) {
    const own = runs.filter((r) => r.variant === v)
    const pooled = own.flatMap((r) => r.sections[s] || [])
    const perRound = own.map((r) => ({ round: r.round, n: (r.sections[s] || []).length, median: quantile(r.sections[s] || [], 0.5) }))
    const sorted = [...pooled].sort((x, y) => x - y)
    result.sections[s][v] = {
      n: pooled.length,
      median: quantile(pooled, 0.5),
      p95: quantile(pooled, 0.95),
      p95Nearest: sorted[Math.ceil(sorted.length * 0.95) - 1] ?? null,
      max: pooled.length ? sorted[sorted.length - 1] : null,
      over140: pooled.filter((x) => x > 140).length,
      over250: pooled.filter((x) => x > 250).length,
      perRound,
    }
  }
  const base = result.sections[s].A || {}
  const c0 = result.sections[s].C0 || {}
  const cf = result.sections[s].CF || {}
  const pct = (x, y) => (x != null && y) ? Number((((x - y) / y) * 100).toFixed(2)) : null
  result.sections[s].delta = {
    C0_vs_A_median_pct: pct(c0.median, base.median),
    C0_vs_A_p95_pct: pct(c0.p95, base.p95),
    CF_vs_A_median_pct: pct(cf.median, base.median),
    CF_vs_A_p95_pct: pct(cf.p95, base.p95),
    CF_vs_C0_median_pct: pct(cf.median, c0.median),
    CF_vs_C0_p95_pct: pct(cf.p95, c0.p95),
  }
}

fs.writeFileSync(path.join(dir, 'perf-summary-' + prefix + '.json'), JSON.stringify(result, null, 2))
const lines = []
for (const s of sections) {
  if (!variants.some((v) => (result.sections[s][v] || {}).n)) continue
  lines.push('=== ' + s)
  for (const v of variants) {
    const r = result.sections[s][v]
    lines.push(v.padEnd(3) + ' n=' + String(r.n).padStart(4) + ' median=' + (r.median?.toFixed(3)) + ' p95=' + (r.p95?.toFixed(3)) + ' p95nn=' + r.p95Nearest + ' max=' + (r.max?.toFixed(3)) + ' >140=' + r.over140 + ' >250=' + r.over250)
    lines.push('    per-round: ' + r.perRound.map((x) => 'r' + x.round + '=' + (x.median?.toFixed(3)) + '(n=' + x.n + ')').join(' '))
  }
  lines.push('delta ' + JSON.stringify(result.sections[s].delta))
  lines.push('')
}
fs.writeFileSync(path.join(dir, 'perf-summary-' + prefix + '.txt'), lines.join('\n'))
