# Contrat de consommation — moteur analytique (Lot 2)

**Version du contrat : `ANALYTICS_CONTRACT_VERSION = 2`** (`lib/assistant/analytics-contract.ts`).
Toute rupture de forme ou de sémantique doit incrémenter cette version.

Ce document décrit **ce que l'orchestrateur reçoit** et **ce qu'il ne doit jamais faire**.
Il ne modifie aucun fichier de l'Agent 1.

## 1. Règle fondatrice

Un chiffre ne circule jamais seul : il est toujours accompagné d'un **état**.

| État | Sens | Ce que le consommateur peut afficher |
|---|---|---|
| `complete` | Donnée complète pour la définition annoncée | Le chiffre |
| `empty` | Période lue avec succès, population réellement vide | Un **zéro réel** |
| `partial` | Couverture incomplète, troncature ou écart V5 | Le chiffre **avec réserve**, jamais comme total |
| `missing` | Donnée absente ou illisible | **Rien** — jamais 0 |
| `forbidden` | Accès refusé pour ce périmètre | **Rien** — message d'autorisation |
| `unavailable` | Aucun agrégat autorisé n'existe | **Rien** — expliquer l'indisponibilité |

**Interdits absolus côté consommateur :** `Number(x || 0)`, `x ?? 0`, `x || '0'`,
et tout calcul de marge à partir de `revenue` seul.

## 2. Résultat d'un outil

```ts
interface AgentToolResult {
  toolName: AgentToolName
  data:
    | KpiEnvelope            // KPI, profit, publicité, statuts
    | SectionResult<T>       // villes, agents, confirmation, produits, commandes récentes
    | PeriodComparison       // comparaison de deux périodes
    | StoreComparison        // comparaison de boutiques
    | { kind: 'daily', ... } // tendance quotidienne
  meta: { storeId: string; currency: string }
}
```

### 2.1 `KpiEnvelope` (contrat stable)

```ts
{
  contractVersion: 2,
  kind: 'kpis',
  state: 'complete' | 'empty' | 'partial' | 'missing' | 'forbidden' | 'unavailable',
  range: { from: '2026-09-01', to: '2026-09-08' },   // bornes métier [from, to[
  timeZone: 'Africa/Casablanca',
  currency: 'MAD' | null,                            // null si devises multiples
  definitionVersions: [1],
  access: { '<storeId>': 'full' | 'commercial' },
  coverage: [{ storeId, state, coverage: {...} }],
  metrics: {
    totalOrders?:        AnalyticsMetric | null,
    deliveredOrders?:    AnalyticsMetric | null,
    returnedOrders?:     AnalyticsMetric | null,
    cancelledOrders?:    AnalyticsMetric | null,
    revenue?:            AnalyticsMetric | null,
    revenueEstimated?:   AnalyticsMetric | null,
    adSpend?:            AnalyticsMetric | null,
    deliveryRate?:       AnalyticsMetric | null,
    purchaseCost?:       AnalyticsMetric | null,
    deliveryCost?:       AnalyticsMetric | null,
    confirmationCost?:   AnalyticsMetric | null,
    contributionMargin?: AnalyticsMetric | null,
  },
  stores: AnalyticsStoreResult[],   // détail par boutique, aucune somme inter-devises
  limits: string[],
  issues: string[],
}
```

Alias → métrique V5 : `totalOrders→orders`, `deliveredOrders→delivered`,
`revenue→revenue`, `adSpend→adSpend`, `contributionMargin→contributionMargin`
(source unique : `KPI_METRIC_ALIASES`).

Chaque `AnalyticsMetric` :

```ts
{
  value: '24107.00' | '101' | null,  // décimal exact en texte
  count: 101 | null,                 // rempli uniquement si unit === 'count'
  unit: 'count' | 'decimal' | 'percent',
  state: AnalyticsState,
  definition: 'V5 : CA réalisé (lignes des commandes livrées)',
  numerator: 66 | null,
  denominator: 101 | null,
  limit?: string,
}
```

### 2.2 `SectionResult<T>`

```ts
{
  meta: {
    contractVersion: 2,
    section: 'confirmation' | 'agents' | 'cities' | 'products' | 'recent_orders' | 'delivery' | 'stock',
    state: AnalyticsState,
    source: 'rpc_dashboard_confirmation_counters' | 'rpc_dashboard_confirmation_performance'
           | 'rpc_dashboard_city_performance' | 'rpc_dashboard_top_products' | 'orders:limit',
    range, timeZone, currencies: string[], access,
    notices: string[], limits: string[],
    consistency: Array<{ metric, v5, section, match: boolean | null, reason? }>,
    issues: string[],
  },
  rows: T[],
  totals: Record<string, string | number | null>,
}
```

`match: null` signifie **non comparable** (jamais un faux PASS).

## 3. Exemples complets

### 3.1 Succès complet

