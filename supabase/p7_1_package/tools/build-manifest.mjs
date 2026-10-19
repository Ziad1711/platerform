import fs from 'node:fs'
import crypto from 'node:crypto'

const root = new URL('../', import.meta.url)
const staticReport = JSON.parse(
  fs.readFileSync(new URL('../verification-static.json', import.meta.url), 'utf8'),
).report
const snapshot = fs.readFileSync(new URL('../.work/snapshot.sql', import.meta.url), 'utf8')
const re = /^-- @@FUNCTION ([0-9a-f]{32}) (.+)$/gm
const functions = []
let match
while ((match = re.exec(snapshot)) !== null) {
  functions.push({ signature: match[2].replace(/\r$/, ''), md5: match[1] })
}
if (functions.length !== 23) throw new Error(`expected 23 functions, got ${functions.length}`)
const aggregate = crypto
  .createHash('md5')
  .update(
    [...functions]
      .sort((a, b) => (a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0))
      .map((f) => `${f.signature}:${f.md5}`)
      .join(','),
    'utf8',
  )
  .digest('hex')

const files = [
  '10_install_objects.sql',
  '20_extensions_prerequisites.sql',
  '30_activate_invalidations.sql',
  '31_activate_wakeup.sql',
  '40_activate_worker.sql',
  '41_backfill.sql',
  '50_reader_activation.md',
  'README.md',
  '90_verify.sql',
  '91_rollback.sql',
  'reference/20261018213537_dashboard_legacy_financial_permissions.sql',
  'reference/README.md',
  'verification-static.json',
  'MANIFEST.md',
  'P7.2-QUALIFICATION.md',
  'P7.2-evidence.json',
  'P7.3-MCP.md',
  'P7.3-evidence.json',
  'tools/build-acl.mjs',
  'tools/build-install-snapshot.mjs',
  'tools/build-rollback.mjs',
  'tools/build-verify.mjs',
  'tools/build-manifest.mjs',
  'tools/verify-static.mjs',
  'tools/export-prod-structure.sh',
  'tools/preflight-export.sql',
]

const fileEntries = files.map((file) => {
  const bytes = fs.readFileSync(new URL(file, root))
  return {
    file,
    bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  }
})

const rbl4Url = new URL(
  '../../migrations/20261018213537_dashboard_legacy_financial_permissions.sql',
  import.meta.url,
)
const rbl4Bytes = fs.readFileSync(rbl4Url)

const manifest = {
  package: 'JISRA P7.1 KPI V5',
  status: 'PASS',
  generated_at: new Date().toISOString(),
  source: {
    environment: 'jisra-test',
    project_ref: 'goqedvcdmgtejtyrawsp',
    postgres: '17.11',
    snapshot_raw_chars: snapshot.length,
    functions: functions.length,
    functions_md5_verified: functions.length,
    aggregate_md5: aggregate,
  },
  verification: {
    static_checks: `${staticReport.passed}/${staticReport.checks} PASS`,
    snapshot_md5: '23/23',
    aggregate_md5_matches_test: aggregate === '7c42c7ec3479d25f88d876be4f842bca',
  },
  target: {
    environment: 'production',
    project_ref: 'attvfeoqgbxsnnsllatt',
    postgres: '17.6',
    access: 'read-only',
    kpi_objects_present: false,
    pg_net_installed: false,
    pg_cron_installed: false,
    rbl4_objects_present: false,
  },
  files: fileEntries,
  external_dependencies: [
    {
      file: 'supabase/migrations/20261018213537_dashboard_legacy_financial_permissions.sql',
      bytes: rbl4Bytes.length,
      sha256: crypto.createHash('sha256').update(rbl4Bytes).digest('hex'),
      package_copy:
        'reference/20261018213537_dashboard_legacy_financial_permissions.sql',
      reason: 'R-BL4 requis avant shadow ou rollback legacy sécurisé ; absent en Production.',
      applied_by_install: false,
    },
  ],
  functions,
  deviations: [
    {
      id: 'D01',
      severity: 'BLOCKING',
      subject: 'tzdata Production',
      detail: 'Production est antérieure à 2026c ; V5 et tout backfill de journées métier restent bloqués jusqu’à correction officielle et vérification.',
    },
    {
      id: 'D02',
      severity: 'BLOCKING',
      subject: 'Migrations P1–P6 absentes du dépôt',
      detail: 'Les sources locales ne contiennent pas les migrations worker/lecteur appliquées sur Test. Le snapshot Test (23 fonctions) est la référence de définition ; l’historique local reste non réconcilié.',
    },
    {
      id: 'D03',
      severity: 'MAJEURE',
      subject: 'Versions B13 locales ≠ historique Test',
      detail: 'Ex. b13_invalidation_hot_path : 20261018230000 local vs 20261018230705 Test. Ne pas rejouer les fichiers historiques ; utiliser le snapshot.',
    },
    {
      id: 'D04',
      severity: 'MAJEURE',
      subject: 'ACL Test non durcie',
      detail: 'dashboard_kpi_invalidate_insert_stmt porte EXECUTE PUBLIC/anon/authenticated sur Test. Le paquet révoque ces droits ; écart volontaire, à vérifier après installation.',
    },
    {
      id: 'D05',
      severity: 'MINEURE',
      subject: 'Rôle jisra_kpi_worker absent en Production',
      detail: 'Test accorde EXECUTE à ce rôle sur worker_run et worker_purge_runs. Le paquet accorde service_role uniquement ; le cron s’exécute en postgres.',
    },
    {
      id: 'D06',
      severity: 'MAJEURE',
      subject: 'R-BL4 absent en Production',
      detail: '0 objet _rbl4 / dashboard_legacy_access en Production. R-BL4 doit être appliqué avant un rollback legacy sécurisé ou un shadow.',
    },
    {
      id: 'D07',
      severity: 'MINEURE',
      subject: 'Versions extensions',
      detail: 'Production disponible : pg_net 0.20.0, pg_cron 1.6.4. Test : pg_net 0.20.4. Vérifier la signature net.http_post après installation.',
    },
    {
      id: 'D08',
      severity: 'MAJEURE',
      subject: 'PostgreSQL différent',
      detail: 'Production 17.6 ARM64 / Test 17.11 x86_64. Les mesures B13 Test ne sont pas transposables telles quelles.',
    },
    {
      id: 'D09',
      severity: 'BLOCKING',
      subject: 'Lecteur V5 bloqué par le code',
      detail: 'lib/dashboard/kpi-reader-flag.ts interdit explicitement la Production. Aucune activation possible sans modification P7.2 et autorisation.',
    },
  ],
  verdict_reason:
    'P7.3 : PASS — installation propre atomique sur qxtqtzmxkwiohfbmwcdt, 29/29 vérifications, ACL corrigées, empreinte agrégée identique, extensions sans job, rollback 91 deux fois, idempotence. Installation Production non autorisée : tzdata et R-BL4 restent des prérequis distincts.',
}

fs.writeFileSync(new URL('../00_manifest.json', import.meta.url), JSON.stringify(manifest, null, 2))
