const fs = require('node:fs')
const path = require('node:path')
const dir = path.join(__dirname, 'out')
function parseLog(file) {
  const out = {}; let section = null, seen = false
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trimEnd()
    const sec = line.match(/^SECTION:([a-z0-9_]+)/i)
    if (sec) { section = sec[1]; seen = false; out[section] = out[section] || []; continue }
    if (/^\s*\(\d+ rows?\)\s*$/.test(line)) { seen = true; continue }
    const t = line.match(/^Time:\s+([0-9]+(?:[.,][0-9]+)?)\s+ms/)
    if (t && section && seen) { out[section].push(Number(t[1].replace(',', '.'))); seen = false }
  }
  return out
}
const lines = []
for (const f of fs.readdirSync(dir).filter((x) => /^tail-\d-[A-Z0-9]+\.log$/.test(x)).sort()) {
  const data = parseLog(path.join(dir, f)).update_item_price || []
  const spikes = data.map((v, i) => [i, v]).filter(([, v]) => v > 140)
  const first50 = data.slice(0, 50); const rest = data.slice(50)
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
  lines.push(f + ' n=' + data.length +
    ' med_all=' + med(data).toFixed(3) +
    ' med_first50=' + med(first50).toFixed(3) +
    ' med_rest=' + med(rest).toFixed(3) +
    ' spikes=' + spikes.length +
    ' spike_idx=' + spikes.slice(0, 12).map(([i]) => i).join(','))
}
fs.writeFileSync(path.join(dir, 'tail-positions.txt'), lines.join('\n'))
