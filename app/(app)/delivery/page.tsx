'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useStore } from '@/lib/store-context'
import { formatCurrency } from '@/lib/utils'
import StoreSelector from '@/components/dashboard/store-selector'
import { JisraMark } from '@/components/logo'

export default function LivraisonPage() {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const { currentStoreId, isStoresLoading, accessibleStores } = useStore()
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([])
  const [voucherError, setVoucherError] = useState('')
  const [voucherSuccess, setVoucherSuccess] = useState('')
  const [isCreatingVoucher, setIsCreatingVoucher] = useState(false)

  const { data: deliveryCompanies = [] } = useQuery({
    queryKey: ['delivery-page-companies', currentStoreId],
    enabled: !!currentStoreId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('delivery_companies')
        .select('id, name, api_provider, is_active')
        .eq('store_id', currentStoreId!)
        .order('created_at', { ascending: false })

      if (error) throw error
      return data || []
    },
  })

  const { data: rapidDeliveryConfig } = useQuery({
    queryKey: ['delivery-page-rapid-config', currentStoreId],
    enabled: !!currentStoreId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rapid_delivery_configs')
        .select('integration_id, parcel_creation_mode, default_shop_key')
        .eq('store_id', currentStoreId!)
        .maybeSingle()

      if (error) throw error
      return data || null
    },
  })

  const { data: customCities = [] } = useQuery({
    queryKey: ['delivery-page-custom-cities', rapidDeliveryConfig?.integration_id],
    enabled: !!rapidDeliveryConfig?.integration_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rapid_delivery_cities_custom')
        .select('city_key, city_name, cost_delivery, cost_refuse, cost_cancel')
        .eq('integration_id', rapidDeliveryConfig!.integration_id)

      if (error) throw error
      return data || []
    },
  })

  const { data: confirmedParcels = [] } = useQuery({
    queryKey: ['delivery-page-confirmed-parcels', currentStoreId],
    enabled: !!currentStoreId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, customer_name, phone, city, total_selling_price, rapid_delivery_parcel_key, confirmed_at, rapid_delivery_voucher_key, status')
        .eq('store_id', currentStoreId!)
        .eq('status', 'confirmed')
        .not('rapid_delivery_parcel_key', 'is', null)
        .is('rapid_delivery_voucher_key', null)
        .order('confirmed_at', { ascending: false })

      if (error) throw error
      return data || []
    },
  })

  const { data: vouchers = [] } = useQuery({
    queryKey: ['delivery-page-vouchers', rapidDeliveryConfig?.integration_id],
    enabled: !!rapidDeliveryConfig?.integration_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rapid_delivery_entity_mappings')
        .select('rapid_delivery_id, payload, updated_at')
        .eq('integration_id', rapidDeliveryConfig!.integration_id)
        .eq('entity_type', 'voucher')
        .order('updated_at', { ascending: false })

      if (error) throw error
      return data || []
    },
  })

  const allSelected = confirmedParcels.length > 0 && selectedOrderIds.length === confirmedParcels.length

  useEffect(() => {
    const nextIds = confirmedParcels.map((row: any) => row.id)
    setSelectedOrderIds((current) => {
      if (current.length === nextIds.length && current.every((id, index) => id === nextIds[index])) {
        return current
      }
      return nextIds
    })
  }, [confirmedParcels])

  async function createVoucher() {
    if (!currentStoreId || selectedOrderIds.length === 0) return

    setIsCreatingVoucher(true)
    setVoucherError('')
    setVoucherSuccess('')

    try {
      const response = await fetch('/api/integrations/rapid-delivery/vouchers/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId: currentStoreId, orderIds: selectedOrderIds }),
      })

      const payload = (await response.json().catch(() => null)) as { error?: string; voucherKey?: string; count?: number } | null
      if (!response.ok) throw new Error(payload?.error || 'RAPID_DELIVERY_CREATE_VOUCHER_FAILED')

      setVoucherSuccess(`Bon ${payload?.voucherKey || ''} créé pour ${Number(payload?.count || 0)} colis.`)
      setSelectedOrderIds([])
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['delivery-page-confirmed-parcels', currentStoreId] }),
        queryClient.invalidateQueries({ queryKey: ['delivery-page-vouchers', rapidDeliveryConfig?.integration_id] }),
      ])
    } catch (error) {
      setVoucherError(error instanceof Error ? error.message : 'RAPID_DELIVERY_CREATE_VOUCHER_FAILED')
    } finally {
      setIsCreatingVoucher(false)
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col items-center sm:items-start gap-1">
        <div className="flex items-center gap-2">
          <JisraMark size={28} />
          <span className="text-lg font-bold text-[#1fa971] bg-[#1fa971]/10 px-3 py-1 rounded-full">
            Livraison
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Gestion des expéditions et bons de ramassage
        </p>
      </div>
      <div className="bg-card rounded-xl shadow p-4">
        <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4">
          <StoreSelector />
          <Link href="/settings" className="px-3 py-2 rounded-lg border text-sm text-foreground hover:bg-secondary w-fit">
            Paramètres
          </Link>
        </div>
      </div>

      {!currentStoreId ? (
        <div className="flex items-center justify-center py-12">
          {isStoresLoading ? (
            <div className="flex items-center gap-3 text-muted-foreground">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span className="text-sm">Chargement de votre store...</span>
            </div>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              Sélectionnez un store pour afficher la livraison.
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl border bg-card p-4">
              <div className="text-sm text-muted-foreground">Sociétés actives</div>
              <div className="mt-2 text-2xl font-semibold text-foreground">{deliveryCompanies.length}</div>
            </div>
            <div className="rounded-xl border bg-card p-4">
              <div className="text-sm text-muted-foreground">Mode Rapid Delivery</div>
              <div className="mt-2 text-2xl font-semibold text-foreground">{rapidDeliveryConfig?.parcel_creation_mode || '-'}</div>
            </div>
          </div>

          <div className="rounded-xl border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Colis confirmés à ramasser</h2>
                <p className="text-xs text-muted-foreground">Seuls les colis avec statut confirmé apparaissent ici pour créer un bon de ramassage.</p>
              </div>
              <button
                type="button"
                onClick={() => void createVoucher()}
                disabled={isCreatingVoucher || selectedOrderIds.length === 0}
                className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {isCreatingVoucher ? 'Création...' : `Créer bon de ramassage (${selectedOrderIds.length})`}
              </button>
            </div>

            {voucherSuccess ? <p className="text-sm text-emerald-600">{voucherSuccess}</p> : null}
            {voucherError ? <p className="text-sm text-red-500">{voucherError}</p> : null}

            {confirmedParcels.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun colis confirmé prêt pour un bon.</p>
            ) : (
              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="px-2 py-2">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={(e) => setSelectedOrderIds(e.target.checked ? confirmedParcels.map((row: any) => row.id) : [])}
                        />
                      </th>
                      <th className="px-2 py-2">Tracking</th>
                      <th className="px-2 py-2">Client</th>
                      <th className="px-2 py-2">Téléphone</th>
                      <th className="px-2 py-2">Ville</th>
                      <th className="px-2 py-2">Montant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {confirmedParcels.map((order: any) => {
                      const checked = selectedOrderIds.includes(order.id)
                      return (
                        <tr key={order.id} className="border-b last:border-b-0">
                          <td className="px-2 py-2">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => setSelectedOrderIds((current) => e.target.checked ? [...current, order.id] : current.filter((id) => id !== order.id))}
                            />
                          </td>
                          <td className="px-2 py-2 text-foreground">{order.rapid_delivery_parcel_key}</td>
                          <td className="px-2 py-2 text-foreground">{order.customer_name || '-'}</td>
                          <td className="px-2 py-2">{order.phone || '-'}</td>
                          <td className="px-2 py-2">{order.city || '-'}</td>
                          <td className="px-2 py-2">{formatCurrency(Number(order.total_selling_price || 0))}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-xl border bg-card p-4 space-y-3">
            <h2 className="text-lg font-semibold text-foreground">Bons de ramassage</h2>
            {vouchers.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun bon créé pour le moment.</p>
            ) : (
              <div className="space-y-2">
                {vouchers.map((voucher: any, index: number) => (
                  <div key={`${voucher.rapid_delivery_id}-${index}`} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                    <div>
                      <div className="font-medium text-foreground">Bon #{voucher.rapid_delivery_id}</div>
                      <div className="text-muted-foreground">{Array.isArray(voucher.payload?.parcels) ? voucher.payload.parcels.length : 0} colis</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Link
                        href={`/api/integrations/rapid-delivery/vouchers/${encodeURIComponent(voucher.rapid_delivery_id)}/labels`}
                        target="_blank"
                        className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary"
                      >
                        Télécharger étiquettes
                      </Link>
                      <Link
                        href={`/dashboard/livraison/vouchers/${encodeURIComponent(voucher.rapid_delivery_id)}`}
                        target="_blank"
                        className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary"
                      >
                        Télécharger bon
                      </Link>
                      <div className="text-xs text-muted-foreground">{voucher.updated_at ? new Date(voucher.updated_at).toLocaleString('fr-MA') : '-'}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border bg-card p-4 space-y-3">
            <h2 className="text-lg font-semibold text-foreground">Sociétés de livraison</h2>
            {deliveryCompanies.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune société active.</p>
            ) : (
              <div className="space-y-2">
                {deliveryCompanies.map((company: any) => (
                  <div key={company.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                    <div>
                      <div className="font-medium text-foreground">{company.name}</div>
                      <div className="text-muted-foreground">{company.api_provider || 'interne'}</div>
                    </div>
                    <div className="text-xs text-muted-foreground">{company.is_active === false ? 'inactive' : 'active'}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border bg-card p-4 space-y-3">
            <h2 className="text-lg font-semibold text-foreground">Villes Rapid Delivery</h2>
            <p className="text-xs text-muted-foreground">Villes et tarifs liés à votre intégration Rapid Delivery.</p>
            {customCities.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune ville liée à votre intégration Rapid Delivery.</p>
            ) : (
              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="px-2 py-2">Ville</th>
                      <th className="px-2 py-2">Livraison</th>
                      <th className="px-2 py-2">Refus</th>
                      <th className="px-2 py-2">Annulation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customCities.map((city: any) => (
                      <tr key={city.city_key} className="border-b last:border-b-0">
                        <td className="px-2 py-2 text-foreground">{city.city_name}</td>
                        <td className="px-2 py-2">{formatCurrency(Number(city.cost_delivery || 0))}</td>
                        <td className="px-2 py-2">{formatCurrency(Number(city.cost_refuse || 0))}</td>
                        <td className="px-2 py-2">{formatCurrency(Number(city.cost_cancel || 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}