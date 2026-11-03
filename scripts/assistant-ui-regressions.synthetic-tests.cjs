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
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

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

check('U10', 'avertissements équivalents fusionnés et regroupés', () => {
  const summary = ui.summarizeWarnings([
    'Données partielles sur la période.',
    'donnees   partielles sur la periode',
    'DONNÉES PARTIELLES SUR LA PÉRIODE',
  ])
  assertEqual(summary.details.length, 1, 'une seule entrée distincte')
  assert(summary.duplicatesRemoved >= 2, 'doublons comptés')
  assertEqual(summary.summary, 'Certaines données sont incomplètes.', 'résumé utilisateur')
  return `${summary.duplicatesRemoved} doublons`
})

check('U11', 'réserves critiques préservées et catégorisées', () => {
  const summary = ui.summarizeWarnings(CRITICAL)
  const all = [summary.summary, ...summary.details].join(' | ')
  for (const fragment of ['partielles', 'manquante', 'interdit', 'indisponible', 'Devises', 'non vérifié']) {
    assert(all.toLowerCase().includes(fragment.toLowerCase()), `réserve perdue: ${fragment}`)
  }
  assertEqual(summary.criticalCount, CRITICAL.length, 'compteur critiques')
  assertEqual(summary.details.length, CRITICAL.length, 'une entrée par réserve distincte')
  return `${summary.criticalCount} réserves`
})

check('U12', 'marge contributive et bénéfice net jamais fusionnés', () => {
  const summary = ui.summarizeWarnings(['Marge contributive non vérifiée.', 'Bénéfice net non vérifié.'])
  const all = [summary.summary, ...summary.details].join(' | ')
  assert(all.includes('Marge contributive'), 'marge absente')
  assert(all.includes('Bénéfice net'), 'bénéfice absent')
  return 'distinction conservée'
})

check('U13', 'résumé synthétique unique + section dépliable', () => {
  const summary = ui.summarizeWarnings(CRITICAL)
  assert(summary.summary && summary.summary.length < 160, 'résumé trop long')
  assert(!/encadré|avertissement\s*:/i.test(summary.summary), 'résumé technique')
  assert(WARNINGS_COMPONENT.includes('Limites de l’analyse'), 'libellé dépliable')
  assert(WARNINGS_COMPONENT.includes('<details'), 'section dépliable')
  assertEqual(ui.summarizeWarnings([]).summary, null, 'aucun encadré si aucun avertissement')
  return 'une ligne + détails'
})

check('U17', 'aucun message interne ni montant dans les avertissements rendus', () => {
  const summary = ui.summarizeWarnings([
    'RPC partiel : scan de secours utilisé',
    'Précision de transport : expression numérique non vérifiable',
    'Montant 1 250 MAD non vérifié',
  ])
  const rendered = [summary.summary, ...summary.details].join(' ')
  for (const forbidden of ['RPC', 'scan de secours', 'précision de transport', 'expression numérique non vérifiable']) {
    assert(!rendered.toLowerCase().includes(forbidden.toLowerCase()), `jargon visible: ${forbidden}`)
  }
  assert(!/\d/.test(rendered), 'chiffre présent dans les avertissements')
  return 'interface propre'
})

check('U18', 'indicateurs clés issus uniquement de metrics_summary', () => {
  const chips = ui.sanitizeMetricsSummary([
    { label: 'Chiffre d’affaires', value: '12 400 MAD' },
    { label: 'Commandes', value: 42 },
    { label: '', value: 'x' },
    { label: 'Vide', value: '' },
    { label: 'Objet', value: { a: 1 } },
  ])
  assertEqual(chips.length, 2, 'entrées invalides écartées')
  assertEqual(chips[1].value, '42', 'valeur numérique convertie')
  return chips.map((chip) => chip.label).join(' + ')
})

