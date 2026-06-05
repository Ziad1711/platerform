'use client'

import { useStore } from '@/lib/store-context'
import { createClient } from '@/lib/supabase/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatCurrency, formatDateTime } from '@/lib/utils'
import { Search, Filter, MoreVertical, CheckCircle, Clock, Truck, XCircle, Plus, Upload, RefreshCw, Info, Pencil } from 'lucide-react'
import InlineEditText from '@/components/dashboard/sales/inline-edit-text'
import InlineEditCity from '@/components/dashboard/sales/inline-edit-city'
import InlineEditAddressModal from '@/components/dashboard/sales/inline-edit-address-modal'
import InlineEditProducts from '@/components/dashboard/sales/inline-edit-products'
import { useEffect, useMemo, useRef, useState } from 'react'
import { usePermissions } from '@/lib/auth/use-permissions'
import StoreSelector from '@/components/dashboard/store-selector'
import { JisraMark } from '@/components/logo'

async function normalizeOrderCityRequest(city: string, orderId?: string) {
  const response = await fetch('/api/orders/normalize-city', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ city, orderId }),
  })

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(payload?.error || 'CITY_NORMALIZATION_FAILED')
  }

  return (await response.json()) as { cityName?: string; cityKey?: number | null; fallback?: boolean }
}

const statusConfig = {
  new: { label: 'Nouvelle', color: 'bg-blue-100 text-blue-800', icon: Clock },
  confirmation_rejected: { label: 'Non confirmé', color: 'bg-slate-100 text-slate-800', icon: XCircle },
  follow_up_1: { label: 'Rappel 1', color: 'bg-cyan-100 text-cyan-800', icon: Clock },
  follow_up_2: { label: 'Rappel 2', color: 'bg-cyan-100 text-cyan-800', icon: Clock },
  follow_up_3: { label: 'Rappel 3', color: 'bg-cyan-100 text-cyan-800', icon: Clock },
  follow_up_4: { label: 'Rappel 4', color: 'bg-cyan-100 text-cyan-800', icon: Clock },
  follow_up_5: { label: 'Rappel 5', color: 'bg-cyan-100 text-cyan-800', icon: Clock },
  no_answer: { label: 'Pas de réponse', color: 'bg-amber-100 text-amber-800', icon: Clock },
  wrong_number: { label: 'Mauvais numéro', color: 'bg-orange-100 text-orange-800', icon: XCircle },
  voicemail: { label: 'Boîte vocale', color: 'bg-teal-100 text-teal-800', icon: Clock },
  confirmed: { label: 'Confirmée', color: 'bg-yellow-100 text-yellow-800', icon: CheckCircle },
  picked_up: { label: 'Ramassée', color: 'bg-indigo-100 text-indigo-800', icon: Truck },
  sent: { label: 'Envoyée', color: 'bg-purple-100 text-purple-800', icon: Truck },
  delivered: { label: 'Livrée', color: 'bg-green-100 text-green-800', icon: CheckCircle },
  cancelled: { label: 'Annulée', color: 'bg-gray-100 text-gray-800', icon: XCircle },
  refused: { label: 'Refusée', color: 'bg-rose-100 text-rose-800', icon: XCircle },
  returned_not_stocked: { label: 'Retour non stocké', color: 'bg-red-100 text-red-800', icon: XCircle },
  returned_stocked: { label: 'Retour stocké', color: 'bg-orange-100 text-orange-800', icon: XCircle },
  dl_no_answer: { label: 'Pas de réponse (livreur)', color: 'bg-amber-100 text-amber-800', icon: Clock },
  dl_unreachable: { label: 'Injoignable', color: 'bg-amber-100 text-amber-800', icon: Clock },
  dl_out_of_zone: { label: 'Hors zone', color: 'bg-red-100 text-red-800', icon: XCircle },
  dl_client_interested: { label: 'Client intéressé', color: 'bg-cyan-100 text-cyan-800', icon: Clock },
  dl_postponed: { label: 'Reportée', color: 'bg-slate-100 text-slate-800', icon: Clock },
  dl_address_change: { label: 'Changement d\'adresse', color: 'bg-slate-100 text-slate-800', icon: Clock },
  dl_pickup_pending: { label: 'En attente ramassage', color: 'bg-indigo-100 text-indigo-800', icon: Clock },
  dl_refund: { label: 'Remboursement', color: 'bg-rose-100 text-rose-800', icon: XCircle },
  dl_follow_up_request: { label: 'Demande de suivie', color: 'bg-cyan-100 text-cyan-800', icon: Clock },
  dl_billing_error: { label: 'Facturé par erreur', color: 'bg-rose-100 text-rose-800', icon: XCircle },
  dl_out_for_delivery: { label: 'Sortie pour livraison', color: 'bg-purple-100 text-purple-800', icon: Truck },
}

const USER_EDITABLE_STATUSES = [
  'new',
  'confirmation_rejected',
  'follow_up_1',
  'follow_up_2',
  'follow_up_3',
  'follow_up_4',
  'follow_up_5',
  'no_answer',
  'wrong_number',
  'voicemail',
  'confirmed',
  'picked_up',
  'sent',
  'delivered',
  'cancelled',
  'refused',
  'returned_not_stocked',
  'returned_stocked',
] as const

const getNowLocalDateTimeValue = () => {
  const now = new Date()
  const tzOffset = now.getTimezoneOffset() * 60000
  return new Date(now.getTime() - tzOffset).toISOString().slice(0, 16)
}

const normalizePhoneForBlacklist = (value: any) => {
  const digits = String(value || '').replace(/\D/g, '')
  if (!digits) return ''
  return digits.length >= 9 ? digits.slice(-9) : digits
}

const BLACKLIST_ALLOW_REASON = '__allow_override__'

const STATUS_ORDER_PRIORITY = [
  'new',
  'sent',
  'delivered',
  'cancelled',
  'returned_not_stocked',
  'returned_stocked',
] as const

const IMPORT_SELF_CONFIRMATION = '__self_confirmed__'
const IMPORT_INTERNAL_DELIVERY = '__internal_delivery__'
const IMPORT_OTHER_DELIVERY = '__other_delivery__'

type CsvDateFormat =
  | 'auto'
  | 'dd/mm/yyyy'
  | 'dd/mm/yyyy hh:mm'
  | 'yyyy-mm-dd'
  | 'yyyy-mm-dd hh:mm'

type ImportFieldKey =
  | 'order_date'
  | 'customer_name'
  | 'phone'
  | 'address'
  | 'city'
  | 'total_selling_price'
  | 'status'
  | 'product_name'
  | 'confirmation_agent'
  | 'delivery_company'
  | 'tracking_number'
  | 'delivery_fee'
  | 'ads_cost_allocated'
  | 'delivery_charge_to_customer'
  | 'discount_type'
  | 'discount_value'
  | 'source'
  | 'purchase_cost'

type ImportFieldDefinition = {
  key: ImportFieldKey
  label: string
  required: boolean
  synonyms: string[]
}

const csvDateFormatOptions: Array<{ value: CsvDateFormat; label: string }> = [
  { value: 'auto', label: 'Auto-détecter (recommandé)' },
  { value: 'dd/mm/yyyy', label: 'DD/MM/YYYY' },
  { value: 'dd/mm/yyyy hh:mm', label: 'DD/MM/YYYY HH:mm' },
  { value: 'yyyy-mm-dd', label: 'YYYY-MM-DD' },
  { value: 'yyyy-mm-dd hh:mm', label: 'YYYY-MM-DD HH:mm' },
]

const importFieldDefinitions: ImportFieldDefinition[] = [
  { key: 'order_date', label: 'Date de commande', required: true, synonyms: ['date', 'order date', 'date commande', 'order_date', 'created at'] },
  { key: 'customer_name', label: 'Nom complet', required: true, synonyms: ['nom', 'nom client', 'client', 'full name', 'customer', 'customer name'] },
  { key: 'phone', label: 'Téléphone', required: true, synonyms: ['phone', 'telephone', 'tel', 'mobile', 'num', 'numero'] },
  { key: 'address', label: 'Adresse', required: true, synonyms: ['address', 'adresse', 'adresse client', 'street'] },
  { key: 'city', label: 'Ville', required: true, synonyms: ['city', 'ville', 'town'] },
  { key: 'total_selling_price', label: 'Prix de vente', required: true, synonyms: ['price', 'prix', 'montant', 'total', 'total selling price', 'prix de vente'] },
  { key: 'status', label: 'Statut', required: true, synonyms: ['status', 'statut', 'etat', 'etat commande', 'order status'] },
  { key: 'product_name', label: 'Nom produit', required: false, synonyms: ['product name', 'product', 'produit', 'nom produit', 'nom_produit'] },
  { key: 'confirmation_agent', label: 'Agent de confirmation', required: false, synonyms: ['confirmation agent', 'agent confirmation', 'agent', 'confirmateur'] },
  { key: 'delivery_company', label: 'Société de livraison', required: false, synonyms: ['delivery company', 'company', 'societe livraison', 'société livraison', 'transporteur', 'livreur'] },
  { key: 'tracking_number', label: 'N° tracking', required: false, synonyms: ['tracking', 'tracking number', 'numero suivi', 'suivi'] },
  { key: 'delivery_fee', label: 'Frais livraison (store)', required: false, synonyms: ['delivery fee', 'frais livraison', 'cout livraison'] },
  { key: 'ads_cost_allocated', label: 'Coût publicité alloué', required: false, synonyms: ['ads cost', 'ads_cost_allocated', 'cout pub', 'coût pub', 'cout publicite', 'coût publicité', 'advertising cost'] },
  { key: 'delivery_charge_to_customer', label: 'Livraison facturée client', required: false, synonyms: ['delivery charge', 'livraison client', 'frais livraison client'] },
  { key: 'discount_type', label: 'Type remise', required: false, synonyms: ['discount type', 'type remise'] },
  { key: 'discount_value', label: 'Valeur remise', required: false, synonyms: ['discount value', 'remise', 'valeur remise'] },
  { key: 'source', label: 'Source', required: false, synonyms: ['source', 'canal'] },
  { key: 'purchase_cost', label: 'Coût d’achat', required: false, synonyms: ['purchase cost', 'cost', 'coût', 'coût d’achat', 'prix d’achat', 'purchase_price', 'cost_price'] },
]

const normalizeHeader = (value: any) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const normalizeProductName = (value: any) => normalizeHeader(value)

const parseCsvText = (text: string) => {
  const rows: string[][] = []
  let currentCell = ''
  let currentRow: string[] = []
  let inQuotes = false

  const pushCell = () => {
    currentRow.push(currentCell)
    currentCell = ''
  }

  const pushRow = () => {
    if (currentRow.length === 0) return
    if (currentRow.every((cell) => String(cell || '').trim() === '')) {
      currentRow = []
      return
    }
    rows.push(currentRow)
    currentRow = []
  }

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const nextChar = text[i + 1]

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentCell += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      pushCell()
      continue
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') i += 1
      pushCell()
      pushRow()
      continue
    }

    currentCell += char
  }

  pushCell()
  pushRow()

  if (rows.length === 0) {
    return { columns: [] as string[], rows: [] as Array<Record<string, string>> }
  }

  const columns = rows[0].map((col) => String(col || '').trim())
  const dataRows = rows.slice(1).map((row) => {
    const record: Record<string, string> = {}
    columns.forEach((col, index) => {
      record[col] = String(row[index] || '').trim()
    })
    return record
  })

  return { columns, rows: dataRows }
}

const parseNumberValue = (value: any) => {
  const raw = String(value || '').trim()
  if (!raw) return null
  const normalized = raw
    .replace(/\s+/g, '')
    .replace(/,/g, '.')
    .replace(/[^0-9.-]/g, '')
  if (!normalized) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

const parseDateWithFormat = (value: any, format: CsvDateFormat): Date | null => {
  const raw = String(value || '').trim()
  if (!raw) return null

  const parseDmY = () => {
    const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2}))?$/)
    if (!match) return null
    const day = Number(match[1])
    const month = Number(match[2])
    const year = Number(match[3])
    const hour = Number(match[4] || 0)
    const minute = Number(match[5] || 0)
    const date = new Date(year, month - 1, day, hour, minute)
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
    return date
  }

  const parseYmD = () => {
    const match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/)
    if (!match) return null
    const year = Number(match[1])
    const month = Number(match[2])
    const day = Number(match[3])
    const hour = Number(match[4] || 0)
    const minute = Number(match[5] || 0)
    const date = new Date(year, month - 1, day, hour, minute)
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
    return date
  }

  if (format === 'dd/mm/yyyy' || format === 'dd/mm/yyyy hh:mm') return parseDmY()
  if (format === 'yyyy-mm-dd' || format === 'yyyy-mm-dd hh:mm') return parseYmD()

  const tryFormats: CsvDateFormat[] = ['dd/mm/yyyy hh:mm', 'dd/mm/yyyy', 'yyyy-mm-dd hh:mm', 'yyyy-mm-dd']
  for (const f of tryFormats) {
    const parsed: Date | null = parseDateWithFormat(raw, f)
    if (parsed) return parsed
  }

  const fallback = new Date(raw)
  if (!Number.isNaN(fallback.getTime())) return fallback
  return null
}

const detectBestDateFormat = (samples: string[]) => {
  const candidates: CsvDateFormat[] = ['dd/mm/yyyy hh:mm', 'dd/mm/yyyy', 'yyyy-mm-dd hh:mm', 'yyyy-mm-dd']
  let best: CsvDateFormat = 'dd/mm/yyyy hh:mm'
  let bestScore = -1

  candidates.forEach((candidate) => {
    const score = samples.reduce((sum, value) => sum + (parseDateWithFormat(value, candidate) ? 1 : 0), 0)
    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
  })

  return best
}

const autoMapColumns = (columns: string[]) => {
  const mapping = {} as Record<ImportFieldKey, string>
  const normalizedColumns = columns.map((column) => ({
    original: column,
    normalized: normalizeHeader(column),
  }))

  importFieldDefinitions.forEach((field) => {
    const synonyms = field.synonyms.map((syn) => normalizeHeader(syn))
    const directMatch = normalizedColumns.find((col) =>
      synonyms.some((synonym) => col.normalized === synonym || col.normalized.includes(synonym) || synonym.includes(col.normalized))
    )
    mapping[field.key] = directMatch?.original || ''
  })

  return mapping
}

const normalizeStatusValue = (value: any) => normalizeHeader(value)

const autoMapSingleStatusValue = (rawStatus: string) => {
  const v = normalizeStatusValue(rawStatus)
  if (!v) return ''

  if (v.includes('nouvelle') || v === 'new') return 'new'
  if (v.includes('non confirme') || v.includes('confirmation rejet')) return 'confirmation_rejected'
  if (v.includes('rappel 1')) return 'follow_up_1'
  if (v.includes('rappel 2')) return 'follow_up_2'
  if (v.includes('rappel 3')) return 'follow_up_3'
  if (v.includes('rappel 4')) return 'follow_up_4'
  if (v.includes('rappel 5')) return 'follow_up_5'
  if (v.includes('pas de reponse') || v.includes('no answer')) return 'no_answer'
  if (v.includes('pas de reponse livreur')) return 'dl_no_answer'
  if (v.includes('injoignable')) return 'dl_unreachable'
  if (v.includes('hors zone')) return 'dl_out_of_zone'
  if (v.includes('client interesse')) return 'dl_client_interested'
  if (v.includes('reportee') || v.includes('reporte')) return 'dl_postponed'
  if (v.includes('changement d adresse') || v.includes('changement adresse')) return 'dl_address_change'
  if (v.includes('mauvais numero') || v.includes('wrong number')) return 'wrong_number'
  if (v.includes('boite vocale') || v.includes('voicemail') || v === 'b v' || v === 'bv') return 'voicemail'
  if (v.includes('confirme')) return 'confirmed'
  if (v.includes('en attente de ramassage')) return 'dl_pickup_pending'
  if (v.includes('ramasse') || v.includes('picked up')) return 'picked_up'
  if (v.includes('envoye') || v.includes('sent')) return 'sent'
  if (v.includes('sortie pour livraison')) return 'dl_out_for_delivery'
  if (v.includes('livre') || v.includes('delivered')) return 'delivered'
  if (v.includes('demande de suivie')) return 'dl_follow_up_request'
  if (v.includes('facture par erreur')) return 'dl_billing_error'
  if (v.includes('remboursement')) return 'dl_refund'
  if (v.includes('annule') || v.includes('cancel')) return 'cancelled'
  if (v.includes('refuse')) return 'refused'
  if (v.includes('retour non stock') || v.includes('returned not stocked')) return 'returned_not_stocked'
  if (v.includes('retour stock') || v.includes('returned stocked')) return 'returned_stocked'
  return ''
}

const buildDedupeKey = (phone: string, isoDate: string, totalSellingPrice: number) => {
  const phoneKey = normalizePhoneForBlacklist(phone)
  const dateKey = new Date(isoDate).toISOString().slice(0, 19)
  const priceKey = Number(totalSellingPrice || 0).toFixed(2)
  return `${phoneKey}|${dateKey}|${priceKey}`
}

const createEmptyImportMapping = () =>
  importFieldDefinitions.reduce((acc, field) => {
    acc[field.key] = ''
    return acc
  }, {} as Record<ImportFieldKey, string>)

