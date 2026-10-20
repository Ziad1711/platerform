#!/usr/bin/env node
// B13 - statistiques sur observations BRUTES (aucune mediane de p95).
// Usage : node stats_from_csv.mjs fichier1.csv [fichier2.csv ...]
// Sortie : JSON { files, samples, median, p95, min, max, mean }
import fs from 'node:fs'

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('P79_STATS_NO_INPUT')
  process.exit(2)
}

const values = []
const details = []
for (const f of files) {
  if (!fs.existsSync(f)) { console.error('P79_STATS_MISSING_FILE ' + f); process.exit(3) }
  // BOM UTF-8 eventuel (redirection PowerShell) retire avant parsing.
  const raw = fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '')
  const lines = raw.split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    // Le CSV de mesure contient aussi le bloc de preuve P79_SRV_PROOF : ignore.
    .filter((l) => !l.startsWith('marker,') && !l.startsWith('P79_SRV_PROOF,'))
  if (lines.length === 0) { console.error('P79_STATS_EMPTY ' + f); process.exit(4) }
  const header = lines[0].split(',').map((s) => s.trim().toLowerCase())
  if (header.length !== 2 || header[0] !== 'i' || header[1] !== 'ms') {
    console.error('P79_STATS_BAD_HEADER ' + f + ' -> ' + JSON.stringify(lines[0])); process.exit(5)
  }
  const seen = new Set()
  let n = 0
  for (const line of lines.slice(1)) {
    const cols = line.split(',')
    if (cols.length !== 2) { console.error('P79_STATS_BAD_COLUMNS ' + f + ' -> ' + line); process.exit(9) }
    const idx = Number(cols[0].trim())
    const v = Number(cols[1].trim())
    if (!Number.isInteger(idx) || idx < 1) { console.error('P79_STATS_BAD_INDEX ' + f + ' -> ' + line); process.exit(7) }
    if (seen.has(idx)) { console.error('P79_STATS_DUPLICATE_INDEX ' + f + ' -> ' + idx); process.exit(10) }
    if (!Number.isFinite(v) || v < 0) { console.error('P79_STATS_BAD_VALUE ' + f + ' -> ' + line); process.exit(6) }
    seen.add(idx); values.push(v); n++
  }
  // Indices strictement consecutifs 1..n, sans trou.
  for (let k = 1; k <= n; k++) {
    if (!seen.has(k)) { console.error('P79_STATS_INDEX_GAP ' + f + ' -> manque ' + k); process.exit(11) }
  }
  details.push({ file: f, samples: n })
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null
  const rank = (sorted.length - 1) * p
  const lo = Math.floor(rank), hi = Math.ceil(rank)
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo)
}

const sorted = [...values].sort((a, b) => a - b)
if (sorted.length === 0) {
  console.error('P79_STATS_NO_SAMPLES -> ' + files.join(', '))
  process.exit(8)
}
const sum = sorted.reduce((a, b) => a + b, 0)
const result = {
  files: details,
  samples: sorted.length,
  mean: Number((sum / sorted.length).toFixed(3)),
  median: Number(percentile(sorted, 0.5).toFixed(3)),
  p95: Number(percentile(sorted, 0.95).toFixed(3)),
  min: Number(sorted[0].toFixed(3)),
  max: Number(sorted[sorted.length - 1].toFixed(3)),
  method: 'percentile_interpole_sur_observations_brutes',
}
console.log(JSON.stringify(result))
