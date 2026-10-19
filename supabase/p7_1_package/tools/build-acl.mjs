import fs from 'node:fs'

const snapshot = fs.readFileSync(new URL('../.work/snapshot.sql', import.meta.url), 'utf8')
const re = /^-- @@FUNCTION [0-9a-f]{32} (.+)$/gm
const lines = []
let match
let count = 0

while ((match = re.exec(snapshot)) !== null) {
  const signature = match[1].replace(/\r$/, '')
  count += 1
  lines.push(`revoke all on function public.${signature} from public, anon, authenticated;`)
  lines.push(`grant execute on function public.${signature} to service_role;`)
  if (signature.startsWith('rpc_dashboard_kpi_reader(')) {
    lines.push(`grant execute on function public.${signature} to authenticated;`)
  }
}

if (count !== 23) {
  throw new Error(`expected 23 functions, got ${count}`)
}

lines.push('')
lines.push('reset check_function_bodies;')
lines.push('')
lines.push('-- FIN P7.1 / 10 — aucun trigger, aucun job, aucun webhook créé.')
lines.push('')

fs.writeFileSync(new URL('../.work/acl.sql', import.meta.url), lines.join('\n'))
