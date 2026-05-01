#!/usr/bin/env node

/**
 * Script de migration des routes dashboard/FR → routes EN indépendantes
 * 
 * Table de mapping :
 *   /dashboard/ventes         → /sales
 *   /dashboard/produits       → /products
 *   /dashboard/stocks         → /stock
 *   /dashboard/fournisseurs   → /suppliers
 *   /dashboard/publicite      → /advertising
 *   /dashboard/depenses       → /expenses
 *   /dashboard/integrations   → /integrations
 *   /dashboard/livraison      → /delivery
 *   /dashboard/assistant-ia   → /ai-assistant
 *   /dashboard/personnel      → /staff
 *   /dashboard/abonnement     → /subscription
 *   /dashboard/parametres     → /settings
 */

import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

const ROOT = path.resolve(import.meta.dirname, '..')

// ── 1. Table de mapping ──────────────────────────────────────────────
const MAPPING = [
  { from: 'ventes',         to: 'sales' },
  { from: 'produits',       to: 'products' },
  { from: 'stocks',         to: 'stock' },
  { from: 'fournisseurs',   to: 'suppliers' },
  { from: 'publicite',      to: 'advertising' },
  { from: 'depenses',       to: 'expenses' },
  { from: 'integrations',   to: 'integrations' },
  { from: 'livraison',      to: 'delivery' },
  { from: 'assistant-ia',   to: 'ai-assistant' },
  { from: 'personnel',      to: 'staff' },
  { from: 'abonnement',     to: 'subscription' },
  { from: 'parametres',     to: 'settings' },
]

// ── 2. Déplacer les dossiers ─────────────────────────────────────────
const DASHBOARD_DIR = path.join(ROOT, 'app', 'dashboard')
const APP_DIR = path.join(ROOT, 'app')
const GROUP_DIR = path.join(APP_DIR, '(app)')

// Créer le route group (app)
if (!fs.existsSync(GROUP_DIR)) {
  fs.mkdirSync(GROUP_DIR, { recursive: true })
}

for (const { from, to } of MAPPING) {
  const src = path.join(DASHBOARD_DIR, from)
  const dst = path.join(GROUP_DIR, to)

  if (!fs.existsSync(src)) {
    console.warn(`⚠  Source introuvable : ${src}`)
    continue
  }

  if (fs.existsSync(dst)) {
    console.warn(`⚠  Destination existe déjà : ${dst}`)
    continue
  }

  try {
    execSync(`git mv "${src}" "${dst}"`, { cwd: ROOT, stdio: 'pipe' })
    console.log(`✓ Déplacé : app/dashboard/${from} → app/(app)/${to}`)
  } catch {
    // fallback si pas git
    fs.cpSync(src, dst, { recursive: true })
    fs.rmSync(src, { recursive: true, force: true })
    console.log(`✓ Copié (fallback) : app/dashboard/${from} → app/(app)/${to}`)
  }
}

// ── 3. Déplacer app/dashboard/page.tsx dans (app)/dashboard/ ─────────
const DASHBOARD_PAGE_SRC = path.join(DASHBOARD_DIR, 'page.tsx')
const DASHBOARD_PAGE_DST = path.join(GROUP_DIR, 'dashboard', 'page.tsx')

if (fs.existsSync(DASHBOARD_PAGE_SRC)) {
  if (!fs.existsSync(path.join(GROUP_DIR, 'dashboard'))) {
    fs.mkdirSync(path.join(GROUP_DIR, 'dashboard'), { recursive: true })
  }
  try {
    execSync(`git mv "${DASHBOARD_PAGE_SRC}" "${DASHBOARD_PAGE_DST}"`, { cwd: ROOT, stdio: 'pipe' })
  } catch {
    fs.cpSync(DASHBOARD_PAGE_SRC, DASHBOARD_PAGE_DST, { recursive: true })
    fs.rmSync(DASHBOARD_PAGE_SRC, { force: true })
  }
  console.log('✓ Déplacé : app/dashboard/page.tsx → app/(app)/dashboard/page.tsx')
}

// ── 4. Créer le nouveau layout (app) ─────────────────────────────────
const NEW_LAYOUT = `'use client'

import Sidebar from '@/components/dashboard/sidebar'
import { usePathname } from 'next/navigation'

export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const isAssistantPage = pathname === '/ai-assistant'

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <main className={isAssistantPage ? 'flex-1 overflow-hidden p-0' : 'flex-1 overflow-y-auto p-6'}>
          {children}
        </main>
      </div>
    </div>
  )
}
`

