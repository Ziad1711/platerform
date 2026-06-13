'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useStore } from '@/lib/store-context'
import { formatCurrency } from '@/lib/utils'
import StoreSelector from '@/components/dashboard/store-selector'
import { JisraMark } from '@/components/logo'
import { Search, ChevronLeft, ChevronRight } from 'lucide-react'

export default function LivraisonPage() {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const { currentStoreId, isStoresLoading, accessibleStores } = useStore()
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([])
  const [voucherError, setVoucherError] = useState('')
  const [voucherSuccess, setVoucherSuccess] = useState('')
  const [isCreatingVoucher, setIsCreatingVoucher] = useState(false)
  const [citySearch, setCitySearch] = useState('')
  const [cityPage, setCityPage] = useState(1)

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
    queryKey: ['delivery-page-custom-cities', currentStoreId],
    enabled: !!currentStoreId,
    queryFn: async () => {
      // Récupérer le pricing_group_id du shop via delivery_shops
      const { data: shop, error: shopError } = await supabase
        .from('delivery_shops')
        .select('pricing_group_id')
        .eq('store_id', currentStoreId!)
        .maybeSingle()

      if (shopError) throw shopError

      if (!shop?.pricing_group_id) {
        // Fallback: lire depuis rapid_delivery_cities_standard
        const { data: fallback, error: fallbackError } = await supabase
          .from('rapid_delivery_cities_standard')
          .select('city_key, city_name, cost_delivery, cost_refuse, cost_cancel')
          .order('city_name', { ascending: true })

        if (fallbackError) throw fallbackError
        return (fallback || []).map((c: any) => ({
          city_key: c.city_key,
          city_name: c.city_name,
          cost_delivery: c.cost_delivery,
          cost_refuse: c.cost_refuse,
          cost_cancel: c.cost_cancel,
        }))
      }

      // Lire depuis delivery_rates via le pricing_group_id
      const { data: rates, error: ratesError } = await supabase
        .from('delivery_rates')
        .select('external_city_key, city_name, price, cost_refuse, cost_cancel')
        .eq('pricing_group_id', shop.pricing_group_id)
        .order('city_name', { ascending: true })

      if (ratesError) throw ratesError
      return (rates || []).map((r: any) => ({
        city_key: r.external_city_key,
        city_name: r.city_name,
        cost_delivery: r.price,
        cost_refuse: r.cost_refuse,
        cost_cancel: r.cost_cancel,
      }))
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

  const { data: confirmedOzoneParcels = [] } = useQuery({
    queryKey: ['delivery-page-confirmed-ozone-parcels', currentStoreId],
    enabled: !!currentStoreId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, customer_name, phone, city, total_selling_price, ozone_parcel_key, confirmed_at, ozone_voucher_key, status')
        .eq('store_id', currentStoreId!)
        .eq('status', 'confirmed')
        .not('ozone_parcel_key', 'is', null)
        .is('ozone_voucher_key', null)
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

  const { data: ozoneVouchers = [] } = useQuery({
    queryKey: ['delivery-page-ozone-vouchers', currentStoreId],
    enabled: !!currentStoreId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ozone_vouchers')
        .select('id, ozone_voucher_key, payload, updated_at')
        .eq('store_id', currentStoreId!)
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
    <div className="space-y-4 sm:space-y-6 p-3 sm:p-6">
      <div className="flex flex-col items-center sm:items-start gap-1">
        <div className="flex items-center gap-2 w-full justify-center sm:justify-start">
          <JisraMark size={28} />
          <span className="text-lg font-bold text-[#1fa971] bg-[#1fa971]/10 px-3 py-1 rounded-full">
            Livraison
          </span>
          <div className="hidden md:block ml-auto">
            <StoreSelector />
          </div>
        </div>
        <p className="text-sm text-muted-foreground text-center sm:text-left w-full">
          Gestion des expéditions et bons de ramassage
        </p>
        <div className="md:hidden w-full flex justify-center mt-1">
          <StoreSelector />
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <div className="rounded-xl border bg-card p-3 sm:p-4">
              <div className="text-xs sm:text-sm text-muted-foreground">Sociétés actives</div>
              <div className="mt-2 text-xl sm:text-2xl font-semibold text-foreground">{deliveryCompanies.length}</div>
            </div>
            <div className="rounded-xl border bg-card p-3 sm:p-4">
              <div className="text-xs sm:text-sm text-muted-foreground">Mode Rapid Delivery</div>
              <div className="mt-2 text-xl sm:text-2xl font-semibold text-foreground">{rapidDeliveryConfig?.parcel_creation_mode || '-'}</div>
            </div>
          </div>

          <div className="rounded-xl border bg-card p-3 sm:p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base sm:text-lg font-semibold text-foreground">Colis confirmés à ramasser</h2>
                <p className="text-xs text-muted-foreground">Seuls les colis avec statut confirmé apparaissent ici pour créer un bon de ramassage.</p>
              </div>
              <button
                type="button"
                onClick={() => void createVoucher()}
                disabled={isCreatingVoucher || selectedOrderIds.length === 0}
                className="w-full sm:w-auto rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {isCreatingVoucher ? 'Création...' : `Créer bon de ramassage (${selectedOrderIds.length})`}
              </button>
            </div>

            {voucherSuccess ? <p className="text-sm text-emerald-600">{voucherSuccess}</p> : null}
            {voucherError ? <p className="text-sm text-red-500">{voucherError}</p> : null}

            {confirmedParcels.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun colis confirmé prêt pour un bon.</p>
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden sm:block overflow-auto">
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

                {/* Mobile cards */}
                <div className="sm:hidden space-y-2">
                  {confirmedParcels.map((order: any) => {
                    const checked = selectedOrderIds.includes(order.id)
                    return (
                      <div
                        key={order.id}
                        className={`rounded-lg border p-3 text-sm space-y-1.5 transition-colors ${checked ? 'border-primary/50 bg-primary/5' : ''}`}
                      >
                        <div className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            className="mt-0.5 shrink-0"
                            onChange={(e) => setSelectedOrderIds((current) => e.target.checked ? [...current, order.id] : current.filter((id) => id !== order.id))}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-foreground truncate">{order.customer_name || '-'}</div>
                            <div className="text-xs text-muted-foreground">Tracking: {order.rapid_delivery_parcel_key}</div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="font-semibold text-foreground">{formatCurrency(Number(order.total_selling_price || 0))}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground pl-6">
                          <span>{order.phone || '-'}</span>
                          <span>{order.city || '-'}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>

          <div className="rounded-xl border bg-card p-3 sm:p-4 space-y-3">
            <h2 className="text-base sm:text-lg font-semibold text-foreground">Bons de ramassage (Rapid Delivery)</h2>
            {vouchers.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun bon créé pour le moment.</p>
            ) : (
              <div className="space-y-2">
                {vouchers.map((voucher: any, index: number) => (
                  <div key={`${voucher.rapid_delivery_id}-${index}`} className="flex flex-col sm:flex-row sm:items-center justify-between rounded-lg border px-3 py-2 text-sm gap-2">
                    <div>
                      <div className="font-medium text-foreground">Bon #{voucher.rapid_delivery_id}</div>
                      <div className="text-muted-foreground">{Array.isArray(voucher.payload?.parcels) ? voucher.payload.parcels.length : 0} colis</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/api/integrations/rapid-delivery/vouchers/${encodeURIComponent(voucher.rapid_delivery_id)}/labels`}
                        target="_blank"
                        className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary"
                      >
                        Étiquettes
                      </Link>
                      <Link
                        href={`/dashboard/livraison/vouchers/${encodeURIComponent(voucher.rapid_delivery_id)}`}
                        target="_blank"
                        className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary"
                      >
                        Bon
                      </Link>
                      <div className="text-xs text-muted-foreground sm:ml-2">{voucher.updated_at ? new Date(voucher.updated_at).toLocaleString('fr-MA') : '-'}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border bg-card p-3 sm:p-4 space-y-3">
            <h2 className="text-base sm:text-lg font-semibold text-foreground">Colis OZONE confirmés à ramasser</h2>
            <p className="text-xs text-muted-foreground">Colis OZONE prêts pour la création d'un bon de ramassage.</p>

            {confirmedOzoneParcels.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun colis OZONE confirmé prêt pour un bon.</p>
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden sm:block overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="px-2 py-2">Tracking</th>
                        <th className="px-2 py-2">Client</th>
                        <th className="px-2 py-2">Téléphone</th>
                        <th className="px-2 py-2">Ville</th>
                        <th className="px-2 py-2">Montant</th>
                      </tr>
                    </thead>
                    <tbody>
                      {confirmedOzoneParcels.map((order: any) => (
                        <tr key={order.id} className="border-b last:border-b-0">
                          <td className="px-2 py-2 text-foreground">{order.ozone_parcel_key}</td>
                          <td className="px-2 py-2 text-foreground">{order.customer_name || '-'}</td>
                          <td className="px-2 py-2">{order.phone || '-'}</td>
                          <td className="px-2 py-2">{order.city || '-'}</td>
                          <td className="px-2 py-2">{formatCurrency(Number(order.total_selling_price || 0))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile cards */}
                <div className="sm:hidden space-y-2">
                  {confirmedOzoneParcels.map((order: any) => (
                    <div key={order.id} className="rounded-lg border p-3 text-sm space-y-1.5">
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-foreground truncate">{order.customer_name || '-'}</div>
                          <div className="text-xs text-muted-foreground">Tracking: {order.ozone_parcel_key}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-semibold text-foreground">{formatCurrency(Number(order.total_selling_price || 0))}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground pl-0">
                        <span>{order.phone || '-'}</span>
                        <span>{order.city || '-'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="rounded-xl border bg-card p-3 sm:p-4 space-y-3">
            <h2 className="text-base sm:text-lg font-semibold text-foreground">Bons de ramassage (OZONE)</h2>
            {ozoneVouchers.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun bon OZONE créé pour le moment.</p>
            ) : (
              <div className="space-y-2">
                {ozoneVouchers.map((voucher: any) => (
                  <div key={voucher.id} className="flex flex-col sm:flex-row sm:items-center justify-between rounded-lg border px-3 py-2 text-sm gap-2">
                    <div>
                      <div className="font-medium text-foreground">Bon #{voucher.ozone_voucher_key}</div>
                      <div className="text-muted-foreground">{Array.isArray(voucher.payload?.parcels) ? voucher.payload.parcels.length : 0} colis</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-xs text-muted-foreground">{voucher.updated_at ? new Date(voucher.updated_at).toLocaleString('fr-MA') : '-'}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border bg-card p-3 sm:p-4 space-y-3">
            <h2 className="text-base sm:text-lg font-semibold text-foreground">Sociétés de livraison</h2>
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

          <div className="rounded-xl border bg-card p-3 sm:p-4 space-y-3">
            <h2 className="text-base sm:text-lg font-semibold text-foreground">Villes Rapid Delivery</h2>
            <p className="text-xs text-muted-foreground">Villes et tarifs liés à votre intégration Rapid Delivery.</p>
            {customCities.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune ville liée à votre intégration Rapid Delivery.</p>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Rechercher une ville..."
                    value={citySearch}
                    onChange={(e) => { setCitySearch(e.target.value); setCityPage(1) }}
                    className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>

                {(() => {
                  const filtered = customCities.filter((city: any) =>
                    city.city_name.toLowerCase().includes(citySearch.toLowerCase())
                  )
                  const totalPages = Math.max(1, Math.ceil(filtered.length / 10))
                  const page = Math.min(cityPage, totalPages)
                  const start = (page - 1) * 10
                  const paged = filtered.slice(start, start + 10)

                  return (
                    <>
                      {/* Desktop table */}
                      <div className="hidden sm:block overflow-auto">
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
                            {paged.length === 0 ? (
                              <tr>
                                <td colSpan={4} className="px-2 py-6 text-center text-sm text-muted-foreground">Aucune ville trouvée.</td>
                              </tr>
                            ) : (
                              paged.map((city: any) => (
                                <tr key={city.city_key} className="border-b last:border-b-0">
                                  <td className="px-2 py-2 text-foreground">{city.city_name}</td>
                                  <td className="px-2 py-2">{formatCurrency(Number(city.cost_delivery || 0))}</td>
                                  <td className="px-2 py-2">{formatCurrency(Number(city.cost_refuse || 0))}</td>
                                  <td className="px-2 py-2">{formatCurrency(Number(city.cost_cancel || 0))}</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>

                      {/* Mobile cards */}
                      <div className="sm:hidden space-y-2">
                        {paged.length === 0 ? (
                          <p className="text-sm text-muted-foreground text-center py-4">Aucune ville trouvée.</p>
                        ) : (
                          paged.map((city: any) => (
                            <div key={city.city_key} className="rounded-lg border p-3 text-sm space-y-1.5">
                              <div className="font-medium text-foreground">{city.city_name}</div>
                              <div className="grid grid-cols-3 gap-2 text-xs">
                                <div>
                                  <span className="text-muted-foreground">Livraison</span>
                                  <div className="font-medium text-foreground">{formatCurrency(Number(city.cost_delivery || 0))}</div>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Refus</span>
                                  <div className="font-medium text-foreground">{formatCurrency(Number(city.cost_refuse || 0))}</div>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Annulation</span>
                                  <div className="font-medium text-foreground">{formatCurrency(Number(city.cost_cancel || 0))}</div>
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>

                      {/* Pagination */}
                      {totalPages > 1 && (
                        <div className="flex items-center justify-center gap-2 pt-2">
                          <button
                            type="button"
                            disabled={page <= 1}
                            onClick={() => setCityPage(page - 1)}
                            className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary disabled:opacity-40 disabled:pointer-events-none"
                          >
                            <ChevronLeft className="h-3.5 w-3.5" />
                            Précédent
                          </button>
                          <span className="text-xs text-muted-foreground px-2">
                            Page {page} / {totalPages}
                          </span>
                          <button
                            type="button"
                            disabled={page >= totalPages}
                            onClick={() => setCityPage(page + 1)}
                            className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary disabled:opacity-40 disabled:pointer-events-none"
                          >
                            Suivant
                            <ChevronRight className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </>
                  )
                })()}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
