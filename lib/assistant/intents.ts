import type { AnalyticsRange, AssistantIntent } from '@/lib/assistant/types'

const GREETINGS = ['bonjour', 'salut', 'bonsoir', 'hello', 'coucou']

function normalizeIntentText(message: string) {
  return message
    .toLowerCase()
    .replace(/[^a-zàâäçéèêëîïôöùûüÿñæœ0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function resolveRangeFromQuestion(message: string): AnalyticsRange {
  const text = message.toLowerCase()

  if (text.includes('hier')) return 'yesterday'
  if (text.includes('30 derniers jours') || text.includes('30 jours')) return '30d'
  if (text.includes('mois dernier')) return 'last_month'
  if (text.includes('ce mois') || text.includes('mois en cours')) return 'month'

  return '7d'
}

export function resolveIntent(message: string): AssistantIntent {
  const text = message.toLowerCase()
  const normalized = normalizeIntentText(message)

  if (GREETINGS.some((g) => normalized === g || normalized.startsWith(`${g} `))) {
    return 'greeting'
  }

  if (text.includes('ça va') || text.includes('merci')) {
    return 'small_talk'
  }

  if (text.includes('compare') || text.includes('vs') || text.includes('versus')) {
    return 'comparison_request'
  }

  if (text.includes('graph') || text.includes('courbe') || text.includes('chart')) {
    return 'chart_request'
  }

  if (text.includes('performance') || text.includes('performances')) {
    return 'performance_request'
  }

  if (
    text.includes('analyse mon business') ||
    text.includes('résumé') ||
    text.includes('tableau de bord')
  ) {
    return 'dashboard_summary'
  }

  if (text.includes('meilleur produit') || text.includes('top produit') || text.includes('plus rentable')) {
    return 'top_products'
  }

  if (text.includes('publicité') || text.includes('ads') || text.includes('roas')) {
    return 'ads_analysis'
  }

  if (text.includes('profit') || text.includes('gagné') || text.includes('marge')) {
    return 'profit_analysis'
  }

  if (text.includes('stock')) {
    return 'stock_analysis'
  }

  if (text.includes('fournisseur')) {
    return 'supplier_summary'
  }

  if (text.includes('commande récente') || text.includes('dernières commandes')) {
    return 'recent_orders'
  }

  return 'generic_business_chat'
}

export function asksForOtherStore(message: string) {
  const text = message.toLowerCase()
  return (
    text.includes('autre store') ||
    text.includes('autre magasin') ||
    text.includes('autre boutique') ||
    text.includes('un autre store')
  )
}
