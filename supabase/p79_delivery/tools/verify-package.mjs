// Verification statique du paquet KPI V5 (Phase 2).
// Aucune connexion reseau, aucune ecriture en base.
// Empreintes calculees sur contenu normalise LF (meme regle que verify-static.mjs).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const supabaseRoot = path.resolve(here, '..', '..')
const packageDir = path.resolve(here, '..')

const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, '00_manifest.json'), 'utf8'))
const checks = []
const check = (id, ok, detail = '') => checks.push({ id, status: ok ? 'PASS' : 'FAIL', detail })

const normalize = (text) => text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
const read = (rel) => normalize(fs.readFileSync(path.join(supabaseRoot, rel), 'utf8'))
const digest = (rel) => crypto.createHash('sha256').update(read(rel), 'utf8').digest('hex')
const exists = (rel) => fs.existsSync(path.join(supabaseRoot, rel))
const count = (text, pattern) => (text.match(pattern) ?? []).length

// Supprime le contenu des blocs $tag$ ... $tag$ (corps de fonctions), pour ne
// controler que les instructions reellement executees au premier niveau.
function stripDollarQuoted(sql) {
  let out = ''
  let i = 0
  while (i < sql.length) {
    if (sql[i] === '$') {
      const match = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))
      if (match) {
        const tag = match[0]
        const end = sql.indexOf(tag, i + tag.length)
        if (end === -1) return out
        out += ' '
        i = end + tag.length
        continue
      }
    }
    out += sql[i]
    i += 1
  }
  return out
}

// 1. Structure et ordre.
const steps = manifest.steps ?? []
check('steps_count', steps.length >= 15, String(steps.length))
const ids = new Set()
let previous = -1
let orderOk = true
let uniqueOk = true
for (const step of steps) {
  if (typeof step.order !== 'number' || step.order <= previous) orderOk = false
  previous = step.order
  if (ids.has(step.id)) uniqueOk = false
  ids.add(step.id)
}
check('steps_order_increasing', orderOk)
check('steps_unique', uniqueOk)

const preconditionIds = new Set((manifest.preconditions ?? []).map((p) => p.id))
const seen = new Set([...preconditionIds])
for (const step of steps) {
  const missing = (step.requires ?? []).filter((dep) => !seen.has(dep))
  check(`requires_${step.id}`, missing.length === 0, missing.join(','))
  seen.add(step.id)
}

// 2. Fichiers et empreintes.
const applied = new Map()
const allEntries = [
  ...steps.map((s) => ({ ...s, where: `step ${s.id}` })),
  ...(manifest.activations ?? []).map((a) => ({ ...a, where: `activation ${a.id}` })),
  ...(manifest.rollback ?? []).map((r) => ({ ...r, where: `rollback ${r.id}` }))
]
for (const entry of allEntries) {
  for (const file of entry.files ?? []) {
    check(`exists_${file.path}`, exists(file.path), entry.where)
    if (file.sha256) {
      const observed = exists(file.path) ? digest(file.path) : 'missing'
      check(`sha256_${file.path}`, observed === file.sha256, observed.slice(0, 16))
    }
    if (entry.apply === false) continue
    if (applied.has(file.path)) {
      check(`unique_apply_${file.path}`, false, `${applied.get(file.path)} + ${entry.where}`)
    } else {
      applied.set(file.path, entry.where)
    }
  }
}

// 3. Installation inactive : aucun producteur, aucun job, aucun appel au premier niveau.
// Les triggers de bookkeeping du rollout (trg_rollout_*) sont hors de cet invariant.
const inactiveInstallSteps = new Set(['P7.1_SOCLE', 'P7.9_INACTIVE'])
for (const step of steps.filter((s) => s.mode === 'install')) {
  for (const file of step.files ?? []) {
    const raw = read(file.path)
    const top = stripDollarQuoted(raw)
    const label = path.basename(file.path)
    if (inactiveInstallSteps.has(step.id)) {
      check(`no_top_trigger_${label}`, count(top, /^\s*create\s+(constraint\s+)?trigger\s/gim) === 0)
    }
    check(`no_top_cron_${label}`, count(top, /cron\.schedule/gi) === 0)
    check(`no_top_http_${label}`, count(top, /net\.http_post/gi) === 0)
  }
}

const installObjects = read('p7_1_package/10_install_objects.sql')
check('worker_disabled_at_install',
  /insert into public\.dashboard_kpi_worker_config \(id, enabled\) values \(1, false\)/i.test(installObjects))
check('wakeup_disabled_at_install',
  /insert into public\.dashboard_kpi_wakeup_config \(id, enabled\) values \(1, false\)/i.test(installObjects))
check('install_rls_closed',
  count(installObjects, /enable row level security/gi) === 6,
  String(count(installObjects, /enable row level security/gi)))
