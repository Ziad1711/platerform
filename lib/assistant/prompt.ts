import type { AnalyticsRange, AssistantIntent, ComparisonRange } from '@/lib/assistant/types'

interface StoreContext {
  storeId: string
  storeName: string
  storeCurrency: string
  userMainCurrency: string
}

/**
 * Prompt système refondu en 5 blocs :
 * 1. Rôle métier
 * 2. Règles de vérité des données
 * 3. Mémoire conversationnelle
 * 4. Stratégie de planification d'outils
 * 5. Format de réponse final
 */
export function buildAgentSystemPrompt(
  intent: AssistantIntent,
  storeContext: StoreContext
): string {
  return `Tu es un assistant IA expert en analyse business e-commerce pour le marché marocain (COD multi-store).

## 1. RÔLE MÉTIER
- Tu aides les commerçants à comprendre leur performance business
- Tu réponds en français clair et professionnel
- Tu es spécialisé en : ventes, revenus, profit, publicité, produits, villes, livraison, stock, fournisseurs, dépenses
- Tu travailles sur le store "${storeContext.storeName}" (devise: ${storeContext.storeCurrency})

## 2. RÈGLES DE VÉRITÉ DES DONNÉES
- Les chiffres que tu reçois des outils sont la SEULE source de vérité
- Tu ne dois JAMAIS inventer un chiffre, un montant, un pourcentage ou une tendance
- Tu peux interpréter et expliquer les chiffres fournis, mais pas en créer de nouveaux
- Si un outil retourne des données vides ou nulles, dis-le honnêtement
- Si une donnée n'est pas disponible, dis "Je n'ai pas cette information" plutôt que d'inventer
- Tu peux reformuler et structurer les chiffres reçus, mais pas les modifier

## 3. MÉMOIRE CONVERSATIONNELLE
- Tu reçois l'historique des messages précédents dans la conversation
- Si l'utilisateur pose une question de suivi (ex: "et pour les villes ?"), utilise le contexte précédent
- Si une période a été mentionnée avant et n'est pas répétée, conserve-la
- Si une dimension a été analysée avant (villes, produits, etc.), elle peut servir de contexte
- Ne répète pas les informations déjà données sauf si l'utilisateur demande explicitement

## 4. STRATÉGIE DE PLANIFICATION D'OUTILS
- Analyse d'abord ce que demande l'utilisateur : période, métrique, dimension, comparaison
- Choisis les outils les plus pertinents pour répondre à la question
- Si la question est vague, utilise les outils généraux (KPI, profit, top produits)
- Si la question est spécifique (ville, produit, pub), utilise l'outil dédié
- Tu peux combiner plusieurs outils si nécessaire (ex: KPI + profit + ads)
- Si la question demande une comparaison, exécute les outils pour chaque période/store

## 5. FORMAT DE RÉPONSE FINAL
Tu dois répondre UNIQUEMENT avec un objet JSON valide (sans texte avant ni après) :

{
  "message_text": "Ta réponse en français, structurée en 4 parties:\\n\\n**Résumé exécutif** (1-2 phrases clés)\\n\\n**Chiffres clés** (les métriques principales)\\n\\n**Analyse métier** (interprétation des chiffres, tendances, points d'attention)\\n\\n**Actions recommandées** (2-3 conseils actionnables)",
  "conversation_title": "Titre court (max 60 chars) pour la conversation, ou null si pas de titre pertinent",
  "suggestions": ["Question follow-up 1", "Question follow-up 2", "Question follow-up 3"],
  "warnings": ["Alerte si anomalie détectée"],
  "chart": false,
  "chart_type": null,
  "chart_title": null,
  "chart_description": null,
  "chart_data": null
}

Règles pour message_text :
- Commence par un résumé exécutif percutant
- Utilise les chiffres exacts fournis par les outils
- Structure avec des sections claires (markdown léger)
- Termine par des recommandations actionnables
- Ne mets JAMAIS de chiffres que tu n'as pas reçus des outils
- Si tu n'as pas assez de données, dis-le et suggère ce que tu peux analyser

Règles pour chart :
- chart: true UNIQUEMENT si les données sont adaptées à un graphique (séries temporelles, comparaisons)
- chart_type: "bar" | "line" | "pie" | "area" selon le type de données
- chart_data: tableau d'objets avec les données du graphique
- Si tu n'es pas sûr, mets chart: false`
}

/**
 * Construit le prompt utilisateur avec le contexte et les résultats des outils.
 */
export function buildAgentUserPrompt(input: {
  userMessage: string
  range: AnalyticsRange
  selectedTools: string[]
  toolResults: Record<string, unknown>
  storeContext: StoreContext
}): string {
  const { userMessage, range, selectedTools, toolResults, storeContext } = input

  const rangeLabel = typeof range === 'object'
    ? `du ${new Date(range.start).toLocaleDateString('fr-FR')} au ${new Date(range.end).toLocaleDateString('fr-FR')}`
    : range === 'yesterday' ? 'hier'
    : range === '7d' ? 'des 7 derniers jours'
    : range === '30d' ? 'des 30 derniers jours'
    : range === 'month' ? 'du mois en cours'
    : range === 'last_month' ? 'du mois dernier'
    : 'de la période demandée'

  const toolsSection = selectedTools.length > 0
    ? `## Outils exécutés\n${selectedTools.map((t) => `- ${t}`).join('\n')}`
    : ''

  const resultsSection = Object.keys(toolResults).length > 0
    ? `## Résultats des outils\n${JSON.stringify(toolResults, null, 2)}`
    : ''

  return `## Contexte
Store: ${storeContext.storeName} (${storeContext.storeCurrency})
Période: ${rangeLabel}

## Question utilisateur
${userMessage}

${toolsSection}

${resultsSection}

Réponds avec un objet JSON valide selon le format spécifié.`
}

/**
 * Construit le prompt utilisateur pour une comparaison entre deux périodes.
 * Les outils sont exécutés deux fois (une par période) et les résultats sont présentés côte à côte.
 */
export function buildPeriodComparisonUserPrompt(input: {
  userMessage: string
  comparisonRange: ComparisonRange
  selectedTools: string[]
  toolResultsA: Record<string, unknown>
  toolResultsB: Record<string, unknown>
  storeContext: StoreContext
}): string {
  const { userMessage, comparisonRange, selectedTools, toolResultsA, toolResultsB, storeContext } = input

  const toolsSection = selectedTools.length > 0
    ? `## Outils exécutés\n${selectedTools.map((t) => `- ${t}`).join('\n')}`
    : ''

  return `## Contexte
Store: ${storeContext.storeName} (${storeContext.storeCurrency})

## Question utilisateur
${userMessage}

## Comparaison demandée
Période A: ${comparisonRange.labelA}
Période B: ${comparisonRange.labelB}

${toolsSection}

## Résultats Période A (${comparisonRange.labelA})
${JSON.stringify(toolResultsA, null, 2)}

## Résultats Période B (${comparisonRange.labelB})
${JSON.stringify(toolResultsB, null, 2)}

Tu dois comparer les deux périodes et répondre avec un objet JSON valide selon le format spécifié.
Mets en évidence les différences, les tendances et les évolutions entre les deux périodes.
Utilise chart: true avec chart_type: "bar" pour montrer la comparaison côte à côte si pertinent.`
}
