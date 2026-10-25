'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import DeliveryCityPicker, { type DeliveryCityOption } from './delivery-city-picker'
import {
  deliveryProviderCatalogueId,
  type ConfirmationDeliveryOptions,
  type ConfirmationDeliveryProvider,
  type DeliveryOptionsErrorCode,
} from '@/lib/confirmation/delivery-options'

type DeliveryProviderFieldsProps = {
  provider: ConfirmationDeliveryProvider
  storeId: string | null
  /** Commande concernée : sert à pré-remplir la ville Maroc Go (auto-détection). */
  orderId?: string | null
  orderCity?: string | null
  value: ConfirmationDeliveryOptions
  onChange: (next: ConfirmationDeliveryOptions) => void
  onConfigError: (code: DeliveryOptionsErrorCode | null) => void
}

const CITY_PROVIDER_LABEL: Partial<Record<ConfirmationDeliveryProvider, string>> = {
  ozone: 'Ville OZONE',
  ameex: 'Ville AMEEX',
  sendit: 'Ville Sendit',
  'maroc-go-delivery': 'Ville Maroc Go Delivery',
  'rapid-delivery': 'Ville Rapid Delivery',
  rushliv: 'Ville Rushliv',
}

const PROVIDER_TITLE: Record<ConfirmationDeliveryProvider, string> = {
  ozone: 'Options colis OZONE',
  forcelog: 'Options colis ForceLog',
  ameex: 'Options colis AMEEX',
  sendit: 'Options colis Sendit',
  digylog: 'Paramètres Digylog',
  'maroc-go-delivery': 'Ville Maroc Go Delivery',
  'rapid-delivery': 'Ville Rapid Delivery',
  rushliv: 'Ville Rushliv',
}

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring'

/** Champs de ville des transporteurs à détection automatique (aucun autre transporteur). */
const SLUG_CITY_FIELDS: Partial<
  Record<
    ConfirmationDeliveryProvider,
    { key: keyof ConfirmationDeliveryOptions; name: keyof ConfirmationDeliveryOptions }
  >
> = {
  'maroc-go-delivery': { key: 'marocGoCityKey', name: 'marocGoCityName' },
  'rapid-delivery': { key: 'rapidCityKey', name: 'rapidCityName' },
  rushliv: { key: 'rushlivCityKey', name: 'rushlivCityName' },
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm text-foreground">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="rounded border-border text-primary focus:ring-primary/20"
      />
    </label>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-foreground">{label}</label>
      {children}
    </div>
  )
}

/**
 * Champs colis propres au transporteur retenu.
 * Les valeurs sont préremplies comme dans `/sales` (config Sendit / Digylog),
 * sans jamais écrire de configuration : seule la création du colis est déclenchée.
 */