check('install_no_client_policy', count(installObjects, /^\s*create\s+policy\s/gim) === 0)

const installP79 = read('p79_delivery/10_install_p79_functions.sql')
check('p79_install_no_trigger',
  count(stripDollarQuoted(installP79), /^\s*create\s+(constraint\s+)?trigger\s/gim) === 0)

const rolloutConfig = read('migrations/20261019183241_kpi_rollout_config.sql')
check('rollout_kill_switch_default_true', /kill_switch boolean not null default true/i.test(rolloutConfig))
check('rollout_mode_default_legacy', /requested_mode text not null default 'legacy'/i.test(rolloutConfig))

// 4. Activations gardees.
for (const activation of manifest.activations ?? []) {
  if (!activation.guard || !(activation.files ?? []).length) continue
  const source = read(activation.files[0].path)
  const key = /"?(p7|p79)\.[a-z_.]+/.exec(activation.guard)?.[0]?.replace(/"/g, '')
  if (!key) continue
  check(`guard_${activation.id}`, source.includes(`current_setting('${key}'`), key)
}

// 5. Ordre reel des dependances.
const orderOf = (id) => steps.find((s) => s.id === id)?.order ?? -1
check('p83_before_p84_s2', orderOf('P8.3_M2') < orderOf('P8.4_S2'))
check('rbl4_before_p79', orderOf('RBL4') < orderOf('P7.9_INACTIVE'))
check('rbl4_reference_identical',
  digest('p7_1_package/reference/20261018213537_dashboard_legacy_financial_permissions.sql')
  === digest('migrations/20261018213537_dashboard_legacy_financial_permissions.sql'))

// 6. Rollback combine : couverture et preservation.
const combined = read('p79_delivery/92_rollback_combined.sql')
const combinedTop = stripDollarQuoted(combined)
check('rollback_guard', combined.includes("current_setting('p79.combined_rollback_authorized'"))
check('rollback_p79_producer',
  /drop trigger if exists trg_kpi_invalidate_orders_quality/i.test(combinedTop)
  && /drop function if exists public\.dashboard_kpi_invalidate_orders_quality_trg\(\)/i.test(combinedTop))
check('rollback_p71_producers',
  count(combinedTop, /^\s*drop trigger if exists trg_kpi_(?!invalidate_orders_quality)/gim) === 5,
  String(count(combinedTop, /^\s*drop trigger if exists trg_kpi_(?!invalidate_orders_quality)/gim)))
check('rollback_stops_worker',
  /cron\.unschedule\('jisra_kpi_worker'\)/.test(combined)
  && /dashboard_kpi_worker_config[\s\S]{0,160}enabled = false/.test(combined))
check('rollback_stops_wakeup',
  /dashboard_kpi_wakeup_config[\s\S]{0,160}enabled = false/.test(combined)
  && /drop trigger if exists trg_kpi_wakeup/.test(combined))
check('rollback_reader_legacy',
  /kill_switch = true/.test(combined) && /requested_mode = 'legacy'/.test(combined))
check('rollback_no_table_drop', count(combinedTop, /^\s*drop table/gim) === 0)
check('rollback_no_policy_drop', count(combinedTop, /^\s*drop policy/gim) === 0)
check('rollback_no_p8_drop',
  count(combinedTop, /drop\s+(function|trigger)[^;]*(can_invite_to_store|can_manage_store_expenses|can_manage_store_products|p84_)/gim) === 0)
check('rollback_verifies_p8',
  combined.includes("'p8_function_digest_unchanged'")
  && combined.includes("'p8_policy_digest_unchanged'"))
check('rollback_verifies_no_loss',
  combined.includes("'business_rows_unchanged'")
  && combined.includes("'journal_and_aggregates_unchanged'"))

// 7. Equilibre des blocs dollar (garde-fou de syntaxe minimal).
for (const rel of ['p79_delivery/92_rollback_combined.sql', 'p79_delivery/93_preflight_capture.sql']) {
  const tags = read(rel).match(/\$[A-Za-z_][A-Za-z0-9_]*\$/g) ?? []
  check(`dollar_balance_${path.basename(rel)}`, tags.length % 2 === 0, String(tags.length))
}

// 8. Interdits.
for (const entry of allEntries) {
  for (const file of entry.files ?? []) {
    if (entry.apply === false) continue
    check(`no_b13_replay_${path.basename(file.path)}`, !/b13_/i.test(path.basename(file.path)))
  }
}

const failing = checks.filter((c) => c.status === 'FAIL')
if (failing.length === 0) {
  console.log(`PASS — ${checks.length}/${checks.length} controles`)
} else {
  for (const c of failing) console.log(`FAIL ${c.id} ${c.detail}`)
  console.log(`\n${checks.length - failing.length}/${checks.length} PASS — ${failing.length} FAIL`)
}
process.exit(failing.length === 0 ? 0 : 1)

