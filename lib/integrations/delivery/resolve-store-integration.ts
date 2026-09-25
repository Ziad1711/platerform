/**
 * Retrouve l'intégration d'un transporteur pour un store donné.
 *
 * L'intégration appartient généralement au propriétaire du store, pas à l'agent
 * qui travaille la commande. Une recherche limitée à l'utilisateur connecté
 * échoue donc quand un agent de confirmation confirme une commande.
 * On cherche d'abord le rattachement au store, puis on retombe sur le
 * propriétaire pour les connexions historiques sans `store_id`.
 */

type SupabaseLike = { from: (table: string) => any }

export type StoreIntegration = { id: string; status: string }

export async function resolveStoreIntegration(
  supabase: SupabaseLike,
  provider: string,
  storeId: string
): Promise<StoreIntegration | null> {
  const byStore = await supabase
    .from('integrations')
    .select('id, status')
    .eq('provider', provider)
    .eq('store_id', storeId)
    .order('created_at', { ascending: true })
    .limit(1)

  if (byStore?.error) throw byStore.error

  const storeRow = ((byStore?.data || []) as StoreIntegration[])[0]
  if (storeRow) return storeRow

  const ownerResult = await supabase
    .from('stores')
    .select('owner_user_id')
    .eq('id', storeId)
    .maybeSingle()

  if (ownerResult?.error) throw ownerResult.error

  const ownerUserId = ownerResult?.data?.owner_user_id
  if (!ownerUserId) return null

  const byOwner = await supabase
    .from('integrations')
    .select('id, status')
    .eq('provider', provider)
    .eq('user_id', ownerUserId)
    .order('created_at', { ascending: true })
    .limit(1)

  if (byOwner?.error) throw byOwner.error

  return (((byOwner?.data || []) as StoreIntegration[])[0]) || null
}
