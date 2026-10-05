// ============================================================
// Libellé article transmis aux sociétés de livraison
// Format : « Nom du produit (Variante achetée) »
// Le nom personnalisé de la ligne (product_name_override) reste prioritaire
// sur le nom catalogue. La variante est toujours ajoutée entre parenthèses
// lorsqu'elle est réelle : les variantes techniques YouCan (« Default » /
// « Default Title ») sont ignorées pour ne pas polluer le nom.
// ============================================================

type Relation<T> = T | T[] | null | undefined

export type OrderItemArticleSource = {
  product_name_override?: string | null
  products?: Relation<{ name?: string | null }>
  product_variants?: Relation<{ name?: string | null }>
}

/** PostgREST renvoie tantôt un objet, tantôt un tableau pour une relation to-one. */
function unwrapRelation<T>(value: Relation<T>): T | null {
  if (Array.isArray(value)) return (value[0] ?? null) as T | null
  return (value ?? null) as T | null
}

/** Variantes techniques à ne jamais afficher (placeholder YouCan). */
function isPlaceholderVariantName(name: string) {
  const normalized = name.trim().toLowerCase()
  return normalized === '' || normalized === 'default' || normalized === 'default title'
}

/** Nom du produit seul : nom personnalisé de la ligne, sinon nom catalogue. */
export function resolveOrderItemProductName(item: OrderItemArticleSource | null | undefined) {
  const override = String(item?.product_name_override || '').trim()
  if (override) return override
  const product = unwrapRelation(item?.products)
  return String(product?.name || '').trim()
}

/** Nom de la variante achetée, ou chaîne vide si aucune variante réelle. */
export function resolveOrderItemVariantName(item: OrderItemArticleSource | null | undefined) {
  const variant = unwrapRelation(item?.product_variants)
  const name = String(variant?.name || '').trim()
  return isPlaceholderVariantName(name) ? '' : name
}

/** « Produit (Variante) » ; « Produit » seul si aucune variante réelle. */
export function buildOrderItemArticleLabel(item: OrderItemArticleSource | null | undefined) {
  const productName = resolveOrderItemProductName(item)
  const variantName = resolveOrderItemVariantName(item)

  if (!productName) return variantName
  if (!variantName) return productName
  if (variantName.toLowerCase() === productName.toLowerCase()) return productName

  return `${productName} (${variantName})`
}

/** Libellé complet d'une commande : « Produit A (V1), Produit B (V2) ». */
export function buildOrderArticleLabel(
  items: OrderItemArticleSource[] | null | undefined,
  fallback?: string | null
) {
  const labels = (items || [])
    .map((item) => buildOrderItemArticleLabel(item))
    .filter(Boolean)

  return labels.join(', ') || String(fallback || '').trim()
}
