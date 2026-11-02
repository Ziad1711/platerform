#!/usr/bin/env node
/** Fixture locale sans session, sans API, pour inspecter les composants réels dans Chromium. */
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

const root = process.cwd()
function component(name) {
  const file = path.join(root, 'components/assistant', name)
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', js)((id) => id === 'react' ? React : id === 'react/jsx-runtime' ? require(id) : {}, module, module.exports)
  return module.exports
}
const Message = component('assistant-message-content.tsx')
const Table = component('assistant-comparison-table.tsx').default
const ar = '## مقارنة أكتوبر 2025 / أكتوبر 2026\n**الخلاصة**: الطلبات زادت ولكن CA نقص.\n\n- رقم المعاملات: 1 250 MAD\n1. نسبة التسليم -12.5% فـ 2026-10-01 و Boutique Atlas'
const fr = '## Comparaison octobre 2025 / octobre 2026\n**Verdict** : commandes et CA évoluent différemment.\n- Montant 1 250 MAD.'
const table = { currentLabel: 'أكتوبر 2025', baselineLabel: 'أكتوبر 2026', rows: [
  { label: 'الطلبات', current: '100', baseline: '120', delta: '-20' },
  { label: 'رقم المعاملات', current: '1 250 MAD', baseline: '900 MAD', delta: '+350 MAD' },
  { label: 'نسبة التسليم', current: '80 %', baseline: '50 %', delta: '—' },
] }
const div = (props, ...children) => React.createElement('div', props, ...children)
const bubble = (content, extra) => div({ className: 'mx-3 my-4 max-w-[92%] rounded-2xl border p-3 text-sm leading-6 sm:max-w-[85%]' },
  React.createElement(Message.default, { content, direction: Message.messageDirection(content) }), extra)
const html = renderToStaticMarkup(div({ className: 'mx-auto max-w-[700px] overflow-hidden' },
  bubble(ar, React.createElement(Table, { table, direction: 'rtl' })),
  bubble(fr),
  bubble('## Résumé\n- Première observation en français, puis: الطلبات كثيرة و 1 250 MAD.'),
  div({ dir: 'rtl', className: 'm-3 flex flex-wrap gap-2' }, React.createElement('button', { dir: 'auto', className: 'rounded-full border px-3 py-1 text-start' }, 'وريني المبيعات')),
))
const cssDir = path.join(root, '.next/static/chunks')
const cssFile = fs.readdirSync(cssDir).find((name) => name.endsWith('.css'))
http.createServer((req, res) => {
  if (req.url === '/style.css') {
    res.writeHead(200, { 'Content-Type': 'text/css' })
    res.end(fs.readFileSync(path.join(cssDir, cssFile)))
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(`<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body>${html}</body></html>`)
}).listen(3000, '127.0.0.1', () => console.log('Assistant render fixture ready on 3000'))