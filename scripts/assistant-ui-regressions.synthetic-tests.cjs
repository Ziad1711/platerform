#!/usr/bin/env node
/**
 * Tests de régression de l'interface du chatbot (ordre, défilement, avertissements).
 * Exécution : `node scripts/assistant-ui-regressions.synthetic-tests.cjs`
 *
 * Aucune base, aucun réseau, aucun fournisseur : seuls les modules purs
 * `lib/assistant/chat-ui.ts` et le câblage de la page sont vérifiés.
 */
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const vm = require('node:vm')

const ROOT = process.cwd()

function loadTs(relativePath) {
  const file = path.resolve(ROOT, relativePath)
  const module = { exports: {} }
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: file,
  }).outputText

  const requireShim = (id) => {
    if (id.startsWith('@/')) return loadTs(`${id.slice(2)}.ts`)
    throw new Error(`import inattendu: ${id}`)
  }

  vm.runInThisContext(`(function(require, module, exports){${js}\n})`, { filename: file })(
    requireShim,
    module,
    module.exports
  )
  return module.exports
}

const results = []
function check(id, name, run) {
  try {
    const detail = run()
    results.push({ id, name, pass: true, detail: detail ?? '' })
  } catch (error) {
    results.push({ id, name, pass: false, detail: error instanceof Error ? error.message : String(error) })
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message)
}
function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message} (attendu ${expected}, obtenu ${actual})`)
}

const ui = loadTs('lib/assistant/chat-ui.ts')
const PAGE = fs.readFileSync(path.join(ROOT, 'app/(app)/ai-assistant/page.tsx'), 'utf8')
const WARNINGS_COMPONENT = fs.readFileSync(path.join(ROOT, 'components/assistant/assistant-warnings.tsx'), 'utf8')
const MODULE_SOURCE = fs.readFileSync(path.join(ROOT, 'lib/assistant/chat-ui.ts'), 'utf8')

const SAME = '2026-10-29T22:11:40.000Z'
const msg = (id, role, createdAt, content = id) => ({
  id,
  thread_id: 't1',
  role,
  content,
  credits_used: 0,
  created_at: createdAt,
})

check('U01', 'ordre question → réponse à horodatage identique (uuid inversé)', () => {
  const assistant = msg('aaaaaaaa-0000-4000-8000-000000000001', 'assistant', SAME)
  const user = msg('ffffffff-0000-4000-8000-000000000002', 'user', SAME)
  assertEqual(ui.sortChatMessages([assistant, user]).map((m) => m.role).join(','), 'user,assistant', 'rôles')
  return 'user avant assistant'
})

check('U02', 'plusieurs échanges successifs restent chronologiques', () => {
  const list = [
    msg('a2', 'assistant', '2026-10-29T22:00:02.000Z'),
    msg('u1', 'user', '2026-10-29T22:00:00.000Z'),
    msg('u2', 'user', '2026-10-29T22:00:05.000Z'),
    msg('a1', 'assistant', '2026-10-29T22:00:01.000Z'),
    msg('a3', 'assistant', '2026-10-29T22:00:06.000Z'),
  ]
  const ordered = ui.sortChatMessages(list).map((m) => m.id).join('>')
  assertEqual(ordered, 'u1>a1>a2>u2>a3', 'séquence')
  return ordered
})

check('U03', 'historique chargé : tri stable quel que soit l’ordre serveur', () => {
  const history = [
    msg('m4', 'assistant', SAME),
    msg('m3', 'user', SAME),
    msg('m2', 'assistant', '2026-10-29T21:00:00.000Z'),
    msg('m1', 'user', '2026-10-29T21:00:00.000Z'),
  ]
  const first = ui.sortChatMessages(history).map((m) => m.id).join('>')
  const second = ui.sortChatMessages([...history].reverse()).map((m) => m.id).join('>')
  assertEqual(first, second, 'stabilité du tri')
  assertEqual(first, 'm1>m2>m3>m4', 'ordre attendu')
  return first
})

check('U04', 'message optimiste réconcilié sans doublon', () => {
  const persisted = [msg('u1', 'user', SAME, 'bonsoir que penses tu de ma performance')]
  const merged = ui.mergeDisplayMessages(persisted, {
    content: 'bonsoir que penses tu de ma performance',
    threadId: 't1',
    createdAt: SAME,
  })
  assertEqual(merged.length, 1, 'aucun doublon')
  assertEqual(merged[0].id, 'u1', 'message persisté conservé')

  const onlyOptimistic = ui.mergeDisplayMessages([], { content: 'salut', threadId: 't1', createdAt: SAME })
  assertEqual(onlyOptimistic.length, 1, 'optimiste seul affiché')
  assertEqual(onlyOptimistic[0].id, ui.OPTIMISTIC_MESSAGE_ID, 'identifiant temporaire')
  return 'réconciliation ok'
})

check('U05', 'réponse tardive : ajoutée après, sans déplacement des précédents', () => {
  const before = ui.mergeDisplayMessages([msg('u1', 'user', SAME)], { content: 'u1', threadId: 't1', createdAt: SAME })
  const after = ui.mergeDisplayMessages([msg('u1', 'user', SAME), msg('a1', 'assistant', SAME)], null)
  assertEqual(before.map((m) => m.id).join('>'), 'u1', 'avant réponse')
  assertEqual(after.map((m) => m.id).join('>'), 'u1>a1', 'après réponse')
  return 'u1>a1'
})

check('U06', 'dédoublonnage des identifiants répétés', () => {
  const duplicated = [msg('u1', 'user', SAME), msg('u1', 'user', SAME), msg('a1', 'assistant', SAME)]
  assertEqual(ui.mergeDisplayMessages(duplicated, null).length, 2, 'doublons supprimés')
  return '2 messages uniques'
})

check('U07', 'défilement : ouverture de conversation → bas', () => {
  const decision = ui.decideAutoScroll({
    threadChanged: true,
    latestAssistantId: 'a1',
    lastHandledAssistantId: 'a1',
    userScrolledAway: true,
  })
  assertEqual(decision, 'bottom', 'décision')
  return decision
})

check('U08', 'défilement : nouvelle réponse → début de la réponse, une seule fois', () => {
  const first = ui.decideAutoScroll({
    threadChanged: false,
    latestAssistantId: 'a2',
    lastHandledAssistantId: 'a1',
    userScrolledAway: false,
  })
  assertEqual(first, 'assistant-start', 'première décision')
  const second = ui.decideAutoScroll({
    threadChanged: false,
    latestAssistantId: 'a2',
    lastHandledAssistantId: 'a2',
    userScrolledAway: false,
  })
  assertEqual(second, 'none', 'pas de second saut')
  return `${first} puis ${second}`
})

check('U09', 'défilement : lecture manuelle non interrompue', () => {
  const decision = ui.decideAutoScroll({
    threadChanged: false,
    latestAssistantId: 'a3',
    lastHandledAssistantId: 'a2',
    userScrolledAway: true,
  })
  assertEqual(decision, 'none', 'aucun défilement forcé')
  return decision
})

const CRITICAL = [
  'Données partielles sur la période.',
  'Métrique manquante : marge contributive.',
  'Accès interdit au bénéfice net.',
  'Source indisponible : livraison.',
  'Devises mixtes : conversion impossible.',
  'Montant non vérifié exclu du total.',
]

check('U10', 'avertissements équivalents fusionnés (casse, accents, espaces, ponctuation)', () => {
  const summary = ui.summarizeWarnings([
    'Données partielles sur la période.',
    'donnees   partielles sur la periode',
    'DONNÉES PARTIELLES SUR LA PÉRIODE',
  ])
  assertEqual(summary.details.length, 0, 'détails restants')
  assert(summary.duplicatesRemoved >= 2, 'doublons comptés')
  return `${summary.duplicatesRemoved} doublons`
})

check('U11', 'toutes les réserves critiques sont conservées', () => {
  const summary = ui.summarizeWarnings(CRITICAL)
  const all = [summary.summary, ...summary.details].join(' | ')
  for (const text of CRITICAL) {
    assert(all.includes(text.replace(/\.$/, '')), `réserve perdue: ${text}`)
  }
  assertEqual(summary.criticalCount, CRITICAL.length, 'compteur critiques')
  return `${summary.criticalCount} critiques`
})

check('U12', 'marge contributive et bénéfice net jamais fusionnés', () => {
  const summary = ui.summarizeWarnings(['Marge contributive non vérifiée.', 'Bénéfice net non vérifié.'])
  const all = [summary.summary, ...summary.details].join(' | ')
  assert(all.includes('Marge contributive'), 'marge absente')
  assert(all.includes('Bénéfice net'), 'bénéfice absent')
  return 'distinction conservée'
})

check('U13', 'résumé compact : une ligne + section dépliable', () => {
  const summary = ui.summarizeWarnings(CRITICAL)
  assert(summary.summary && summary.summary.length < 220, 'résumé trop long')
  assertEqual(summary.details.length, CRITICAL.length - 1, 'section secondaire')
  assert(WARNINGS_COMPONENT.includes('Voir les limites de l’analyse'), 'libellé dépliable')
  assert(WARNINGS_COMPONENT.includes('<details'), 'section dépliable')
  assertEqual(ui.summarizeWarnings([]).summary, null, 'aucun encadré si aucun avertissement')
  return 'compact'
})

check('U14', 'câblage : page branchée sur les helpers et le composant', () => {
  assert(PAGE.includes("from '@/lib/assistant/chat-ui'"), 'helpers non importés')
  assert(PAGE.includes("from '@/components/assistant/assistant-warnings'"), 'composant non importé')
  assert(PAGE.includes('mergeDisplayMessages'), 'fusion absente')
  assert(PAGE.includes('decideAutoScroll'), 'décision de défilement absente')
  assert(PAGE.includes('assistantMessageRefs'), 'référence DOM stable absente')
  assert(PAGE.includes('prefers-reduced-motion'), 'reduced-motion absent')
  assert(!PAGE.includes('messagesEndRef.current?.scrollIntoView'), 'ancien défilement global encore présent')
  return 'page câblée'
})

check('U15', 'aucune dépendance base, permission ou facturation dans le module UI', () => {
  assert(!/supabase|postgrest|rpc_|ai_credit|credits_charged|billing/i.test(MODULE_SOURCE), 'dépendance interdite')
  assert(!/^import /m.test(MODULE_SOURCE), 'le module doit rester sans import')
  return 'module pur'
})

check('U16', 'rendu : aucun montant interdit réintroduit', () => {
  const summary = ui.summarizeWarnings(CRITICAL)
  const rendered = [summary.summary, ...summary.details].join(' ').replace(/\(\+\d+ autres? limites?\)/, '')
  assert(!/\d{3,}/.test(rendered), 'chiffre inventé dans les avertissements')
  return 'aucun chiffre'
})

console.log('\n=== Tests de régression — interface assistant ===\n')
for (const entry of results) {
  console.log(`${entry.pass ? 'PASS' : 'FAIL'}  ${entry.id.padEnd(4)} ${entry.name}${entry.detail ? ` — ${entry.detail}` : ''}`)
}
const failures = results.filter((entry) => !entry.pass)
console.log(`\nTotal : ${results.length - failures.length}/${results.length} PASS\n`)
process.exit(failures.length === 0 ? 0 : 1)