fs.writeFileSync(path.join(GROUP_DIR, 'layout.tsx'), NEW_LAYOUT, 'utf-8')
console.log('✓ Créé : app/(app)/layout.tsx (sidebar seule, sans header)')

// ── 5. Supprimer l'ancien layout dashboard ───────────────────────────
const OLD_LAYOUT = path.join(DASHBOARD_DIR, 'layout.tsx')
if (fs.existsSync(OLD_LAYOUT)) {
  try {
    execSync(`git rm "${OLD_LAYOUT}"`, { cwd: ROOT, stdio: 'pipe' })
  } catch {
    fs.rmSync(OLD_LAYOUT, { force: true })
  }
  console.log('✓ Supprimé : app/dashboard/layout.tsx')
}

// ── 6. Remplacer les chemins dans tous les fichiers du projet ────────
const URL_MAP = [
  { old: "'/dashboard/ventes'",         new: "'/sales'" },
  { old: '"/dashboard/ventes"',         new: '"/sales"' },
  { old: "'/dashboard/produits'",       new: "'/products'" },
  { old: '"/dashboard/produits"',       new: '"/products"' },
  { old: "'/dashboard/stocks'",         new: "'/stock'" },
  { old: '"/dashboard/stocks"',         new: '"/stock"' },
  { old: "'/dashboard/fournisseurs'",   new: "'/suppliers'" },
  { old: '"/dashboard/fournisseurs"',   new: '"/suppliers"' },
  { old: "'/dashboard/publicite'",      new: "'/advertising'" },
  { old: '"/dashboard/publicite"',      new: '"/advertising"' },
  { old: "'/dashboard/depenses'",       new: "'/expenses'" },
  { old: '"/dashboard/depenses"',       new: '"/expenses"' },
  { old: "'/dashboard/integrations'",   new: "'/integrations'" },
  { old: '"/dashboard/integrations"',   new: '"/integrations"' },
  { old: "'/dashboard/livraison'",      new: "'/delivery'" },
  { old: '"/dashboard/livraison"',      new: '"/delivery"' },
  { old: "'/dashboard/assistant-ia'",   new: "'/ai-assistant'" },
  { old: '"/dashboard/assistant-ia"',   new: '"/ai-assistant"' },
  { old: "'/dashboard/personnel'",      new: "'/staff'" },
  { old: '"/dashboard/personnel"',      new: '"/staff"' },
  { old: "'/dashboard/abonnement'",     new: "'/subscription'" },
  { old: '"/dashboard/abonnement"',     new: '"/subscription"' },
  { old: "'/dashboard/parametres'",     new: "'/settings'" },
  { old: '"/dashboard/parametres"',     new: '"/settings"' },
]

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.md', '.sql', '.json', '.env', '.env.local']

function walkDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.next') continue
      files.push(...walkDir(full))
    } else {
      files.push(full)
    }
  }
  return files
}

const allFiles = walkDir(ROOT)
let totalReplacements = 0

for (const file of allFiles) {
  const ext = path.extname(file)
  if (!EXTENSIONS.includes(ext)) continue

  let content = fs.readFileSync(file, 'utf-8')
  let changed = false

  for (const { old, new: newVal } of URL_MAP) {
    if (content.includes(old)) {
      content = content.replaceAll(old, newVal)
      changed = true
      totalReplacements++
    }
  }

  if (changed) {
    fs.writeFileSync(file, content, 'utf-8')
    console.log(`  ↻  ${path.relative(ROOT, file)}`)
  }
}

console.log(`\n✓ Substitutions effectuées : ${totalReplacements} remplacements dans les fichiers`)

// ── 7. Nettoyer le dossier dashboard s'il est vide ───────────────────
const remaining = fs.readdirSync(DASHBOARD_DIR)
if (remaining.length === 0) {
  try {
    execSync(`git rm -r "${DASHBOARD_DIR}"`, { cwd: ROOT, stdio: 'pipe' })
  } catch {
    fs.rmSync(DASHBOARD_DIR, { recursive: true, force: true })
  }
  console.log('✓ Dossier app/dashboard/ supprimé (vide)')
} else {
  console.log(`ℹ  Dossier app/dashboard/ non vide, reste : ${remaining.join(', ')}`)
}

console.log('\n✅ Migration terminée !')
