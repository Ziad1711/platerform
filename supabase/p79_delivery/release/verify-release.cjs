// Vérification statique seulement : aucune connexion ni écriture.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '../../..')
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'release-manifest.json'), 'utf8'))
const failures = []
let checks = 0
function check(ok, label) {
  checks++
  if (!ok) failures.push(label)
}
function content(entry) {
  if (entry.source === 'git-head') {
    return execFileSync('git', ['show', `${manifest.source_commit}:${entry.path}`], {
      cwd: root, encoding: 'utf8', maxBuffer: 8e6,
    })
  }
  return fs.readFileSync(path.join(root, entry.path), 'utf8')
}
const entries = [
  ...manifest.application,
  ...manifest.inactive_sql.flatMap(s => s.files),
  ...manifest.activation_sql.flatMap(s => s.files),
  ...manifest.rollback_sql,
  ...manifest.archive,
  ...(manifest.verification_tooling ?? []),
]
for (const entry of entries) {
  try {
    const text = content(entry)
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const digest = crypto.createHash('sha256').update(normalized).digest('hex')
    check(digest === entry.sha256, `hash:${entry.path}`)
    // Valeurs uniquement : ne pas imprimer un match susceptible d'être secret.
    check(!/sb_secret_[A-Za-z0-9_-]{8,}|sb_publishable_[A-Za-z0-9_-]{15,}|eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|postgres(?:ql)?:\/\/[^\s]+:[^\s]+@/.test(text),
      `credential:${entry.path}`)
  } catch {
    check(false, `unreadable:${entry.path}`)
  }
}
const productionEntries = entries.filter(e => !manifest.archive.some(a => a.path === e.path))
for (const entry of productionEntries) {
  check(!/\/final\/REINSTALL-|\/final\/legacy-b13\/|\/reference\/production_|\/b13\/|\/b13_v3\/|^lib\/qualification\/|qualify-b13/.test(entry.path),
    `no-b13-tool:${entry.path}`)
}
const rollout = content(manifest.application.find(e => e.path === 'lib/dashboard/use-kpi-rollout.tsx'))
check(rollout.includes('void queryClient.invalidateQueries({') && !rollout.includes('queryClient.removeQueries({'), 'react-observers-preserved')
check(manifest.deployment.inactive.kill_switch === true && manifest.deployment.inactive.cohorts === 0 && manifest.deployment.inactive.worker === false, 'inactive-defaults')
const quality = content(manifest.rollback_sql.find(e => e.path.endsWith('REINSTALL-QUALITY-RELEASE.sql')))
const source = fs.readFileSync(path.join(root, 'supabase/p79_delivery/10_install_p79_functions.sql'), 'utf8')
check(source.includes(quality.slice(quality.indexOf('create or replace function'))), 'resume-quality-from-release-source')
check(manifest.status === 'PREPARED_STATIC_ONLY_NO_GO_ACTIVATION', 'no-implicit-go')
for (const f of failures) console.log(`FAIL ${f}`)
console.log(`${failures.length ? 'FAIL' : 'PASS'} — ${checks - failures.length}/${checks} contrôles Release`)
process.exitCode = failures.length ? 1 : 0