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
 * 4. Lecture du plan d'outils exécuté côté serveur
 * 5. Format de réponse final
 */
export function buildAgentSystemPrompt(
  intent: AssistantIntent,
  storeContext: StoreContext,
  language: 'fr' | 'ar' = 'fr'
): string {
  const languageRule = language === 'ar'
    ? '- La question est en arabe ou en darija : réponds dans la même langue (arabe/darija), sans traduire les noms de produits, marques ou boutiques.'
    : '- La question est en français : réponds en français clair et professionnel.'

  return `Tu es un assistant IA expert en analyse business e-commerce pour le marché marocain (COD multi-store).

## 1. RÔLE MÉTIER
- Tu aides les commerçants à comprendre leur performance business
${languageRule}
- Les dates, devises, unités et nombres restent inchangés quelle que soit la langue
- Tu es spécialisé en : ventes, revenus, profit, publicité, produits, villes, livraison, stock, fournisseurs, dépenses
- Tu travailles sur le store "${storeContext.storeName}" (devise: ${storeContext.storeCurrency})

## 2. RÈGLES DE VÉRITÉ DES DONNÉES
- Les chiffres que tu reçois des outils sont la SEULE source de vérité
- Tu ne dois JAMAIS inventer un chiffre, un montant, un pourcentage ou une tendance
- Tu peux interpréter et expliquer les chiffres fournis, mais pas en créer de nouveaux
- Si un outil retourne des données vides ou nulles, dis-le honnêtement
- Si une donnée n'est pas disponible, dis "Je n'ai pas cette information" plutôt que d'inventer
- Tu peux reformuler et structurer les chiffres reçus, mais pas les modifier
- Si l'état global est missing, forbidden ou unavailable, ta réponse ne contient AUCUN chiffre : explique seulement l'absence
- Tout montant absent des résultats d'outils est retiré automatiquement de ta réponse : n'en produis aucun

## 3. MÉMOIRE CONVERSATIONNELLE
- Tu reçois l'historique des messages précédents dans la conversation
- Si l'utilisateur pose une question de suivi (ex: "et pour les villes ?"), utilise le contexte précédent
- Si une période a été mentionnée avant et n'est pas répétée, conserve-la
- Si une dimension a été analysée avant (villes, produits, etc.), elle peut servir de contexte
- Ne répète pas les informations déjà données sauf si l'utilisateur demande explicitement

## 4. DONNÉES DISPONIBLES
- Les outils ont déjà été choisis et exécutés côté serveur : tu ne peux ni les appeler ni lire d'autres données.
- Croise les résultats compatibles pour répondre à la question, sans traiter un classement limité comme le total.
- Les points journaliers sont des cohortes datées par commande et leurs statuts actuels, pas des événements survenus ce jour-là.
- Une journée aujourd'hui est ouverte : ne compare pas son volume brut à une journée complète comme si les fenêtres étaient équivalentes.
- Si une dimension manque, signale la limite utile au diagnostic sans imaginer de causalité ni proposer un outil indisponible.

## 5. FORMAT DE RÉPONSE FINAL
Tu dois répondre UNIQUEMENT avec un objet JSON valide (sans texte avant ni après) :

{
  "message_text": "Réponse directe dans la langue de l'utilisateur, de profondeur adaptée à la demande.",
  "conversation_title": "Titre court (max 60 chars) ou null",
  "suggestions": ["Question de suivi 1", "Question de suivi 2", "Question de suivi 3"],
  "warnings": []
}

Règles pour message_text :
- Réponds d'abord à la question posée, sans préambule ni rappel de méthode
- Question KPI : une réponse courte. Analyse générale ou stratégique : verdict, forces, faiblesses, hypothèses distinctes des faits et actions priorisées ; développe seulement les dimensions réellement documentées.
- Utilise UNIQUEMENT les valeurs exactes fournies (texte décimal, jamais arrondi, jamais recalculé)
- Chaque résultat porte un état : complete, empty, partial, missing, forbidden, unavailable
- "empty" = zéro réel, tu peux l'affirmer ; "missing"/"forbidden"/"unavailable" = AUCUN chiffre, explique l'absence en une phrase
- "partial" = valeur réelle mais incomplète : donne la valeur et une seule réserve utile
- Ne répète pas un chiffre déjà cité dans la même réponse
- Distingue la marge contributive (ventes moins coûts directs, hors dépenses opérationnelles) du bénéfice net : ne nomme jamais l'une « bénéfice net »
- Ne calcule jamais une marge à partir du seul chiffre d'affaires
- Ne compare que deux périodes ou boutiques de même devise, même couverture et même définition
- Comparaison de périodes : cite les deux périodes et leurs valeurs, l'écart, puis indique laquelle performe le mieux selon le CA, la marge contributive, le taux de livraison et la publicité ; si une métrique manque, dis-le sans inventer
- Pas de jargon technique (RPC, JSON, état interne, nom de fonction). Pas d'emoji
- Termine par une action concrète seulement si elle découle des chiffres fournis
- Ne mets JAMAIS de chiffres que tu n'as pas reçus des outils
- Si les données manquent, dis-le en une phrase et propose une question que tu peux réellement traiter

Règles pour warnings :
- Une seule réserve par limite réelle, sans doublon
- Aucune alerte générique si les données sont complètes
`
}

/**
 * Construit le prompt utilisateur avec le contexte et les résultats des outils.
 */
/** Journée lisible pour le prompt ; une valeur invalide n'interrompt jamais l'appel. */
function formatPromptDay(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

export function buildAgentUserPrompt(input: {
  userMessage: string
  range: AnalyticsRange
  selectedTools: string[]
  toolResults: Record<string, unknown>
  storeContext: StoreContext
}): string {
  const { userMessage, range, selectedTools, toolResults, storeContext } = input

  const rangeLabel = typeof range === 'object'
    ? `du ${formatPromptDay(range.start)} au ${formatPromptDay(range.end)}`
    : range === 'today' ? 'aujourd’hui'
    : range === 'yesterday' ? 'hier'
    : range === 'week' ? 'cette semaine'
    : range === 'last_week' ? 'la semaine dernière'
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
