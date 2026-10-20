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
  const raw = fs.readFileSync(f, 'utf8').trim()
  if (raw === '') { console.error('P79_STATS_EMPTY ' + f); process.exit(4) }
  const lines = raw.split(/\r?\n/)
  const header = lines[0].split(',').map((s) => s.trim().toLowerCase())
  const iIdx = header.indexOf('i')
  const msIdx = header.indexOf('ms')
  if (msIdx === -1) { console.error('P79_STATS_BAD_HEADER ' + f + ' -> ' + lines[0]); process.exit(5) }
  let n = 0
  for (const line of lines.slice(1)) {
    const cols = line.split(',')
    const v = Number(cols[msIdx])
    if (!Number.isFinite(v) || v < 0) { console.error('P79_STATS_BAD_VALUE ' + f + ' -> ' + line); process.exit(6) }
    if (iIdx !== -1 && cols[iIdx] === undefined) { console.error('P79_STATS_BAD_INDEX ' + f); process.exit(7) }
    values.push(v); n++
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
