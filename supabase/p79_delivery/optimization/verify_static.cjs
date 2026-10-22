// Controle local uniquement : aucune connexion, aucune execution SQL.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const dir = __dirname
const m = JSON.parse(fs.readFileSync(path.join(dir, 'MANIFEST.json'), 'utf8'))
const results = []
function check(ok, label) { results.push((ok ? 'PASS' : 'FAIL') + ' ' + label); if (!ok) failed = true }
let failed = false

for (const f of m.files) {
  const buf = fs.readFileSync(path.join(dir, f.path))
  check(!buf.includes(13), 'LF_ONLY ' + f.path)
  check(crypto.createHash('sha256').update(buf).digest('hex') === f.sha256, 'SHA256 ' + f.path)
}
const read = (p) => fs.readFileSync(path.join(dir, p), 'utf8')
const install = read('10_install_producer_optimization.sql')
const activate = read('20_activate_producers_optimized.sql')
const verify = read('90_verify_producer_optimization.sql')
const rollback = read('91_rollback_producer_optimization.sql')

check((activate.match(/^create trigger /gm) || []).length === 6, 'SIX_PRODUCERS')
for (const t of ['trg_kpi_mark_order_insert', 'trg_kpi_invalidate_orders', 'trg_kpi_invalidate_orders_insert',
  'trg_kpi_invalidate_order_items', 'trg_kpi_invalidate_ad_spend', 'trg_kpi_invalidate_orders_quality']) {
  check(activate.includes('create trigger ' + t), 'TRIGGER ' + t)
}
check(install.includes('PRODUCERS_OPT_NOT_AUTHORIZED') && install.includes('PRODUCERS_OPT_MISSING_SOCLE'), 'INSTALL_GUARDS')
check(install.includes('PRODUCERS_OPT_TRIGGERS_MUST_STAY_INACTIVE') && install.includes('PRODUCERS_OPT_MUST_INSTALL_DISARMED'), 'INSTALL_POSTCONDITIONS')
check(activate.includes('ACTIVATION_FUNCTION_DRIFT') && activate.includes('ACTIVATION_MUST_START_DISARMED'), 'ACTIVATION_DRIFT_AND_DISARM_GUARDS')
check(activate.includes('ACTIVATION_RISK_UNSIGNED') && activate.includes('ACTIVATION_PROJECT_NOT_ALLOWED'), 'RISK_AND_PROJECT_GUARDS')
check(m.functionHashes.length === 12 && m.producers === 6, 'MANIFEST_INVENTORY')
for (const h of m.functionHashes) check(activate.includes(h.md5), 'MANIFEST_HASH_IN_ACTIVATION ' + h.signature)
for (const h of m.c0Hashes) check(rollback.includes(h.md5), 'C0_HASH_IN_ROLLBACK ' + h.signature)
check((rollback.match(/^drop trigger if exists/gm) || []).length === 6, 'ROLLBACK_DROPS_SIX_TRIGGERS')
check((rollback.match(/^CREATE OR REPLACE FUNCTION/gm) || []).length === 5, 'ROLLBACK_RESTORES_PRODUCERS_AND_WORKER')
check(!/insert into public\.|update public\.|delete from public\./i.test(verify), 'VERIFY_IS_READ_ONLY')
check(!/cron\.schedule\s*\(|create extension/i.test(install + activate), 'NO_CRON_OR_EXTENSION')
check(!/set enabled\s*=\s*true\b/i.test(activate), 'NO_IMPLICIT_WORKER_ENABLE')
const resilience = read('11_worker_failure_resilience.sql')
const prodcompat = read('92_verify_production_compatibility.sql')
const pilot = read('PILOT-PROCEDURE.md')
check(resilience.includes('WORKER_RESILIENCE_NOT_AUTHORIZED') && resilience.includes('WORKER_RESILIENCE_REQUIRES_P710'), 'RESILIENCE_GUARDS')
check((resilience.match(/exception when others then/g) || []).length >= 3, 'RESILIENCE_SAVEPOINTS')
check(resilience.includes("set_config('lock_timeout', '250ms', true)"), 'RESILIENCE_LOCK_BOUND')
check(resilience.includes('dashboard_kpi_worker_note_failure'), 'RESILIENCE_HELPER_USED')
check(prodcompat.includes('default_transaction_read_only = on') && !/insert into |update public\.|delete from |create |drop /i.test(prodcompat), 'PRODUCTION_VERIFY_READ_ONLY')
for (const k of ['enable_store', 'Rapprochement', 'kill_switch', 'producer_arm(false)', '91_rollback_producer_optimization.sql']) {
  check(pilot.includes(k), 'PILOT_STEP ' + k)
}
const inactive = read('89_verify_inactive_install.sql')
const installDoc = read('INSTALL-INACTIVE.md')
const allSql = [install, resilience, activate, verify, rollback, inactive, prodcompat].join(String.fromCharCode(10))
check(!/^create trigger /im.test(install) && !/^create trigger /im.test(resilience), 'INSTALL_FILES_CREATE_NO_TRIGGER')
check(!/cron\.schedule\s*\(|create extension/i.test(install + resilience), 'INSTALL_FILES_NO_CRON_EXTENSION')
check(!/dashboard_kpi_rollout_cohorts/i.test(install + resilience), 'INSTALL_FILES_TOUCH_NO_COHORT')
check(!/update public\.dashboard_kpi_rollout_config/i.test(install + resilience), 'INSTALL_FILES_TOUCH_NO_ROLLOUT')
check(!/dashboard_kpi_producer_stores\s*\(?[^)]*enabled[^)]*true/i.test(install), 'INSTALL_FILES_DO_NOT_ARM_STORE')
check(!/revenue_items_gross|\bpurchase_cost\b|contribution_margin|margin_rate|\bprofit\s*=/i.test(allSql), 'NO_FINANCIAL_FORMULA_CHANGE')
check(inactive.includes('INSTALL_INACTIVE_OK') && inactive.includes('zero_trigger'), 'INACTIVE_VERIFIER_PRESENT')
check(!/insert into public\.|update public\.|delete from public\./i.test(inactive), 'INACTIVE_VERIFIER_READ_ONLY')
check(installDoc.includes('89_verify_inactive_install.sql') && installDoc.includes('91_rollback_producer_optimization.sql'), 'INSTALL_DOC_LINKS_VERIFY_AND_ROLLBACK')
for (const k of ['92_verify_production_compatibility.sql', '10_install_producer_optimization.sql', '11_worker_failure_resilience.sql', 'Conditions d\'arr\u00eat']) {
  check(installDoc.includes(k), 'INSTALL_DOC_STEP ' + k)
}
check(!/sb_secret_[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]{20,}\./.test(install + activate + verify + rollback), 'NO_SECRET')
check(!/attvfeoqgbxsnnsllatt/.test(install + activate) || activate.includes("in ('attvfeoqgbxsnnsllatt', 'biqrgdopcvkrbgfxkzxm')"), 'PROJECT_ALLOWLIST_ONLY')

fs.writeFileSync(path.join(dir, 'VERIFY-STATIC.txt'), results.join('\n') + '\n')
process.exit(failed ? 1 : 0)
