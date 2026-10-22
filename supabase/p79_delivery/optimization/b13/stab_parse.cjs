const fs = require('node:fs')
const path = require('node:path')
const dir = path.join(__dirname, 'out')
const q = (a, p) => { const s=[...a].sort((x,y)=>x-y); if(!s.length) return null; const i=(s.length-1)*p, lo=Math.floor(i), hi=Math.ceil(i); return s[lo]+(s[hi]-s[lo])*(i-lo) }
const rows = []
for (const f of fs.readdirSync(dir).filter((x) => /^stab-\d-[A-Z0-9]+\.log$/.test(x)).sort()) {
  const txt = fs.readFileSync(path.join(dir, f), 'utf8')
  const [, round, variant] = f.match(/^stab-(\d)-([A-Z0-9]+)\.log$/)
  let client = [], section = null, seen = false, server = null
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.trimEnd()
    const sec = line.match(/^SECTION:([a-z0-9_]+)/i)
    if (sec) { section = sec[1]; seen = false; continue }
    if (/^\s*\(\d+ rows?\)\s*$/.test(line) || /^(UPDATE|DELETE|INSERT \d+ \d+|SELECT) \d+$/.test(line.trim())) { seen = true; continue }
    const t = line.match(/^Time:\s+([0-9]+(?:[.,][0-9]+)?)\s+ms/)
    if (t && section === 'client_item_update' && seen) { client.push(Number(t[1].replace(',', '.'))); seen = false; continue }
    if (section === 'server_series' && /^[0-9]+([.,][0-9]+)?(,[0-9]+([.,][0-9]+)?)+$/.test(line)) {
      server = line.split(',').map((x) => Number(x.replace(',', '.')))
    }
  }
  rows.push({ round: Number(round), variant, client, server: server || [] })
}
const out = { blocks: rows.length, perVariant: {} }
for (const v of [...new Set(rows.map((r) => r.variant))].sort()) {
  const own = rows.filter((r) => r.variant === v)
  const client = own.flatMap((r) => r.client)
  const server = own.flatMap((r) => r.server)
  out.perVariant[v] = {
    client: { n: client.length, median: q(client,0.5), p95: q(client,0.95), max: client.length?Math.max(...client):null, over140: client.filter(x=>x>140).length },
    server: { n: server.length, median: q(server,0.5), p95: q(server,0.95), max: server.length?Math.max(...server):null },
    blocks: own.map((r) => ({ round: r.round, clientMedian: q(r.client,0.5), clientP95: q(r.client,0.95), serverMedian: q(r.server,0.5), serverP95: q(r.server,0.95) })),
  }
}
const A = rows.filter((r) => r.variant === 'A').sort((a,b)=>a.round-b.round)
let stability = null
if (A.length >= 2) {
  const m1 = q(A[0].client,0.5), m2 = q(A[1].client,0.5)
  const p1 = q(A[0].client,0.95), p2 = q(A[1].client,0.95)
  stability = {
    clientMedianDeltaPct: Number((Math.abs(m1-m2)/Math.min(m1,m2)*100).toFixed(2)),
    clientP95DeltaPct: Number((Math.abs(p1-p2)/Math.min(p1,p2)*100).toFixed(2)),
    medianStable: Math.abs(m1-m2)/Math.min(m1,m2) <= 0.10,
    p95Stable: Math.abs(p1-p2)/Math.min(p1,p2) <= 0.25,
  }
}
out.aStability = stability
fs.writeFileSync(path.join(dir,'stab-summary.json'), JSON.stringify(out,null,2))
const L=[]
for (const v of Object.keys(out.perVariant)) {
  const r = out.perVariant[v]
  L.push(`${v} client n=${r.client.n} med=${r.client.median?.toFixed(2)} p95=${r.client.p95?.toFixed(2)} max=${r.client.max?.toFixed(1)} >140=${r.client.over140} | server med=${r.server.median?.toFixed(3)} p95=${r.server.p95?.toFixed(3)} max=${r.server.max?.toFixed(3)}`)
  L.push('   blocks: ' + r.blocks.map(b=>`r${b.round} cMed=${b.clientMedian?.toFixed(2)} cP95=${b.clientP95?.toFixed(2)} sMed=${b.serverMedian?.toFixed(3)}`).join(' | '))
}
L.push('A stability: ' + JSON.stringify(stability))
fs.writeFileSync(path.join(dir,'stab-summary.txt'), L.join('\n'))