check('U19', 'graphique affiché seulement avec des données structurées suffisantes', () => {
  assertEqual(ui.hasUsableChart({ chart: false, chart_data: [{ a: 1, b: 2 }, { a: 2, b: 3 }] }), false, 'chart=false')
  assertEqual(ui.hasUsableChart({ chart: true, chart_data: [{ a: 1, b: 2 }] }), false, 'un seul point')
  assertEqual(ui.hasUsableChart({ chart: true, chart_data: [{ a: 1 }, { a: 2 }] }), false, 'une seule dimension')
  assertEqual(
    ui.hasUsableChart({ chart: true, chart_data: [{ label: 'lun', value: 10 }, { label: 'mar', value: 12 }] }),
    true,
    'série exploitable'
  )
  assert(PAGE.includes('hasUsableChart'), 'garde graphique non branchée')
  return 'garde graphique'
})

check('U14', 'câblage : page branchée sur les helpers et le composant', () => {
  assert(PAGE.includes("from '@/lib/assistant/chat-ui'"), 'helpers non importés')
  assert(PAGE.includes("from '@/components/assistant/assistant-warnings'"), 'composant non importé')
  assert(PAGE.includes('mergeDisplayMessages'), 'fusion absente')
  assert(PAGE.includes('decideAutoScroll'), 'décision de défilement absente')
  assert(PAGE.includes('assistantMessageRefs'), 'référence DOM stable absente')
  assert(PAGE.includes('prefers-reduced-motion'), 'reduced-motion absent')
  assert(PAGE.includes('sanitizeMetricsSummary'), 'indicateurs clés non branchés')
  assert(PAGE.includes('positionMessages'), 'positionnement centralisé absent')
  assert(!PAGE.includes('messagesEndRef.current?.scrollIntoView'), 'ancien défilement global encore présent')
  return 'page câblée'
})

