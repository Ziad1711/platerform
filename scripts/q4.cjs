/* Qualification locale uniquement. Aucun secret ni environnement Production hérité. */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const ROOT = path.resolve(__dirname, '..')
const ORIGIN = 'https://supabase-qualif.jisra.io:8443'

if (process.env.JISRA_Q4_PRELOAD === '1') {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== ORIGIN || process.env.JISRA_QUALIFICATION !== '1') {
    throw new Error('Q4_ISOLATION_DENIED')
  }
  const originalFetch = globalThis.fetch
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    if (url.origin !== ORIGIN && !['http://localhost:3000', 'http://127.0.0.1:3000'].includes(url.origin)) {
      throw new Error('Q4_EGRESS_DENIED')
    }
    return originalFetch(input, { ...init, redirect: 'error' })
  }
} else {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, '.q4.local.json'), 'utf8'))
  if (config.url !== ORIGIN) throw new Error('Q4_ORIGIN_DENIED')
  for (const [key, role] of [['anonKey', 'anon'], ['serviceKey', 'service_role']]) {
    const token = config[key]
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
    if (payload.role !== role || crypto.createHash('sha256').update(token).digest('hex') !== config[`${key}Sha256`]) {
      throw new Error('Q4_KEY_DENIED')
    }
  }
  // Ne jamais lire les valeurs de .env.local : seuls ses noms sont neutralisés.
  const env = { ...process.env }
  for (const file of ['.env', '.env.local', '.env.production', '.env.production.local', '.env.development', '.env.development.local']) {
    const p = path.join(ROOT, file)
    if (fs.existsSync(p)) for (const m of fs.readFileSync(p, 'utf8').matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*=/gm)) env[m[1]] = ''
  }
  for (const key of Object.keys(env)) {
    if (/SECRET|TOKEN|API_KEY|SUPABASE|DATABASE_URL|PGHOST|PGPASSWORD|INTEGRATIONS_ENCRYPTION|ASSISTANT|VERCEL_|KPI_|JISRA_|NEXT_PUBLIC_/.test(key)) env[key] = ''
  }
  Object.assign(env, {
    NEXT_PUBLIC_SUPABASE_URL: ORIGIN,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: config.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: config.serviceKey,
    JISRA_QUALIFICATION: '1', NEXT_PUBLIC_JISRA_QUALIFICATION: '1',
    JISRA_QUALIFICATION_SUPABASE_ORIGINS: ORIGIN,
    NEXT_PUBLIC_SITE_URL: 'http://localhost:3000', NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    JISRA_Q4_RUNNER: '1', JISRA_Q4_PRELOAD: '1', NEXT_TELEMETRY_DISABLED: '1',
    PUBLIC_AI_ENABLED: process.env.PUBLIC_AI_ENABLED || 'enabled',
    NODE_OPTIONS: `--require ${JSON.stringify(__filename)}`,
  })
  const action = process.argv[2]
  const commands = {
    build: ['node_modules/next/dist/bin/next', 'build'],
    dev: ['node_modules/next/dist/bin/next', 'dev', '-p', '3000'],
    start: ['node_modules/next/dist/bin/next', 'start', '-p', '3000'],
    typecheck: ['node_modules/typescript/bin/tsc', '--noEmit', '--incremental', 'false', '--pretty', 'false'],
    check: ['-e', `Promise.all(['/auth/v1/health','/rest/v1/plans?select=name'].map(p=>fetch('${ORIGIN}'+p,{headers:{apikey:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}}).then(r=>{if(!r.ok)throw Error(p+':'+r.status)}))).then(()=>console.log('Q4_API_AUTH=PASS')).catch(e=>{console.error(e.message);process.exitCode=1})`],
  }
  if (!commands[action]) throw new Error('Usage: node scripts/q4.cjs check|typecheck|build|dev|start')
  const generated = ['tsconfig.json', 'next-env.d.ts'].map((name) => ({
    name: path.join(ROOT, name), contents: fs.readFileSync(path.join(ROOT, name)),
  }))
  const result = spawnSync(process.execPath, commands[action], { cwd: ROOT, env, stdio: 'inherit' })
  if (action === 'build' || action === 'dev') {
    for (const file of generated) fs.writeFileSync(file.name, file.contents)
  }
  process.exit(result.status ?? 1)
}