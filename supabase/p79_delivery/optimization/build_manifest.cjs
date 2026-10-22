const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const dir = __dirname
const files = [
  '10_install_producer_optimization.sql',
  '20_activate_producers_optimized.sql',
  '89_verify_inactive_install.sql',
  '90_verify_producer_optimization.sql',
  '91_rollback_producer_optimization.sql',
  'tests/producers_optimization_tests.sql',
  '11_worker_failure_resilience.sql',
  '92_verify_production_compatibility.sql',
  'INSTALL-INACTIVE.md',
  'PILOT-PROCEDURE.md',
  'QUALIFICATION-P710.md',
  'tests/setup_fixtures.sql',
  'tests/qualification_permissions.sql',
  'tests/qualification_worker.sql',
  'b13/bench.sql',
  'b13/variant.sql',
  'b13/qualif_helpers.sql',
  'b13/concurrency_run.sh',
  'b13/worker_failure_run.sh',
  'b13/stab_bench.sql',
  'b13/stab_run.sh',
  'b13/stab_parse.cjs',
  'b13/prepare_variants.sh',
  'b13/cleanup_all.sql',
  'b13/analyze_tail.cjs',
  'b13/parse_perf.cjs',
  'b13/count_work.sql',
  'b13/cleanup.sql',
  'b13/run_campaign.sh',
  'b13/run_tail.sh',
]
const hashes = [
  ['dashboard_kpi_invalidate_trg()', '3a11c2a622833bd58ba64244a9f23a08'],
  ['dashboard_kpi_invalidate_insert_stmt()', '60a03918fcb663b4f908f13486179d8e'],
  ['dashboard_kpi_mark_order_insert()', '80ed494f8623b37e92937b26677a2546'],
  ['dashboard_kpi_invalidate_orders_quality_trg()', '4a5b55cb2e2d443c8f0c7a4fd5287b8a'],
  ['dashboard_kpi_producers_armed()', 'ca961583cb7c5722e9d3d453424c33db'],
  ['dashboard_kpi_producer_active(uuid)', '70fb8a5b5c3861755036a37798cf5cf7'],
  ['dashboard_kpi_day_claimed(uuid,date)', 'd3b8a065a801678631d0fc2278eafbb0'],
  ['dashboard_kpi_producer_arm(boolean)', '4cc7900d7392566e0ef4c11f71141038'],
  ['dashboard_kpi_producer_disable_store(uuid,text)', 'd4621a5768dd08783d7071dbd1a0750f'],
  ['dashboard_kpi_producer_enable_store(uuid,date,text)', 'c3b12d082732bb8ebddf37f6309d694d'],
  ['dashboard_kpi_worker_run(text,integer,bigint,numeric)', '98cb969dd827a1dc1858f69bfea6d3ac'],
  ['dashboard_kpi_worker_note_failure(uuid,date,uuid,text)', '1b1cc0fc8dd90bd28f5fd645b4ef67ee'],
]
const c0 = [
  ['dashboard_kpi_invalidate_trg()', '10e7ba5957e8e70479208ab82e1fbfd4'],
  ['dashboard_kpi_invalidate_insert_stmt()', 'db18817564f6348743ee82b389ec56db'],
  ['dashboard_kpi_mark_order_insert()', '51396e7b26984fc83a72852f79f9490e'],
  ['dashboard_kpi_worker_run(text,integer,bigint,numeric)', 'f41abff2c59cbba39ef740740307eb07'],
  ['dashboard_kpi_invalidate_orders_quality_trg()', '0af853293f65fb45a51887a3a0dd82cc'],
]
const manifest = {
  package: 'p79_delivery/optimization',
  version: 'P7.10-producer-optimization',
  createdAt: new Date().toISOString(),
  provenance: 'Casablanca IANA 2026c already applied (TZ-COMPAT-PATCH)',
  defaultState: { armed: false, eligibleStores: 0, producers: 0 },
  producers: 6,
  files: [],
  functionHashes: hashes.map(([signature, md5]) => ({ signature, md5 })),
  c0Hashes: c0.map(([signature, md5]) => ({ signature, md5 })),
  budgets: { medianOvercostPctMax: 15, p95OvercostPctMax: 25 },
}
for (const rel of files) {
  const p = path.join(dir, rel)
  const buf = fs.readFileSync(p)
  manifest.files.push({
    path: rel,
    bytes: buf.length,
    lines: buf.toString('utf8').split('\n').length - 1,
    lfOnly: !buf.includes(13),
    sha256: crypto.createHash('sha256').update(buf).digest('hex'),
  })
}
fs.writeFileSync(path.join(dir, 'MANIFEST.json'), JSON.stringify(manifest, null, 2))