const areStringMapsEqual = (a: Record<string, string>, b: Record<string, string>) => {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false
  }
  return true
}

export default function VentesPage() {
  const PAGE_SIZE = 10
  const { currentStoreId, accessibleStoreIds } = useStore()
  const { role } = usePermissions(currentStoreId)
  const isConfirmationRole = role === 'confirmation'
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [blacklistFilter, setBlacklistFilter] = useState<'all' | 'blacklisted' | 'not_blacklisted'>('all')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [selectedCreateStoreId, setSelectedCreateStoreId] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [orderDate, setOrderDate] = useState(getNowLocalDateTimeValue)
  const [orderSource, setOrderSource] = useState<'organic' | 'ads' | 'recommendation'>('organic')
  const [selectedAgentId, setSelectedAgentId] = useState('')
  const [selectedDeliveryCompanyId, setSelectedDeliveryCompanyId] = useState('')
  const [deliveryCostAutomationEnabled, setDeliveryCostAutomationEnabled] = useState(false)
  const [deliveryApiKey, setDeliveryApiKey] = useState('')
  const [showDeliveryApiKeyInput, setShowDeliveryApiKeyInput] = useState(false)
  const [showApiAutomationInfoModal, setShowApiAutomationInfoModal] = useState(false)
  const [deliveryBillingMode, setDeliveryBillingMode] = useState<'free' | 'paid_by_customer'>('free')
  const [deliveryChargeToCustomer, setDeliveryChargeToCustomer] = useState('0')
  const [discountType, setDiscountType] = useState<'fixed' | 'amount' | 'percentage'>('fixed')
  const [discountValue, setDiscountValue] = useState('0')
  const [deliveryFee, setDeliveryFee] = useState('0')
  const [formError, setFormError] = useState('')
  const [items, setItems] = useState<Array<{ product_id: string; product_variant_id: string; quantity: number; unit_selling_price: number }>>([
    { product_id: '', product_variant_id: '', quantity: 1, unit_selling_price: 0 },
  ])
  const [productSearchTerms, setProductSearchTerms] = useState<string[]>([''])
  const [openProductDropdownIndex, setOpenProductDropdownIndex] = useState<number | null>(null)
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null)
  const [selectedOrderForDetails, setSelectedOrderForDetails] = useState<any | null>(null)
  const [isRapidDeliveryModalOpen, setIsRapidDeliveryModalOpen] = useState(false)
  const [rapidDeliveryOrder, setRapidDeliveryOrder] = useState<any | null>(null)
  const [rapidDeliveryCityKey, setRapidDeliveryCityKey] = useState('')
  const [rapidDeliveryShopKey, setRapidDeliveryShopKey] = useState('')
  const [rapidDeliveryRemark, setRapidDeliveryRemark] = useState('')
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [importStep, setImportStep] = useState<1 | 2 | 3>(1)
  const [importFileName, setImportFileName] = useState('')
  const [importRows, setImportRows] = useState<Array<Record<string, string>>>([])
  const [importColumns, setImportColumns] = useState<string[]>([])
  const [importDateFormat, setImportDateFormat] = useState<CsvDateFormat>('auto')
  const [suggestedDateFormat, setSuggestedDateFormat] = useState<CsvDateFormat>('dd/mm/yyyy hh:mm')
  const [fieldToColumnMap, setFieldToColumnMap] = useState<Record<ImportFieldKey, string>>(createEmptyImportMapping)
  const [statusValueMap, setStatusValueMap] = useState<Record<string, string>>({})
  const [productValueMap, setProductValueMap] = useState<Record<string, string>>({})
  const [agentValueMap, setAgentValueMap] = useState<Record<string, string>>({})
  const [deliveryCompanyValueMap, setDeliveryCompanyValueMap] = useState<Record<string, string>>({})
  const [deliveryCompanyOtherNameMap, setDeliveryCompanyOtherNameMap] = useState<Record<string, string>>({})
  const [linkImportedProducts, setLinkImportedProducts] = useState(true)
  const [linkImportedAgents, setLinkImportedAgents] = useState(true)
  const [linkImportedDeliveryCompanies, setLinkImportedDeliveryCompanies] = useState(true)
  const [defaultConfirmationAgentSelection, setDefaultConfirmationAgentSelection] = useState(IMPORT_SELF_CONFIRMATION)
  const [defaultDeliveryCompanySelection, setDefaultDeliveryCompanySelection] = useState(IMPORT_INTERNAL_DELIVERY)
  const [defaultDeliveryCompanyOtherName, setDefaultDeliveryCompanyOtherName] = useState('')
  const [importError, setImportError] = useState('')
  const [importSummary, setImportSummary] = useState<{
    inserted: number
    duplicates: number
    invalid: number
    total: number
    ignoredRows: Array<{
      rowNumber: number
      reason: string
      statusRaw?: string
      productRaw?: string
      agentRaw?: string
      deliveryCompanyRaw?: string
      customerName?: string
      phone?: string
    }>
  } | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const supabase = createClient()
  const queryClient = useQueryClient()
  const statusOptions = useMemo(() => {
    const priorityMap = new Map<string, number>(
      STATUS_ORDER_PRIORITY.map((status, index) => [status, index])
    )

    return Object.entries(statusConfig)
      .map(([value, cfg]) => ({ value, label: cfg.label }))
      .sort((a, b) => {
        const aPriority = priorityMap.get(a.value)
        const bPriority = priorityMap.get(b.value)

        if (aPriority !== undefined && bPriority !== undefined) return aPriority - bPriority
        if (aPriority !== undefined) return -1
        if (bPriority !== undefined) return 1

        return a.label.localeCompare(b.label, 'fr')
      })
  }, [])
  const userStatusOptions = useMemo(
    () => statusOptions.filter((option) => USER_EDITABLE_STATUSES.includes(option.value as any)),
    [statusOptions]
  )
  const statusDateFieldMap = useMemo(
    () => ({
      new: 'created_at',
      confirmation_rejected: 'confirmation_rejected_at',
      follow_up_1: 'follow_up_1_at',
      follow_up_2: 'follow_up_2_at',
      follow_up_3: 'follow_up_3_at',
      no_answer: 'no_answer_at',
      wrong_number: 'wrong_number_at',
      voicemail: 'voicemail_at',
      confirmed: 'confirmed_at',
      picked_up: 'picked_up_at',
      sent: 'sent_at',
      delivered: 'delivered_at',
      cancelled: 'cancelled_at',
      refused: 'refused_at',
      returned_not_stocked: 'returned_not_stocked_at',
      returned_stocked: 'returned_stocked_at',
      dl_no_answer: 'dl_no_answer_at',
      dl_unreachable: 'dl_unreachable_at',
      dl_out_of_zone: 'dl_out_of_zone_at',
      dl_client_interested: 'dl_client_interested_at',
      dl_postponed: 'dl_postponed_at',
      dl_address_change: 'dl_address_change_at',
      dl_pickup_pending: 'dl_pickup_pending_at',
      dl_refund: 'dl_refund_at',
      dl_follow_up_request: 'dl_follow_up_request_at',
      dl_billing_error: 'dl_billing_error_at',
      dl_out_for_delivery: 'dl_out_for_delivery_at',
    } as Record<string, string>),
    []
  )

  const { data: orders, isLoading } = useQuery({
    queryKey: ['orders', currentStoreId, search, statusFilter, currentPage],
    queryFn: async () => {
      if (!currentStoreId && accessibleStoreIds.length === 0) {
        return { data: [], count: 0 }
      }

      let query = supabase
        .from('orders')
        .select(`
          *,
          order_items(
            quantity,
            product_id,
            product_variant_id,
            unit_selling_price,
            products(name)
          ),
          delivery_companies(name),
          confirmation_agents(name)
        `, { count: 'exact' })
        .order('order_date', { ascending: false })
        .range((currentPage - 1) * PAGE_SIZE, (currentPage * PAGE_SIZE) - 1)

      if (currentStoreId) {
        query = query.eq('store_id', currentStoreId)
      } else if (accessibleStoreIds.length > 0) {
        query = query.in('store_id', accessibleStoreIds)
      }

      if (search) {
        query = query.or(`customer_name.ilike.%${search}%,phone.ilike.%${search}%,tracking_number.ilike.%${search}%`)
      }

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter)
      }

      let { data, error, count } = await query

      if (error) {
        let fallbackQuery = supabase
          .from('orders')
          .select(`
            *,
            order_items(
              quantity,
              product_id,
              product_variant_id,
              unit_selling_price,
              products(name)
            ),
            delivery_companies(name),
            confirmation_agents(name)
          `, { count: 'exact' })

          .order('order_date', { ascending: false })
          .range((currentPage - 1) * PAGE_SIZE, (currentPage * PAGE_SIZE) - 1)

        if (currentStoreId) {
          fallbackQuery = fallbackQuery.eq('store_id', currentStoreId)
        } else if (accessibleStoreIds.length > 0) {
          fallbackQuery = fallbackQuery.in('store_id', accessibleStoreIds)
        }

        if (search) {
          fallbackQuery = fallbackQuery.or(`customer_name.ilike.%${search}%,phone.ilike.%${search}%,tracking_number.ilike.%${search}%`)
        }

        if (statusFilter !== 'all') {
          fallbackQuery = fallbackQuery.eq('status', statusFilter)
        }

        const fallbackResult = await fallbackQuery
        data = fallbackResult.data
        count = fallbackResult.count
        error = fallbackResult.error
      }

      if (error) throw error

      const normalizedData = (data || []).map((order: any) => ({
        ...order,
        order_items: (order?.order_items || []).map((item: any) => ({
          ...item,
          product_variant_id: item?.product_variant_id || null,
        })),
      }))

      return {
        data: normalizedData,
        count: count || 0,
      }
    },
  })

  useEffect(() => {
    setCurrentPage(1)
  }, [currentStoreId, search, statusFilter])

  const orderVariantIds = useMemo(
    () => Array.from(new Set((orders?.data || [])
      .flatMap((order: any) => (order?.order_items || []).map((item: any) => item?.product_variant_id))
      .filter(Boolean))),
    [orders?.data]
  )

  const { data: orderVariantsById } = useQuery({
    queryKey: ['sales-order-variants-by-id', orderVariantIds],
    enabled: orderVariantIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_variants')
        .select('id, name, sku')
        .in('id', orderVariantIds)

      if (error) throw error
      return Object.fromEntries((data || []).map((variant: any) => [variant.id, variant])) as Record<string, any>
    },
  })

  const { data: userContext } = useQuery({
    queryKey: ['sales-user-context'],
    queryFn: async () => {
      const { data, error } = await supabase.auth.getUser()
      if (error) throw error
      return data.user || null
    },
  })

  const { data: ownedStores = [] } = useQuery({
    queryKey: ['sales-owned-stores', userContext?.id],
    enabled: !!userContext?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stores')
        .select('id')
        .eq('owner_user_id', userContext!.id)

      if (error) throw error
      return data || []
    },
  })

  const ownedStoreIds = useMemo(
    () => Array.from(new Set((ownedStores || []).map((store: any) => String(store.id || '')).filter(Boolean))),
    [ownedStores]
  )

  const { data: blacklistEntries = [] } = useQuery({
    queryKey: ['sales-blacklist-entries-owner', ownedStoreIds],
    enabled: ownedStoreIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('blacklist_entries')
        .select('phone, reason')
        .in('store_id', ownedStoreIds)

      if (error) throw error
      return data || []
    },
  })

  const { data: blacklistRule } = useQuery({
    queryKey: ['sales-blacklist-rule-owner', ownedStoreIds],
    enabled: ownedStoreIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('blacklist_rules')
        .select('store_id, max_status_hits, status_filters')
        .in('store_id', ownedStoreIds)
        .order('created_at', { ascending: true })
        .limit(1)

      if (error) throw error
      return (data || [])[0] || null
    },
  })

  const { data: orderStatusRowsForBlacklist = [] } = useQuery({
    queryKey: ['sales-blacklist-order-statuses-owner', ownedStoreIds, blacklistRule?.status_filters, blacklistRule?.max_status_hits],
    enabled: ownedStoreIds.length > 0,
    queryFn: async () => {
      const statusFilters = (blacklistRule?.status_filters || ['returned_not_stocked', 'returned_stocked']) as string[]
      if (statusFilters.length === 0) return []

      const { data, error } = await supabase
        .from('orders')
        .select('phone, status')
        .in('store_id', ownedStoreIds)
        .in('status', statusFilters)

      if (error) throw error
      return data || []
    },
  })

  const blacklistPhonesSet = useMemo(() => {
    const set = new Set<string>()
    const allowSet = new Set<string>()

    ;(blacklistEntries || []).forEach((row: any) => {
      const normalized = normalizePhoneForBlacklist(row?.phone)
      if (!normalized) return
      if (String(row?.reason || '') === BLACKLIST_ALLOW_REASON) {
        allowSet.add(normalized)
      }
    })

    ;(blacklistEntries || []).forEach((row: any) => {
      const normalized = normalizePhoneForBlacklist(row?.phone)
      if (normalized) set.add(normalized)
    })

    const threshold = Number(blacklistRule?.max_status_hits || 3)
    const counts: Record<string, number> = {}

    ;(orderStatusRowsForBlacklist || []).forEach((row: any) => {
      const normalized = normalizePhoneForBlacklist(row?.phone)
      if (!normalized) return
      counts[normalized] = Number(counts[normalized] || 0) + 1
    })

    Object.entries(counts).forEach(([phoneKey, count]) => {
      if (count >= threshold) {
        set.add(phoneKey)
      }
    })

    allowSet.forEach((phoneKey) => {
      set.delete(phoneKey)
    })

    return set
  }, [blacklistEntries, blacklistRule?.max_status_hits, orderStatusRowsForBlacklist])

  const { data: stores } = useQuery({
    queryKey: ['sales-stores-for-create-order'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stores')
        .select('id, name')
        .order('created_at', { ascending: true })

      if (error) throw error
      return data || []
    },
  })

  const { data: products } = useQuery({
    queryKey: ['sales-products-for-create-order', selectedCreateStoreId],
    queryFn: async () => {
      if (!selectedCreateStoreId) return []

      let query = supabase
        .from('products')
        .select('id, name, default_selling_price, default_purchase_cost')
        .order('created_at', { ascending: false })

      query = query.eq('store_id', selectedCreateStoreId)

      const { data, error } = await query
      if (error) throw error
      return data || []
    },
  })

  // Products for editing existing orders
  // Uses currentStoreId when a specific store is selected, all accessible stores when "Tous les stores"
  const editProductsStoreIds = useMemo(() => {
    return currentStoreId ? [currentStoreId] : accessibleStoreIds
  }, [currentStoreId, accessibleStoreIds])

  const { data: editProducts } = useQuery({
    queryKey: ['sales-edit-products', editProductsStoreIds],
    enabled: editProductsStoreIds.length > 0,
    queryFn: async () => {
      if (editProductsStoreIds.length === 0) return []

      let query = supabase
        .from('products')
        .select('id, name, default_selling_price, default_purchase_cost')
        .order('created_at', { ascending: false })

      query = query.in('store_id', editProductsStoreIds)

      const { data, error } = await query
      if (error) throw error
      return data || []
    },
  })

  // Variants for editing existing orders
  // Uses currentStoreId when a specific store is selected, all accessible stores when "Tous les stores"
  const editVariantsStoreIds = useMemo(() => {
    return currentStoreId ? [currentStoreId] : accessibleStoreIds
  }, [currentStoreId, accessibleStoreIds])

  const { data: editVariantsByProductId } = useQuery({
    queryKey: ['sales-edit-variants-by-product', editVariantsStoreIds],
    enabled: editVariantsStoreIds.length > 0,
    queryFn: async () => {
      if (editVariantsStoreIds.length === 0) return {} as Record<string, any[]>

      const { data, error } = await supabase
        .from('product_variants')
        .select('id, product_id, name, sku, selling_price, purchase_cost')
        .in('store_id', editVariantsStoreIds)
        .order('created_at', { ascending: true })

      if (error) throw error

      const grouped: Record<string, any[]> = {}
      ;(data || []).forEach((variant: any) => {
        const productId = String(variant.product_id || '')
        if (!productId) return
        if (!grouped[productId]) grouped[productId] = []
        grouped[productId].push(variant)
      })

      return grouped
    },
  })

  const { data: importStoreProducts = [] } = useQuery({
    queryKey: ['sales-import-products-by-store', currentStoreId],
    enabled: !!currentStoreId,
    queryFn: async () => {
      if (!currentStoreId) return []

      const { data, error } = await supabase
        .from('products')
        .select('id, name, default_purchase_cost')
        .eq('store_id', currentStoreId)
        .order('name', { ascending: true })

      if (error) throw error
      return data || []
    },
  })

  const { data: variantsByProductId } = useQuery({
    queryKey: ['sales-variants-by-product', selectedCreateStoreId],
    queryFn: async () => {
      if (!selectedCreateStoreId) return {} as Record<string, any[]>

      const { data, error } = await supabase
        .from('product_variants')
        .select('id, product_id, name, sku, selling_price, purchase_cost')
        .eq('store_id', selectedCreateStoreId)
        .order('created_at', { ascending: true })

      if (error) throw error

      const grouped: Record<string, any[]> = {}
      ;(data || []).forEach((variant: any) => {
        const productId = String(variant.product_id || '')
        if (!productId) return
        if (!grouped[productId]) grouped[productId] = []
        grouped[productId].push(variant)
      })

      return grouped
    },
  })


  const { data: productStockById } = useQuery({
    queryKey: ['sales-product-stock-by-id', selectedCreateStoreId],
    queryFn: async () => {
      if (!selectedCreateStoreId) return {} as Record<string, number>

      let query = supabase
        .from('inventory_movements')
        .select('product_id, product_variant_id, movement_type, adjustment_direction, quantity, remaining_qty')
        .eq('movement_type', 'in')

      query = query.eq('store_id', selectedCreateStoreId)

      const { data, error } = await query
      if (error) throw error

      const stockMap: Record<string, number> = {}
      ;(data || []).forEach((row: any) => {
        const productId = String(row.product_id || '')
        if (!productId) return
        const variantId = String(row.product_variant_id || '__no_variant__')
        const key = `${productId}::${variantId}`
        stockMap[key] = Number(stockMap[key] || 0) + Number(row.remaining_qty || 0)
      })

      return stockMap
    },
  })

  const { data: confirmationAgents } = useQuery({
    queryKey: ['sales-confirmation-agents-for-create-order', selectedCreateStoreId],
    queryFn: async () => {
      if (!selectedCreateStoreId) return []

      let query = supabase
        .from('confirmation_agents')
        .select('id, name')
        .order('name', { ascending: true })

      query = query.eq('store_id', selectedCreateStoreId)

      const { data, error } = await query
      if (error) throw error
      return data || []
    },
  })

  const { data: deliveryCompanies } = useQuery({
    queryKey: ['sales-delivery-companies-for-create-order', selectedCreateStoreId],
    queryFn: async () => {
      if (!selectedCreateStoreId) return []

      let query = supabase
        .from('delivery_companies')
        .select('id, name, api_provider, api_key, is_active')
        .order('created_at', { ascending: false })

      query = query.eq('store_id', selectedCreateStoreId)

      const { data, error } = await query
      if (error) throw error
      return (data || []).filter((company: any) => company.is_active !== false)
    },
  })

  const { data: rapidDeliveryIntegration } = useQuery({
    queryKey: ['rapid-delivery-integration-status'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('integrations')
        .select('id, status')
        .eq('provider', 'rapid-delivery')
        .maybeSingle()

      if (error) throw error
      return data || null
    },
  })

  const { data: createOrderRapidDeliveryConfig } = useQuery({
    queryKey: ['sales-rapid-delivery-config-create-order', selectedCreateStoreId],
    enabled: !!selectedCreateStoreId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rapid_delivery_configs')
        .select('enable_city_normalization')
        .eq('store_id', selectedCreateStoreId)
        .maybeSingle()

      if (error) throw error
      return data || null
    },
  })

  const { data: importRapidDeliveryConfig } = useQuery({
    queryKey: ['sales-rapid-delivery-config-import', currentStoreId],
    enabled: !!currentStoreId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rapid_delivery_configs')
        .select('enable_city_normalization')
        .eq('store_id', currentStoreId!)
        .maybeSingle()

      if (error) throw error
      return data || null
    },
  })

  const { data: rapidDeliveryCities = [] } = useQuery({
    queryKey: ['rapid-delivery-cities', currentStoreId],
    enabled: !!currentStoreId,
    queryFn: async () => {
      // 1. Récupérer l'intégration Rapid Delivery liée au store courant
      const { data: config, error: configError } = await supabase
        .from('rapid_delivery_configs')
        .select('integration_id')
        .eq('store_id', currentStoreId!)
        .maybeSingle()

      if (configError) throw configError

      if (config?.integration_id) {
        // 2. Charger les villes depuis rapid_delivery_cities (liées à l'intégration)
        const { data: cities, error: citiesError } = await supabase
          .from('rapid_delivery_cities')
          .select('city_key, city_name, cost_delivery')
          .eq('integration_id', config.integration_id)
          .order('city_name', { ascending: true })

        if (citiesError) throw citiesError
        if (cities && cities.length > 0) return cities
      }

      // 3. Fallback : charger depuis rapid_delivery_cities_standard (villes génériques)
      const { data: fallbackCities, error: fallbackError } = await supabase
        .from('rapid_delivery_cities_standard')
        .select('city_key, city_name, cost_delivery')
        .order('city_name', { ascending: true })

      if (fallbackError) throw fallbackError
      return fallbackCities || []
    },
  })

  const rapidDeliveryCityCostByKey = useMemo(() => {
    const map = new Map<number, number>()
    for (const city of (rapidDeliveryCities || [])) {
      const cityKey = Number(city?.city_key || 0)
      if (Number.isFinite(cityKey) && cityKey > 0) {
        map.set(cityKey, Number(city?.cost_delivery || 0))
      }
    }
    return map
  }, [rapidDeliveryCities])

  const { data: rapidDeliveryShops = [] } = useQuery({
    queryKey: ['rapid-delivery-shops', rapidDeliveryIntegration?.id],
    enabled: !!rapidDeliveryIntegration?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rapid_delivery_shops')
        .select('shop_key, name')
        .eq('integration_id', rapidDeliveryIntegration!.id)
        .order('name', { ascending: true })

      if (error) throw error
      return data || []
    },
  })

  const { data: importConfirmationAgents = [] } = useQuery({
    queryKey: ['sales-import-confirmation-agents-by-store', currentStoreId],
    enabled: !!currentStoreId,
    queryFn: async () => {
      if (!currentStoreId) return []
      const { data, error } = await supabase
        .from('confirmation_agents')
        .select('id, name')
        .eq('store_id', currentStoreId)
        .order('name', { ascending: true })
      if (error) throw error
      return data || []
    },
  })

  const { data: importDeliveryCompanies = [] } = useQuery({
    queryKey: ['sales-import-delivery-companies-by-store', currentStoreId],
    enabled: !!currentStoreId,
    queryFn: async () => {
      if (!currentStoreId) return []
      const { data, error } = await supabase
        .from('delivery_companies')
        .select('id, name, is_active')
        .eq('store_id', currentStoreId)
        .order('name', { ascending: true })
      if (error) throw error
      return (data || []).filter((row: any) => row.is_active !== false)
    },
  })

  useEffect(() => {
    if (!selectedCreateStoreId) return
    if (selectedDeliveryCompanyId) return
    const latestCompany = (deliveryCompanies || [])[0]
    if (latestCompany?.id) {
      setSelectedDeliveryCompanyId(latestCompany.id)
      setDeliveryCostAutomationEnabled(!!latestCompany.api_key)
      setDeliveryApiKey(latestCompany.api_key || '')
      setShowDeliveryApiKeyInput(false)
    }
  }, [selectedCreateStoreId, selectedDeliveryCompanyId, deliveryCompanies])

  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + (Number(item.quantity || 0) * Number(item.unit_selling_price || 0)), 0),
    [items]
  )

  const parsedDiscountValue = Number(discountValue || 0)
  const parsedDeliveryFee = Number(deliveryFee || 0)
  const parsedDeliveryChargeToCustomer = Number(deliveryChargeToCustomer || 0)
  const isDeliveryCostManagedByApi =
    deliveryCostAutomationEnabled && !!selectedDeliveryCompanyId && selectedDeliveryCompanyId !== '__owner__'

  const discountAmount = useMemo(() => {
    const safeDiscountValue = Number.isFinite(parsedDiscountValue) ? parsedDiscountValue : 0
    if (discountType === 'percentage') {
      const pct = Math.min(100, Math.max(0, safeDiscountValue))
      return (subtotal * pct) / 100
    }
    if (discountType === 'amount') {
      return Math.min(subtotal, Math.max(0, safeDiscountValue))
    }
    return 0
  }, [discountType, parsedDiscountValue, subtotal])

  const totalSellingPrice = useMemo(() => {
    const deliveryCharge = Number.isFinite(parsedDeliveryChargeToCustomer) ? parsedDeliveryChargeToCustomer : 0
    return Math.max(0, subtotal - discountAmount + deliveryCharge)
  }, [subtotal, discountAmount, parsedDeliveryChargeToCustomer])

  const createOrderMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCreateStoreId) throw new Error('Choisissez un store dans le formulaire.')

      const validItems = items.filter((item) => item.product_id && Number(item.quantity) > 0)
      const productsMap = new Map((products || []).map((p: any) => [p.id, p]))
      const stockMap = productStockById || {}

      if (validItems.length === 0) throw new Error('Ajoutez au moins un produit avec quantité valide.')
      if (!customerName.trim()) throw new Error('Le nom client est obligatoire.')
      if (!phone.trim()) throw new Error('Le numéro de téléphone est obligatoire.')
      if (!address.trim()) throw new Error('L\'adresse client est obligatoire.')
      if (!city.trim()) throw new Error('La ville est obligatoire.')
      if (!selectedAgentId) throw new Error('Choisissez un agent de confirmation (ou Owner).')
      if (!selectedDeliveryCompanyId) throw new Error('Choisissez une société de livraison (ou Owner).')

      for (const item of validItems) {
        const productVariants = variantsByProductId?.[item.product_id] || []
        if (productVariants.length > 0 && !item.product_variant_id) {
          const productName = String(productsMap.get(item.product_id)?.name || 'Produit')
          throw new Error(`Veuillez choisir une variante pour "${productName}".`)
        }

        const stockKey = `${item.product_id}::${item.product_variant_id || '__no_variant__'}`
        const availableStock = Number(stockMap[stockKey] || 0)
        const productName = String(productsMap.get(item.product_id)?.name || 'Produit')

        if (availableStock <= 0) {
          throw new Error(`Le produit "${productName}" est en rupture de stock.`)
        }

        if (Number(item.quantity) > availableStock) {
          throw new Error(`Stock insuffisant pour "${productName}". Disponible: ${availableStock}.`)
        }
      }

      const isOwnerConfirmation = selectedAgentId === '__owner__'
      const isOwnerDelivery = selectedDeliveryCompanyId === '__owner__'

      const selectedDeliveryCompany = (deliveryCompanies || []).find(
        (company: any) => company.id === selectedDeliveryCompanyId
      )

      if (
        !isOwnerDelivery &&
        deliveryCostAutomationEnabled &&
        !selectedDeliveryCompany?.api_provider &&
        !deliveryApiKey.trim()
      ) {
        throw new Error('Automation API activée sans provider configuré. Renseignez la clé API ou désactivez automation.')
      }

      const safeDiscountValue = Number.isFinite(parsedDiscountValue) ? parsedDiscountValue : 0
      const normalizedDiscountValue = discountType === 'fixed' ? 0 : safeDiscountValue
      const manualDeliveryFee = isDeliveryCostManagedByApi
        ? 0
        : (Number.isFinite(parsedDeliveryFee) ? parsedDeliveryFee : 0)
      const safeDeliveryChargeToCustomer =
        deliveryBillingMode === 'paid_by_customer' && Number.isFinite(parsedDeliveryChargeToCustomer)
          ? Math.max(0, parsedDeliveryChargeToCustomer)
          : 0

      const computedSubtotal = validItems.reduce(
        (sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_selling_price || 0),
        0
      )

      const computedDiscountAmount =
        discountType === 'percentage'
          ? (computedSubtotal * Math.min(100, Math.max(0, normalizedDiscountValue))) / 100
          : discountType === 'amount'
            ? Math.min(computedSubtotal, Math.max(0, normalizedDiscountValue))
            : 0

      const computedNetTotal = Math.max(0, computedSubtotal - computedDiscountAmount + safeDeliveryChargeToCustomer)
      const shouldNormalizeCreateOrderCity = createOrderRapidDeliveryConfig?.enable_city_normalization !== false
      const normalizedCityPayload = shouldNormalizeCreateOrderCity
        ? await normalizeOrderCityRequest(city.trim())
        : { cityName: city.trim() }
      const normalizedCityValue = String(normalizedCityPayload.cityName || city.trim()).trim()
      const normalizedCityKey = Number(normalizedCityPayload.cityKey || 0) || null
      const resolvedDeliveryFee = normalizedCityKey
        ? Number(rapidDeliveryCityCostByKey.get(normalizedCityKey) ?? manualDeliveryFee)
        : manualDeliveryFee

      const { data: insertedOrder, error: insertOrderError } = await supabase
        .from('orders')
        .insert({
          store_id: selectedCreateStoreId,
          customer_name: customerName.trim(),
          phone: phone.trim(),
          address: address.trim(),
          city: normalizedCityValue,
          rapid_delivery_city_key: normalizedCityKey,
          source: orderSource,
          status: 'new',
          order_date: orderDate ? new Date(orderDate).toISOString() : new Date().toISOString(),
          subtotal_amount: computedSubtotal,
          total_selling_price: computedNetTotal,
          discount_type: discountType,
          discount_value: normalizedDiscountValue,
          discount_amount: computedDiscountAmount,
          delivery_fee: resolvedDeliveryFee,
          delivery_charge_to_customer: safeDeliveryChargeToCustomer,
          confirmation_agent_id: isOwnerConfirmation ? null : selectedAgentId,
          delivery_company_id: isOwnerDelivery ? null : selectedDeliveryCompanyId,
        })
        .select('id')
        .single()

      if (insertOrderError) throw insertOrderError

      const orderItemsPayload = validItems.map((item) => {
        const product = productsMap.get(item.product_id)
        const variant = (variantsByProductId?.[item.product_id] || []).find((v: any) => v.id === item.product_variant_id)
        return {
          store_id: selectedCreateStoreId,
          order_id: insertedOrder.id,
          product_id: item.product_id,
          product_variant_id: item.product_variant_id || null,
          quantity: Number(item.quantity || 1),
          unit_selling_price: Number(item.unit_selling_price || 0),
          unit_purchase_cost_snapshot: Number(variant?.purchase_cost ?? product?.default_purchase_cost ?? 0),
        }
      })

      const { error: insertItemsError } = await supabase
        .from('order_items')
        .insert(orderItemsPayload)

      if (insertItemsError) throw insertItemsError
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['orders'] })
      await queryClient.invalidateQueries({ queryKey: ['sales-blacklist-order-statuses'] })
      await queryClient.invalidateQueries({ queryKey: ['sales-blacklist-order-statuses-owner'] })
      setIsCreateOpen(false)
      setCustomerName('')
      setPhone('')
      setAddress('')
      setCity('')
      setOrderDate(getNowLocalDateTimeValue())
      setOrderSource('organic')
      setSelectedAgentId('')
      setSelectedDeliveryCompanyId('')
      setDeliveryCostAutomationEnabled(false)
      setDeliveryApiKey('')
      setShowDeliveryApiKeyInput(false)
      setShowApiAutomationInfoModal(false)
      setDeliveryBillingMode('free')
      setDeliveryChargeToCustomer('0')
      setSelectedCreateStoreId(currentStoreId || '')
      setItems([{ product_id: '', product_variant_id: '', quantity: 1, unit_selling_price: 0 }])
      setProductSearchTerms([''])
      setOpenProductDropdownIndex(null)
      setDiscountType('fixed')
      setDiscountValue('0')
      setDeliveryFee('0')
      setFormError('')
    },
    onError: (error: any) => {
      setFormError(error?.message || 'Erreur lors de la création de la commande')
    },
  })

  const updateOrderStatusMutation = useMutation({
    mutationFn: async ({ orderId, status }: { orderId: string; status: string }) => {
      const response = await fetch('/api/orders/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, status }),
      })

      const payload = (await response.json().catch(() => null)) as { error?: string; warning?: string } | null
      if (!response.ok) {
        throw new Error(payload?.error || 'ORDER_STATUS_UPDATE_FAILED')
      }

      return payload
    },
    onSuccess: async (payload) => {
      await queryClient.invalidateQueries({ queryKey: ['orders'] })
      await queryClient.invalidateQueries({ queryKey: ['sales-blacklist-order-statuses'] })
      await queryClient.invalidateQueries({ queryKey: ['sales-blacklist-order-statuses-owner'] })
      if (payload?.warning) {
        setFormError(payload.warning)
      }
    },
    onError: (error: any) => {
      setFormError(error?.message || 'Erreur lors du changement de statut')
    },
  })

  const createRapidDeliveryParcelMutation = useMutation({
    mutationFn: async () => {
      if (!currentStoreId || !rapidDeliveryOrder?.id) throw new Error('Commande introuvable.')
      if (!rapidDeliveryCityKey || !rapidDeliveryShopKey) throw new Error('Choisissez la ville et le shop.')

      const response = await fetch('/api/integrations/rapid-delivery/parcels/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId: currentStoreId,
          orderId: rapidDeliveryOrder.id,
          cityKey: Number(rapidDeliveryCityKey),
          shopKey: Number(rapidDeliveryShopKey),
          remark: rapidDeliveryRemark,
        }),
      })

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(payload?.error || 'RAPID_DELIVERY_CREATE_FAILED')
      }

      return response.json()
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['orders'] })
      setIsRapidDeliveryModalOpen(false)
      setRapidDeliveryOrder(null)
      setRapidDeliveryCityKey('')
      setRapidDeliveryShopKey('')
      setRapidDeliveryRemark('')
      setFormError('')
    },
    onError: (error: any) => {
      setFormError(error?.message || 'Erreur création colis Rapid Delivery')
    },
  })

  const trackRapidDeliveryMutation = useMutation({
    mutationFn: async ({ orderId, trackingNumber }: { orderId: string; trackingNumber: string }) => {
      const params = new URLSearchParams({ orderId, trackingNumber })
      const response = await fetch(`/api/integrations/rapid-delivery/parcels/track?${params.toString()}`)
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(payload?.error || 'RAPID_DELIVERY_TRACK_FAILED')
      }
      return response.json()
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['orders'] })
      setFormError('')
    },
    onError: (error: any) => {
      setFormError(error?.message || 'Erreur suivi Rapid Delivery')
    },
  })

  const syncAllRapidDeliveryMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/integrations/rapid-delivery/parcels/sync-all', {
        method: 'POST',
      })
      const payload = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) throw new Error(payload?.error || 'RAPID_DELIVERY_SYNC_ALL_FAILED')
      return payload
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['orders'] })
      setFormError('')
    },
    onError: (error: any) => {
      setFormError(error?.message || 'Erreur synchronisation Rapid Delivery')
    },
  })

  const updateOrderFieldMutation = useMutation({
    mutationFn: async ({ orderId, field, value }: { orderId: string; field: string; value: any }) => {
      const { error } = await supabase
        .from('orders')
        .update({ [field]: value })
        .eq('id', orderId)

      if (error) throw error
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['orders'] })
    },
    onError: (error: any) => {
      setFormError(error?.message || 'Erreur de mise à jour')
    },
  })

  const updateOrderCityMutation = useMutation({
    mutationFn: async ({ orderId, cityName, cityKey }: { orderId: string; cityName: string; cityKey?: number | null }) => {
      // Normaliser la ville via l'API (comme à la création)
      const normalized = await normalizeOrderCityRequest(cityName)
      const resolvedCityName = String(normalized.cityName || cityName).trim()
      const resolvedCityKey = Number(normalized.cityKey || 0) || cityKey || null

      // Calculer les frais de livraison si on a un cityKey
      let resolvedDeliveryFee: number | undefined
      if (resolvedCityKey) {
        const cost = rapidDeliveryCityCostByKey.get(resolvedCityKey)
        if (cost !== undefined) {
          resolvedDeliveryFee = cost
        }
      }

      const updatePayload: Record<string, any> = {
        city: resolvedCityName,
        rapid_delivery_city_key: resolvedCityKey,
      }
      if (resolvedDeliveryFee !== undefined) {
        updatePayload.delivery_fee = resolvedDeliveryFee
      }

      const { error } = await supabase
        .from('orders')
        .update(updatePayload)
        .eq('id', orderId)

      if (error) throw error
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['orders'] })
    },
    onError: (error: any) => {
      setFormError(error?.message || 'Erreur de mise à jour de la ville')
    },
  })

  const updateOrderItemsMutation = useMutation({
    mutationFn: async ({ orderId, storeId, items }: { orderId: string; storeId: string; items: any[] }) => {
      // Reconstruct each item with required fields before insert
      const payload = items.map((item) => ({
        order_id: orderId,
        store_id: storeId,
        product_id: item.product_id,
        product_variant_id: item.product_variant_id || null,
        quantity: Number(item.quantity) || 1,
        unit_selling_price: Number(item.unit_selling_price) || 0,
        unit_purchase_cost_snapshot: Number(item.unit_purchase_cost_snapshot) || 0,
        item_type: item.item_type || 'product',
      }))

      // Validate payload before delete
      const invalidItem = payload.find(
        (p) => !p.product_id || p.quantity <= 0
      )
      if (invalidItem) {
        throw new Error('Chaque produit doit avoir un ID et une quantité valide')
      }

      const { error: deleteError } = await supabase
        .from('order_items')
        .delete()
        .eq('order_id', orderId)

      if (deleteError) throw deleteError

      if (payload.length > 0) {
        const { error: insertError } = await supabase
          .from('order_items')
          .insert(payload)

        if (insertError) throw insertError
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['orders'] })
    },
    onError: (error: any) => {
      setFormError(error?.message || 'Erreur de mise à jour des produits')
    },
  })

  useEffect(() => {
    if (!rapidDeliveryIntegration || rapidDeliveryIntegration.status !== 'connected') return
    syncAllRapidDeliveryMutation.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rapidDeliveryIntegration?.id, rapidDeliveryIntegration?.status])

  const getAllowedStatusOptionsForOrder = (order: any) => {
    if (order?.delivery_status_source === 'delivery_company') {
      if (order?.status === 'returned_not_stocked') {
        return userStatusOptions.filter((option) => option.value === 'returned_stocked')
      }
      return []
    }
    return userStatusOptions
  }

  const onChangeProduct = (index: number, productId: string) => {
    const product = (products || []).find((p: any) => p.id === productId)
    const variants = variantsByProductId?.[productId] || []
    const firstVariant = variants[0]
    setProductSearchTerms((prev) => prev.map((term, i) => (i === index ? String(product?.name || '') : term)))
    setItems((prev) =>
      prev.map((item, i) =>
        i === index
          ? {
              ...item,
              product_id: productId,
              product_variant_id: firstVariant?.id || '',
              unit_selling_price: Number(firstVariant?.selling_price ?? product?.default_selling_price ?? 0),
            }
          : item
      )
    )
  }

  const onChangeVariant = (index: number, variantId: string) => {
    setItems((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item
        const variants = variantsByProductId?.[item.product_id] || []
        const variant = variants.find((v: any) => v.id === variantId)
        return {
          ...item,
          product_variant_id: variantId,
          unit_selling_price: Number(variant?.selling_price ?? item.unit_selling_price ?? 0),
        }
      })
    )
  }

  const onChangeItemField = (index: number, field: 'quantity' | 'unit_selling_price', value: number) => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)))
  }

  const addItemRow = () => {
    setItems((prev) => [...prev, { product_id: '', product_variant_id: '', quantity: 1, unit_selling_price: 0 }])
    setProductSearchTerms((prev) => [...prev, ''])
  }

  const removeItemRow = (index: number) => {
    setItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev))
    setProductSearchTerms((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev))
    setOpenProductDropdownIndex((prev) => (prev === index ? null : prev))
  }

  const whatsappPhone = selectedOrderForDetails?.phone
    ? String(selectedOrderForDetails.phone).replace(/\D/g, '')
    : ''
  const selectedOrderPhoneKey = normalizePhoneForBlacklist(selectedOrderForDetails?.phone)
  const selectedOrderIsBlacklisted = selectedOrderPhoneKey ? blacklistPhonesSet.has(selectedOrderPhoneKey) : false

  const filteredOrders = useMemo(() => {
    const rows = orders?.data || []
    if (blacklistFilter === 'all') return rows

    return rows.filter((order: any) => {
      const normalizedOrderPhone = normalizePhoneForBlacklist(order?.phone)
      const isBlacklisted = normalizedOrderPhone ? blacklistPhonesSet.has(normalizedOrderPhone) : false
      return blacklistFilter === 'blacklisted' ? isBlacklisted : !isBlacklisted
    })
  }, [orders?.data, blacklistFilter, blacklistPhonesSet])

  const totalOrders = orders?.count || 0
  const totalRevenue = filteredOrders.reduce((sum, order) => sum + (order.total_selling_price || 0), 0)
  const totalPages = Math.max(1, Math.ceil(totalOrders / PAGE_SIZE))

  const openRapidDeliveryModal = (order: any) => {
    setRapidDeliveryOrder(order)
    setRapidDeliveryCityKey('')
    setRapidDeliveryShopKey('')
    setRapidDeliveryRemark('')
    setFormError('')
    setIsRapidDeliveryModalOpen(true)
  }

  const statusRawValues = useMemo(() => {
    const statusColumn = fieldToColumnMap.status
    if (!statusColumn) return [] as string[]
    return Array.from(
      new Set(
        importRows
          .map((row) => String(row?.[statusColumn] || '').trim())
          .filter(Boolean)
      )
    )
  }, [fieldToColumnMap.status, importRows])

  const missingRequiredFields = useMemo(
    () => importFieldDefinitions.filter((field) => field.required && !fieldToColumnMap[field.key]),
    [fieldToColumnMap]
  )

  const hasUnmappedStatuses = useMemo(
    () => statusRawValues.some((raw) => !statusValueMap[raw]),
    [statusRawValues, statusValueMap]
  )

  const productRawValues = useMemo(() => {
    const productColumn = fieldToColumnMap.product_name
    if (!productColumn) return [] as string[]

    return Array.from(
      new Set(
        importRows
          .map((row) => String(row?.[productColumn] || '').trim())
          .filter(Boolean)
      )
    )
  }, [fieldToColumnMap.product_name, importRows])

  const hasUnmappedImportProducts = useMemo(() => {
    if (!linkImportedProducts) return false
    return productRawValues.some((raw) => !productValueMap[raw])
  }, [linkImportedProducts, productRawValues, productValueMap])

  const agentRawValues = useMemo(() => {
    const agentColumn = fieldToColumnMap.confirmation_agent
    if (!agentColumn) return [] as string[]
    return Array.from(
      new Set(
        importRows
          .map((row) => String(row?.[agentColumn] || '').trim())
          .filter(Boolean)
      )
    )
  }, [fieldToColumnMap.confirmation_agent, importRows])

  const hasUnmappedImportAgents = useMemo(() => {
    if (!linkImportedAgents) return false
    if (!fieldToColumnMap.confirmation_agent) return false
    return agentRawValues.some((raw) => !agentValueMap[raw])
  }, [linkImportedAgents, fieldToColumnMap.confirmation_agent, agentRawValues, agentValueMap])

  const deliveryCompanyRawValues = useMemo(() => {
    const deliveryCompanyColumn = fieldToColumnMap.delivery_company
    if (!deliveryCompanyColumn) return [] as string[]
    return Array.from(
      new Set(
        importRows
          .map((row) => String(row?.[deliveryCompanyColumn] || '').trim())
          .filter(Boolean)
      )
    )
  }, [fieldToColumnMap.delivery_company, importRows])

  const hasUnmappedImportDeliveryCompanies = useMemo(() => {
    if (!linkImportedDeliveryCompanies) return false
    if (!fieldToColumnMap.delivery_company) return false
    return deliveryCompanyRawValues.some((raw) => !deliveryCompanyValueMap[raw])
  }, [linkImportedDeliveryCompanies, fieldToColumnMap.delivery_company, deliveryCompanyRawValues, deliveryCompanyValueMap])

  const hasMissingOtherDeliveryNames = useMemo(() => {
    if (!linkImportedDeliveryCompanies || !fieldToColumnMap.delivery_company) return false
    return deliveryCompanyRawValues.some((raw) => {
      if (deliveryCompanyValueMap[raw] !== IMPORT_OTHER_DELIVERY) return false
      return !String(deliveryCompanyOtherNameMap[raw] || '').trim()
    })
  }, [
    linkImportedDeliveryCompanies,
    fieldToColumnMap.delivery_company,
    deliveryCompanyRawValues,
    deliveryCompanyValueMap,
    deliveryCompanyOtherNameMap,
  ])

  const hasInvalidDefaultDeliveryOtherName = useMemo(
    () =>
      linkImportedDeliveryCompanies &&
      !fieldToColumnMap.delivery_company &&
      defaultDeliveryCompanySelection === IMPORT_OTHER_DELIVERY &&
      !String(defaultDeliveryCompanyOtherName || '').trim(),
    [
      linkImportedDeliveryCompanies,
      fieldToColumnMap.delivery_company,
      defaultDeliveryCompanySelection,
      defaultDeliveryCompanyOtherName,
    ]
  )

  const mandatoryImportStatuses = useMemo(
    () => ({
      new: 'New order',
      sent: 'Envoyé',
      delivered: 'Delivered',
      cancelled: 'Cancelled',
      return: 'Return',
    }),
    []
  )

  const missingMandatoryImportStatuses = useMemo(() => {
    const mappedValues = new Set(
      statusRawValues
        .map((raw) => statusValueMap[raw])
        .filter((value): value is string => Boolean(value))
    )

    const missing: string[] = []

    if (!mappedValues.has('new')) missing.push(mandatoryImportStatuses.new)
    if (!mappedValues.has('sent')) missing.push(mandatoryImportStatuses.sent)
    if (!mappedValues.has('delivered')) missing.push(mandatoryImportStatuses.delivered)
    if (!mappedValues.has('cancelled')) missing.push(mandatoryImportStatuses.cancelled)

    const hasReturnMapped =
      mappedValues.has('returned_not_stocked') || mappedValues.has('returned_stocked')
    if (!hasReturnMapped) missing.push(mandatoryImportStatuses.return)

    return missing
  }, [mandatoryImportStatuses, statusRawValues, statusValueMap])

  const hasMissingMandatoryImportStatuses = missingMandatoryImportStatuses.length > 0

  const openCreateModal = () => {
    setFormError('')
    setSelectedCreateStoreId(currentStoreId || '')
    setIsCreateOpen(true)
  }

  const openImportModal = () => {
    setIsImportOpen(true)
    setImportStep(1)
    setImportFileName('')
    setImportRows([])
    setImportColumns([])
    setImportDateFormat('auto')
    setSuggestedDateFormat('dd/mm/yyyy hh:mm')
    setFieldToColumnMap(createEmptyImportMapping())
    setStatusValueMap({})
    setProductValueMap({})
    setAgentValueMap({})
    setDeliveryCompanyValueMap({})
    setDeliveryCompanyOtherNameMap({})
    setLinkImportedProducts(true)
    setLinkImportedAgents(true)
    setLinkImportedDeliveryCompanies(true)
    setDefaultConfirmationAgentSelection(IMPORT_SELF_CONFIRMATION)
    setDefaultDeliveryCompanySelection(IMPORT_INTERNAL_DELIVERY)
    setDefaultDeliveryCompanyOtherName('')
    setImportError('')
    setImportSummary(null)
  }

  const closeImportModal = () => {
    setIsImportOpen(false)
    setImportError('')
  }

  const handleCsvUpload = async (file: File) => {
    try {
      const content = await file.text()
      const parsed = parseCsvText(content)
      if (!parsed.columns.length) {
        setImportError('Fichier CSV vide ou invalide.')
        return
      }

      const initialMapping = autoMapColumns(parsed.columns)
      const dateColumn = initialMapping.order_date
      const dateSamples = dateColumn
        ? parsed.rows.map((row) => String(row?.[dateColumn] || '').trim()).filter(Boolean).slice(0, 20)
        : []

      const suggested = dateSamples.length > 0 ? detectBestDateFormat(dateSamples) : 'dd/mm/yyyy hh:mm'

      setImportFileName(file.name)
      setImportRows(parsed.rows)
      setImportColumns(parsed.columns)
      setFieldToColumnMap(initialMapping)
      setSuggestedDateFormat(suggested)
      setImportDateFormat('auto')
      setImportError('')
      setImportSummary(null)
      setImportStep(2)
    } catch (error: any) {
      setImportError(error?.message || 'Impossible de lire ce CSV.')
    }
  }

  useEffect(() => {
    const nextMap: Record<string, string> = {}
    statusRawValues.forEach((raw) => {
      nextMap[raw] = statusValueMap[raw] || autoMapSingleStatusValue(raw)
    })
    setStatusValueMap((prev) => (areStringMapsEqual(prev, nextMap) ? prev : nextMap))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldToColumnMap.status, importRows])

  useEffect(() => {
    if (!linkImportedProducts) return

    const productsById = new Map<string, any>(
      (importStoreProducts || []).map((product: any) => [String(product.id || ''), product])
    )

    const normalizedNameToProducts = new Map<string, any[]>()
    ;(importStoreProducts || []).forEach((product: any) => {
      const normalizedName = normalizeProductName(product?.name)
      if (!normalizedName) return
      const existing = normalizedNameToProducts.get(normalizedName) || []
      existing.push(product)
      normalizedNameToProducts.set(normalizedName, existing)
    })

    const nextMap: Record<string, string> = {}

    productRawValues.forEach((raw) => {
      const current = productValueMap[raw]
      if (current && productsById.has(current)) {
        nextMap[raw] = current
        return
      }

      const normalizedRaw = normalizeProductName(raw)
      const matches = normalizedNameToProducts.get(normalizedRaw) || []
      nextMap[raw] = matches.length === 1 ? String(matches[0].id) : ''
    })

    setProductValueMap((prev) => (areStringMapsEqual(prev, nextMap) ? prev : nextMap))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkImportedProducts, fieldToColumnMap.product_name, importRows, importStoreProducts])

  useEffect(() => {
    if (!linkImportedAgents || !fieldToColumnMap.confirmation_agent) return

    const agentsById = new Map<string, any>(
      (importConfirmationAgents || []).map((agent: any) => [String(agent.id || ''), agent])
    )

    const normalizedNameToAgents = new Map<string, any[]>()
    ;(importConfirmationAgents || []).forEach((agent: any) => {
      const normalizedName = normalizeHeader(agent?.name)
      if (!normalizedName) return
      const existing = normalizedNameToAgents.get(normalizedName) || []
      existing.push(agent)
      normalizedNameToAgents.set(normalizedName, existing)
    })

    const nextMap: Record<string, string> = {}
    agentRawValues.forEach((raw) => {
      const current = agentValueMap[raw]
      if (current === IMPORT_SELF_CONFIRMATION) {
        nextMap[raw] = current
        return
      }
      if (current && agentsById.has(current)) {
        nextMap[raw] = current
        return
      }

      const normalizedRaw = normalizeHeader(raw)
      const matches = normalizedNameToAgents.get(normalizedRaw) || []
      nextMap[raw] = matches.length === 1 ? String(matches[0].id) : ''
    })
    setAgentValueMap((prev) => (areStringMapsEqual(prev, nextMap) ? prev : nextMap))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkImportedAgents, fieldToColumnMap.confirmation_agent, importRows, importConfirmationAgents])

  useEffect(() => {
    if (!linkImportedDeliveryCompanies || !fieldToColumnMap.delivery_company) return

    const companiesById = new Map<string, any>(
      (importDeliveryCompanies || []).map((company: any) => [String(company.id || ''), company])
    )

    const normalizedNameToCompanies = new Map<string, any[]>()
    ;(importDeliveryCompanies || []).forEach((company: any) => {
      const normalizedName = normalizeHeader(company?.name)
      if (!normalizedName) return
      const existing = normalizedNameToCompanies.get(normalizedName) || []
      existing.push(company)
      normalizedNameToCompanies.set(normalizedName, existing)
    })

    const nextMap: Record<string, string> = {}
    deliveryCompanyRawValues.forEach((raw) => {
      const current = deliveryCompanyValueMap[raw]
      if (current === IMPORT_INTERNAL_DELIVERY || current === IMPORT_OTHER_DELIVERY) {
        nextMap[raw] = current
        return
      }
      if (current && companiesById.has(current)) {
        nextMap[raw] = current
        return
      }

      const normalizedRaw = normalizeHeader(raw)
      const matches = normalizedNameToCompanies.get(normalizedRaw) || []
      nextMap[raw] = matches.length === 1 ? String(matches[0].id) : ''
    })
    setDeliveryCompanyValueMap((prev) => (areStringMapsEqual(prev, nextMap) ? prev : nextMap))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkImportedDeliveryCompanies, fieldToColumnMap.delivery_company, importRows, importDeliveryCompanies])

  const importOrdersMutation = useMutation({
    mutationFn: async () => {
      if (!currentStoreId) throw new Error('Sélectionnez un store avant import.')
      if (missingRequiredFields.length > 0) throw new Error('Veuillez mapper tous les champs obligatoires.')
      if (hasMissingMandatoryImportStatuses) {
        throw new Error(
          `Veuillez mapper les statuts obligatoires: ${missingMandatoryImportStatuses.join(', ')}`
        )
      }
      if (linkImportedProducts && !fieldToColumnMap.product_name) {
        throw new Error('Veuillez mapper la colonne produit pour la liaison produits.')
      }
      if (hasUnmappedImportProducts) {
        throw new Error('Veuillez mapper tous les produits CSV dans “Correspondance des produits”.')
      }
      if (linkImportedAgents && fieldToColumnMap.confirmation_agent && hasUnmappedImportAgents) {
        throw new Error('Veuillez mapper tous les agents CSV dans “Correspondance des agents”.')
      }
      if (linkImportedDeliveryCompanies && fieldToColumnMap.delivery_company && hasUnmappedImportDeliveryCompanies) {
        throw new Error('Veuillez mapper toutes les sociétés CSV dans “Correspondance des sociétés de livraison”.')
      }
      if (hasMissingOtherDeliveryNames || hasInvalidDefaultDeliveryOtherName) {
        throw new Error('Veuillez renseigner le nom des sociétés marquées “Autre”.')
      }

      const confirmationAgentsById = new Map<string, any>(
        (importConfirmationAgents || []).map((agent: any) => [String(agent.id || ''), agent])
      )
      const deliveryCompaniesById = new Map<string, any>(
        (importDeliveryCompanies || []).map((company: any) => [String(company.id || ''), company])
      )
      const deliveryCompanyByNormalizedName = new Map<string, string>(
        (importDeliveryCompanies || []).map((company: any) => [normalizeHeader(company.name), String(company.id)])
      )
      const createdDeliveryCompanyByNormalizedName = new Map<string, string>()

      const effectiveDateFormat = importDateFormat === 'auto' ? suggestedDateFormat : importDateFormat
      const validRows: Array<{
        rowNumber: number
        payload: Record<string, any>
        linkedProductId: string | null
        linkedUnitPurchaseCost: number
        productRaw: string
        agentRaw: string
        deliveryCompanyRaw: string
      }> = []
      const ignoredRows: Array<{
        rowNumber: number
        reason: string
        statusRaw?: string
        productRaw?: string
        agentRaw?: string
        deliveryCompanyRaw?: string
        customerName?: string
        phone?: string
      }> = []
      let invalid = 0

      for (let rowIndex = 0; rowIndex < importRows.length; rowIndex += 1) {
        const row = importRows[rowIndex]
        const rowNumber = rowIndex + 2
        const dateRaw = row[fieldToColumnMap.order_date] || ''
        const customerName = String(row[fieldToColumnMap.customer_name] || '').trim()
        const phoneValue = String(row[fieldToColumnMap.phone] || '').trim()
        const addressValue = String(row[fieldToColumnMap.address] || '').trim()
        const cityValue = String(row[fieldToColumnMap.city] || '').trim()
        const statusRaw = String(row[fieldToColumnMap.status] || '').trim()
        const productRaw = String(row[fieldToColumnMap.product_name] || '').trim()
        const agentRaw = String(row[fieldToColumnMap.confirmation_agent] || '').trim()
        const deliveryCompanyRaw = String(row[fieldToColumnMap.delivery_company] || '').trim()
        const totalSellingPrice = parseNumberValue(row[fieldToColumnMap.total_selling_price])

        const parsedDate = parseDateWithFormat(dateRaw, effectiveDateFormat)
        const mappedStatus = statusValueMap[statusRaw] || ''

        const reasons: string[] = []
        if (!parsedDate) reasons.push('Date invalide')
        if (!customerName) reasons.push('Nom client manquant')
        if (!phoneValue) reasons.push('Téléphone manquant')
        if (!addressValue) reasons.push('Adresse manquante')
        if (!cityValue) reasons.push('Ville manquante')
        if (totalSellingPrice === null) reasons.push('Prix de vente invalide')
        if (!mappedStatus) reasons.push('Statut non mappé')

        let linkedProductId: string | null = null
        let linkedUnitPurchaseCost = 0
        let resolvedConfirmationAgentId: string | null = null
        let resolvedDeliveryCompanyId: string | null = null

        if (linkImportedProducts) {
          if (!productRaw) {
            reasons.push('Produit manquant')
          } else {
            const mappedProductId = productValueMap[productRaw] || ''
            if (!mappedProductId) {
              reasons.push('Produit non mappé')
            } else {
              const product = (importStoreProducts || []).find((p: any) => String(p.id) === mappedProductId)
              if (!product) {
                reasons.push('Produit introuvable dans la base')
              } else {
                linkedProductId = mappedProductId
                // Coût d'achat: priorité colonne CSV, sinon default_purchase_cost du produit
                const purchaseCostRaw = fieldToColumnMap.purchase_cost ? row[fieldToColumnMap.purchase_cost] : null
                const parsedPurchaseCost = purchaseCostRaw !== null ? parseNumberValue(purchaseCostRaw) : null
                linkedUnitPurchaseCost = parsedPurchaseCost !== null ? parsedPurchaseCost : Number(product.default_purchase_cost || 0)
              }
            }
          }
        }

        if (linkImportedAgents) {
          const selectedAgent = fieldToColumnMap.confirmation_agent
            ? (agentRaw ? agentValueMap[agentRaw] : defaultConfirmationAgentSelection)
            : defaultConfirmationAgentSelection

          if (!selectedAgent || selectedAgent === IMPORT_SELF_CONFIRMATION) {
            resolvedConfirmationAgentId = null
          } else if (!confirmationAgentsById.has(selectedAgent)) {
            reasons.push('Agent introuvable dans la base')
          } else {
            resolvedConfirmationAgentId = selectedAgent
          }

          if (fieldToColumnMap.confirmation_agent && agentRaw && !selectedAgent) {
            reasons.push('Agent non mappé')
          }
        }

        if (linkImportedDeliveryCompanies) {
          const selectedDeliveryCompany = fieldToColumnMap.delivery_company
            ? (deliveryCompanyRaw ? deliveryCompanyValueMap[deliveryCompanyRaw] : defaultDeliveryCompanySelection)
            : defaultDeliveryCompanySelection

          if (!selectedDeliveryCompany || selectedDeliveryCompany === IMPORT_INTERNAL_DELIVERY) {
            resolvedDeliveryCompanyId = null
          } else if (selectedDeliveryCompany === IMPORT_OTHER_DELIVERY) {
            const otherName = fieldToColumnMap.delivery_company
              ? String(deliveryCompanyOtherNameMap[deliveryCompanyRaw] || '').trim()
              : String(defaultDeliveryCompanyOtherName || '').trim()

            const normalizedOtherName = normalizeHeader(otherName)
            if (!normalizedOtherName) {
              reasons.push('Nom société “Autre” manquant')
            } else {
              const existingId =
                deliveryCompanyByNormalizedName.get(normalizedOtherName) ||
                createdDeliveryCompanyByNormalizedName.get(normalizedOtherName)

              if (existingId) {
                resolvedDeliveryCompanyId = existingId
              } else {
                const { data: insertedCompany, error: insertCompanyError } = await supabase
                  .from('delivery_companies')
                  .insert({
                    store_id: currentStoreId,
                    name: otherName,
                    is_active: true,
                  })
                  .select('id, name')
                  .single()

                if (insertCompanyError) {
                  reasons.push('Impossible de créer la société de livraison')
                } else {
                  const newId = String(insertedCompany?.id || '')
                  if (newId) {
                    createdDeliveryCompanyByNormalizedName.set(normalizedOtherName, newId)
                    resolvedDeliveryCompanyId = newId
                  }
                }
              }
            }
          } else if (!deliveryCompaniesById.has(selectedDeliveryCompany)) {
            reasons.push('Société de livraison introuvable dans la base')
          } else {
            resolvedDeliveryCompanyId = selectedDeliveryCompany
          }

          if (fieldToColumnMap.delivery_company && deliveryCompanyRaw && !selectedDeliveryCompany) {
            reasons.push('Société de livraison non mappée')
          }
        }

        if (reasons.length > 0) {
          invalid += 1
          ignoredRows.push({
            rowNumber,
            reason: reasons.join(', '),
            statusRaw,
            productRaw,
            agentRaw,
            deliveryCompanyRaw,
            customerName,
            phone: phoneValue,
          })
          continue
        }

        if (!parsedDate) {
          continue
        }
        const orderDateIso = parsedDate.toISOString()
        const shouldNormalizeImportCity = importRapidDeliveryConfig?.enable_city_normalization !== false
        const normalizedCityPayload = shouldNormalizeImportCity
          ? await normalizeOrderCityRequest(cityValue)
          : { cityName: cityValue }
        const normalizedCityKey = Number(normalizedCityPayload.cityKey || 0) || null
        const payload: Record<string, any> = {
          store_id: currentStoreId,
          order_date: orderDateIso,
          customer_name: customerName,
          phone: phoneValue,
          address: addressValue,
          city: String(normalizedCityPayload.cityName || cityValue).trim(),
          rapid_delivery_city_key: normalizedCityKey,
          total_selling_price: totalSellingPrice,
          status: mappedStatus,
          source: 'organic',
          subtotal_amount: totalSellingPrice,
          delivery_fee: normalizedCityKey
            ? Number(rapidDeliveryCityCostByKey.get(normalizedCityKey) ?? 0)
            : 0,
          ads_cost_allocated: 0,
          delivery_charge_to_customer: 0,
          confirmation_agent_id: resolvedConfirmationAgentId,
          delivery_company_id: resolvedDeliveryCompanyId,
        }

        const statusDateField = statusDateFieldMap[mappedStatus]
        if (statusDateField && statusDateField !== 'created_at') {
          payload[statusDateField] = orderDateIso
        }
        payload.last_status_update_at = orderDateIso

        const trackingColumn = fieldToColumnMap.tracking_number
        if (trackingColumn) {
          const tracking = String(row[trackingColumn] || '').trim()
          if (tracking) payload.tracking_number = tracking
        }

        const deliveryFeeColumn = fieldToColumnMap.delivery_fee
        if (deliveryFeeColumn) {
          const parsed = parseNumberValue(row[deliveryFeeColumn])
          if (parsed !== null) payload.delivery_fee = parsed
        }

        const adsCostAllocatedColumn = fieldToColumnMap.ads_cost_allocated
        if (adsCostAllocatedColumn) {
          const parsed = parseNumberValue(row[adsCostAllocatedColumn])
          if (parsed !== null) payload.ads_cost_allocated = parsed
        }

        const deliveryChargeColumn = fieldToColumnMap.delivery_charge_to_customer
        if (deliveryChargeColumn) {
          const parsed = parseNumberValue(row[deliveryChargeColumn])
          if (parsed !== null) payload.delivery_charge_to_customer = parsed
        }

        const discountTypeColumn = fieldToColumnMap.discount_type
        if (discountTypeColumn) {
          const discountTypeRaw = String(row[discountTypeColumn] || '').trim().toLowerCase()
          if (['fixed', 'amount', 'percentage'].includes(discountTypeRaw)) payload.discount_type = discountTypeRaw
        }

        const discountValueColumn = fieldToColumnMap.discount_value
        if (discountValueColumn) {
          const parsed = parseNumberValue(row[discountValueColumn])
          if (parsed !== null) payload.discount_value = parsed
        }

        const sourceColumn = fieldToColumnMap.source
        if (sourceColumn) {
          const sourceRaw = String(row[sourceColumn] || '').trim().toLowerCase()
          if (['organic', 'ads', 'recommendation'].includes(sourceRaw)) payload.source = sourceRaw
        }

        validRows.push({
          rowNumber,
          payload,
          linkedProductId,
          linkedUnitPurchaseCost,
          productRaw,
          agentRaw,
          deliveryCompanyRaw,
        })
      }

      if (validRows.length === 0) {
        throw new Error('Aucune ligne valide à importer.')
      }

  const dedupedRows: Array<{
    rowNumber: number
    payload: Record<string, any>
    linkedProductId: string | null
    linkedUnitPurchaseCost: number
  }> = validRows
  const duplicates = 0

  if (dedupedRows.length > 0) {
    const CHUNK_SIZE = 200
    for (let i = 0; i < dedupedRows.length; i += CHUNK_SIZE) {
      const chunkRows = dedupedRows.slice(i, i + CHUNK_SIZE)
      const chunk = chunkRows.map((row) => row.payload)
      const { data: insertedOrders, error } = await supabase
        .from('orders')
        .insert(chunk)
        .select('id, phone, order_date, total_selling_price')
      if (error) throw error

      if (linkImportedProducts) {
        const insertedByKey = new Map<string, string>()
        ;(insertedOrders || []).forEach((inserted: any) => {
          const key = buildDedupeKey(
            String(inserted.phone || ''),
            String(inserted.order_date || ''),
            Number(inserted.total_selling_price || 0)
          )
          insertedByKey.set(key, String(inserted.id || ''))
        })

        const orderItemsPayload = chunkRows
          .filter((row) => !!row.linkedProductId)
          .map((row) => {
            const orderKey = buildDedupeKey(
              String(row.payload.phone || ''),
              String(row.payload.order_date || ''),
              Number(row.payload.total_selling_price || 0)
            )
            const orderId = insertedByKey.get(orderKey) || ''
            if (!orderId) return null

            return {
              store_id: currentStoreId,
              order_id: orderId,
              product_id: row.linkedProductId,
              product_variant_id: null,
              quantity: 1,
              unit_selling_price: Number(row.payload.total_selling_price || 0),
              unit_purchase_cost_snapshot: Number(row.linkedUnitPurchaseCost || 0),
            }
          })
          .filter(Boolean)

        if (orderItemsPayload.length > 0) {
          const { error: orderItemsError } = await supabase.from('order_items').insert(orderItemsPayload as any[])
          if (orderItemsError) throw orderItemsError
        }
      }
    }
  }

      await queryClient.invalidateQueries({ queryKey: ['orders'] })
      await queryClient.invalidateQueries({ queryKey: ['sales-blacklist-order-statuses'] })
      await queryClient.invalidateQueries({ queryKey: ['sales-blacklist-order-statuses-owner'] })

      return {
        inserted: dedupedRows.length,
        duplicates,
        invalid,
        total: importRows.length,
        ignoredRows,
      }
    },
    onSuccess: (summary) => {
      setImportSummary(summary)
      setImportError('')
      setImportStep(3)
    },
    onError: (error: any) => {
      setImportError(error?.message || 'Erreur import CSV')
    },
  })

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col items-center sm:items-start gap-1">
        <div className="flex items-center gap-2">
          <JisraMark size={28} />
          <span className="text-lg font-bold text-[#1fa971] bg-[#1fa971]/10 px-3 py-1 rounded-full">
            Ventes
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Suivi des commandes et des revenus
        </p>
      </div>
      {isCreateOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setIsCreateOpen(false)}>
          <div className="bg-card rounded-2xl shadow-2xl border border-border w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-border flex items-center justify-between shrink-0">
              <h3 className="text-lg font-semibold text-foreground">Nouvelle commande</h3>
              <button
                onClick={() => setIsCreateOpen(false)}
                className="text-muted-foreground hover:text-foreground"
                type="button"
              >
                Fermer
              </button>
            </div>

            <div className="p-6 space-y-5 overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">Date de commande</label>
                  <input
                    type="datetime-local"
                    value={orderDate}
                    onChange={(e) => setOrderDate(e.target.value)}
                    className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground"
                  />
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">Store</label>
                  <select
                    value={selectedCreateStoreId}
                    onChange={(e) => {
                      setSelectedCreateStoreId(e.target.value)
                      setSelectedAgentId('')
                      setSelectedDeliveryCompanyId('')
                      setDeliveryCostAutomationEnabled(false)
                      setDeliveryApiKey('')
                      setShowDeliveryApiKeyInput(false)
                      setShowApiAutomationInfoModal(false)
                      setDeliveryBillingMode('free')
                      setDeliveryChargeToCustomer('0')
                      setItems([{ product_id: '', product_variant_id: '', quantity: 1, unit_selling_price: 0 }])
                      setProductSearchTerms([''])
                      setOpenProductDropdownIndex(null)
                    }}
                    className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground"
                  >
                    <option value="">Choisir un store</option>
                    {(stores || []).map((store: any) => (
                      <option key={store.id} value={store.id}>
                        {store.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">Agent de confirmation</label>
                  <select
                    value={selectedAgentId}
                    onChange={(e) => setSelectedAgentId(e.target.value)}
                    className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground"
                  >
                    <option value="">Choisir un agent</option>
                    <option value="__owner__">Owner a confirmé lui-même</option>
                    {(confirmationAgents || []).map((agent: any) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">Client</label>
                  <input
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground"
                    placeholder="Nom du client"
                  />
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">Téléphone</label>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground"
                    placeholder="Téléphone"
                  />
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">Adresse client</label>
                  <input
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground"
                    placeholder="Adresse complète"
                  />
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">Ville</label>
                  <input
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground"
                    placeholder="Ville"
                  />
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">Source de commande</label>
                  <select
                    value={orderSource}
                    onChange={(e) => setOrderSource(e.target.value as 'organic' | 'ads' | 'recommendation')}
                    className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground"
                  >
                    <option value="organic">Organique</option>
                    <option value="ads">ADS</option>
                    <option value="recommendation">Recommendation</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">Société de livraison</label>
                  <select
                    value={selectedDeliveryCompanyId}
                    onChange={(e) => {
                      const nextDeliveryCompanyId = e.target.value
                      const isOwnerDelivery = nextDeliveryCompanyId === '__owner__'
                      const selectedCompany = (deliveryCompanies || []).find(
                        (company: any) => company.id === nextDeliveryCompanyId
                      )

                      setSelectedDeliveryCompanyId(nextDeliveryCompanyId)
                      setDeliveryCostAutomationEnabled(!isOwnerDelivery && !!selectedCompany?.api_key)
                      setDeliveryApiKey(selectedCompany?.api_key || '')
                      if (!isOwnerDelivery && !!selectedCompany?.api_key) {
                        setDeliveryFee('0')
                      }
                      setShowDeliveryApiKeyInput(false)
                      setShowApiAutomationInfoModal(false)
                    }}
                    className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground"
                  >
                    <option value="">Choisir une société</option>
                    <option value="__owner__">Livraison interne (sans transporteur)</option>
                    {(deliveryCompanies || []).map((company: any) => (
                      <option key={company.id} value={company.id}>
                        {company.name}
                      </option>
                    ))}
                  </select>
                  {selectedCreateStoreId && (deliveryCompanies || []).length === 0 ? (
                    <p className="text-xs text-amber-600 mt-1">
                      Aucune société active pour ce store. Choisissez "Livraison interne (sans transporteur)" ou ajoutez une société.
                    </p>
                  ) : null}
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm text-muted-foreground">Coût livraison</label>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">API</span>
                      <button
                        type="button"
                        onClick={() => {
                          const isOwnerDelivery = selectedDeliveryCompanyId === '__owner__'
                          if (!selectedDeliveryCompanyId || isOwnerDelivery) return

                          const selectedCompany = (deliveryCompanies || []).find(
                            (company: any) => company.id === selectedDeliveryCompanyId
                          )

                          const nextValue = !deliveryCostAutomationEnabled

                          if (nextValue && !selectedCompany?.api_provider && !deliveryApiKey.trim()) {
                            setShowApiAutomationInfoModal(true)
                            return
                          }

                          setFormError('')
                          setDeliveryCostAutomationEnabled(nextValue)
                          if (nextValue) {
                            setDeliveryFee('0')
                          }
                        }}
                        disabled={!selectedDeliveryCompanyId || selectedDeliveryCompanyId === '__owner__'}
                        className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors ${
                          deliveryCostAutomationEnabled ? 'bg-primary' : 'bg-muted'
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                        aria-label="Activer automation coût livraison"
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-background transition-transform ${
                            deliveryCostAutomationEnabled ? 'translate-x-5' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={deliveryFee}
                    onChange={(e) => setDeliveryFee(e.target.value)}
                    disabled={isDeliveryCostManagedByApi}
                    className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground disabled:opacity-50"
                  />
                  {isDeliveryCostManagedByApi ? (
                    <p className="text-xs text-blue-600 mt-1">
                      Coût synchronisé automatiquement via API.
                    </p>
                  ) : null}
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">Facturation livraison</label>
                  <select
                    value={deliveryBillingMode}
                    onChange={(e) => {
                      const mode = e.target.value as 'free' | 'paid_by_customer'
                      setDeliveryBillingMode(mode)
                      if (mode === 'free') {
                        setDeliveryChargeToCustomer('0')
                      }
                    }}
                    className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground"
                  >
                    <option value="free">Livraison gratuite (supportée par le store)</option>
                    <option value="paid_by_customer">Livraison payée par le client</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">Montant livraison facturé client</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={deliveryChargeToCustomer}
                    onChange={(e) => setDeliveryChargeToCustomer(e.target.value)}
                    disabled={deliveryBillingMode === 'free'}
                    className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground disabled:opacity-50"
                  />
                </div>
                <div></div>
                {showApiAutomationInfoModal ? (
                  <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
                    <div className="w-full max-w-md bg-card rounded-2xl shadow-2xl border border-border p-4 space-y-3">
                      <h5 className="text-sm font-semibold text-foreground">Activation API - information</h5>
                      <p className="text-sm text-muted-foreground">
                        Cette société de livraison n'a pas de <span className="font-medium">api_provider</span> configuré.
                        Pour activer l'automation des coûts, veuillez renseigner une clé API transporteur.
                      </p>
                      <div>
                        <label className="block text-sm text-muted-foreground mb-1">Clé API transporteur</label>
                        <input
                          type="password"
                          value={deliveryApiKey}
                          onChange={(e) => setDeliveryApiKey(e.target.value)}
                          className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground"
                          placeholder="Renseignez la clé API"
                        />
                      </div>
                      <div className="flex items-center justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setShowApiAutomationInfoModal(false)}
                          className="px-3 py-1.5 rounded-md border border-border text-sm text-foreground hover:bg-secondary"
                        >
                          Fermer
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!deliveryApiKey.trim()) {
                              setFormError('Veuillez renseigner la clé API transporteur.')
                              return
                            }

                            const { error } = await supabase
                              .from('delivery_companies')
                              .update({ api_key: deliveryApiKey.trim() })
                              .eq('id', selectedDeliveryCompanyId)

                            if (error) {
                              setFormError(error.message || "Erreur lors de l'enregistrement de la clé API.")
                              return
                            }

                            setDeliveryCostAutomationEnabled(true)
                            setDeliveryFee('0')
                            setShowApiAutomationInfoModal(false)
                            setFormError('')
                          }}
                          className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm"
                        >
                          Activer
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
                <div></div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-foreground">Produits de la commande</h4>
                </div>

                {items.map((item, index) => (
                  <div key={index} className="grid grid-cols-1 md:grid-cols-[1fr_180px_110px_150px_auto] gap-3 items-end">
                    <div className="relative">
                      <label className="block text-xs text-muted-foreground mb-1">Produit</label>
                      <input
                        value={productSearchTerms[index] || ''}
                        onFocus={() => setOpenProductDropdownIndex(index)}
                        onChange={(e) => {
                          if (!selectedCreateStoreId) {
                            setOpenProductDropdownIndex(index)
                            return
                          }

                          const value = e.target.value
                          setProductSearchTerms((prev) => prev.map((term, i) => (i === index ? value : term)))
                          setOpenProductDropdownIndex(index)

                          setItems((prev) =>
                            prev.map((row, i) =>
                              i === index
                                ? { ...row, product_id: '', product_variant_id: '', unit_selling_price: 0 }
                                : row
                            )
                          )
                        }}
                        className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground"
                        placeholder={selectedCreateStoreId ? 'Rechercher un produit...' : "Sélectionnez d'abord un store"}
                      />

                      {openProductDropdownIndex === index ? (
                        <div className="absolute z-30 mt-1 w-full max-h-52 overflow-y-auto rounded-lg border border-border bg-card shadow-lg">
                          {!selectedCreateStoreId ? (
                            <div className="px-3 py-2 text-sm text-amber-700 bg-amber-50 border-b border-border">
                              Veuillez sélectionner un store d'abord pour charger les produits.
                            </div>
                          ) : null}

                          {(products || [])
                            .filter((product: any) =>
                              String(product.name || '')
                                .toLowerCase()
                                .includes(String(productSearchTerms[index] || '').toLowerCase())
                            )
                            .slice(0, 40)
                            .map((product: any) => {
                              const variants = variantsByProductId?.[product.id] || []
                              const availableStock = variants.length > 0
                                ? variants.reduce((sum: number, variant: any) => {
                                    const key = `${product.id}::${variant.id}`
                                    return sum + Number(productStockById?.[key] || 0)
                                  }, 0)
                                : Number(productStockById?.[`${product.id}::__no_variant__`] || 0)
                              const isOutOfStock = availableStock <= 0
                              return (
                              <button
                                key={product.id}
                                type="button"
                                onMouseDown={(e) => {
                                  if (isOutOfStock) return
                                  e.preventDefault()
                                  onChangeProduct(index, product.id)
                                  setOpenProductDropdownIndex(null)
                                }}
                                className={`w-full text-left px-3 py-2 text-sm ${
                                  isOutOfStock ? 'text-red-600 bg-red-50 cursor-not-allowed' : 'hover:bg-secondary'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <span>{product.name}</span>
                                  <span className={`text-xs ${isOutOfStock ? 'text-red-600' : 'text-muted-foreground'}`}>
                                    {isOutOfStock ? 'Rupture' : `Stock: ${availableStock}`}
                                  </span>
                                </div>
                              </button>
                              )
                            })}

                          {(products || []).filter((product: any) =>
                            String(product.name || '')
                              .toLowerCase()
                              .includes(String(productSearchTerms[index] || '').toLowerCase())
                          ).length === 0 && selectedCreateStoreId ? (
                            <div className="px-3 py-2 text-sm text-muted-foreground">Aucun produit trouvé</div>
                          ) : null}

                          <div className="border-t border-border px-3 py-2">
                            <button
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault()
                                setOpenProductDropdownIndex(null)
                              }}
                              className="text-xs text-muted-foreground hover:text-foreground"
                            >
                              Fermer la liste
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Variante</label>
                      <select
                        value={item.product_variant_id || ''}
                        onChange={(e) => onChangeVariant(index, e.target.value)}
                        className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground"
                        disabled={!item.product_id || !(variantsByProductId?.[item.product_id] || []).length}
                      >
                        <option value="">
                          {(variantsByProductId?.[item.product_id] || []).length > 0
                            ? 'Choisir variante'
                            : 'Produit sans variantes'}
                        </option>
                        {(variantsByProductId?.[item.product_id] || []).map((variant: any) => (
                          <option key={variant.id} value={variant.id}>
                            {variant.name} {variant.sku ? `(${variant.sku})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Qté</label>
                      <input
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(e) => onChangeItemField(index, 'quantity', Number(e.target.value || 1))}
                        className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Prix vente unitaire</label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={item.unit_selling_price}
                        onChange={(e) => onChangeItemField(index, 'unit_selling_price', Number(e.target.value || 0))}
                        className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground"
                      />
                    </div>
                    <div>
                      <button
                        type="button"
                        onClick={() => removeItemRow(index)}
                        className="text-sm text-red-600 hover:text-red-700"
                      >
                        Supprimer
                      </button>
                    </div>
                  </div>
                ))}

                <div>
                  <button
                    type="button"
                    onClick={addItemRow}
                    className="text-sm text-primary hover:text-primary/80"
                  >
                    + Ajouter produit
                  </button>
                </div>
              </div>

              <div className="border border-border rounded-lg p-4 bg-secondary/50 space-y-3">
                <h4 className="text-sm font-semibold text-foreground">Résumé financier</h4>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Type remise</label>
                    <select
                      value={discountType}
                      onChange={(e) => {
                        const nextType = e.target.value as 'fixed' | 'amount' | 'percentage'
                        setDiscountType(nextType)
                        if (nextType === 'fixed') setDiscountValue('0')
                      }}
                      className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground"
                    >
                      <option value="fixed">Aucune remise</option>
                      <option value="amount">Montant (MAD)</option>
                      <option value="percentage">Pourcentage (%)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Valeur remise</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={discountValue}
                      onChange={(e) => setDiscountValue(e.target.value)}
                      disabled={discountType === 'fixed'}
                      className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground disabled:opacity-50"
                    />
                  </div>
                  <div></div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Sous-total produits</span>
                    <span className="font-medium text-foreground">{formatCurrency(subtotal)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Remise appliquée</span>
                    <span className="font-medium text-foreground">-{formatCurrency(discountAmount)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Coût livraison (store)</span>
                    <span className="font-medium text-foreground">{formatCurrency(Number.isFinite(parsedDeliveryFee) ? parsedDeliveryFee : 0)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Livraison facturée client</span>
                    <span className="font-medium text-foreground">
                      {formatCurrency(
                        deliveryBillingMode === 'paid_by_customer' && Number.isFinite(parsedDeliveryChargeToCustomer)
                          ? parsedDeliveryChargeToCustomer
                          : 0
                      )}
                    </span>
                  </div>
                </div>

                <div className="pt-2 border-t border-border flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">Total final</span>
                  <span className="text-lg font-bold text-foreground">{formatCurrency(totalSellingPrice)}</span>
                </div>
              </div>

              {formError ? <div className="text-sm text-red-600">{formError}</div> : null}
            </div>

            <div className="p-6 border-t border-border flex items-center justify-end gap-3 shrink-0">
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="px-4 py-2 rounded-lg border border-border text-foreground hover:bg-secondary"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => createOrderMutation.mutate()}
                disabled={createOrderMutation.isPending}
                className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground disabled:opacity-50"
              >
                {createOrderMutation.isPending ? 'Création...' : 'Créer la commande'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isImportOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-card rounded-2xl shadow-2xl border border-border w-full max-w-5xl max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-border flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-lg font-semibold text-foreground">Importer des ventes (CSV)</h3>
                <p className="text-sm text-muted-foreground">
                  Étape {importStep} / 3 {importFileName ? `• ${importFileName}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={closeImportModal}
                className="text-muted-foreground hover:text-foreground"
              >
                Fermer
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5">
              {importStep === 1 ? (
                <div className="space-y-4">
                  {!currentStoreId ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-700 px-3 py-2 text-sm">
                      Sélectionnez un store en haut avant l'import.
                    </div>
                  ) : null}

                  <div className="rounded-lg border border-dashed p-6 text-center space-y-3">
                    <p className="text-sm text-muted-foreground">Import CSV uniquement</p>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={!currentStoreId}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground disabled:opacity-50"
                    >
                      <Upload className="w-4 h-4" />
                      Choisir un fichier CSV
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,text/csv"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (!file) return
                        void handleCsvUpload(file)
                        e.currentTarget.value = ''
                      }}
                    />
                  </div>
                </div>
              ) : null}

              {importStep === 2 ? (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm text-foreground mb-1">Format de date</label>
                      <select
                        value={importDateFormat}
                        onChange={(e) => setImportDateFormat(e.target.value as CsvDateFormat)}
                        className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground"
                      >
                        {csvDateFormatOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-muted-foreground mt-1">
                        Suggestion auto: {csvDateFormatOptions.find((o) => o.value === suggestedDateFormat)?.label}
                      </p>
                    </div>
                    <div className="text-sm text-foreground flex items-end">
                      Lignes détectées: <span className="font-semibold ml-1">{importRows.length}</span>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border">
                    <div className="grid grid-cols-12 gap-3 px-4 py-2 border-b border-border text-xs font-medium text-muted-foreground bg-secondary/50">
                      <div className="col-span-5">Nos champs</div>
                      <div className="col-span-7">Colonne du fichier</div>
                    </div>
                    <div className="max-h-72 overflow-y-auto">
                      {importFieldDefinitions.map((field) => (
                        <div key={field.key} className="grid grid-cols-12 gap-3 px-4 py-2 border-b border-border last:border-b-0 items-center">
                          <div className="col-span-5 text-sm text-foreground">
                            {field.label}
                            {field.required ? <span className="text-red-600 ml-1">*</span> : null}
                          </div>
                          <div className="col-span-7">
                            <select
                              value={fieldToColumnMap[field.key]}
                              onChange={(e) =>
                                setFieldToColumnMap((prev) => ({
                                  ...prev,
                                  [field.key]: e.target.value,
                                }))
                              }
                              className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground"
                            >
                              <option value="">-- Non mappé --</option>
                              {importColumns.map((column, columnIndex) => (
                                <option key={`${field.key}-${column || 'empty'}-${columnIndex}`} value={column}>
                                  {column}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {fieldToColumnMap.status ? (
                    <div className="rounded-lg border border-border p-4 space-y-3">
                      <h4 className="text-sm font-semibold text-foreground">Correspondance des statuts</h4>
                      <div className="max-h-64 overflow-y-auto space-y-2">
                        {statusRawValues.map((rawStatus) => (
                          <div key={rawStatus} className="grid grid-cols-12 gap-3 items-center">
                            <div className="col-span-5 text-sm text-foreground truncate" title={rawStatus}>
                              {rawStatus}
                            </div>
                            <div className="col-span-7">
                              <select
                                value={statusValueMap[rawStatus] || ''}
                                onChange={(e) =>
                                  setStatusValueMap((prev) => ({
                                    ...prev,
                                    [rawStatus]: e.target.value,
                                  }))
                                }
                                className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground"
                              >
                                <option value="">-- Choisir un statut --</option>
                                {statusOptions.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {fieldToColumnMap.product_name ? (
                    <div className="rounded-lg border border-border p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-sm font-semibold text-foreground">Correspondance des produits</h4>
                          <p className="text-xs text-muted-foreground">Lier les lignes CSV aux produits existants</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setLinkImportedProducts((prev) => !prev)}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                            linkImportedProducts ? 'bg-primary' : 'bg-muted'
                          }`}
                          aria-label="Activer la liaison produits"
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-background transition-transform ${
                              linkImportedProducts ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      </div>

                      {linkImportedProducts ? (
                        <div className="max-h-64 overflow-y-auto space-y-2">
                          {productRawValues.map((rawProduct) => (
                            <div key={rawProduct} className="grid grid-cols-12 gap-3 items-center">
                              <div className="col-span-5 text-sm text-foreground truncate" title={rawProduct}>
                                {rawProduct}
                              </div>
                              <div className="col-span-7">
                                <select
                                  value={productValueMap[rawProduct] || ''}
                                  onChange={(e) =>
                                    setProductValueMap((prev) => ({
                                      ...prev,
                                      [rawProduct]: e.target.value,
                                    }))
                                  }
                                  className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground"
                                >
                                  <option value="">-- Choisir un produit --</option>
                                  {importStoreProducts.map((product: any) => (
                                    <option key={product.id} value={product.id}>
                                      {product.name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground">Liaison produits désactivée.</div>
                      )}
                    </div>
                  ) : null}

                  {fieldToColumnMap.confirmation_agent ? (
                    <div className="rounded-lg border border-border p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-sm font-semibold text-foreground">Correspondance des agents</h4>
                          <p className="text-xs text-muted-foreground">Lier les lignes CSV aux agents existants</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setLinkImportedAgents((prev) => !prev)}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                            linkImportedAgents ? 'bg-primary' : 'bg-muted'
                          }`}
                          aria-label="Activer la liaison agents"
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-background transition-transform ${
                              linkImportedAgents ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      </div>

                      {linkImportedAgents ? (
                        <div className="max-h-64 overflow-y-auto space-y-2">
                          {agentRawValues.map((rawAgent) => (
                            <div key={rawAgent} className="grid grid-cols-12 gap-3 items-center">
                              <div className="col-span-5 text-sm text-foreground truncate" title={rawAgent}>
                                {rawAgent}
                              </div>
                              <div className="col-span-7">
                                <select
                                  value={agentValueMap[rawAgent] || ''}
                                  onChange={(e) =>
                                    setAgentValueMap((prev) => ({
                                      ...prev,
                                      [rawAgent]: e.target.value,
                                    }))
                                  }
                                  className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground"
                                >
                                  <option value="">-- Choisir un agent --</option>
                                  <option value={IMPORT_SELF_CONFIRMATION}>J'ai confirmé moi-même</option>
                                  {importConfirmationAgents.map((agent: any) => (
                                    <option key={agent.id} value={agent.id}>
                                      {agent.name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground">Liaison agents désactivée.</div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-border p-4 space-y-2">
                      <div className="text-sm font-semibold text-foreground">Agent de confirmation par défaut</div>
                      <p className="text-xs text-muted-foreground">Pas de colonne "agent" dans le CSV ? choisissez une valeur par défaut ou ajoutez une colonne dans votre sheet.</p>
                      <select
                        value={defaultConfirmationAgentSelection}
                        onChange={(e) => setDefaultConfirmationAgentSelection(e.target.value)}
                        className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground"
                      >
                        <option value={IMPORT_SELF_CONFIRMATION}>J'ai confirmé moi-même</option>
                        {importConfirmationAgents.map((agent: any) => (
                          <option key={agent.id} value={agent.id}>{agent.name}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {fieldToColumnMap.delivery_company ? (
                    <div className="rounded-lg border border-border p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-sm font-semibold text-foreground">Correspondance des sociétés de livraison</h4>
                          <p className="text-xs text-muted-foreground">Lier les lignes CSV aux sociétés existantes</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setLinkImportedDeliveryCompanies((prev) => !prev)}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                            linkImportedDeliveryCompanies ? 'bg-primary' : 'bg-muted'
                          }`}
                          aria-label="Activer la liaison sociétés"
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-background transition-transform ${
                              linkImportedDeliveryCompanies ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      </div>

                      {linkImportedDeliveryCompanies ? (
                        <div className="max-h-64 overflow-y-auto space-y-2">
                          {deliveryCompanyRawValues.map((rawCompany) => (
                            <div key={rawCompany} className="grid grid-cols-12 gap-3 items-start">
                              <div className="col-span-5 text-sm text-foreground truncate pt-2" title={rawCompany}>{rawCompany}</div>
                              <div className="col-span-7 space-y-2">
                                <select
                                  value={deliveryCompanyValueMap[rawCompany] || ''}
                                  onChange={(e) =>
                                    setDeliveryCompanyValueMap((prev) => ({
                                      ...prev,
                                      [rawCompany]: e.target.value,
                                    }))
                                  }
                                  className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground"
                                >
                                  <option value="">-- Choisir une société --</option>
                                  {(deliveryCompanies || []).map((company: any) => (
                                    <option key={company.id} value={company.id}>
                                      {company.name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground">Liaison sociétés désactivée.</div>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {importStep === 3 ? (
                <div className="space-y-4">
                  <div className="rounded-lg border border-border p-4">
                    <h4 className="text-sm font-semibold text-foreground mb-2">Récapitulatif</h4>
                    <p className="text-sm text-muted-foreground">
                      {importRows.length} lignes à importer • {Object.keys(fieldToColumnMap).filter((k) => fieldToColumnMap[k as ImportFieldKey]).length} champs mappés
                    </p>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="p-6 border-t border-border flex items-center justify-between shrink-0">
              <button
                type="button"
                onClick={closeImportModal}
                className="px-4 py-2 rounded-lg border border-border text-foreground hover:bg-secondary"
              >
                Annuler
              </button>
              <div className="flex items-center gap-3">
                {importStep > 1 ? (
                  <button
                    type="button"
                    onClick={() => setImportStep((s) => (s - 1) as 1 | 2 | 3)}
                    className="px-4 py-2 rounded-lg border border-border text-foreground hover:bg-secondary"
                  >
                    Retour
                  </button>
                ) : null}
                {importStep < 3 ? (
                  <button
                    type="button"
                    onClick={() => setImportStep((s) => (s + 1) as 1 | 2 | 3)}
                    className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground"
                  >
                    Suivant
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => importOrdersMutation.mutate()}
                    disabled={importOrdersMutation.isPending}
                    className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground disabled:opacity-50"
                  >
                    {importOrdersMutation.isPending ? 'Import...' : 'Lancer import'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedOrderForDetails ? (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedOrderForDetails(null)}
        >
          <div
            className="bg-card rounded-2xl shadow-2xl border border-border w-full max-w-2xl max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-border flex items-center justify-between shrink-0">
              <h3 className="text-lg font-semibold text-foreground">Détails commande</h3>
              <button
                type="button"
                onClick={() => setSelectedOrderForDetails(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                Fermer
              </button>
            </div>

            <div className="p-5 space-y-5 overflow-y-auto">
              <div className="border border-border rounded-lg p-4 space-y-2">
                <div className="text-sm text-muted-foreground">Client</div>
                <div className="font-semibold text-foreground">{selectedOrderForDetails.customer_name || '-'}</div>
                <div className="mt-1">
                  {selectedOrderIsBlacklisted ? (
                    <span className="inline-flex items-center rounded-full bg-red-100 text-red-700 text-[11px] px-2 py-0.5 font-medium">
                      Numéro blacklisté
                    </span>
                  ) : null}
                </div>
                <div className="text-sm text-foreground">Téléphone: {selectedOrderForDetails.phone || '-'}</div>
                <div className="text-sm text-foreground">Adresse: {selectedOrderForDetails.address || '-'}</div>
                <div className="text-sm text-foreground">Ville: {selectedOrderForDetails.city || '-'}</div>
                <div className="pt-2 flex items-center gap-2">
                  <a
                    href={selectedOrderForDetails.phone ? `tel:${selectedOrderForDetails.phone}` : '#'}
                    className={`px-3 py-1.5 rounded-md text-sm border border-border ${selectedOrderForDetails.phone ? 'text-foreground hover:bg-secondary' : 'text-muted-foreground pointer-events-none opacity-50'}`}
                  >
                    Appeler
                  </a>
                  <a
                    href={whatsappPhone ? `https://wa.me/${whatsappPhone}` : '#'}
                    target="_blank"
                    rel="noreferrer"
                    className={`px-3 py-1.5 rounded-md text-sm ${whatsappPhone ? 'bg-primary hover:bg-primary/90 text-primary-foreground' : 'bg-muted text-muted-foreground pointer-events-none opacity-50'}`}
                  >
                    WhatsApp
                  </a>
                </div>
              </div>

              <div className="border border-border rounded-lg p-4 space-y-2">
                <div className="text-sm text-muted-foreground">Informations commande</div>
                <div className="text-sm text-foreground">ID: #{String(selectedOrderForDetails.id || '').slice(0, 8)}</div>
                <div className="text-sm text-foreground">Date commande: {formatDateTime(selectedOrderForDetails.order_date)}</div>
                <div className="text-sm text-foreground">
                  Source: {selectedOrderForDetails.source === 'ads' ? 'ADS' : selectedOrderForDetails.source === 'recommendation' ? 'Recommendation' : 'Organique'}
                </div>
                <div className="text-sm text-foreground">
                  Produits: {(selectedOrderForDetails.order_items || [])
                    .map((item: any) => {
                      const productName = item?.products?.name
                      const variantName = item?.product_variant_id ? orderVariantsById?.[item.product_variant_id]?.name : null
                      if (!productName) return null
                      return variantName ? `${productName} (${variantName})` : productName
                    })
                    .filter(Boolean)
                    .join(', ') || '-'}
                </div>
                <div className="text-sm text-foreground">Total: {formatCurrency(selectedOrderForDetails.total_selling_price || 0)}</div>
                <div className="text-sm text-foreground">Tracking: {selectedOrderForDetails.tracking_number || '-'}</div>
                <div className="pt-3 flex flex-wrap gap-2">
                  {rapidDeliveryIntegration?.status === 'connected' && selectedOrderForDetails.tracking_number ? (
                    <button
                      type="button"
                      onClick={() =>
                        trackRapidDeliveryMutation.mutate({
                          orderId: selectedOrderForDetails.id,
                          trackingNumber: selectedOrderForDetails.tracking_number,
                        })
                      }
                      className="px-3 py-1.5 rounded-md border border-border text-sm text-foreground hover:bg-secondary"
                    >
                      Synchroniser suivi
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="border border-border rounded-lg p-4">
                <div className="text-sm text-muted-foreground mb-3">Historique statuts</div>
                <div className="space-y-2">
                  {statusOptions.map((option) => {
                    const dateField = statusDateFieldMap[option.value]
                    const dateValue = dateField ? selectedOrderForDetails?.[dateField] : null
                    const isCurrent = selectedOrderForDetails.status === option.value
                    if (!dateValue && !isCurrent) return null

                    return (
                      <div key={option.value} className="flex items-center justify-between text-sm border-b border-border pb-2 last:border-b-0 last:pb-0">
                        <span className={`font-medium ${isCurrent ? 'text-primary' : 'text-foreground'}`}>
                          {option.label}{isCurrent ? ' (actuel)' : ''}
                        </span>
                        <span className="text-muted-foreground">{dateValue ? formatDateTime(dateValue) : '-'}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Filters */}
      <div className="bg-card rounded-xl shadow p-4">
        <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4">
          <div className="flex flex-row items-center justify-center gap-3">
            <StoreSelector />

            <div className="relative">
            <button
              onClick={() => setFiltersOpen(!filtersOpen)}
              className={`flex items-center gap-2 px-3 py-2 border rounded-lg transition-colors ${
                filtersOpen || statusFilter !== 'all' || blacklistFilter !== 'all'
                  ? 'border-jisra-green bg-jisra-green/10 text-jisra-green'
                  : 'border-border bg-card text-foreground hover:border-jisra-green/50'
              }`}
            >
              <Filter className="w-4 h-4" />
              <span className="text-sm font-medium">Filtres</span>
              {(statusFilter !== 'all' || blacklistFilter !== 'all') && (
                <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-bold rounded-full bg-jisra-green text-white">
                  {(statusFilter !== 'all' ? 1 : 0) + (blacklistFilter !== 'all' ? 1 : 0)}
                </span>
              )}
            </button>

            {filtersOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setFiltersOpen(false)} />
                <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-50 w-64 sm:w-72 bg-card border border-border rounded-xl shadow-xl p-4 space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                      Statut
                    </label>
                    <select
                      className="w-full border border-border rounded-lg px-3 py-2 focus:ring-2 focus:ring-jisra-green focus:border-jisra-green bg-card text-foreground text-sm"
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                    >
                      <option value="all">Tous les statuts</option>
                      <option value="new">Nouvelle</option>
                      <option value="confirmation_rejected">Non confirmé</option>
                      <option value="follow_up_1">Rappel 1</option>
                      <option value="follow_up_2">Rappel 2</option>
                      <option value="follow_up_3">Rappel 3</option>
                      <option value="follow_up_4">Rappel 4</option>
                      <option value="follow_up_5">Rappel 5</option>
                      <option value="no_answer">Pas de réponse</option>
                      <option value="wrong_number">Mauvais numéro</option>
                      <option value="voicemail">Boîte vocale</option>
                      <option value="confirmed">Confirmée</option>
                      <option value="picked_up">Ramassée</option>
                      <option value="sent">Envoyée</option>
                      <option value="delivered">Livrée</option>
                      <option value="cancelled">Annulée</option>
                      <option value="refused">Refusée</option>
                      <option value="returned_not_stocked">Retour non stocké</option>
                      <option value="returned_stocked">Retour stocké</option>
                      <option value="dl_no_answer">Pas de réponse (livreur)</option>
                      <option value="dl_unreachable">Injoignable</option>
                      <option value="dl_out_of_zone">Hors zone</option>
                      <option value="dl_client_interested">Client intéressé</option>
                      <option value="dl_postponed">Reportée</option>
                      <option value="dl_address_change">Changement d'adresse</option>
                      <option value="dl_pickup_pending">En attente ramassage</option>
                      <option value="dl_refund">Remboursement</option>
                      <option value="dl_follow_up_request">Demande de suivie</option>
                      <option value="dl_billing_error">Facturé par erreur</option>
                      <option value="dl_out_for_delivery">Sortie pour livraison</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                      Blacklist
                    </label>
                    <select
                      className="w-full border border-border rounded-lg px-3 py-2 focus:ring-2 focus:ring-jisra-green focus:border-jisra-green bg-card text-foreground text-sm"
                      value={blacklistFilter}
                      onChange={(e) => setBlacklistFilter(e.target.value as 'all' | 'blacklisted' | 'not_blacklisted')}
                    >
                      <option value="all">Tous (blacklist)</option>
                      <option value="blacklisted">Blacklisté</option>
                      <option value="not_blacklisted">Non blacklisté</option>
                    </select>
                  </div>
                </div>
              </>
            )}
          </div>
          </div>

          <div className="flex items-center gap-2 flex-1 min-w-[220px]">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Rechercher par client, téléphone ou numéro de suivi..."
                className="w-full pl-10 pr-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary bg-card text-foreground"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <button
              type="button"
              onClick={() => syncAllRapidDeliveryMutation.mutate()}
              disabled={syncAllRapidDeliveryMutation.isPending || rapidDeliveryIntegration?.status !== 'connected'}
              className="inline-flex items-center justify-center border border-border hover:bg-secondary text-foreground text-sm font-medium p-2 rounded-lg transition-colors whitespace-nowrap disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${syncAllRapidDeliveryMutation.isPending ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline ml-1">Resynchroniser</span>
            </button>
            <button
              type="button"
              onClick={openImportModal}
              className="inline-flex items-center justify-center border border-border hover:bg-secondary text-foreground text-sm font-medium p-2 rounded-lg transition-colors whitespace-nowrap"
            >
              <Upload className="w-4 h-4" />
              <span className="hidden sm:inline ml-1">Importer</span>
            </button>
          </div>

          <button
            onClick={openCreateModal}
            className="inline-flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium px-4 py-2 rounded-lg transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Ajouter une commande
          </button>
        </div>
      </div>

      {/* Orders Table */}
      <div className="bg-card rounded-xl shadow overflow-hidden">
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="p-8 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
              <p className="text-muted-foreground mt-2">Chargement des commandes...</p>
            </div>
          ) : orders && filteredOrders.length > 0 ? (
              <table className="min-w-full divide-y divide-border text-xs sm:text-sm">
              <thead className="bg-secondary">
                <tr>
                  <th rowSpan={2} className="px-1.5 sm:px-4 py-1.5 sm:py-3 text-center align-middle text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    <div className="flex items-center justify-center text-center">Commande</div>
                  </th>
                  <th rowSpan={2} className="px-1.5 sm:px-4 py-1.5 sm:py-3 text-center align-middle text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    <div className="flex items-center justify-center text-center">Date</div>
                  </th>
                  <th rowSpan={2} className="px-1.5 sm:px-4 py-1.5 sm:py-3 text-center align-middle text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    <div className="flex items-center justify-center text-center">Client</div>
                  </th>
                  <th rowSpan={2} className="px-1.5 sm:px-4 py-1.5 sm:py-3 text-center align-middle text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    <div className="flex items-center justify-center text-center">Statut</div>
                  </th>
                  <th rowSpan={2} className="px-1.5 sm:px-4 py-1.5 sm:py-3 text-center align-middle text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    <div className="flex items-center justify-center text-center">Produit</div>
                  </th>
                  <th rowSpan={2} className="px-1.5 sm:px-4 py-1.5 sm:py-3 text-center align-middle text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    <div className="flex items-center justify-center text-center">Ville</div>
                  </th>
                  <th rowSpan={2} className="px-1.5 sm:px-4 py-1.5 sm:py-3 text-center align-middle text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    <div className="flex items-center justify-center text-center">Adresse</div>
                  </th>
                  <th rowSpan={2} className="px-1.5 sm:px-4 py-1.5 sm:py-3 text-center align-middle text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    <div className="flex items-center justify-center text-center">Vente</div>
                  </th>
                  {!isConfirmationRole && (
                    <th rowSpan={2} className="px-1.5 sm:px-4 py-1.5 sm:py-3 text-center align-middle text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Achat
                    </th>
                  )}
                  {!isConfirmationRole && (
                    <th rowSpan={2} className="px-1.5 sm:px-4 py-1.5 sm:py-3 text-center align-middle text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Ads
                    </th>
                  )}
                  {!isConfirmationRole && (
                    <th rowSpan={2} className="px-1.5 sm:px-4 py-1.5 sm:py-3 text-center align-middle text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Confirmation
                    </th>
                  )}
                  {!isConfirmationRole && (
                    <th colSpan={2} className="px-1.5 sm:px-4 py-1.5 sm:py-3 text-center align-middle text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      <div className="group relative inline-flex items-center gap-1">
                        <span>Livraison</span>
                        <span className="inline-flex cursor-help rounded-full">
                          <Info className="w-3.5 h-3.5" />
                        </span>
                        <div className="pointer-events-none absolute left-0 top-full z-20 mt-2 hidden w-72 rounded-lg border border-border bg-popover p-2 text-[11px] normal-case tracking-normal text-popover-foreground shadow-lg group-hover:block space-y-1">
                          <div>Coût = frais de livraison supportés par le store.</div>
                          <div>Facturé = montant facturé au client.</div>
                          <div>Profit = Prix de vente - Prix d'achat - Ads - Coût confirmation - Coût livraison + Livraison facturée.</div>
                        </div>
                      </div>
                    </th>
                  )}
                  {!isConfirmationRole && (
                    <th rowSpan={2} className="px-1.5 sm:px-4 py-1.5 sm:py-3 text-center align-middle text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Profit
                    </th>
                  )}
                  <th rowSpan={2} className="px-1.5 sm:px-4 py-1.5 sm:py-3 text-center align-middle text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
                {!isConfirmationRole && (
                  <tr>
                    <th className="px-1.5 sm:px-4 pb-1.5 sm:pb-3 text-center align-middle text-[11px] font-medium text-muted-foreground tracking-wider">Coût</th>
                    <th className="px-1.5 sm:px-4 pb-1.5 sm:pb-3 text-center align-middle text-[11px] font-medium text-muted-foreground tracking-wider">Facturé</th>
                  </tr>
                )}
              </thead>
              <tbody className="bg-card divide-y divide-border">
                {filteredOrders.map((order: any) => {
                  const status = statusConfig[order.status as keyof typeof statusConfig]
                  const StatusIcon = status?.icon || Clock
                  const allowedStatusOptions = getAllowedStatusOptionsForOrder(order)
                  const isDeliveryLocked = order.delivery_status_source === 'delivery_company' && order.status !== 'returned_not_stocked'
                  const isReturnedOverrideOnly = order.delivery_status_source === 'delivery_company' && order.status === 'returned_not_stocked'
                  const normalizedOrderPhone = normalizePhoneForBlacklist(order.phone)
                  const isBlacklisted = normalizedOrderPhone ? blacklistPhonesSet.has(normalizedOrderPhone) : false
                  const productNames = (order.order_items || [])
                    .map((item: any) => {
                      const productName = item?.products?.name
                      const variantName = item?.product_variant_id ? orderVariantsById?.[item.product_variant_id]?.name : null
                      if (!productName) return null
                      return variantName ? `${productName} (${variantName})` : productName
                    })
                    .filter(Boolean)
                  return (
                    <tr key={order.id} className="hover:bg-secondary/50">
                      <td className="px-1.5 sm:px-4 py-1.5 sm:py-3 whitespace-nowrap">
                        <div className="text-xs sm:text-sm font-medium text-foreground">#{order.id.slice(0, 8)}</div>
                        {order.tracking_number && (
                          <div className="text-xs sm:text-sm text-muted-foreground">Suivi: {order.tracking_number}</div>
                        )}
                      </td>
                      <td className="px-1.5 sm:px-4 py-1.5 sm:py-3 whitespace-nowrap text-xs sm:text-sm text-muted-foreground">
                        {formatDateTime(order.order_date)}
                      </td>
                      <td className="px-1.5 sm:px-4 py-1.5 sm:py-3 whitespace-nowrap">
                        <div className="text-xs sm:text-sm font-medium text-foreground">
                          <InlineEditText
                            value={order.customer_name || ''}
                            onSave={(val) => updateOrderFieldMutation.mutate({ orderId: order.id, field: 'customer_name', value: val })}
                            placeholder="Nom client"
                          />
                        </div>
                        <div className="text-xs sm:text-sm text-muted-foreground">
                          <InlineEditText
                            value={order.phone || ''}
                            onSave={(val) => updateOrderFieldMutation.mutate({ orderId: order.id, field: 'phone', value: val })}
                            placeholder="Téléphone"
                          />
                        </div>
                        {isBlacklisted ? (
                          <div className="mt-1 inline-flex items-center rounded-full bg-red-100 text-red-700 text-[11px] px-2 py-0.5 font-medium">
                            Blacklist
                          </div>
                        ) : null}
                      </td>
                      <td className="px-1.5 sm:px-4 py-1.5 sm:py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <StatusIcon className="w-3.5 h-3.5 text-muted-foreground" />
                          {isDeliveryLocked ? (
                            <span className={`text-xs font-medium rounded-full px-2.5 py-1 border ${status?.color || 'bg-secondary text-foreground'}`}>
                              {status?.label || order.status}
                            </span>
                          ) : (
                            <select
                              value={order.status}
                              onChange={(e) => {
                                const nextStatus = e.target.value
                                if (nextStatus === order.status) return

                                setUpdatingOrderId(order.id)
                                updateOrderStatusMutation.mutate(
                                  { orderId: order.id, status: nextStatus },
                                  {
                                    onSettled: () => setUpdatingOrderId(null),
                                  }
                                )
                              }}
                              disabled={(updateOrderStatusMutation.isPending && updatingOrderId === order.id) || (isReturnedOverrideOnly && allowedStatusOptions.length === 0)}
                              className={`text-xs font-medium rounded-full px-2.5 py-1 border ${status?.color || 'bg-secondary text-foreground'} ${
                                updateOrderStatusMutation.isPending && updatingOrderId === order.id
                                  ? 'opacity-60 cursor-not-allowed'
                                  : ''
                              }`}
                            >
                              {isReturnedOverrideOnly ? (
                                <>
                                  <option value={order.status}>{status?.label || order.status}</option>
                                  {allowedStatusOptions.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </>
                              ) : (
                                allowedStatusOptions.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))
                              )}
                            </select>
                          )}
                        </div>
                      </td>
                      <td className="px-1.5 sm:px-4 py-1.5 sm:py-3">
                        <InlineEditProducts
                          items={order.order_items || []}
                          products={(products && products.length > 0) ? products : (editProducts || [])}
                          variantsByProductId={(variantsByProductId && Object.keys(variantsByProductId).length > 0) ? variantsByProductId : (editVariantsByProductId || {})}
                          onSave={(items) => updateOrderItemsMutation.mutate({ orderId: order.id, storeId: order.store_id, items })}
                          onClose={() => {}}
                        />
                      </td>
                      <td className="px-1.5 sm:px-4 py-1.5 sm:py-3 whitespace-nowrap text-xs sm:text-sm text-foreground">
                        <InlineEditCity
                          value={order.city || ''}
                          cities={rapidDeliveryCities || []}
                          onSave={(cityName, cityKey) => {
                            updateOrderCityMutation.mutate({ orderId: order.id, cityName, cityKey })
                          }}
                        />
                      </td>
                      <td className="px-1.5 sm:px-4 py-1.5 sm:py-3 text-xs sm:text-sm text-foreground">
                        <InlineEditAddressModal
                          value={order.address || ''}
                          onSave={(val) => updateOrderFieldMutation.mutate({ orderId: order.id, field: 'address', value: val })}
                        />
                      </td>
                      <td className="px-1.5 sm:px-4 py-1.5 sm:py-3 whitespace-nowrap text-xs sm:text-sm font-medium text-foreground">
                        <InlineEditProducts
                          items={order.order_items || []}
                          products={(products && products.length > 0) ? products : (editProducts || [])}
                          variantsByProductId={(variantsByProductId && Object.keys(variantsByProductId).length > 0) ? variantsByProductId : (editVariantsByProductId || {})}
                          onSave={(items) => updateOrderItemsMutation.mutate({ orderId: order.id, storeId: order.store_id, items })}
                          onClose={() => {}}
                          triggerLabel={formatCurrency(order.total_selling_price || 0)}
                        />
                      </td>
                      {!isConfirmationRole && (
                        <td className="px-1.5 sm:px-4 py-1.5 sm:py-3 whitespace-nowrap text-xs sm:text-sm text-foreground">
                          <InlineEditText
                            value={formatCurrency(order.buy_price || 0)}
                            onSave={(val) => updateOrderFieldMutation.mutate({ orderId: order.id, field: 'buy_price', value: val })}
                            placeholder="Achat"
                            type="number"
                          />
                        </td>
                      )}
                      {!isConfirmationRole && (
                        <td className="px-1.5 sm:px-4 py-1.5 sm:py-3 whitespace-nowrap text-xs sm:text-sm text-foreground">
                          <InlineEditText
                            value={formatCurrency(order.ads_cost_allocated || 0)}
                            onSave={(val) => updateOrderFieldMutation.mutate({ orderId: order.id, field: 'ads_cost_allocated', value: val })}
                            placeholder="Ads"
                            type="number"
                          />
                        </td>
                      )}
                      {!isConfirmationRole && (
                        <td className="px-1.5 sm:px-4 py-1.5 sm:py-3 whitespace-nowrap text-xs sm:text-sm text-foreground">
                          <InlineEditText
                            value={formatCurrency(order.confirmation_cost_allocated || 0)}
                            onSave={(val) => updateOrderFieldMutation.mutate({ orderId: order.id, field: 'confirmation_cost_allocated', value: val })}
                            placeholder="Confirmation"
                            type="number"
                          />
                        </td>
                      )}
                      {!isConfirmationRole && (
                        <td className="px-1.5 sm:px-4 py-1.5 sm:py-3 whitespace-nowrap text-xs sm:text-sm text-foreground">
                          <InlineEditText
                            value={formatCurrency(order.delivery_fee || 0)}
                            onSave={(val) => updateOrderFieldMutation.mutate({ orderId: order.id, field: 'delivery_fee', value: val })}
                            placeholder="Coût livraison"
                            type="number"
                          />
                        </td>
                      )}
                      {!isConfirmationRole && (
                        <td className="px-1.5 sm:px-4 py-1.5 sm:py-3 whitespace-nowrap text-xs sm:text-sm text-foreground">
                          <InlineEditText
                            value={formatCurrency(order.delivery_charge_to_customer || 0)}
                            onSave={(val) => updateOrderFieldMutation.mutate({ orderId: order.id, field: 'delivery_charge_to_customer', value: val })}
                            placeholder="Facturé"
                            type="number"
                          />

                        </td>
                      )}
                      {!isConfirmationRole && (
                        <td className="px-1.5 sm:px-4 py-1.5 sm:py-3 whitespace-nowrap text-xs sm:text-sm font-medium text-foreground">
                          {formatCurrency(order.profit || 0)}
                        </td>
                      )}
                      <td className="px-1.5 sm:px-4 py-1.5 sm:py-3 whitespace-nowrap text-xs sm:text-sm font-medium">
                        <button
                          onClick={() => setSelectedOrderForDetails(order)}
                          className="text-primary hover:text-primary/80 mr-3"
                        >
                          Détails
                        </button>
                        <button className="text-muted-foreground hover:text-foreground">
                          <MoreVertical className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : (
            <div className="p-8 text-center">
              <div className="text-muted-foreground mb-4">Aucune commande trouvée</div>
              <p className="text-muted-foreground">
                {search || statusFilter !== 'all' || blacklistFilter !== 'all' ? 'Essayez de modifier vos filtres' : 'Créez votre première commande'}
              </p>
            </div>
          )}
        </div>

        {orders && orders.count > 0 ? (
          <div className="border-t border-border px-3 sm:px-6 py-3 sm:py-4 flex flex-col sm:flex-row items-center justify-between gap-2">
            <div className="text-xs sm:text-sm text-muted-foreground order-2 sm:order-1">
              Page {currentPage} / {totalPages} • {orders.count} commandes
            </div>
            <div className="flex items-center gap-2 order-1 sm:order-2">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-2.5 sm:px-3 py-1.5 rounded-md border border-border text-xs sm:text-sm text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
              >
                ← Préc.
              </button>
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="px-2.5 sm:px-3 py-1.5 rounded-md border border-border text-xs sm:text-sm text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Suiv. →
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {isRapidDeliveryModalOpen && rapidDeliveryOrder ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setIsRapidDeliveryModalOpen(false)} />
          <div className="relative z-10 w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-foreground">Créer colis Rapid Delivery</h3>
                <p className="text-sm text-muted-foreground">Commande #{String(rapidDeliveryOrder.id || '').slice(0, 8)}</p>
              </div>
              <button type="button" onClick={() => setIsRapidDeliveryModalOpen(false)} className="text-sm text-muted-foreground">
                Fermer
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Ville Rapid Delivery</label>
                <select
                  value={rapidDeliveryCityKey}
                  onChange={(e) => setRapidDeliveryCityKey(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                >
                  <option value="">Choisir une ville</option>
                  {rapidDeliveryCities.map((city: any) => (
                    <option key={city.city_key} value={city.city_key}>
                      {city.city_name} — {formatCurrency(city.cost_delivery || 0)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Shop de dépôt</label>
                <select
                  value={rapidDeliveryShopKey}
                  onChange={(e) => setRapidDeliveryShopKey(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                >
                  <option value="">Choisir un shop</option>
                  {rapidDeliveryShops.map((shop: any) => (
                    <option key={shop.shop_key} value={shop.shop_key}>
                      {shop.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Remarque</label>
                <textarea
                  value={rapidDeliveryRemark}
                  onChange={(e) => setRapidDeliveryRemark(e.target.value)}
                  rows={3}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                  placeholder="Instruction de livraison"
                />
              </div>

              <button
                type="button"
                onClick={() => createRapidDeliveryParcelMutation.mutate()}
                disabled={createRapidDeliveryParcelMutation.isPending}
                className="w-full rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {createRapidDeliveryParcelMutation.isPending ? 'Création...' : 'Créer le colis'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
