type SupabaseLike = any

/** Transforme un libellé en slug : accents, espaces et caractères spéciaux normalisés. */
export function slugify(value: string | null | undefined): string {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')

  const cleaned = normalized.replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '')
  return cleaned || 'produit'
}

/**
 * Construit un slug unique pour un store.
 * Les collisions sont résolues avec un suffixe stable (-2, -3, ...).
 */
export async function buildUniqueProductSlug(params: {
  supabase: SupabaseLike
  storeId: string
  base: string
  excludeProductId?: string | null
}): Promise<string> {
  const { supabase, storeId, base, excludeProductId } = params
  const root = slugify(base) || 'produit'

  const { data, error } = await supabase
    .from('products')
    .select('id, slug')
    .eq('store_id', storeId)
    .ilike('slug', `${root}%`)

  if (error) throw error

  const taken = new Set(
    (data || [])
      .filter((row: any) => String(row.id) !== String(excludeProductId || ''))
      .map((row: any) => String(row.slug || ''))
  )

  if (!taken.has(root)) return root

  let counter = 2
  while (counter < 1000) {
    const candidate = `${root}-${counter}`
    if (!taken.has(candidate)) return candidate
    counter += 1
  }

  return `${root}-${Date.now()}`
}

/** Slug unique pour une catégorie de store. */
export async function buildUniqueCategorySlug(params: {
  supabase: SupabaseLike
  storeId: string
  base: string
  excludeCategoryId?: string | null
}): Promise<string> {
  const { supabase, storeId, base, excludeCategoryId } = params
  const root = slugify(base) || 'categorie'

  const { data, error } = await supabase
    .from('product_categories')
    .select('id, slug')
    .eq('store_id', storeId)
    .ilike('slug', `${root}%`)

  if (error) throw error

  const taken = new Set(
    (data || [])
      .filter((row: any) => String(row.id) !== String(excludeCategoryId || ''))
      .map((row: any) => String(row.slug || ''))
  )

  if (!taken.has(root)) return root

  let counter = 2
  while (counter < 1000) {
    const candidate = `${root}-${counter}`
    if (!taken.has(candidate)) return candidate
    counter += 1
  }

  return `${root}-${Date.now()}`
}