check('U20', 'un seul positionnement, jamais de remontée automatique', () => {
  const occurrences = (PAGE.match(/container\.scrollTo\(/g) || []).length
  assert(occurrences >= 1, 'aucun positionnement')
  assert(PAGE.includes('Math.max(container.scrollTop'), 'garde anti-remontée absente')
  assertEqual(
    (PAGE.match(/requestAnimationFrame\(\(\) =>\s*\{?\s*requestAnimationFrame/g) || []).length,
    2,
    'deux effets seulement (fil/réponse + révélation du message)'
  )
  assert(!/sendMessageMutation\.isPending[\s\S]{0,200}scrollTo/.test(PAGE), 'effet de scroll concurrent sur isPending')
  return `${occurrences} appels centralisés`
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

const VOICE_PANEL = fs.readFileSync(path.join(ROOT, 'components/assistant/assistant-voice-panel.tsx'), 'utf8')
const BLOCKS_COMPONENT = fs.readFileSync(path.join(ROOT, 'components/assistant/assistant-blocks.tsx'), 'utf8')

check('U21', 'panneau vocal dédié, aucune superposition dans le champ', () => {
  assert(PAGE.includes('AssistantVoicePanel'), 'panneau vocal non branché')
  assert(PAGE.includes('waveformCanvasRef'), 'onde sonore non branchée')
  assert(VOICE_PANEL.includes('role="group"'), 'groupe d’enregistrement absent')
  assert(!PAGE.includes('absolute inset-0 flex items-center gap-2 rounded-lg px-3'), 'superposition héritée encore présente')
  assert(!PAGE.includes('mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-red-200'), 'ancienne barre séparée encore présente')
  return 'panneau dédié'
})

check('U22', 'quatre contrôles ordonnés : annuler, onde, arrêter, envoyer', () => {
  const cancel = VOICE_PANEL.indexOf('labels.cancel')
  const canvas = VOICE_PANEL.indexOf('<canvas')
  const stop = VOICE_PANEL.indexOf('labels.stop')
  const send = VOICE_PANEL.indexOf('labels.send')
  assert(cancel > -1 && canvas > -1 && stop > -1 && send > -1, 'contrôle manquant')
  assert(cancel < canvas && canvas < stop && stop < send, 'ordre des contrôles incohérent')
  return 'X → onde → arrêter → envoyer'
})

check('U23', 'durée jamais fournie par le navigateur', () => {
  assert(!PAGE.includes('durationMs'), 'durée cliente encore envoyée')
  assert(PAGE.includes('encodeWav'), 'conversion WAV absente')
  assert(PAGE.includes("'audio/wav'"), 'type WAV absent')
  return 'WAV serveur'
})

check('U24', 'onde flexible, cibles tactiles de 44 px', () => {
  assert(VOICE_PANEL.includes('h-9 min-w-0 flex-1'), 'onde non flexible')
  assert(VOICE_PANEL.includes('h-11 w-full'), 'rangée vocale non compacte')
  assert(VOICE_PANEL.includes('h-9 w-9'), 'cible tactile insuffisante')
  assert(PAGE.includes("recording || transcribing ? 'hidden' : ''"), 'champ non masqué pendant l’enregistrement')
  return 'onde élargie sans boutons externes'
})

check('U25', 'enregistrement aux couleurs Jisra, sans rouge décoratif', () => {
  assert(!VOICE_PANEL.includes('border-red-300'), 'bordure rouge encore présente')
  assert(!VOICE_PANEL.includes('bg-red-500'), 'point d’enregistrement rouge')
  assert(!VOICE_PANEL.includes('#dc2626'), 'onde rouge codée en dur')
  assert(VOICE_PANEL.includes('text-primary'), 'couleur de thème absente de l’onde')
  return 'thème Jisra'
})

check('U26', 'alignement et compacité du compositeur', () => {
  assert(VOICE_PANEL.includes('items-center gap-2'), 'ligne non alignée')
  assert(VOICE_PANEL.includes('tabular-nums'), 'durée non stabilisée')
  assert(PAGE.includes('text-base leading-6'), 'police de saisie sous 16 px (zoom iOS)')
  assert(PAGE.includes('Math.min(132'), 'croissance du champ non plafonnée')
  return 'aligné'
})

check('U29', 'rendu des blocs : tableaux et valeurs LTR', () => {
  assert(BLOCKS_COMPONENT.includes('role="region"'), 'tableau sans région accessible')
  assert(/dir=\"ltr\"/.test(BLOCKS_COMPONENT), 'valeurs non isolées en LTR')
  assert(!/<[a-z]+[^>]*dangerouslySetInnerHTML/.test(BLOCKS_COMPONENT), 'HTML brut injecté')
  return 'blocs sûrs'
})

check('U27', 'drawer mobile : hamburger, overlay et glissement', () => {
  assert(PAGE.includes('aria-label="Ouvrir les conversations"'), 'hamburger absent')
  assert(PAGE.includes('id="threads-drawer"'), 'drawer absent')
  assert(PAGE.includes('aria-modal={threadsOpen}'), 'drawer non modal')
  assert(PAGE.includes('onClick={closeThreads}'), 'overlay sans fermeture')
  return 'drawer accessible'
})

check('U28', 'sélection ferme le drawer, création accessible', () => {
  assert(PAGE.includes('setThreadsOpen(false)'), 'fermeture absente')
  assert(PAGE.includes('aria-label="Nouvelle conversation"'), 'création mobile absente')
  return 'ok'
})

check('U29', 'hauteur mobile, safe area et scroll unique', () => {
  const rootLayout = fs.readFileSync(path.join(ROOT, 'app/layout.tsx'), 'utf8')
  const appLayout = fs.readFileSync(path.join(ROOT, 'app/(app)/layout-client.tsx'), 'utf8')
  assert(rootLayout.includes('interactiveWidget') && rootLayout.includes('resizes-content'), 'clavier virtuel non géré (interactive-widget)')
  assert(appLayout.includes('h-dvh'), 'hauteur viewport dynamique absente')
  assert(PAGE.includes('env(safe-area-inset-bottom)'), 'safe area absente')
  assert(PAGE.includes('overscroll-contain'), 'scroll contenu absent')
  assert(PAGE.includes('overflow-hidden'), 'débordement page non bloqué')
  return 'mobile plein écran'
})

check('U30', 'Escape ferme le drawer et focus géré', () => {
  assert(PAGE.includes("event.key === 'Escape'"), 'Escape absent')
  assert(PAGE.includes('threadsDrawerRef.current?.focus()'), 'focus initial absent')
  assert(PAGE.includes('threadsButtonRef.current?.focus()'), 'retour du focus absent')
  return 'accessibilité'
})

check('U33', 'Un seul panneau mobile et déclencheurs distincts', () => {
  const layout = fs.readFileSync(path.join(ROOT, 'app/(app)/layout-client.tsx'), 'utf8')
  const sidebar = fs.readFileSync(path.join(ROOT, 'components/dashboard/sidebar.tsx'), 'utf8')
  assert(layout.includes('MobileNavigationContext.Provider'), 'état des panneaux non partagé')
  assert(sidebar.includes("panel === 'navigation'"), 'menu Jisra non coordonné')
  assert(PAGE.includes("panel === 'conversations'"), 'conversations non coordonnées')
  assert(PAGE.includes('data-assistant-nav-toggle'), 'bouton principal mobile absent')
  assert(sidebar.includes("pathname === '/ai-assistant' ? 'hidden'"), 'déclencheurs superposables')
  assert(sidebar.includes("event.key === 'Escape'") && PAGE.includes("event.key === 'Escape'"), 'Escape incomplet')
  return 'navigation/conversations exclusives'
})

check('U31', 'RTL : contenus en dir auto, graphiques en LTR', () => {
  assert(PAGE.includes('dir="auto"'), 'direction automatique absente')
  assert(PAGE.includes('dir="ltr"'), 'chiffres non isolés en LTR')
  const chart = fs.readFileSync('components/assistant/assistant-chart-card.tsx', 'utf8')
  assert(chart.includes('dir="ltr"'), 'graphique sans direction LTR')
  return 'bidirectionnel'
})

check('U34', 'DOM réel : RTL, chiffres isolés, tableau vérifié et français non inversé', () => {
  const loadComponent = (filename) => {
    const file = path.join(ROOT, 'components/assistant', filename)
    const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText
    const m = { exports: {} }
    vm.runInThisContext(`(function(require,module,exports){${js}\n})`, { filename: file })((id) => id === 'react/jsx-runtime' ? require(id) : id === 'react' ? React : {}, m, m.exports)
    return m.exports
  }
  const message = loadComponent('assistant-message-content.tsx')
  const table = loadComponent('assistant-comparison-table.tsx')
  const ar = '## المقارنة\n- رقم المعاملات 1 250 MAD (2025-10-01)\n1. النسبة -12.5% و Boutique Atlas'
  assertEqual(message.messageDirection(ar), 'rtl', 'darija mixte')
  assertEqual(message.messageDirection('## Analyse\nCA 1 250 MAD'), 'ltr', 'français')
  const html = renderToStaticMarkup(React.createElement(message.default, { content: ar, direction: 'rtl' }))
  assert(html.includes('dir="rtl"') && html.includes('lang="ar"') && html.includes('<h3'), 'structure RTL non rendue')
  assert(html.includes('<bdi dir="ltr">1 250 MAD</bdi>') && html.includes('<bdi dir="ltr">-12.5%</bdi>'), 'montants/taux non isolés')
  assert(html.includes('Boutique Atlas') && !html.includes('dangerouslySetInnerHTML'), 'nom boutique altéré ou HTML brut')
  const comparison = renderToStaticMarkup(React.createElement(table.default, {
    direction: 'rtl', table: { currentLabel: 'أكتوبر 2025', baselineLabel: 'أكتوبر 2026', rows: [{ label: 'الطلبات', current: '100', baseline: '120', delta: '-20' }] },
  }))
  assert(comparison.includes('<table dir="rtl"') && comparison.includes('<bdi dir="ltr">-20</bdi>'), 'tableau RTL ou écart incorrect')
  assert(comparison.includes('overflow-x-auto') && comparison.includes('tabindex="0"'), 'tableau mobile non défilable')
  return 'React SSR : titres, listes, montants et tableau'
})

check('U32', 'drawer au-dessus du bouton flottant SaaS', () => {
  assert(PAGE.includes('z-[70]'), 'drawer sous la navigation principale')
  assert(PAGE.includes('z-[60]'), 'overlay sous la navigation principale')
  return 'z-index'
})

console.log('\n=== Tests de régression — interface assistant ===\n')
for (const entry of results) {
  console.log(`${entry.pass ? 'PASS' : 'FAIL'}  ${entry.id.padEnd(4)} ${entry.name}${entry.detail ? ` — ${entry.detail}` : ''}`)
}
const failures = results.filter((entry) => !entry.pass)
console.log(`\nTotal : ${results.length - failures.length}/${results.length} PASS\n`)
process.exit(failures.length === 0 ? 0 : 1)