export default function DeliveryProviderFields({
  provider,
  storeId,
  orderId,
  orderCity,
  value,
  onChange,
  onConfigError,
}: DeliveryProviderFieldsProps) {
  const supabase = useMemo(() => createClient(), [])
  const [cityQuery, setCityQuery] = useState('')
  const [pickupQuery, setPickupQuery] = useState('')
  const pickupPrefilledRef = useRef(false)
  const digylogPrefilledRef = useRef(false)
  // Le dialogue parent recrée ses callbacks à chaque rendu : on conserve la
  // dernière version pour que la résolution de ville ne dépende jamais de leur
  // identité (source de l'annulation prématurée de l'ancien effet).
  const onChangeRef = useRef(onChange)
  const valueRef = useRef(value)
  // Un choix (ou une saisie) manuel de ville prime toujours sur l'auto-détection.
  const manualCitySelectionRef = useRef(false)

  useEffect(() => {
    onChangeRef.current = onChange
    valueRef.current = value
  }, [onChange, value])

  const catalogueId = deliveryProviderCatalogueId(provider)

  const { data: catalogueCities = [] } = useQuery<DeliveryCityOption[]>({
    queryKey: ['confirmation-delivery-cities', catalogueId],
    enabled: Boolean(catalogueId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('delivery_rates')
        .select('external_city_key, city_name, price')
        .eq('provider_id', catalogueId as string)
        .order('city_name', { ascending: true })

      if (error) throw error
      const options = new Map<string, DeliveryCityOption>()
      for (const rate of (data || []) as Array<{
        external_city_key: unknown
        city_name: string | null
        price: number | null
      }>) {
        options.set(String(rate.external_city_key), {
          city_key: String(rate.external_city_key),
          city_name: rate.city_name,
          price: rate.price,
        })
      }
      return Array.from(options.values())
    },
  })

  // Villes des transporteurs dont le provider n'a pas d'id catalogue statique
  // (Maroc Go, Rapid, Rushliv) : on résout le provider par son slug puis on lit
  // ses tarifs dans `delivery_rates`. Les clés de villes y sont identiques à
  // celles acceptées à la création du colis.
  const usesSlugCities =
    provider === 'maroc-go-delivery' || provider === 'rapid-delivery' || provider === 'rushliv'

  const { data: slugCities = [] } = useQuery<DeliveryCityOption[]>({
    queryKey: ['confirmation-slug-cities', provider],
    enabled: usesSlugCities,
    queryFn: async () => {
      const { data: providerRow, error: providerError } = await supabase
        .from('integration_providers')
        .select('id')
        .eq('slug', provider)
        .maybeSingle()

      if (providerError) throw providerError
      if (!providerRow?.id) return []

      const { data, error } = await supabase
        .from('delivery_rates')
        .select('external_city_key, city_name, price')
        .eq('provider_id', providerRow.id)
        .order('city_name', { ascending: true })

      if (error) throw error
      const options = new Map<string, DeliveryCityOption>()
      for (const rate of (data || []) as Array<{
        external_city_key: unknown
        city_name: string | null
        price: number | null
      }>) {
        options.set(String(rate.external_city_key), {
          city_key: String(rate.external_city_key),
          city_name: rate.city_name,
          price: rate.price,
        })
      }
      return Array.from(options.values())
    },
  })

  const cities = usesSlugCities ? slugCities : catalogueCities

  // Prévisualisation de la ville pour les transporteurs à détection automatique
  // (Maroc Go / Rapid / Rushliv). La clé de requête identifie strictement la
  // recherche : un rerender du dialogue (blacklist, compteurs P0, onglets) ne
  // relance ni l'appel serveur ni l'IA. Résolution en lecture seule : ouvrir le
  // dialogue ne modifie ni la commande ni les alias.
  const autoCityProvider = usesSlugCities ? provider : null
  const rawOrderCity = String(orderCity || '').trim()

  const { data: resolvedCity } = useQuery<{
    cityKey: string
    cityName: string
    source?: string
  } | null>({
    queryKey: ['confirmation-city-resolution', autoCityProvider, orderId, rawOrderCity],
    enabled: Boolean(autoCityProvider && orderId && rawOrderCity),
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async () => {
      const response = await fetch('/api/orders/normalize-city', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          city: rawOrderCity,
          orderId,
          providerSlug: autoCityProvider,
          preview: true,
        }),
      })
      if (!response.ok) return null
      const payload = (await response.json().catch(() => null)) as {
        cityKey?: string | null
        cityName?: string | null
        source?: string | null
      } | null
      const key = payload?.cityKey ? String(payload.cityKey) : ''
      if (!key) return null
      return {
        cityKey: key,
        cityName: String(payload?.cityName || rawOrderCity),
        source: payload?.source ? String(payload.source) : undefined,
      }
    },
  })

  // La ville reconnue est appliquée uniquement si elle appartient au catalogue
  // affiché du transporteur et si l'agent n'a pas déjà choisi une ville. Le
  // composant est remonté à chaque changement de société (clé = société) : une
  // réponse d'un ancien transporteur ne peut donc jamais être appliquée ici.
  useEffect(() => {
    const fields = SLUG_CITY_FIELDS[provider]
    if (!fields || !resolvedCity) return
    if (manualCitySelectionRef.current) return

    const current = valueRef.current
    if (current[fields.key]) return

    // Clé absente du catalogue du transporteur : pas de présélection hasardeuse,
    // la sélection manuelle reste la seule issue.
    const inCatalogue = cities.some((city) => String(city.city_key) === resolvedCity.cityKey)
    if (!inCatalogue) return

    const next: ConfirmationDeliveryOptions = { ...current }
    ;(next as Record<string, unknown>)[fields.key as string] = resolvedCity.cityKey
    ;(next as Record<string, unknown>)[fields.name as string] = resolvedCity.cityName

    setCityQuery(resolvedCity.cityName)
    onChangeRef.current(next)
  }, [provider, orderId, resolvedCity, cities, value])

  const { data: senditConfig } = useQuery<{ default_pickup_district_id: string | null } | null>({
    queryKey: ['confirmation-sendit-config', storeId],
    enabled: Boolean(storeId) && provider === 'sendit',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sendit_configs')
        .select('default_pickup_district_id')
        .eq('store_id', storeId as string)
        .maybeSingle()

      if (error) throw error
      return data || null
    },
  })

  const { data: digylogConfig, error: digylogError } = useQuery<Record<string, unknown> | null>({
    queryKey: ['confirmation-digylog-config', storeId],
    enabled: Boolean(storeId) && provider === 'digylog',
    queryFn: async () => {
      const response = await fetch(
        `/api/integrations/digylog/config?storeId=${encodeURIComponent(storeId as string)}`
      )
      const payload = (await response.json().catch(() => null)) as {
        data?: Record<string, unknown> | null
        error?: string
      } | null
      if (!response.ok) throw new Error(payload?.error || 'DIGYLOG_CONFIG_FAILED')
      return payload?.data || null
    },
  })

  // Préremplit le district de ramassage Sendit depuis la configuration existante.
  // La confirmation ne réécrit jamais `sendit_configs` : elle n'écrit que le colis.
  useEffect(() => {
    if (provider !== 'sendit' || pickupPrefilledRef.current || !senditConfig) return
    pickupPrefilledRef.current = true
    const districtId = senditConfig.default_pickup_district_id
      ? String(senditConfig.default_pickup_district_id)
      : ''
    if (!districtId) return
    const district = (cities || []).find((city) => String(city.city_key) === districtId) || null
    if (district) setPickupQuery(String(district.city_name || ''))
    onChange({ ...value, senditPickupDistrictId: districtId })
  }, [provider, senditConfig, cities, onChange, value])

  // Une config Digylog illisible bloque la confirmation : aucun réseau par défaut inventé.
  useEffect(() => {
    onConfigError(digylogError ? 'DIGYLOG_CONFIG_UNAVAILABLE' : null)
  }, [digylogError, onConfigError])

  useEffect(() => {
    if (provider !== 'digylog' || digylogPrefilledRef.current || digylogError) return
    if (digylogConfig === undefined) return
    digylogPrefilledRef.current = true
    const config = digylogConfig || {}
    onChange({
      ...value,
      digylogNetworkId:
        Number(config.default_network_id) > 0 ? Number(config.default_network_id) : 2,
      digylogExternalStore: String(config.default_external_store || '') || undefined,
      digylogOrderMode: Number(config.default_order_mode) === 2 ? 2 : 1,
      digylogSendStatus: Number(config.default_send_status) === 0 ? 0 : 1,
      digylogCheckDuplicate: Number(config.check_duplicate ?? 1) === 1 ? 1 : 0,
      digylogOpenProduct: Number(config.openproduct_default ?? 1) === 1 ? 1 : 2,
      digylogPort: Number(config.port_default ?? 2) === 1 ? 1 : 2,
    })
  }, [provider, digylogConfig, digylogError, onChange, value])

  const update = (partial: Partial<ConfirmationDeliveryOptions>) => onChange({ ...value, ...partial })

  const cityKey =
    provider === 'ozone'
      ? value.ozoneCityKey
        ? String(value.ozoneCityKey)
        : ''
      : provider === 'ameex'
        ? value.ameexCityKey || ''
        : provider === 'sendit'
          ? value.senditCityKey || ''
          : provider === 'maroc-go-delivery'
            ? value.marocGoCityKey || ''
            : provider === 'rapid-delivery'
              ? value.rapidCityKey || ''
              : provider === 'rushliv'
                ? value.rushlivCityKey || ''
                : ''

  const selectCity = (city: DeliveryCityOption) => {
    manualCitySelectionRef.current = true
    const key = String(city.city_key)
    const name = String(city.city_name || '')
    setCityQuery(name)
    if (provider === 'ozone') update({ ozoneCityKey: Number(key) || undefined, ozoneCityName: name })
    if (provider === 'ameex') update({ ameexCityKey: key, ameexCityName: name })
    if (provider === 'sendit') update({ senditCityKey: key, senditCityName: name })
    if (provider === 'maroc-go-delivery') update({ marocGoCityKey: key, marocGoCityName: name })
    if (provider === 'rapid-delivery') update({ rapidCityKey: key, rapidCityName: name })
    if (provider === 'rushliv') update({ rushlivCityKey: key, rushlivCityName: name })
  }

  const changeCityQuery = (next: string) => {
    manualCitySelectionRef.current = true
    setCityQuery(next)
    if (provider === 'ozone') update({ ozoneCityKey: undefined, ozoneCityName: undefined })
    if (provider === 'ameex') update({ ameexCityKey: undefined, ameexCityName: undefined })
    if (provider === 'sendit') update({ senditCityKey: undefined, senditCityName: undefined })
    if (provider === 'maroc-go-delivery') update({ marocGoCityKey: undefined, marocGoCityName: undefined })
    if (provider === 'rapid-delivery') update({ rapidCityKey: undefined, rapidCityName: undefined })
    if (provider === 'rushliv') update({ rushlivCityKey: undefined, rushlivCityName: undefined })
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
      <div className="text-sm font-medium text-foreground">{PROVIDER_TITLE[provider]}</div>

      {provider === 'ozone' || provider === 'ameex' || provider === 'sendit' || usesSlugCities ? (
        <DeliveryCityPicker
          label={CITY_PROVIDER_LABEL[provider] as string}
          placeholder={
            usesSlugCities
              ? 'Tapez pour rechercher une ville...'
              : `Tapez pour rechercher une ville ${provider.toUpperCase()}...`
          }
          required
          hint={
            provider === 'ozone'
              ? 'OZONE nécessite un choix manuel de la ville.'
              : usesSlugCities
                ? 'Ville détectée automatiquement si possible ; choisissez-la dans la liste si elle est vide.'
                : undefined
          }
          cities={cities}
          query={cityQuery}
          selectedKey={cityKey}
          onQueryChange={changeCityQuery}
          onSelect={selectCity}
        />
      ) : null}

      {provider === 'ozone' ? (
        <>
          <ToggleRow
            label="Autoriser l'ouverture du colis"
            checked={value.ozoneParcelOpen === 1}
            onChange={(checked) => update({ ozoneParcelOpen: checked ? 1 : 2 })}
          />
          <ToggleRow
            label="Colis fragile"
            checked={value.ozoneParcelFragile === 1}
            onChange={(checked) => update({ ozoneParcelFragile: checked ? 1 : 0 })}
          />
          <ToggleRow
            label="Autoriser le remplacement"
            checked={value.ozoneParcelReplace === 1}
            onChange={(checked) => update({ ozoneParcelReplace: checked ? 1 : 0 })}
          />
        </>
      ) : null}

      {provider === 'forcelog' ? (
        <>
          <ToggleRow
            label="Autoriser l'ouverture du colis"
            checked={value.forcelogCanOpen !== false}
            onChange={(checked) => update({ forcelogCanOpen: checked })}
          />
          <ToggleRow
            label="Colis fragile"
            checked={value.forcelogFragile === true}
            onChange={(checked) => update({ forcelogFragile: checked })}
          />
          <Field label="Nature du produit">
            <select
              value={value.forcelogProductNature || ''}
              onChange={(event) => update({ forcelogProductNature: event.target.value || undefined })}
              className={inputClass}
            >
              <option value="">-- Sélectionner --</option>
              <option value="vetement">Vêtement</option>
              <option value="electronique">Électronique</option>
              <option value="cosmetique">Cosmétique</option>
              <option value="alimentaire">Alimentaire</option>
              <option value="accessoire">Accessoire</option>
              <option value="autre">Autre</option>
            </select>
          </Field>
        </>
      ) : null}

      {provider === 'ameex' ? (
        <>
          <Field label="Type de colis">
            <select
              value={value.ameexParcelType || 'SIMPLE'}
              onChange={(event) =>
                update({ ameexParcelType: event.target.value === 'STOCK' ? 'STOCK' : 'SIMPLE' })
              }
              className={inputClass}
            >
              <option value="SIMPLE">Simple</option>
              <option value="STOCK">Stock</option>
            </select>
          </Field>
          <ToggleRow
            label="Autoriser l'ouverture du colis"
            checked={value.ameexOpen !== false}
            onChange={(checked) => update({ ameexOpen: checked })}
          />
          <ToggleRow
            label="Colis fragile"
            checked={value.ameexFragile === true}
            onChange={(checked) => update({ ameexFragile: checked })}
          />
          <ToggleRow
            label="Autoriser le remplacement"
            checked={value.ameexReplace !== false}
            onChange={(checked) => update({ ameexReplace: checked })}
          />
          <ToggleRow
            label="Autoriser l'essayage"
            checked={value.ameexTry !== false}
            onChange={(checked) => update({ ameexTry: checked })}
          />
        </>
      ) : null}

      {provider === 'sendit' ? (
        <>
          <ToggleRow
            label="Autoriser l'ouverture du colis"
            checked={value.senditAllowOpen !== false}
            onChange={(checked) => update({ senditAllowOpen: checked })}
          />
          <ToggleRow
            label="Autoriser l'essayage"
            checked={value.senditAllowTry !== false}
            onChange={(checked) => update({ senditAllowTry: checked })}
          />
          <ToggleRow
            label="Produits depuis le stock"
            checked={value.senditProductsFromStock === true}
            onChange={(checked) => update({ senditProductsFromStock: checked })}
          />
          <Field label="Packaging">
            <input
              type="text"
              value={value.senditPackagingId || ''}
              onChange={(event) => update({ senditPackagingId: event.target.value || undefined })}
              className={inputClass}
              placeholder="ID du packaging (optionnel)"
            />
          </Field>
          <ToggleRow
            label="Option échange"
            checked={value.senditOptionExchange === true}
            onChange={(checked) => update({ senditOptionExchange: checked })}
          />
          {value.senditOptionExchange ? (
            <Field label="ID livraison échange">
              <input
                type="text"
                value={value.senditDeliveryExchangeId || ''}
                onChange={(event) =>
                  update({ senditDeliveryExchangeId: event.target.value || undefined })
                }
                className={inputClass}
                placeholder="ID de livraison pour échange"
              />
            </Field>
          ) : null}
          <DeliveryCityPicker
            label="District de ramassage Sendit"
            placeholder="Tapez pour rechercher un district..."
            hint="Valeur par défaut de la configuration Sendit du store."
            cities={cities}
            query={pickupQuery}
            selectedKey={value.senditPickupDistrictId || ''}
            onQueryChange={(next) => {
              setPickupQuery(next)
              update({ senditPickupDistrictId: undefined })
            }}
            onSelect={(city) => {
              setPickupQuery(String(city.city_name || ''))
              update({ senditPickupDistrictId: String(city.city_key) })
            }}
          />
        </>
      ) : null}

      {provider === 'digylog' ? (
        <>
          <Field label="Réseau de livraison">
            <input
              type="number"
              min={1}
              value={value.digylogNetworkId ?? ''}
              onChange={(event) =>
                update({
                  digylogNetworkId:
                    Number(event.target.value) > 0 ? Number(event.target.value) : undefined,
                })
              }
              className={inputClass}
              placeholder="2"
            />
          </Field>
          <Field label="Store externe">
            <input
              type="text"
              value={value.digylogExternalStore || ''}
              onChange={(event) => update({ digylogExternalStore: event.target.value || undefined })}
              className={inputClass}
              placeholder="Store externe (optionnel)"
            />
          </Field>
          <Field label="Type d'expédition">
            <select
              value={value.digylogOrderMode || 1}
              onChange={(event) =>
                update({ digylogOrderMode: Number(event.target.value) === 2 ? 2 : 1 })
              }
              className={inputClass}
            >
              <option value={1}>Commande standard</option>
              <option value={2}>Fulfillment center</option>
            </select>
          </Field>
          <Field label="Action après création">
            <select
              value={value.digylogSendStatus ?? 1}
              onChange={(event) =>
                update({ digylogSendStatus: Number(event.target.value) === 0 ? 0 : 1 })
              }
              className={inputClass}
            >
              <option value={0}>Créer sans envoyer</option>
              <option value={1}>Créer et envoyer</option>
            </select>
          </Field>
          <Field label="Frais de livraison payés par">
            <select
              value={value.digylogPort || 2}
              onChange={(event) => update({ digylogPort: Number(event.target.value) === 1 ? 1 : 2 })}
              className={inputClass}
            >
              <option value={1}>Le client</option>
              <option value={2}>Le vendeur</option>
            </select>
          </Field>
          <ToggleRow
            label="Autoriser l'ouverture du colis"
            checked={value.digylogOpenProduct !== 2}
            onChange={(checked) => update({ digylogOpenProduct: checked ? 1 : 2 })}
          />
          <ToggleRow
            label="Bloquer les commandes en double"
            checked={value.digylogCheckDuplicate !== 0}
            onChange={(checked) => update({ digylogCheckDuplicate: checked ? 1 : 0 })}
          />
        </>
      ) : null}

    </div>
  )
}
