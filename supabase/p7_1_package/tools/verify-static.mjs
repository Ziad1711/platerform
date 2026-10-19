import fs from 'node:fs'
import crypto from 'node:crypto'

const root = new URL('../', import.meta.url)
const read = (file) => fs.readFileSync(new URL(file, root), 'utf8')

const snapshot = read('.work/snapshot.sql')
const install = read('10_install_objects.sql')
const invalidations = read('30_activate_invalidations.sql')
const wakeup = read('31_activate_wakeup.sql')
const worker = read('40_activate_worker.sql')
const backfill = read('41_backfill.sql')
const rollback = read('91_rollback.sql')
const verify = read('90_verify.sql')
const manifest = read('MANIFEST.md')

const checks = []
const check = (id, ok, detail = '') => checks.push({ id, status: ok ? 'PASS' : 'FAIL', detail })
const count = (text, pattern) => (text.match(pattern) ?? []).length

const markers = [...snapshot.matchAll(/^-- @@FUNCTION ([0-9a-f]{32}) (.+)$/gm)]
check('snapshot_function_count', markers.length === 23, `${markers.length}/23`)

let md5Ok = 0
for (const marker of markers) {
  const start = marker.index + marker[0].length + 1
  const end = snapshot.indexOf('\n-- @@END', start)
  const ddl = snapshot.slice(start, end)
  const digest = crypto.createHash('md5').update(ddl, 'utf8').digest('hex')
  if (digest === marker[1]) md5Ok += 1
}
check('snapshot_md5', md5Ok === 23, `${md5Ok}/23`)

const installMarkers = [...install.matchAll(/^-- @@FUNCTION ([0-9a-f]{32}) (.+)$/gm)]
check('install_function_count', installMarkers.length === 23, `${installMarkers.length}/23`)
let installMd5Ok = 0
for (const marker of installMarkers) {
  const start = marker.index + marker[0].length + 1
  const end = install.indexOf('\n-- @@END', start)
  const body = install.slice(start, end).replace(/\s+$/, '').replace(/;$/, '')
  const digest = crypto.createHash('md5').update(body, 'utf8').digest('hex')
  if (digest === marker[1]) installMd5Ok += 1
}
check('install_function_md5', installMd5Ok === 23, `${installMd5Ok}/23`)

check('install_tables', count(install, /^create table public\./gm) === 6, String(count(install, /^create table public\./gm)))
check('install_view', count(install, /^create view public\./gm) === 1, String(count(install, /^create view public\./gm)))
check('install_no_trigger', count(install, /^create (constraint )?trigger /gim) === 0)
check('install_no_cron', count(install, /cron\.schedule/i) === 0)
check('install_no_http_call', !/^\s*(select|perform)\s+net\.http_post/im.test(install))
check('install_no_business_write', !/^\s*(insert into|update|delete from)\s+public\.(orders|order_items|ad_spend_daily|stores)\b/im.test(install))
check('install_worker_disabled', /insert into public\.dashboard_kpi_worker_config \(id, enabled\) values \(1, false\)/.test(install))
check('install_wakeup_disabled', /insert into public\.dashboard_kpi_wakeup_config \(id, enabled\) values \(1, false\)/.test(install))
check('install_no_legacy_definitions', !/create (or replace )?function public\.(_rbl4|dashboard_legacy)/i.test(install))

check('invalidation_triggers', count(invalidations, /^create trigger /gm) === 5, String(count(invalidations, /^create trigger /gm)))
check('invalidation_no_wakeup', !/create (constraint )?trigger trg_kpi_wakeup/i.test(invalidations))
check('wakeup_single_constraint_trigger', count(wakeup, /^create constraint trigger trg_kpi_wakeup/gm) === 1)
check('worker_two_jobs', count(worker, /cron\.schedule\(/g) === 2, String(count(worker, /cron\.schedule\(/g)))
check('worker_enables_flag', /set enabled = true/.test(worker))
check('backfill_inclusive_documented', /inclut p_to/.test(backfill))
check('backfill_no_loop', !/\bfor\b.+\bin\b.+\bgenerate_series/i.test(backfill))
check('rollback_keeps_journal', !/(truncate|delete from)\s+public\.dashboard_kpi_invalidation/i.test(rollback))
check('rollback_drops_six_triggers', count(rollback, /drop trigger if exists trg_kpi_/g) === 6, String(count(rollback, /drop trigger if exists trg_kpi_/g)))
check('rollback_no_business_table', !/drop table[^;]*(orders|order_items|ad_spend_daily|stores)/i.test(rollback))
check('rollback_cron_verifies_remaining_jobs', /P71_ROLLBACK_JOBS_REMAIN/.test(rollback))
check('rollback_tolerates_missing_cron_job', /could not find valid entry for job/.test(rollback))
check('rollback_does_not_swallow_all_errors', !/exception when others then null/i.test(rollback))
check('verify_temp_table_qualified', /drop table if exists pg_temp\.p7_checks/.test(verify))
check('verify_columns_qualified', /tc\.n::text/.test(verify))
check('acl_separated_from_end_marker', !/-- @@ENDrevoke/.test(install))
check('acl_access_level_revoked', /^revoke all on function public\.dashboard_kpi_access_level\(/m.test(install))
check('acl_revoke_count', count(install, /^revoke all on function public\./gm) === 23, String(count(install, /^revoke all on function public\./gm)))
check('acl_service_grant_count', count(install, /^grant execute on function public\..* to service_role;/gm) === 23, String(count(install, /^grant execute on function public\..* to service_role;/gm)))
check('manifest_install_before_extensions',
  manifest.indexOf('10_install_objects.sql') !== -1 &&
  manifest.indexOf('20_extensions_prerequisites.sql') !== -1 &&
  manifest.indexOf('10_install_objects.sql') < manifest.indexOf('20_extensions_prerequisites.sql'))

const failed = checks.filter((c) => c.status === 'FAIL')
const report = {
  checks: checks.length,
  passed: checks.length - failed.length,
  failed: failed.length,
  failures: failed,
  verdict: failed.length === 0 ? 'PASS' : 'FAIL',
}
fs.writeFileSync(new URL('verification-static.json', root), JSON.stringify({ report, checks }, null, 2))
console.log(JSON.stringify(report))