```json
{
  "contractVersion": 2,
  "kind": "kpis",
  "state": "complete",
  "range": { "from": "2026-09-01", "to": "2026-09-08" },
  "currency": "MAD",
  "definitionVersions": [1],
  "metrics": {
    "totalOrders":     { "value": "101", "count": 101, "unit": "count", "state": "complete", "definition": "…", "numerator": null, "denominator": null },
    "deliveredOrders": { "value": "66", "count": 66, "unit": "count", "state": "complete", "definition": "…", "numerator": null, "denominator": null },
    "revenue":         { "value": "24107.00", "count": null, "unit": "decimal", "state": "complete", "definition": "…", "numerator": null, "denominator": null },
    "deliveryRate":    { "value": "65.34", "count": null, "unit": "percent", "state": "complete", "definition": "…", "numerator": 66, "denominator": 101 }
  },
  "stores": [],
  "limits": [],
  "issues": []
}
```

### 3.2 Zéro réel (`empty`) — affichable comme zéro

```json
{ "state": "empty", "metrics": { "totalOrders": { "value": "0", "count": 0, "unit": "count", "state": "empty" } } }
```

### 3.3 Donnée absente (`missing`) — ne rien afficher

```json
{ "state": "missing", "metrics": { "revenue": { "value": null, "count": null, "unit": "decimal", "state": "missing" } }, "issues": ["ANALYTICS_INCOMPLETE_SCOPE:…"] }
```

### 3.4 Couverture partielle (`partial`)

```json
{
  "state": "partial",
  "campaigns": null,
  "coverage": [{ "storeId": "…", "state": "partial", "coverage": { "days_total": 7, "days_missing": 2 } }],
  "issues": []
}
```

### 3.5 Accès refusé (`forbidden`)

```json
{ "state": "forbidden", "stores": [], "issues": ["KPI_NO_ACCESS"] }
```

### 3.6 Agrégat inexistant (`unavailable`)

```json
{ "meta": { "section": "stock", "state": "unavailable", "source": "rpc_assistant_stock_snapshot (proposée, non exécutée)", "issues": [] }, "rows": [], "totals": {} }
```

### 3.7 Comparaison de périodes (`kind: 'periods'`)

```json
{
  "contractVersion": 2,
  "kind": "periods",
  "state": "complete",
  "ranges": { "current": { "from": "2026-03-01", "to": "2026-04-01" }, "baseline": { "from": "2026-02-01", "to": "2026-03-01" } },
  "currency": "MAD",
  "definitions": { "current": [1], "baseline": [1] },
  "deltas": [
    { "metric": "revenue", "current": "24107.00", "baseline": "22000.00", "delta": "2107.00", "state": "complete", "reason": null }
  ],
  "notices": [],
  "issues": []
}
```

### 3.8 Comparaison de boutiques (`kind: 'stores'`)

```json
{
  "contractVersion": 2,
  "kind": "stores",
  "state": "complete",
  "stores": [{ "storeId": "…", "currency": "MAD", "state": "complete", "metrics": { "revenue": "12000.00" } }],
  "deltas": [{ "from": "store-A", "to": "store-B", "metric": "revenue", "delta": "2000.00", "state": "complete" }],
  "notices": ["Devises multiples : aucun total inter-boutiques…"],
  "issues": []
}
```

## 4. Intégration attendue côté Agent 1 (aucun fichier modifié ici)

```ts
// 1. Une session par requête, partagée entre tous les outils :
const session = createAssistantAnalyticsSession(supabase, scopeStoreIds, businessRange)

// 2. Passer la session à chaque outil (une seule lecture V5 au total) :
await executeAgentTool({ supabase, storeIds, storeContext, range, toolName, userMessage, session })

// 3. Comparaison explicite : la période de référence décide du type.
await executeAgentTool({
  supabase, storeIds, storeContext, range, toolName: 'getStoreComparison', userMessage,
  session,
  comparisonBaseline: { from: '2026-02-01', to: '2026-03-01' }, // ⇒ kind: 'periods'
})
// sans `comparisonBaseline` ⇒ kind: 'stores'
```

### Lecture correcte d'une métrique

```ts
const metric = envelope.metrics.totalOrders
if (!metric || metric.state === 'missing' || metric.state === 'forbidden') {
  // ne rien afficher, expliquer l'absence
} else if (metric.state === 'partial') {
  // afficher la valeur AVEC la réserve (couverture, troncature)
} else {
  // afficher metric.value (texte exact) — jamais Number(...)
}
```

### Gestion des erreurs

| Situation | Réaction attendue |
|---|---|
| `state: 'forbidden'` | Message d'autorisation, aucun chiffre |
| `state: 'missing'` / `issues` non vide | « Donnée indisponible sur cette période », aucun chiffre |
| `state: 'unavailable'` | « Cet indicateur n'est pas encore disponible » |
| `state: 'partial'` | Afficher la valeur + `notices`/`coverage` |
| `state: 'empty'` | Zéro réel autorisé |

## 5. Garanties et limites

- Périmètre borné à **5 boutiques**, période KPI ≤ **400 jours**, sections détaillées ≤ **90 jours**.
- Comparaisons : refusées si devise, définition, couverture ou accès diffèrent.
- Groupes détaillés (agents, villes) limités à **200** ; au-delà ⇒ `partial`.
- Aucune somme inter-devises ; aucune somme de marge présentée comme résultat opérationnel.
- `delivery` et `stock` restent `unavailable` tant que les RPC proposées ne sont pas validées.
