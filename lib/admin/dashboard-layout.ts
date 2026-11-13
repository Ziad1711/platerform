'use client'

import { useSyncExternalStore } from 'react'

/** Une entrée = une section affichable du dashboard. */
export const DASHBOARD_WIDGETS = [
  { id: 'kpis', label: 'Indicateurs principaux' },
  { id: 'series', label: 'Évolution quotidienne' },
  { id: 'plans', label: 'Répartition des offres' },
  { id: 'revenue', label: 'Revenus récurrents' },
  { id: 'money', label: 'Encaissements et charges' },
  { id: 'coverage', label: 'Couverture et limites' },
] as const

export type DashboardWidgetId = (typeof DASHBOARD_WIDGETS)[number]['id']
export const DEFAULT_WIDGET_ORDER: DashboardWidgetId[] = DASHBOARD_WIDGETS.map((widget) => widget.id)
const LAYOUT_STORAGE_KEY = 'jisra.admin.dashboard.layout.v1'

type LayoutState = { order: DashboardWidgetId[]; hidden: DashboardWidgetId[] }
const KNOWN_IDS = new Set<string>(DEFAULT_WIDGET_ORDER)
const DEFAULT_SNAPSHOT: LayoutState = { order: [...DEFAULT_WIDGET_ORDER], hidden: [] }

export function sanitizeLayout(raw: string | null): LayoutState {
  if (!raw) return { order: [...DEFAULT_WIDGET_ORDER], hidden: [] }
  try {
    const parsed = JSON.parse(raw) as Partial<LayoutState>
    const requested = Array.isArray(parsed.order)
      ? parsed.order.filter((id): id is DashboardWidgetId => KNOWN_IDS.has(id))
      : []
    const order = requested.filter((id, index) => requested.indexOf(id) === index)
    const hidden = Array.isArray(parsed.hidden)
      ? parsed.hidden.filter((id): id is DashboardWidgetId => KNOWN_IDS.has(id))
        .filter((id, index, list) => list.indexOf(id) === index)
      : []
    return { order: [...order, ...DEFAULT_WIDGET_ORDER.filter((id) => !order.includes(id))], hidden }
  } catch { return { order: [...DEFAULT_WIDGET_ORDER], hidden: [] } }
}

/* Petit magasin externe : le stockage navigateur est la seule source de vérité.
   Aucune écriture serveur, aucune migration. */
const listeners = new Set<() => void>()
let snapshot: LayoutState | null = null

function readStorage(): LayoutState {
  try { return sanitizeLayout(window.localStorage.getItem(LAYOUT_STORAGE_KEY)) } catch { return DEFAULT_SNAPSHOT }
}
function getSnapshot(): LayoutState {
  if (!snapshot) snapshot = readStorage()
  return snapshot
}
function getServerSnapshot(): LayoutState {
  return DEFAULT_SNAPSHOT
}
function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = () => { snapshot = null; listeners.forEach((notify) => notify()) }
  window.addEventListener('storage', onStorage)
  return () => { listeners.delete(listener); window.removeEventListener('storage', onStorage) }
}
function commit(next: LayoutState) {
  snapshot = next
  try { window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(next)) } catch { /* stockage indisponible */ }
  listeners.forEach((notify) => notify())
}

/** Préférences locales d'affichage et d'ordre des widgets. */
export function useDashboardLayout() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const toggle = (id: DashboardWidgetId) => commit({
    order: state.order,
    hidden: state.hidden.includes(id) ? state.hidden.filter((item) => item !== id) : [...state.hidden, id],
  })

  const move = (id: DashboardWidgetId, direction: -1 | 1) => {
    const index = state.order.indexOf(id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= state.order.length) return
    const order = [...state.order]
    ;[order[index], order[target]] = [order[target], order[index]]
    commit({ order, hidden: state.hidden })
  }

  const reset = () => commit({ order: [...DEFAULT_WIDGET_ORDER], hidden: [] })

  return { ...state, toggle, move, reset }
}

export type DashboardLayout = ReturnType<typeof useDashboardLayout>
