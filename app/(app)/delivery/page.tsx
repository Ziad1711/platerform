'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useStore } from '@/lib/store-context'
import { formatCurrency } from '@/lib/utils'
import StoreSelector from '@/components/dashboard/store-selector'
import { JisraMark } from '@/components/logo'
import { Search, ChevronLeft, ChevronRight, X } from 'lucide-react'

export default function LivraisonPage() {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const { currentStoreId, isStoresLoading } = useStore()
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([])
  const [voucherError, setVoucherError] = useState('')
  const [voucherSuccess, setVoucherSuccess] = useState('')
  const [isCreatingVoucher, setIsCreatingVoucher] = useState(false)
  const [citySearch, setCitySearch] = useState('')
  const [cityPage, setCityPage] = useState(1)

  // Modal ForceLog
  const [showForceLogModal, setShowForceLogModal] = useState(false)
  const [flPickupPhone, setFlPickupPhone] = useState('')
  const [flPickupCityKey, setFlPickupCityKey] = useState('')
  const [flPickupCityName, setFlPickupCityName] = useState('')
  const [flPickupAddress, setFlPickupAddress] = useState('')
  const [flPickupStickers, setFlPickupStickers] = useState(false)

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

  // Configuration ForceLog pré-remplie
  const { data: forcelogConfig } = useQuery({
    queryKey: ['delivery-page-forcelog-config', currentStoreId],
    enabled: !!currentStoreId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('forcelog_configs')
        .select('pickup_phone, pickup_city_key, pickup_city_name, pickup_address, pickup_stickers')
        .eq('store_id', currentStoreId!)
        .maybeSingle()

      if (error) throw error
      return data || null
    },
  })

  // Villes disponibles pour ForceLog (via delivery_rates)
  const { data: forcelogCities = [] } = useQuery({
    queryKey: ['delivery-page-forcelog-cities', currentStoreId],
    enabled: !!currentStoreId,
    queryFn: async () => {
      // Récupérer le provider_id forcelog (depuis integration_providers)
      const { data: flProvider } = await supabase
        .from('integration_providers')
        .select('id')
        .eq('slug', 'forcelog')
        .maybeSingle()

      if (!flProvider?.id) return []

      const { data, error } = await supabase
        .from('delivery_rates')
        .select('external_city_key, city_name')
        .eq('provider_id', flProvider.id)
        .order('city_name', { ascending: true })

      if (error) throw error
      return data || []
    },
  })

  const { data: customCities = [] } = useQuery({
    queryKey: ['delivery-page-custom-cities', currentStoreId],
    enabled: !!currentStoreId,
    queryFn: async () => {
      const { data: shop, error: shopError } = await supabase
        .from('delivery_shops')
        .select('pricing_group_id')
        .eq('store_id', currentStoreId!)
        .maybeSingle()

      if (shopError) throw shopError

      if (!shop?.pricing_group_id) {
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

  // Fusionner tous les colis confirmés (Rapid + OZONE)
  const { data: confirmedParcels = [] } = useQuery({
    queryKey: ['delivery-page-confirmed-parcels', currentStoreId],
    enabled: !!currentStoreId && deliveryCompanies.length > 0,
    queryFn: async () => {
      const ozoneCompanyIds = deliveryCompanies
        .filter((c: any) => c.api_provider === 'ozone')
        .map((c: any) => c.id)

      const rapidCompanyIds = deliveryCompanies
        .filter((c: any) => c.api_provider === 'rapid-delivery')
        .map((c: any) => c.id)

      const forcelogCompanyIds = deliveryCompanies
        .filter((c: any) => c.api_provider === 'forcelog')
        .map((c: any) => c.id)

      const ameexCompanyIds = deliveryCompanies
        .filter((c: any) => c.api_provider === 'ameex')
        .map((c: any) => c.id)

      // Colis Rapid Delivery (via rapid_delivery_parcel_key, pas de voucher)
      const rapidPromise = rapidCompanyIds.length > 0
        ? supabase
            .from('orders')
            .select('id, customer_name, phone, city, total_selling_price, rapid_delivery_parcel_key, confirmed_at, status')
            .eq('store_id', currentStoreId!)
            .in('status', ['confirmed', 'dl_pickup_pending'])
            .in('delivery_company_id', rapidCompanyIds)
            .not('rapid_delivery_parcel_key', 'is', null)
            .is('rapid_delivery_voucher_key', null)
            .order('confirmed_at', { ascending: false })
            .then(r => (r.data || []).map((o: any) => ({ ...o, _tracking: o.rapid_delivery_parcel_key, _provider: 'Rapid' })))
        : Promise.resolve([])

      // Colis OZONE (via tracking_number, uniquement ceux sans BL)
      const ozonePromise = ozoneCompanyIds.length > 0
        ? supabase
            .from('orders')
            .select('id, customer_name, phone, city, total_selling_price, tracking_number, confirmed_at, status, delivery_voucher_key')
            .eq('store_id', currentStoreId!)
            .in('status', ['confirmed', 'dl_pickup_pending'])
            .in('delivery_company_id', ozoneCompanyIds)
            .not('tracking_number', 'is', null)
            .not('tracking_number', 'eq', '')
            .is('delivery_voucher_key', null)
            .order('confirmed_at', { ascending: false })
            .then(r => (r.data || []).map((o: any) => ({ ...o, _tracking: o.tracking_number, _provider: 'OZONE' })))
        : Promise.resolve([])

      // Colis ForceLog (via forcelog_parcel_key, sans pickup déjà créé)
      const forcelogPromise = forcelogCompanyIds.length > 0
        ? supabase
            .from('orders')
            .select('id, customer_name, phone, city, total_selling_price, forcelog_parcel_key, confirmed_at, status')
            .eq('store_id', currentStoreId!)
            .in('status', ['confirmed', 'dl_pickup_pending'])
            .in('delivery_company_id', forcelogCompanyIds)
            .not('forcelog_parcel_key', 'is', null)
            .is('forcelog_pickup_key', null)
            .order('confirmed_at', { ascending: false })
            .then(r => (r.data || []).map((o: any) => ({ ...o, _tracking: o.forcelog_parcel_key, _provider: 'ForceLog' })))
        : Promise.resolve([])

      // Colis AMEEX (via ameex_parcel_code, sans delivery_note déjà créé)
      const ameexPromise = ameexCompanyIds.length > 0
        ? supabase
            .from('orders')
            .select('id, customer_name, phone, city, total_selling_price, ameex_parcel_code, confirmed_at, status')
            .eq('store_id', currentStoreId!)
            .in('status', ['confirmed', 'dl_pickup_pending'])
            .in('delivery_company_id', ameexCompanyIds)
            .not('ameex_parcel_code', 'is', null)
            .is('ameex_delivery_note_ref', null)
            .order('confirmed_at', { ascending: false })
            .then(r => (r.data || []).map((o: any) => ({ ...o, _tracking: o.ameex_parcel_code, _provider: 'Ameex' })))
        : Promise.resolve([])

      const [rapidRes, ozoneRes, forcelogRes, ameexRes] = await Promise.all([rapidPromise, ozonePromise, forcelogPromise, ameexPromise])
      const merged = [...rapidRes, ...ozoneRes, ...forcelogRes, ...ameexRes]
      merged.sort((a, b) => new Date(b.confirmed_at).getTime() - new Date(a.confirmed_at).getTime())
      return merged
    },
  })

  const { data: allVouchers = [] } = useQuery({
    queryKey: ['delivery-page-all-vouchers', currentStoreId],
    enabled: !!currentStoreId,
    queryFn: async () => {
      // 1. Récupérer les nouveaux bons (unifiés)
      const unifiedPromise = supabase
        .from('delivery_entity_mappings')
        .select('id, integration_id, provider_entity_id, payload, updated_at')
        .eq('store_id', currentStoreId!)
        .eq('entity_type', 'voucher')
        .order('updated_at', { ascending: false })

      // 2. Récupérer les anciens bons Rapid Delivery (legacy)
      const legacyRapidPromise = supabase
        .from('rapid_delivery_entity_mappings')
        .select('rapid_delivery_id, payload, updated_at')
        .eq('store_id', currentStoreId!)
        .eq('entity_type', 'voucher')
        .order('updated_at', { ascending: false })

      const [unifiedRes, legacyRes] = await Promise.all([unifiedPromise, legacyRapidPromise])

      const unifiedVouchers = (unifiedRes.data || []).map((v: any) => ({
        id: v.id,
        integrationId: v.integration_id,
        voucherKey: v.provider_entity_id,
        provider: v.payload?.provider_slug || 'unknown',
        parcelCount: Array.isArray(v.payload?.parcels) ? v.payload.parcels.length : (v.payload?.count || 0),
        updated_at: v.updated_at,
      }))

      const legacyVouchers = (legacyRes.data || []).map((v: any, index: number) => ({
        id: `legacy-${index}`,
        voucherKey: v.rapid_delivery_id,
        provider: 'rapid-delivery',
        parcelCount: Array.isArray(v.payload?.parcels) ? v.payload.parcels.length : 0,
        updated_at: v.updated_at,
      }))

      // Fusionner en évitant les doublons (si un bon est dans les deux tables)
      const seenKeys = new Set(unifiedVouchers.map(v => v.voucherKey))
      const combined = [...unifiedVouchers]
      
      for (const lv of legacyVouchers) {
        if (!seenKeys.has(lv.voucherKey)) {
          combined.push(lv)
          seenKeys.add(lv.voucherKey)
        }
      }

      combined.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      return combined
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

  // Déterminer le provider des colis sélectionnés
  function getSelectedProvider(): 'rapid' | 'ozone' | 'forcelog' | 'ameex' | 'mixed' | 'none' {
    if (selectedOrderIds.length === 0) return 'none'
    const selected = confirmedParcels.filter((o: any) => selectedOrderIds.includes(o.id))
    if (selected.length === 0) return 'none'
    const providers = new Set(selected.map((o: any) => o._provider))
    if (providers.size > 1) return 'mixed'
    if (providers.has('ForceLog')) return 'forcelog'
    if (providers.has('Ameex')) return 'ameex'
    return providers.has('OZONE') ? 'ozone' : 'rapid'
  }

  async function createVoucher() {
    if (!currentStoreId || selectedOrderIds.length === 0) return

    const provider = getSelectedProvider()
    if (provider === 'mixed') {
      setVoucherError('Sélectionnez des colis du même transporteur.')
      return
    }

    // Pour ForceLog, ouvrir le modal avec les infos pré-remplies depuis la config
    if (provider === 'forcelog') {
      setFlPickupPhone(forcelogConfig?.pickup_phone || '')
      setFlPickupCityKey(forcelogConfig?.pickup_city_key || '')
      setFlPickupCityName(forcelogConfig?.pickup_city_name || '')
      setFlPickupAddress(forcelogConfig?.pickup_address || '')
      setFlPickupStickers(forcelogConfig?.pickup_stickers ?? false)
      setShowForceLogModal(true)
      return
    }

    setIsCreatingVoucher(true)
    setVoucherError('')
    setVoucherSuccess('')

    try {
      const endpoint = provider === 'ozone'
        ? '/api/integrations/ozone/vouchers/create'
        : provider === 'ameex'
          ? '/api/integrations/ameex/vouchers/create'
          : '/api/integrations/rapid-delivery/vouchers/create'

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId: currentStoreId, orderIds: selectedOrderIds }),
      })

      const payload = (await response.json().catch(() => null)) as { error?: string; voucherKey?: string; count?: number; pickupKey?: string; totalParcels?: number } | null
      if (!response.ok) throw new Error(payload?.error || 'VOUCHER_CREATE_FAILED')

      const key = payload?.voucherKey || payload?.pickupKey || ''
      const count = Number(payload?.count ?? payload?.totalParcels ?? 0)
      setVoucherSuccess(`Bon ${key} créé pour ${count} colis.`)
      setSelectedOrderIds([])
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['delivery-page-confirmed-parcels', currentStoreId] }),
        queryClient.invalidateQueries({ queryKey: ['delivery-page-all-vouchers', currentStoreId] }),
      ])
    } catch (error) {
      setVoucherError(error instanceof Error ? error.message : 'VOUCHER_CREATE_FAILED')
    } finally {
      setIsCreatingVoucher(false)
    }
  }

  async function submitForceLogPickup() {
    if (!currentStoreId || selectedOrderIds.length === 0) return
    if (!flPickupPhone.trim() || !flPickupCityKey.trim() || !flPickupAddress.trim()) {
      setVoucherError('Veuillez remplir tous les champs de ramassage.')
      return
    }

    setIsCreatingVoucher(true)
    setVoucherError('')
    setVoucherSuccess('')
    setShowForceLogModal(false)

    try {
      const response = await fetch('/api/integrations/forcelog/pickups/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId: currentStoreId,
          orderIds: selectedOrderIds,
          pickupPhone: flPickupPhone.trim(),
          pickupCityKey: flPickupCityKey.trim(),
          pickupCityName: flPickupCityName.trim() || flPickupCityKey.trim(),
          pickupAddress: flPickupAddress.trim(),
          pickupStickers: flPickupStickers,
        }),
      })

      const payload = (await response.json().catch(() => null)) as { error?: string; pickupKey?: string; totalParcels?: number } | null
      if (!response.ok) throw new Error(payload?.error || 'FORCELOG_PICKUP_FAILED')

      const key = payload?.pickupKey || ''
      const count = Number(payload?.totalParcels ?? 0)
      setVoucherSuccess(`Bon de ramassage ForceLog ${key} créé pour ${count} colis.`)
      setSelectedOrderIds([])
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['delivery-page-confirmed-parcels', currentStoreId] }),
        queryClient.invalidateQueries({ queryKey: ['delivery-page-all-vouchers', currentStoreId] }),
      ])
    } catch (error) {
      setVoucherError(error instanceof Error ? error.message : 'FORCELOG_PICKUP_FAILED')
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

      {/* Modal ForceLog */}
      {showForceLogModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border bg-card p-5 shadow-lg space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-foreground">Bon de ramassage ForceLog</h3>
              <button type="button" onClick={() => setShowForceLogModal(false)} className="rounded-md p-1 hover:bg-secondary">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Renseignez les informations de ramassage pour {selectedOrderIds.length} colis.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">Téléphone de ramassage *</label>
                <input
                  type="text"
                  value={flPickupPhone}
                  onChange={(e) => setFlPickupPhone(e.target.value)}
                  placeholder="06XXXXXXXX"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">Ville de ramassage *</label>
                <select
                  value={flPickupCityKey}
                  onChange={(e) => {
                    const selected = forcelogCities.find((c: any) => c.external_city_key === e.target.value)
                    setFlPickupCityKey(e.target.value)
                    setFlPickupCityName(selected?.city_name || e.target.value)
                  }}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value="">Sélectionnez une ville...</option>
                  {forcelogCities.map((city: any) => (
                    <option key={city.external_city_key} value={city.external_city_key}>
                      {city.city_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">Adresse de ramassage *</label>
                <input
                  type="text"
                  value={flPickupAddress}
                  onChange={(e) => setFlPickupAddress(e.target.value)}
                  placeholder="ex: 12 Rue exemple, Bureau 5"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs font-medium text-foreground">Imprimer les étiquettes</label>
                    <p className="text-[10px] text-muted-foreground">Générer les étiquettes de colis (STICKERS)</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={flPickupStickers}
                    onClick={() => setFlPickupStickers(!flPickupStickers)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${flPickupStickers ? 'bg-primary' : 'bg-input'}`}
                  >
                    <span className={`pointer-events-none block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform ${flPickupStickers ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowForceLogModal(false)}
                className="flex-1 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => void submitForceLogPickup()}
                disabled={isCreatingVoucher}
                className="flex-1 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {isCreatingVoucher ? 'Création...' : 'Créer le bon'}
              </button>
            </div>
          </div>
        </div>
      )}

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
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl border bg-card p-3">
              <div className="text-xs text-muted-foreground">Sociétés</div>
              <div className="mt-1 text-xl font-semibold text-foreground">{deliveryCompanies.length}</div>
            </div>
            <div className="rounded-xl border bg-card p-3">
              <div className="text-xs text-muted-foreground">Colis confirmés</div>
              <div className="mt-1 text-xl font-semibold text-foreground">{confirmedParcels.length}</div>
            </div>
            <div className="rounded-xl border bg-card p-3">
              <div className="text-xs text-muted-foreground">Bons Rapid</div>
              <div className="mt-1 text-xl font-semibold text-foreground">
                {allVouchers.filter(v => v.provider === 'rapid-delivery').length}
              </div>
            </div>
            <div className="rounded-xl border bg-card p-3">
              <div className="text-xs text-muted-foreground">Bons OZONE</div>
              <div className="mt-1 text-xl font-semibold text-foreground">
                {allVouchers.filter(v => v.provider === 'ozone').length}
              </div>
            </div>
          </div>

          {/* Colis confirmés avec bouton de création */}
          <div className="rounded-xl border bg-card p-3 sm:p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base sm:text-lg font-semibold text-foreground">Colis confirmés</h2>
                <p className="text-xs text-muted-foreground">
                  {deliveryCompanies.filter((c: any) => c.api_provider === 'rapid-delivery').length > 0
                    ? 'Sélectionnez les colis à inclure dans un bon de ramassage.'
                    : 'Colis prêts pour expédition.'}
                </p>
              </div>
              {(deliveryCompanies.filter((c: any) => c.api_provider === 'rapid-delivery').length > 0 ||
                deliveryCompanies.filter((c: any) => c.api_provider === 'ozone').length > 0 ||
                deliveryCompanies.filter((c: any) => c.api_provider === 'forcelog').length > 0 ||
                deliveryCompanies.filter((c: any) => c.api_provider === 'ameex').length > 0) && (
                <button
                  type="button"
                  onClick={() => void createVoucher()}
                  disabled={isCreatingVoucher || selectedOrderIds.length === 0}
                  className="w-full sm:w-auto rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  {isCreatingVoucher ? 'Création...' : `Créer bon de ramassage (${selectedOrderIds.length})`}
                </button>
              )}
            </div>

            {voucherSuccess ? <p className="text-sm text-emerald-600">{voucherSuccess}</p> : null}
            {voucherError ? <p className="text-sm text-red-500">{voucherError}</p> : null}

            {confirmedParcels.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun colis confirmé.</p>
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden sm:block overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        {(deliveryCompanies.filter((c: any) => c.api_provider === 'rapid-delivery').length > 0 ||
                          deliveryCompanies.filter((c: any) => c.api_provider === 'ozone').length > 0 ||
                          deliveryCompanies.filter((c: any) => c.api_provider === 'forcelog').length > 0 ||
                          deliveryCompanies.filter((c: any) => c.api_provider === 'ameex').length > 0) && (
                          <th className="px-2 py-2">
                            <input
                              type="checkbox"
                              checked={allSelected}
                              onChange={(e) => setSelectedOrderIds(e.target.checked ? confirmedParcels.map((row: any) => row.id) : [])}
                            />
                          </th>
                        )}
                        <th className="px-2 py-2">Tracking</th>
                        <th className="px-2 py-2">Transporteur</th>
                        <th className="px-2 py-2">Client</th>
                        <th className="px-2 py-2">Téléphone</th>
                        <th className="px-2 py-2">Ville</th>
                        <th className="px-2 py-2">Montant</th>
                      </tr>
                    </thead>
                    <tbody>
                      {confirmedParcels.map((order: any) => {
                        const checked = selectedOrderIds.includes(order.id)
                        const isAmeex = order._provider === 'Ameex'
                        const isRapid = order._provider === 'Rapid'
                        const isForceLog = order._provider === 'ForceLog'
                        const canCreateVoucher = isRapid || order._provider === 'OZONE' || isForceLog || isAmeex
                        const badgeClass = isRapid
                          ? 'bg-[#27BEE3]/10 text-[#27BEE3]'
                          : isForceLog
                            ? 'bg-[#FFCD06]/10 text-[#B8860B]'
                            : isAmeex
                              ? 'bg-[#E56C33]/10 text-[#E56C33]'
                              : 'bg-[#E41B29]/10 text-[#E41B29]'
                        return (
                          <tr key={`${order._provider}-${order.id}`} className="border-b last:border-b-0">
                            {(deliveryCompanies.filter((c: any) => c.api_provider === 'rapid-delivery').length > 0 ||
                              deliveryCompanies.filter((c: any) => c.api_provider === 'ozone').length > 0 ||
                              deliveryCompanies.filter((c: any) => c.api_provider === 'forcelog').length > 0 ||
                              deliveryCompanies.filter((c: any) => c.api_provider === 'ameex').length > 0) && (
                              <td className="px-2 py-2">
                                {canCreateVoucher ? (
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) => setSelectedOrderIds((current) => e.target.checked ? [...current, order.id] : current.filter((id) => id !== order.id))}
                                  />
                                ) : null}
                              </td>
                            )}
                            <td className="px-2 py-2 text-foreground font-mono text-xs">{order._tracking}</td>
                            <td className="px-2 py-2">
                              <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass}`}>
                                {order._provider}
                              </span>
                            </td>
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
                    const isRapid = order._provider === 'Rapid'
                    const isForceLog = order._provider === 'ForceLog'
                    const canCreateVoucher = isRapid || order._provider === 'OZONE' || isForceLog
                    const badgeClass = isRapid
                      ? 'bg-[#27BEE3]/10 text-[#27BEE3]'
                      : isForceLog
                        ? 'bg-[#FFCD06]/10 text-[#B8860B]'
                        : 'bg-[#E41B29]/10 text-[#E41B29]'
                    return (
                      <div
                        key={`${order._provider}-${order.id}`}
                        className={`rounded-lg border p-3 text-sm space-y-1.5 transition-colors ${checked ? 'border-primary/50 bg-primary/5' : ''}`}
                      >
                        <div className="flex items-start gap-2">
                          {canCreateVoucher && (
                            <input
                              type="checkbox"
                              checked={checked}
                              className="mt-0.5 shrink-0"
                              onChange={(e) => setSelectedOrderIds((current) => e.target.checked ? [...current, order.id] : current.filter((id) => id !== order.id))}
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-foreground truncate">{order.customer_name || '-'}</div>
                            <div className="text-xs text-muted-foreground">
                              <span className={`inline-block rounded-full px-1.5 py-0.5 text-xs font-medium mr-1 ${badgeClass}`}>
                                {order._provider}
                              </span>
                              {order._tracking}
                            </div>
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
                    )
                  })}
                </div>
              </>
            )}
          </div>

          {/* Bons de ramassage unifiés */}
          {allVouchers.length > 0 && (
            <div className="rounded-xl border bg-card p-3 sm:p-4 space-y-3">
              <h2 className="text-base sm:text-lg font-semibold text-foreground">Bons de ramassage</h2>
              <div className="space-y-2">
                  {allVouchers.map((voucher: any) => {
                  const isOzone = voucher.provider === 'ozone'
                  const isRapid = voucher.provider === 'rapid-delivery'
                  const isForceLog = voucher.provider === 'forcelog'
                  const isAmeex = voucher.provider === 'ameex'
                  
                  const badgeClass = isOzone
                    ? 'bg-[#E41B29]/10 text-[#E41B29]'
                    : isForceLog
                      ? 'bg-[#FFCD06]/10 text-[#B8860B]'
                      : isAmeex
                        ? 'bg-[#E56C33]/10 text-[#E56C33]'
                        : 'bg-[#27BEE3]/10 text-[#27BEE3]'
                  const badgeLabel = isOzone ? 'OZONE' : isForceLog ? 'ForceLog' : isAmeex ? 'AMEEX' : 'RAPID'
                  
                  return (
                    <div key={voucher.id} className="flex flex-col sm:flex-row sm:items-center justify-between rounded-lg border px-3 py-2 text-sm gap-2">
                      <div className="flex items-center gap-2">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${badgeClass}`}>
                          {badgeLabel}
                        </span>
                        <div>
                          <div className="font-medium text-foreground">Bon #{voucher.voucherKey}</div>
                          <div className="text-muted-foreground text-xs">{voucher.parcelCount} colis</div>
                        </div>
                      </div>
                      
                      <div className="flex flex-wrap items-center gap-2">
                        {isRapid && (
                          <>
                            <Link
                              href={`/api/integrations/rapid-delivery/vouchers/${encodeURIComponent(voucher.voucherKey)}/pdf`}
                              target="_blank"
                              className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary"
                            >
                              Bon de ramassage
                            </Link>
                            <Link
                              href={`/api/integrations/rapid-delivery/vouchers/${encodeURIComponent(voucher.voucherKey)}/labels`}
                              target="_blank"
                              className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary"
                            >
                              Étiquettes
                            </Link>
                          </>
                        )}
                        
                        {isForceLog && (
                          <>
                            <Link
                              href={`/api/integrations/forcelog/labels/pickup/${encodeURIComponent(voucher.voucherKey)}`}
                              target="_blank"
                              className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary"
                            >
                              Étiquettes
                            </Link>
                          </>
                        )}
                        
                        {isOzone && (
                          <>
                            <Link
                              href={`https://client.ozoneexpress.ma/pdf-delivery-note?dn-ref=${encodeURIComponent(voucher.voucherKey)}`}
                              target="_blank"
                              className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary"
                            >
                              Standard
                            </Link>
                            <Link
                              href={`https://client.ozoneexpress.ma/pdf-delivery-note-tickets?dn-ref=${encodeURIComponent(voucher.voucherKey)}`}
                              target="_blank"
                              className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary"
                            >
                              A4
                            </Link>
                            <Link
                              href={`https://client.ozoneexpress.ma/pdf-delivery-note-tickets-4-4?dn-ref=${encodeURIComponent(voucher.voucherKey)}`}
                              target="_blank"
                              className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary"
                            >
                              10x10
                            </Link>
                          </>
                        )}
                        
                        {isAmeex && (
                          <>
                            <Link
                              href={`/api/integrations/ameex/vouchers/${encodeURIComponent(voucher.voucherKey)}/pdf`}
                              target="_blank"
                              className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary"
                            >
                              Bon de livraison
                            </Link>
                            <Link
                              href={`/api/integrations/ameex/vouchers/${encodeURIComponent(voucher.voucherKey)}/labels`}
                              target="_blank"
                              className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary"
                            >
                              Étiquettes
                            </Link>
                          </>
                        )}
                        
                        <div className="text-[10px] text-muted-foreground ml-auto sm:ml-2">
                          {voucher.updated_at ? new Date(voucher.updated_at).toLocaleString('fr-MA') : '-'}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Sociétés de livraison */}
          {deliveryCompanies.length > 0 && (
            <div className="rounded-xl border bg-card p-3 sm:p-4 space-y-3">
              <h2 className="text-base sm:text-lg font-semibold text-foreground">Sociétés de livraison</h2>
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
            </div>
          )}

          {/* Villes */}
          {customCities.length > 0 && (
            <div className="rounded-xl border bg-card p-3 sm:p-4 space-y-3">
              <h2 className="text-base sm:text-lg font-semibold text-foreground">Villes et tarifs</h2>
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

                    <div className="sm:hidden space-y-2">
                      {paged.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-4">Aucune ville trouvée.</p>
                      ) : (
                        paged.map((city: any) => (
                          <div key={city.city_key} className="rounded-lg border p-3 text-sm space-y-1.5">
                            <div className="font-medium text-foreground">{city.city_name}</div>
                            <div className="grid grid-cols-3 gap-2 text-xs">
                              <div><span className="text-muted-foreground">Livraison</span><div className="font-medium text-foreground">{formatCurrency(Number(city.cost_delivery || 0))}</div></div>
                              <div><span className="text-muted-foreground">Refus</span><div className="font-medium text-foreground">{formatCurrency(Number(city.cost_refuse || 0))}</div></div>
                              <div><span className="text-muted-foreground">Annulation</span><div className="font-medium text-foreground">{formatCurrency(Number(city.cost_cancel || 0))}</div></div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>

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
                        <span className="text-xs text-muted-foreground px-2">Page {page} / {totalPages}</span>
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
            </div>
          )}
        </>
      )}
    </div>
  )
}
