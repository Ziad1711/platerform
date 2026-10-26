/**
 * Fraîcheur des agrégats analytiques du dashboard.
 *
 * Les cartes et graphiques appellent des RPC d'agrégation (KPI, revenus,
 * publicité, villes, produits) : coûteuses côté serveur, sans état métier
 * propre, et rejouées inutilement à chaque focus de fenêtre, retour d'onglet
 * ou navigation interne lorsque `staleTime` vaut 0 (défaut React Query).
 *
 * 60 s couvre une session de consultation normale tout en gardant une
 * fraîcheur acceptable pour un tableau de bord.
 *
 * À ne PAS appliquer aux requêtes d'autorisation, d'appartenance ou de
 * configuration de rollout : leur revalidation au focus est un choix de
 * sécurité documenté (voir `components/providers.tsx`).
 */
export const DASHBOARD_ANALYTICS_STALE_MS = 60_000

/**
 * Ancienneté au-delà de laquelle un instantané de magasins doit être signalé
 * comme potentiellement obsolète si les revalidations échouent.
 *
 * Le bandeau « données obsolètes » n'est donc plus déclenché par un incident
 * réseau passager, mais seulement lorsque l'absence de revalidation réussie
 * devient durable (ou que l'erreur est définitive).
 */
export const DASHBOARD_STORES_STALE_ALERT_MS = 120_000

/**
 * Préfixes des clés de cache analytiques. Toute mutation réussie les invalide :
 * sans cela, un `staleTime` non nul laisserait des chiffres périmés jusqu'à
 * l'expiration de la fenêtre (création de commande, dépense publicitaire,
 * changement de statut de livraison, édition de produit…).
 */
export const DASHBOARD_ANALYTICS_QUERY_PREFIXES = [
  'dashboard-kpis',
  'dashboard-business-trends',
  'dashboard-top-products',
  'dashboard-ads-cost-chart',
  'dashboard-city-performance',
  'dashboard-confirmation-performance',
  'dashboard-profit-chart',
  'dashboard-recent-orders',
  'dashboard-v5-order-counters',
  'dashboard-confirmation-counters',
] as const

type InvalidateClient = {
  invalidateQueries: (filters?: { queryKey?: readonly unknown[] }) => unknown
}

/** Invalide les agrégats du dashboard après une écriture réussie. */
export function invalidateDashboardAnalytics(client: InvalidateClient): void {
  for (const prefix of DASHBOARD_ANALYTICS_QUERY_PREFIXES) {
    void client.invalidateQueries({ queryKey: [prefix] })
  }
}
