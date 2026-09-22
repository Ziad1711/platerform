'use client'

import { useStore } from '@/lib/store-context'
import { createClient } from '@/lib/supabase/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatCurrency } from '@/lib/utils'
import { detectStockMultiplier, normalizeStockMultiplier } from '@/lib/integrations/variant-stock'
import { buildUniqueProductSlug } from '@/lib/products/slug'
import StoreSelector from '@/components/dashboard/store-selector'
import { JisraMark } from '@/components/logo'
import { Search, Filter, MoreVertical, Plus, ChevronRight, ChevronDown, Copy } from 'lucide-react'
import { Fragment, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  PublicationStatusBadge,
  PublicationStatusSelect,
  normalizePublicationStatus,
  type PublicationStatus,
} from '@/components/dashboard/products/publication-status'
import {
  ProductGalleryEditor,
  type GalleryItem,
} from '@/components/dashboard/products/product-gallery-editor'
import { CategorySelect, type ProductCategory } from '@/components/dashboard/products/category-select'
import {
  VariantEditor,
  type ProductVariantForm,
} from '@/components/dashboard/products/variant-editor'
import { saveProductCatalog } from '@/lib/products/save-product-catalog'
import { deleteManagedProductImages } from '@/lib/products/product-images'

type VariantAttributeForm = {
  id?: string
  name: string
  values: string
}

const EMPTY_ATTRIBUTE: VariantAttributeForm = {
  name: '',
  values: '',
}

const SUGGESTED_MAIN_VARIANTS = ['Couleur', 'Taille', 'Longueur', 'Poids']

const normalizeToken = (value: string) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()

const buildVariantSku = (baseSku: string, optionValues: Record<string, string>) => {
  const base = normalizeToken(baseSku || 'PRD') || 'PRD'
  const suffix = Object.values(optionValues)
    .map((value) => normalizeToken(value).slice(0, 4))
    .filter(Boolean)
    .join('-')

  return suffix ? `${base}-${suffix}` : base
}

const getCombinationKey = (optionValues: Record<string, string>) =>
  Object.entries(optionValues)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${value}`)
    .join('|')

const parseAttributes = (attributes: VariantAttributeForm[]) =>
  (attributes || [])
    .map((attribute) => {
      const name = String(attribute.name || '').trim()
      const values = String(attribute.values || '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
      const uniqueValues = Array.from(new Set(values))
      return { name, values: uniqueValues }
    })
    .filter((attribute) => attribute.name && attribute.values.length > 0)

const buildCombinations = (attributes: Array<{ name: string; values: string[] }>) => {
  if (!attributes.length) return [] as Record<string, string>[]

  let combinations: Record<string, string>[] = [{}]
  attributes.forEach((attribute) => {
    const next: Record<string, string>[] = []
    combinations.forEach((existing) => {
      attribute.values.forEach((value) => {
        next.push({ ...existing, [attribute.name]: value })
      })
    })
    combinations = next
  })

  return combinations
}

const buildVariantName = (optionValues: Record<string, string>) =>
  Object.entries(optionValues)
    .map(([key, value]) => `${key}: ${value}`)
    .join(' / ')

const generateVariantsFromAttributes = ({
  attributes,
  currentVariants,
  baseSku,
  defaultSellingPrice,
}: {
  attributes: VariantAttributeForm[]
  currentVariants: ProductVariantForm[]
  baseSku: string
  defaultSellingPrice: string
}) => {
  const parsedAttributes = parseAttributes(attributes)
  const combinations = buildCombinations(parsedAttributes)
  const existingByKey = new Map(
    (currentVariants || []).map((variant) => [getCombinationKey(variant.option_values || {}), variant])
  )

  return combinations.map((optionValues) => {
    const key = getCombinationKey(optionValues)
    const existing = existingByKey.get(key)
    const generatedName = buildVariantName(optionValues)
    return {
      id: existing?.id,
      name: generatedName,
      sku: String(existing?.sku || '').trim() || buildVariantSku(baseSku, optionValues),
      selling_price: String(existing?.selling_price || defaultSellingPrice || '0'),
      purchase_cost: String(existing?.purchase_cost || '0'),
      stock_multiplier: String(
        existing?.stock_multiplier ?? detectStockMultiplier({ name: generatedName })
      ),
      // Les informations commerciales et les photos de la variante existante sont conservées.
      old_price: existing?.old_price ?? '',
      is_default: Boolean(existing?.is_default),
      sort_order: existing?.sort_order,
      images: existing?.images || [],
      option_values: optionValues,
    } as ProductVariantForm
  })
}

const deriveAttributesFromVariants = (variants: any[]) => {
  const valuesByAttribute = new Map<string, Set<string>>()

  ;(variants || []).forEach((variant: any) => {
    const optionValues = variant?.option_values || {}
    Object.entries(optionValues).forEach(([name, value]) => {
      const attrName = String(name || '').trim()
      const attrValue = String(value || '').trim()
      if (!attrName || !attrValue) return
      if (!valuesByAttribute.has(attrName)) valuesByAttribute.set(attrName, new Set())
      valuesByAttribute.get(attrName)?.add(attrValue)
    })
  })

  return Array.from(valuesByAttribute.entries()).map(([name, values]) => ({
    name,
    values: Array.from(values).join(', '),
  }))
}

const splitAttributeValues = (values: string) =>
  String(values || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)

const appendAttributeValues = (currentValues: string, incomingValues: string[]) => {
  const existing = splitAttributeValues(currentValues)
  const merged = [...existing, ...incomingValues.map((v) => String(v || '').trim()).filter(Boolean)]
  return merged.join(', ')
}

export default function ProduitsPage() {
  const { currentStoreId, accessibleStoreIds, accessibleStores: stores } = useStore()
  const [search, setSearch] = useState('')
  const [stockFilter, setStockFilter] = useState<'all' | 'in_stock' | 'out_of_stock'>('all')
  const [publicationFilter, setPublicationFilter] = useState<'all' | PublicationStatus>('all')
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({})
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [selectedCreateStoreId, setSelectedCreateStoreId] = useState('')
  const [newName, setNewName] = useState('')
  const [newSku, setNewSku] = useState('')
  const [newSellingPrice, setNewSellingPrice] = useState('0')
  const [newPublicationStatus, setNewPublicationStatus] = useState<PublicationStatus>('active')
  const [newHasVariants, setNewHasVariants] = useState(false)
  const [newAttributes, setNewAttributes] = useState<VariantAttributeForm[]>([])
  const [newAttributeDrafts, setNewAttributeDrafts] = useState<Record<number, string>>({})
  const [newVariants, setNewVariants] = useState<ProductVariantForm[]>([])
  const [newSlug, setNewSlug] = useState('')
  const [newShortDescription, setNewShortDescription] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newOldPrice, setNewOldPrice] = useState('')
  const [newCategoryId, setNewCategoryId] = useState('')
  const [newGallery, setNewGallery] = useState<GalleryItem[]>([])
  const [createError, setCreateError] = useState('')
  const [openActionsProductId, setOpenActionsProductId] = useState<string | null>(null)
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([])
  const [expandedVariantsByProduct, setExpandedVariantsByProduct] = useState<Record<string, boolean>>({})
  const [actionsMenuPosition, setActionsMenuPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const [isVariantsOpen, setIsVariantsOpen] = useState(false)
  const [selectedProductForVariants, setSelectedProductForVariants] = useState<any | null>(null)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [selectedProductForEdit, setSelectedProductForEdit] = useState<any | null>(null)
  const [editName, setEditName] = useState('')
  const [editSku, setEditSku] = useState('')
  const [editStockTrackingMode, setEditStockTrackingMode] = useState<'shared' | 'variant'>('variant')
  const [editSellingPrice, setEditSellingPrice] = useState('0')
  const [editPublicationStatus, setEditPublicationStatus] = useState<PublicationStatus>('active')
  const [editSlug, setEditSlug] = useState('')
  const [editShortDescription, setEditShortDescription] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editOldPrice, setEditOldPrice] = useState('')
  const [editCategoryId, setEditCategoryId] = useState('')
  const [editGallery, setEditGallery] = useState<GalleryItem[]>([])
  const [editError, setEditError] = useState('')
  const [editingAttributes, setEditingAttributes] = useState<VariantAttributeForm[]>([])
  const [editingAttributeDrafts, setEditingAttributeDrafts] = useState<Record<number, string>>({})
  const [editingVariants, setEditingVariants] = useState<ProductVariantForm[]>([])
  const [variantsError, setVariantsError] = useState('')
  const supabase = createClient()
  const queryClient = useQueryClient()

  const getProductImageUrl = (imageUrl?: string | null) => {
    if (!imageUrl) return null

    const normalizedUrl = imageUrl.trim()
    if (!normalizedUrl) return null

    if (
      normalizedUrl.startsWith('http://') ||
      normalizedUrl.startsWith('https://') ||
      normalizedUrl.startsWith('data:')
    ) {
      return normalizedUrl
    }

    const cleanPath = normalizedUrl.replace(/^\/+/, '')
    const { data } = supabase.storage.from('products').getPublicUrl(cleanPath)

    return data.publicUrl
  }

  /** Adaptateur pour les composants d'édition d'images (signature `string` non nullable). */
  const resolveImageUrl = (raw: string) => getProductImageUrl(raw)

  const { data: products, isLoading } = useQuery({
    queryKey: ['products', currentStoreId, search],
    queryFn: async () => {
      if (!currentStoreId && accessibleStoreIds.length === 0) {
        return []
      }

      let query = supabase
        .from('products')
        .select('*')
        .order('created_at', { ascending: false })

      if (currentStoreId) {
        query = query.eq('store_id', currentStoreId)
      } else {
        query = query.in('store_id', accessibleStoreIds)
      }

      if (search) {
        query = query.or(`name.ilike.%${search}%,sku.ilike.%${search}%`)
      }

      const { data, error } = await query

      if (error) throw error
      return data || []
    },
  })

  const { data: variantsByProduct } = useQuery({
    queryKey: ['product-variants-by-product', currentStoreId],
    queryFn: async () => {
      if (!currentStoreId && accessibleStoreIds.length === 0) {
        return {}
      }

      let query = supabase
        .from('product_variants')
        .select(
          'id, product_id, name, sku, selling_price, purchase_cost, old_price, is_default, sort_order, stock_multiplier, option_values'
        )
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true })

      if (currentStoreId) {
        query = query.eq('store_id', currentStoreId)
      } else {
        query = query.in('store_id', accessibleStoreIds)
      }

      const { data, error } = await query
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

  const { data: imagesByProduct } = useQuery({
    queryKey: ['product-images-by-product', currentStoreId],
    queryFn: async () => {
      if (!currentStoreId && accessibleStoreIds.length === 0) {
        return { byProduct: {}, byVariant: {} } as Record<string, any>
      }

      let query = supabase
        .from('product_images')
        .select('id, product_id, product_variant_id, image_url, alt_text, sort_order, is_primary, created_at')
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true })

      if (currentStoreId) {
        query = query.eq('store_id', currentStoreId)
      } else {
        query = query.in('store_id', accessibleStoreIds)
      }

      const { data, error } = await query
      if (error) throw error

      const byProduct: Record<string, any[]> = {}
      const byVariant: Record<string, any[]> = {}

      ;(data || []).forEach((image: any) => {
        const productId = String(image.product_id || '')
        if (!productId) return
        if (!byProduct[productId]) byProduct[productId] = []
        byProduct[productId].push(image)

        const variantId = image.product_variant_id ? String(image.product_variant_id) : ''
        if (!variantId) return
        if (!byVariant[variantId]) byVariant[variantId] = []
        byVariant[variantId].push(image)
      })

      return { byProduct, byVariant }
    },
  })

  const { data: categories, refetch: refetchCategories } = useQuery({
    queryKey: ['product-categories', currentStoreId],
    queryFn: async () => {
      if (!currentStoreId && accessibleStoreIds.length === 0) {
        return [] as ProductCategory[]
      }

      let query = supabase
        .from('product_categories')
        .select('id, store_id, name, slug, sort_order')
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true })

      if (currentStoreId) {
        query = query.eq('store_id', currentStoreId)
      } else {
        query = query.in('store_id', accessibleStoreIds)
      }

      const { data, error } = await query
      if (error) throw error
      return (data || []) as ProductCategory[]
    },
  })

  const categoriesForStore = (storeId: string | null | undefined) =>
    (categories || []).filter((category: any) => !storeId || String(category.store_id) === String(storeId))

  const toGalleryItem = (row: any): GalleryItem => ({
    id: row?.id ? String(row.id) : null,
    url: String(row?.image_url || ''),
    alt_text: String(row?.alt_text || ''),
    is_primary: Boolean(row?.is_primary),
  })

  const productGalleryFromRows = (productId: string | null | undefined): GalleryItem[] =>
    ((imagesByProduct?.byProduct || {})[String(productId || '')] || [])
      .filter((row: any) => !row.product_variant_id)
      .map(toGalleryItem)

  const variantGalleryFromRows = (variantId: string | null | undefined): GalleryItem[] =>
    ((imagesByProduct?.byVariant || {})[String(variantId || '')] || [])
      .filter((row: any) => row.product_variant_id)
      .map(toGalleryItem)

  useEffect(() => {
    if (!isCreateOpen) return
    if ((stores || []).length === 1) {
      setSelectedCreateStoreId(stores?.[0]?.id || '')
    }
  }, [isCreateOpen, stores])

  const createProductMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCreateStoreId) throw new Error('Veuillez sélectionner un store avant d’ajouter un produit.')
      if (!newName.trim()) throw new Error('Le nom du produit est obligatoire.')

      const variantPayloads = (newHasVariants ? (newVariants || []) : [])
        .map((variant) => ({
          images: (variant.images || []) as GalleryItem[],
          sync: {
            id: variant.id,
            name: variant.name.trim() || buildVariantName(variant.option_values || {}),
            sku: variant.sku.trim(),
            selling_price: Number(variant.selling_price || 0),
            purchase_cost: Number(variant.purchase_cost || 0),
            old_price: Number(variant.old_price || 0) > 0 ? Number(variant.old_price) : null,
            is_default: Boolean(variant.is_default),
            sort_order: Number(variant.sort_order || 0),
            stock_multiplier: normalizeStockMultiplier(variant.stock_multiplier),
            option_values: variant.option_values || {},
          },
        }))
        .filter(
          (entry) =>
            entry.sync.name || entry.sync.sku || Object.keys(entry.sync.option_values || {}).length > 0
        )

      if (newHasVariants && variantPayloads.length === 0) {
        throw new Error('Ce produit a des variantes: ajoutez au moins une variante.')
      }

      for (const entry of variantPayloads) {
        if (!entry.sync.name) throw new Error('Chaque variante doit avoir un nom.')
        if (!entry.sync.sku) throw new Error('Chaque variante doit avoir un SKU.')
      }

      const slug = await buildUniqueProductSlug({
        supabase,
        storeId: selectedCreateStoreId,
        base: newSlug.trim() || newName.trim(),
      })

      await saveProductCatalog({
        supabase,
        storeId: selectedCreateStoreId,
        product: {
          name: newName.trim(),
          slug,
          sku: newSku.trim() || null,
          short_description: newShortDescription.trim() || null,
          description: newDescription.trim() || null,
          old_price: Number(newOldPrice || 0) > 0 ? Number(newOldPrice) : null,
          category_id: newCategoryId || null,
          sort_order: 0,
          default_selling_price: newHasVariants ? 0 : Number(newSellingPrice || 0),
          default_purchase_cost: 0,
          stock_tracking_mode: 'variant',
          publication_status: newPublicationStatus,
        },
        variants: variantPayloads.map((entry) => ({ ...entry.sync, images: entry.images })),
        images: newGallery,
      })
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['products'] }),
        queryClient.invalidateQueries({ queryKey: ['product-variants-by-product'] }),
        queryClient.invalidateQueries({ queryKey: ['product-images-by-product'] }),
        queryClient.invalidateQueries({ queryKey: ['product-categories'] }),
      ])
      setIsCreateOpen(false)
      setSelectedCreateStoreId(currentStoreId || '')
      setNewName('')
      setNewSku('')
      setNewSellingPrice('0')
      setNewPublicationStatus('active')
      setNewHasVariants(false)
      setNewAttributes([])
      setNewAttributeDrafts({})
      setNewVariants([])
      setNewSlug('')
      setNewShortDescription('')
      setNewDescription('')
      setNewOldPrice('')
      setNewCategoryId('')
      setNewGallery([])
      setCreateError('')
    },
    onError: (error: any) => {
      setCreateError(error?.message || 'Erreur lors de la création du produit.')
    },
  })

  const saveVariantsMutation = useMutation({
    mutationFn: async () => {
      if (!selectedProductForVariants?.id) throw new Error('Produit invalide.')

      const variantPayloads = (editingVariants || [])
        .map((variant) => ({
          images: (variant.images || []) as GalleryItem[],
          sync: {
            id: variant.id,
            name: variant.name.trim() || buildVariantName(variant.option_values || {}),
            sku: variant.sku.trim(),
            selling_price: Number(variant.selling_price || 0),
            purchase_cost: Number(variant.purchase_cost || 0),
            old_price: Number(variant.old_price || 0) > 0 ? Number(variant.old_price) : null,
            is_default: Boolean(variant.is_default),
            sort_order: Number(variant.sort_order || 0),
            stock_multiplier: normalizeStockMultiplier(variant.stock_multiplier),
            option_values: variant.option_values || {},
          },
        }))
        .filter(
          (entry) =>
            entry.sync.name || entry.sync.sku || Object.keys(entry.sync.option_values || {}).length > 0
        )

      for (const entry of variantPayloads) {
        if (!entry.sync.name) throw new Error('Chaque variante doit avoir un nom.')
        if (!entry.sync.sku) throw new Error('Chaque variante doit avoir un SKU.')
      }

      await saveProductCatalog({
        supabase,
        storeId: selectedProductForVariants.store_id,
        productId: selectedProductForVariants.id,
        product: {
          name: String(selectedProductForVariants.name || ''),
          slug: selectedProductForVariants.slug || null,
          sku: selectedProductForVariants.sku || null,
          short_description: selectedProductForVariants.short_description || null,
          description: selectedProductForVariants.description || null,
          old_price:
            selectedProductForVariants.old_price === null ||
            selectedProductForVariants.old_price === undefined
              ? null
              : Number(selectedProductForVariants.old_price),
          category_id: selectedProductForVariants.category_id || null,
          sort_order: Number(selectedProductForVariants.sort_order || 0),
          default_selling_price: Number(selectedProductForVariants.default_selling_price || 0),
          default_purchase_cost: Number(selectedProductForVariants.default_purchase_cost || 0),
          stock_tracking_mode:
            selectedProductForVariants.stock_tracking_mode === 'shared' ? 'shared' : 'variant',
          publication_status: String(selectedProductForVariants.publication_status || 'active'),
        },
        variants: variantPayloads.map((entry) => ({ ...entry.sync, images: entry.images })),
        // La galerie produit n'est pas gérée par cet écran.
        images: null,
      })
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['product-variants-by-product'] }),
        queryClient.invalidateQueries({ queryKey: ['product-images-by-product'] }),
      ])
      setIsVariantsOpen(false)
      setSelectedProductForVariants(null)
      setEditingAttributes([])
      setEditingAttributeDrafts({})
      setEditingVariants([])
      setVariantsError('')
    },
    onError: (error: any) => {
      setVariantsError(error?.message || 'Erreur lors de l’enregistrement des variantes.')
    },
  })

  const updateProductWithVariantsMutation = useMutation({
    mutationFn: async () => {
      if (!selectedProductForEdit?.id) throw new Error('Produit invalide.')
      if (!editName.trim()) throw new Error('Le nom du produit est obligatoire.')

      const hasVariants = (editingVariants || []).length > 0

      const variantPayloads = (editingVariants || [])
        .map((variant) => ({
          images: (variant.images || []) as GalleryItem[],
          sync: {
            id: variant.id,
            name: variant.name.trim() || buildVariantName(variant.option_values || {}),
            sku: variant.sku.trim(),
            selling_price: Number(variant.selling_price || 0),
            purchase_cost: Number(variant.purchase_cost || 0),
            old_price: Number(variant.old_price || 0) > 0 ? Number(variant.old_price) : null,
            is_default: Boolean(variant.is_default),
            sort_order: Number(variant.sort_order || 0),
            stock_multiplier: normalizeStockMultiplier(variant.stock_multiplier),
            option_values: variant.option_values || {},
          },
        }))
        .filter(
          (entry) =>
            entry.sync.name || entry.sync.sku || Object.keys(entry.sync.option_values || {}).length > 0
        )

      for (const entry of variantPayloads) {
        if (!entry.sync.name) throw new Error('Chaque variante doit avoir un nom.')
        if (!entry.sync.sku) throw new Error('Chaque variante doit avoir un SKU.')
      }

      // Le slug reste stable : il n'est régénéré que s'il n'existe pas encore ou s'il est modifié.
      const currentSlug = String(selectedProductForEdit.slug || '')
      const requestedSlug = editSlug.trim()
      let slug = currentSlug

      if (!currentSlug || (requestedSlug && requestedSlug !== currentSlug)) {
        slug = await buildUniqueProductSlug({
          supabase,
          storeId: selectedProductForEdit.store_id,
          base: requestedSlug || editName.trim(),
          excludeProductId: selectedProductForEdit.id,
        })
      }

      await saveProductCatalog({
        supabase,
        storeId: selectedProductForEdit.store_id,
        productId: selectedProductForEdit.id,
        product: {
          name: editName.trim(),
          slug,
          sku: editSku.trim() || null,
          short_description: editShortDescription.trim() || null,
          description: editDescription.trim() || null,
          old_price: Number(editOldPrice || 0) > 0 ? Number(editOldPrice) : null,
          category_id: editCategoryId || null,
          sort_order: Number(selectedProductForEdit.sort_order || 0),
          default_selling_price: hasVariants ? 0 : Number(editSellingPrice || 0),
          default_purchase_cost: Number(selectedProductForEdit.default_purchase_cost || 0),
          stock_tracking_mode: editStockTrackingMode,
          publication_status: editPublicationStatus,
          // Action explicite du marchand : la configuration stock/variantes est confirmée.
          confirm_stock_setup: true,
        },
        variants: variantPayloads.map((entry) => ({ ...entry.sync, images: entry.images })),
        images: editGallery,
      })
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['products'] }),
        queryClient.invalidateQueries({ queryKey: ['product-variants-by-product'] }),
        queryClient.invalidateQueries({ queryKey: ['product-images-by-product'] }),
        queryClient.invalidateQueries({ queryKey: ['inventory-movements'] }),
      ])
      setIsEditOpen(false)
      setSelectedProductForEdit(null)
      setEditName('')
      setEditSku('')
      setEditSellingPrice('0')
      setEditPublicationStatus('active')
      setEditStockTrackingMode('variant')
      setEditError('')
      setEditSlug('')
      setEditShortDescription('')
      setEditDescription('')
      setEditOldPrice('')
      setEditCategoryId('')
      setEditGallery([])
      setEditingAttributes([])
      setEditingAttributeDrafts({})
      setEditingVariants([])
    },
    onError: (error: any) => {
      setEditError(error?.message || 'Erreur lors de la modification du produit.')
    },
  })

  const duplicateProductMutation = useMutation({
    mutationFn: async (product: any) => {
      const productVariants = variantsByProduct?.[product.id] || []
      const duplicateName = `${product.name} (Copie)`

      const slug = await buildUniqueProductSlug({
        supabase,
        storeId: product.store_id,
        base: duplicateName,
      })

      await saveProductCatalog({
        supabase,
        storeId: product.store_id,
        product: {
          name: duplicateName,
          slug,
          sku: product.sku || null,
          short_description: product.short_description || null,
          description: product.description || null,
          old_price: product.old_price ?? null,
          category_id: product.category_id || null,
          sort_order: Number(product.sort_order || 0),
          default_selling_price: Number(product.default_selling_price || 0),
          default_purchase_cost: Number(product.default_purchase_cost || 0),
          stock_tracking_mode: product.stock_tracking_mode === 'shared' ? 'shared' : 'variant',
          publication_status: 'draft',
        },
        variants: productVariants.map((variant: any) => ({
          name: String(variant.name || ''),
          sku: String(variant.sku || ''),
          selling_price: Number(variant.selling_price || 0),
          purchase_cost: Number(variant.purchase_cost || 0),
          old_price: variant.old_price ?? null,
          is_default: Boolean(variant.is_default),
          sort_order: Number(variant.sort_order || 0),
          stock_multiplier: normalizeStockMultiplier(variant.stock_multiplier),
          option_values: variant.option_values || {},
          images: variantGalleryFromRows(variant.id).map((item) => ({ ...item, id: null })),
        })),
        // La copie réutilise les mêmes URLs d'images (aucun fichier dupliqué dans le Storage).
        images: productGalleryFromRows(product.id).map((item) => ({ ...item, id: null })),
      })
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['products'] }),
        queryClient.invalidateQueries({ queryKey: ['product-variants-by-product'] }),
        queryClient.invalidateQueries({ queryKey: ['product-images-by-product'] }),
      ])
    },
  })

  const deleteProductMutation = useMutation({
    mutationFn: async (product: any) => {
      const { data: linkedPurchases, error: linkedPurchasesError } = await supabase
        .from('inventory_movements')
        .select('id')
        .eq('product_id', product.id)
        .eq('movement_type', 'in')
        .or('supplier_id.not.is.null,source_type.eq.purchase')
        .limit(1)

      if (linkedPurchasesError) throw linkedPurchasesError
      if ((linkedPurchases || []).length > 0) {
        throw new Error('Suppression impossible: ce produit est lié à des achats/entrées de stock.')
      }

      const { data: linkedOrderItems, error: linkedOrderItemsError } = await supabase
        .from('order_items')
        .select('id')
        .eq('product_id', product.id)
        .limit(1)

      if (linkedOrderItemsError) throw linkedOrderItemsError
      if ((linkedOrderItems || []).length > 0) {
        throw new Error('Suppression impossible: ce produit est déjà utilisé dans des ventes.')
      }

      const { data: productImagesToClean } = await supabase
        .from('product_images')
        .select('image_url')
        .eq('product_id', product.id)

      const { error: deleteVariantsError } = await supabase
        .from('product_variants')
        .delete()
        .eq('product_id', product.id)

      if (deleteVariantsError) throw deleteVariantsError

      const { error: deleteError } = await supabase
        .from('products')
        .delete()
        .eq('id', product.id)

      if (deleteError) throw deleteError

      // Les fichiers du Storage sont retirés après la suppression des lignes
      // (un fichier encore référencé par une copie du produit est conservé).
      await deleteManagedProductImages({
        supabase,
        imageUrls: ((productImagesToClean || []) as Array<{ image_url: string | null }>).map(
          (row) => row.image_url
        ),
      })
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['products'] }),
        queryClient.invalidateQueries({ queryKey: ['product-variants-by-product'] }),
        queryClient.invalidateQueries({ queryKey: ['inventory-movements'] }),
      ])
      setSelectedProductIds((prev) => prev.filter((id) => id !== String((deleteProductMutation as any).variables?.id || '')))
    },
  })

  const bulkDeleteProductsMutation = useMutation({
    mutationFn: async () => {
      if (selectedProductIds.length === 0) {
        throw new Error('Aucun produit sélectionné.')
      }

      const selectedProducts = (filteredProducts || []).filter((product) =>
        selectedProductIds.includes(String(product.id))
      )

      for (const product of selectedProducts) {
        const { data: linkedPurchases, error: linkedPurchasesError } = await supabase
          .from('inventory_movements')
          .select('id')
          .eq('product_id', product.id)
          .eq('movement_type', 'in')
          .or('supplier_id.not.is.null,source_type.eq.purchase')
          .limit(1)

        if (linkedPurchasesError) throw linkedPurchasesError
        if ((linkedPurchases || []).length > 0) {
          throw new Error(`Suppression impossible (${product.name}): lié à des achats/entrées de stock.`)
        }

        const { data: linkedOrderItems, error: linkedOrderItemsError } = await supabase
          .from('order_items')
          .select('id')
          .eq('product_id', product.id)
          .limit(1)

        if (linkedOrderItemsError) throw linkedOrderItemsError
        if ((linkedOrderItems || []).length > 0) {
          throw new Error(`Suppression impossible (${product.name}): déjà utilisé dans des ventes.`)
        }
      }

      const { data: imagesToClean, error: imagesToCleanError } = await supabase
        .from('product_images')
        .select('image_url')
        .in(
          'product_id',
          selectedProducts.map((product) => String(product.id))
        )

      if (imagesToCleanError) throw imagesToCleanError

      for (const product of selectedProducts) {
        const { error: deleteVariantsError } = await supabase
          .from('product_variants')
          .delete()
          .eq('product_id', product.id)

        if (deleteVariantsError) throw deleteVariantsError

        const { error: deleteError } = await supabase
          .from('products')
          .delete()
          .eq('id', product.id)

        if (deleteError) throw deleteError
      }

      await deleteManagedProductImages({
        supabase,
        imageUrls: ((imagesToClean || []) as Array<{ image_url: string | null }>).map(
          (row) => row.image_url
        ),
      })
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['products'] }),
        queryClient.invalidateQueries({ queryKey: ['product-variants-by-product'] }),
        queryClient.invalidateQueries({ queryKey: ['inventory-movements'] }),
      ])
      setSelectedProductIds([])
    },
    onError: (error: any) => {
      window.alert(error?.message || 'Erreur lors de la suppression multiple.')
    },
  })

  const { data: inventoryData } = useQuery({
    queryKey: ['inventory-movements', currentStoreId],
    queryFn: async () => {
      if (!currentStoreId && accessibleStoreIds.length === 0) {
        return {}
      }

      let movementsQuery = supabase
        .from('inventory_movements')
        .select('product_id, movement_type, adjustment_direction, quantity')

      if (currentStoreId) {
        movementsQuery = movementsQuery.eq('store_id', currentStoreId)
      } else {
        movementsQuery = movementsQuery.in('store_id', accessibleStoreIds)
      }

      const { data, error } = await movementsQuery

      if (error) throw error

      // Calculer le stock pour chaque produit
      const stockByProduct: Record<string, number> = {}
      data?.forEach(movement => {
        const productId = movement.product_id
        if (!stockByProduct[productId]) {
          stockByProduct[productId] = 0
        }
        
        if (
          movement.movement_type === 'in' ||
          (movement.movement_type === 'adjustment' && movement.adjustment_direction === 'in')
        ) {
          stockByProduct[productId] += movement.quantity
        } else if (
          movement.movement_type === 'out' ||
          (movement.movement_type === 'adjustment' && movement.adjustment_direction === 'out')
        ) {
          stockByProduct[productId] -= movement.quantity
        }
      })

      return stockByProduct
    },
  })

  /**
   * Statut de publication : seul `active` est exposé au site client
   * via l'API catalogue (draft = préparation, archived = retiré de la vente).
   */
  const updatePublicationStatusMutation = useMutation({
    mutationFn: async ({ productId, status }: { productId: string; status: PublicationStatus }) => {
      const { data, error } = await supabase
        .from('products')
        .update({ publication_status: status })
        .eq('id', productId)
        .select('id')

      if (error) throw error
      // RLS : un rôle sans droit d'écriture met à jour 0 ligne sans erreur.
      if (!data || data.length === 0) {
        throw new Error("Vous n'avez pas les droits pour modifier ce produit.")
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['products'] })
      toast('Statut de publication mis à jour')
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Erreur lors de la mise à jour du statut.')
    },
  })

  const filteredProducts = (products || []).filter((product) => {
    const stock = inventoryData?.[product.id] || 0
    if (publicationFilter !== 'all' && normalizePublicationStatus(product.publication_status) !== publicationFilter) {
      return false
    }
    if (stockFilter === 'in_stock') return stock > 0
    if (stockFilter === 'out_of_stock') return stock <= 0
    return true
  })

  useEffect(() => {
    const visibleIds = new Set((filteredProducts || []).map((p: any) => String(p.id)))
    setSelectedProductIds((prev) => {
      const next = prev.filter((id) => visibleIds.has(id))
      if (next.length === prev.length && next.every((id, index) => id === prev[index])) {
        return prev
      }
      return next
    })
  }, [filteredProducts])

  const allVisibleSelected =
    filteredProducts.length > 0 && filteredProducts.every((product) => selectedProductIds.includes(product.id))

  const { data: variantStockData } = useQuery({
    queryKey: ['inventory-variant-movements', currentStoreId],
    queryFn: async () => {
      if (!currentStoreId && accessibleStoreIds.length === 0) {
        return {}
      }

      let movementsQuery = supabase
        .from('inventory_movements')
        .select('product_variant_id, movement_type, adjustment_direction, quantity')

      if (currentStoreId) {
        movementsQuery = movementsQuery.eq('store_id', currentStoreId)
      } else {
        movementsQuery = movementsQuery.in('store_id', accessibleStoreIds)
      }

      const { data, error } = await movementsQuery
      if (error) throw error

      const stockByVariant: Record<string, number> = {}
      ;(data || []).forEach((movement: any) => {
        const variantId = String(movement?.product_variant_id || '')
        if (!variantId) return
        if (!stockByVariant[variantId]) stockByVariant[variantId] = 0

        if (
          movement.movement_type === 'in' ||
          (movement.movement_type === 'adjustment' && movement.adjustment_direction === 'in')
        ) {
          stockByVariant[variantId] += Number(movement.quantity || 0)
        } else if (
          movement.movement_type === 'out' ||
          (movement.movement_type === 'adjustment' && movement.adjustment_direction === 'out')
        ) {
          stockByVariant[variantId] -= Number(movement.quantity || 0)
        }
      })

      return stockByVariant
    },
  })

  return (
    <div className="space-y-4 sm:space-y-6 pt-2 sm:pt-0">

      <div className="flex flex-col items-center sm:items-start gap-1">
        <div className="flex items-center gap-2">
          <JisraMark size={28} />
          <span className="text-lg font-bold text-[#1fa971] bg-[#1fa971]/10 px-3 py-1 rounded-full">
            Produits
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Catalogue et inventaire produits
        </p>
      </div>
      {openActionsProductId ? (
        <button
          type="button"
          aria-label="Fermer menu actions"
          className="fixed inset-0 z-40 cursor-default"
          onClick={() => setOpenActionsProductId(null)}
        />
      ) : null}

      {/* Filters & Actions */}
      <div className="bg-card rounded-xl shadow p-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          {/* Phone: StoreSelector + stock filter on same line */}
          <div className="flex flex-row items-center justify-center gap-3 sm:hidden w-full">
            <StoreSelector />
            <select
              value={stockFilter}
              onChange={(e) => setStockFilter(e.target.value as 'all' | 'in_stock' | 'out_of_stock')}
              className="border border-border rounded-lg px-2 py-2 text-xs sm:text-sm bg-card text-foreground focus:ring-2 focus:ring-jisra-green focus:border-jisra-green outline-none"
            >
              <option value="all">Tout stock</option>
              <option value="in_stock">En stock</option>
              <option value="out_of_stock">Rupture</option>
            </select>
            <select
              value={publicationFilter}
              onChange={(e) => setPublicationFilter(e.target.value as 'all' | PublicationStatus)}
              className="border border-border rounded-lg px-2 py-2 text-xs sm:text-sm bg-card text-foreground focus:ring-2 focus:ring-jisra-green focus:border-jisra-green outline-none"
              aria-label="Filtrer par statut de publication"
            >
              <option value="all">Tout statut</option>
              <option value="active">Publiés</option>
              <option value="draft">Brouillons</option>
              <option value="archived">Archivés</option>
            </select>
          </div>

          {/* Phone: Search bar full width */}
          <div className="relative flex-1 sm:hidden w-full">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un produit..."
              className="w-full border border-border rounded-lg pl-9 pr-3 py-2 text-sm bg-card text-foreground placeholder:text-muted-foreground focus:ring-2 focus:ring-jisra-green focus:border-jisra-green outline-none"
            />
          </div>

          {/* Phone: Add product button full width */}
          <button
            onClick={() => setIsCreateOpen(true)}
            className="sm:hidden inline-flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium px-4 py-2 rounded-lg transition-colors whitespace-nowrap w-full"
          >
            <Plus className="w-4 h-4" />
            Ajouter un produit
          </button>

          {/* Desktop layout (unchanged) */}
          <div className="hidden sm:flex sm:flex-row items-stretch sm:items-center gap-3 w-full">
            <StoreSelector />
            <div className="flex-1 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Rechercher un produit..."
                  className="w-full border border-border rounded-lg pl-9 pr-3 py-2 text-sm bg-card text-foreground placeholder:text-muted-foreground focus:ring-2 focus:ring-jisra-green focus:border-jisra-green outline-none"
                />
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <select
                  value={publicationFilter}
                  onChange={(e) => setPublicationFilter(e.target.value as 'all' | PublicationStatus)}
                  className="border border-border rounded-lg px-3 py-2 text-sm bg-card text-foreground focus:ring-2 focus:ring-jisra-green focus:border-jisra-green outline-none"
                  aria-label="Filtrer par statut de publication"
                >
                  <option value="all">Tout statut</option>
                  <option value="active">Publiés</option>
                  <option value="draft">Brouillons</option>
                  <option value="archived">Archivés</option>
                </select>
                <select
                  value={stockFilter}
                  onChange={(e) => setStockFilter(e.target.value as 'all' | 'in_stock' | 'out_of_stock')}
                  className="border border-border rounded-lg px-3 py-2 text-sm bg-card text-foreground focus:ring-2 focus:ring-jisra-green focus:border-jisra-green outline-none"
                >
                  <option value="all">Tout stock</option>
                  <option value="in_stock">En stock</option>
                  <option value="out_of_stock">Rupture</option>
                </select>
                <button
                  onClick={() => setIsCreateOpen(true)}
                  className="inline-flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium px-4 py-2 rounded-lg transition-colors whitespace-nowrap"
                >
                  <Plus className="w-4 h-4" />
                  Ajouter un produit
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {isEditOpen ? (
        <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4">
          <div className="bg-card rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
            <div className="p-6 border-b flex items-center justify-between shrink-0 bg-card">
              <h3 className="text-lg font-semibold text-foreground">
                Modifier — {selectedProductForEdit?.name || 'Produit'}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setIsEditOpen(false)
                  setSelectedProductForEdit(null)
                  setEditError('')
                  setEditGallery([])
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                Fermer
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-sm text-foreground mb-1">Nom du produit</label>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                />
              </div>

              <div>
                <label className="block text-sm text-foreground mb-1">SKU</label>
                <input
                  value={editSku}
                  onChange={(e) => setEditSku(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                />
              </div>

              <div>
                <label className="block text-sm text-foreground mb-1">Publication sur le site</label>
                <PublicationStatusSelect
                  value={editPublicationStatus}
                  onChange={setEditPublicationStatus}
                  className="w-full"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  « Publié » = visible sur le site via l&apos;API. « Brouillon » et « Archivé » ne sont pas exposés.
                </p>
              </div>

              <div>
                <label className="block text-sm text-foreground mb-1">Gestion du stock</label>
                <select
                  value={editStockTrackingMode}
                  onChange={(e) => setEditStockTrackingMode(e.target.value === 'shared' ? 'shared' : 'variant')}
                  className="w-full border rounded-lg px-3 py-2"
                >
                  <option value="variant">Stock par variante (couleur, taille...)</option>
                  <option value="shared">Stock unique partagé (packs quantité 1, 2, 3...)</option>
                </select>
                <p className="mt-1 text-xs text-muted-foreground">
                  « Stock unique partagé » convient aux variantes qui représentent un nombre d’unités du même produit.
                </p>
              </div>

              {(editingVariants || []).length === 0 ? (
                <div>
                  <label className="block text-sm text-foreground mb-1">Prix de vente</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={editSellingPrice}
                    onChange={(e) => setEditSellingPrice(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2"
                  />
                </div>
              ) : null}

              <div>
                <label className="block text-sm text-foreground mb-1">Slug (URL du produit)</label>
                <input
                  value={editSlug}
                  onChange={(e) => setEditSlug(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 font-mono text-sm"
                  placeholder="table-basse-trapeze"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Laisser vide pour conserver le slug actuel. Il ne change pas automatiquement quand le nom change.
                </p>
              </div>

              <div>
                <label className="block text-sm text-foreground mb-1">Ancien prix (prix barré)</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={editOldPrice}
                  onChange={(e) => setEditOldPrice(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                  placeholder="Optionnel"
                />
              </div>

              <div>
                <label className="block text-sm text-foreground mb-1">Catégorie</label>
                <CategorySelect
                  categories={categoriesForStore(selectedProductForEdit?.store_id)}
                  value={editCategoryId}
                  onChange={setEditCategoryId}
                  storeId={selectedProductForEdit?.store_id || null}
                  onCreated={async () => {
                    await refetchCategories()
                  }}
                  className="w-full border rounded-lg px-3 py-2"
                />
              </div>

              <div>
                <label className="block text-sm text-foreground mb-1">Description courte</label>
                <input
                  value={editShortDescription}
                  onChange={(e) => setEditShortDescription(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                  placeholder="Résumé affiché sur les cartes du catalogue"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm text-foreground mb-1">Description complète</label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={4}
                  className="w-full border rounded-lg px-3 py-2"
                  placeholder="Description détaillée affichée sur la fiche produit"
                />
              </div>

              <div className="md:col-span-2">
                <ProductGalleryEditor
                  label="Photos du produit"
                  items={editGallery}
                  onChange={setEditGallery}
                  resolveUrl={resolveImageUrl}
                />
              </div>

              {/* Attributs et variantes dans l'édition */}
              <div className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="block text-sm text-foreground">Attributs principaux</label>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingAttributes((prev) => [...prev, { ...EMPTY_ATTRIBUTE }])
                      setEditingAttributeDrafts({})
                    }}
                    className="text-sm text-primary hover:text-primary/80"
                  >
                    + Ajouter attribut
                  </button>
                </div>

                <div className="flex flex-wrap gap-2">
                  {SUGGESTED_MAIN_VARIANTS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => {
                        const exists = (editingAttributes || []).some((attr) => String(attr.name || '').trim().toLowerCase() === suggestion.toLowerCase())
                        if (exists) return
                        setEditingAttributes((prev) => [...prev, { name: suggestion, values: '' }])
                        setEditingAttributeDrafts({})
                      }}
                      className="px-2.5 py-1 rounded-md border text-xs text-foreground hover:bg-secondary"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>

                {(editingAttributes || []).length > 0 ? (
                  <div className="hidden md:grid md:grid-cols-[180px_1fr_120px] gap-3 px-1">
                    <p className="text-xs font-medium text-muted-foreground">Attribut</p>
                    <p className="text-xs font-medium text-muted-foreground">Sous-variantes (séparées par virgule)</p>
                    <p className="text-xs font-medium text-muted-foreground text-center">Action</p>
                  </div>
                ) : null}

                {(editingAttributes || []).map((attribute, index) => (
                  <div key={`edit-attribute-${index}`} className="grid grid-cols-1 md:grid-cols-[180px_1fr_120px] gap-3 items-end p-3 rounded-lg border border-border/60 bg-muted/20">
                    <div>
                      <label className="md:hidden block text-xs text-muted-foreground mb-1">Attribut</label>
                      <input
                        value={attribute.name}
                        onChange={(e) =>
                          setEditingAttributes((prev) => prev.map((a, i) => (i === index ? { ...a, name: e.target.value } : a)))
                        }
                        className="w-full border rounded-lg px-3 py-2"
                        placeholder="Ex: Couleur"
                      />
                    </div>
                    <div>
                      <label className="md:hidden block text-xs text-muted-foreground mb-1">Sous-variantes</label>
                      <div className="w-full border rounded-lg px-2 py-1 min-h-[42px] flex flex-wrap items-center gap-1.5">
                        {splitAttributeValues(attribute.values).map((value, valueIndex) => (
                          <span key={`${value}-${valueIndex}`} className="px-2 py-0.5 text-xs rounded border bg-secondary text-foreground">
                            {value}
                          </span>
                        ))}
                        <input
                          value={editingAttributeDrafts[index] || ''}
                          onChange={(e) => {
                            const raw = e.target.value
                            if (!raw.includes(',')) {
                              setEditingAttributeDrafts((prev) => ({ ...prev, [index]: raw }))
                              return
                            }
                            const parts = raw.split(',')
                            const committed = parts.slice(0, -1).map((p) => p.trim()).filter(Boolean)
                            const lastDraft = parts[parts.length - 1] || ''
                            if (committed.length > 0) {
                              setEditingAttributes((prev) =>
                                prev.map((a, i) => i === index ? { ...a, values: appendAttributeValues(a.values, committed) } : a)
                              )
                            }
                            setEditingAttributeDrafts((prev) => ({ ...prev, [index]: lastDraft }))
                          }}
                          onKeyDown={(e) => {
                            if ((e.key === ',' || e.key === 'Enter') && String(editingAttributeDrafts[index] || '').trim()) {
                              e.preventDefault()
                              const token = String(editingAttributeDrafts[index] || '').trim()
                              setEditingAttributes((prev) =>
                                prev.map((a, i) => i === index ? { ...a, values: appendAttributeValues(a.values, [token]) } : a)
                              )
                              setEditingAttributeDrafts((prev) => ({ ...prev, [index]: '' }))
                              return
                            }
                            if (e.key === 'Backspace' && !String(editingAttributeDrafts[index] || '').trim()) {
                              const values = splitAttributeValues(attribute.values)
                              if (values.length === 0) return
                              e.preventDefault()
                              setEditingAttributes((prev) =>
                                prev.map((a, i) => i === index ? { ...a, values: values.slice(0, -1).join(', ') } : a)
                              )
                            }
                          }}
                          className="flex-1 min-w-[140px] bg-transparent outline-none px-1 py-1 text-sm"
                          placeholder={splitAttributeValues(attribute.values).length > 0 ? 'Ajouter...' : 'Ex: Noir, Blanc, Vert'}
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingAttributes((prev) => prev.filter((_, i) => i !== index))
                        setEditingAttributeDrafts({})
                      }}
                      className="h-10 w-full px-3 py-2 rounded-lg border text-red-600 flex items-center justify-center md:self-end"
                    >
                      Supprimer
                    </button>
                  </div>
                ))}

                {(editingAttributes || []).length > 0 ? (
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingAttributes((prev) => [...prev, { ...EMPTY_ATTRIBUTE }])
                        setEditingAttributeDrafts({})
                      }}
                      className="text-sm text-primary hover:text-primary/80"
                    >
                      + Ajouter attribut
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => {
                    const generated = generateVariantsFromAttributes({
                      attributes: editingAttributes,
                      currentVariants: editingVariants,
                      baseSku: String(selectedProductForEdit?.sku || ''),
                      defaultSellingPrice: String(selectedProductForEdit?.default_selling_price ?? 0),
                    })
                    if (generated.length === 0) {
                      setEditError('Ajoutez des attributs et des sous-variantes avant génération.')
                      return
                    }
                    setEditError('')
                    setEditingVariants(generated)
                  }}
                  className="px-4 py-2 rounded-lg border bg-white text-black text-sm hover:bg-gray-50"
                >
                  ✨ Générer les variantes automatiquement
                </button>
              </div>

              <VariantEditor
                variants={editingVariants}
                onChange={setEditingVariants}
                resolveUrl={resolveImageUrl}
                error={editError}
              />
            </div>

            <div className="p-6 border-t flex items-center justify-end gap-3 shrink-0 bg-card">
              <button
                type="button"
                onClick={() => {
                  setIsEditOpen(false)
                  setSelectedProductForEdit(null)
                  setEditError('')
                  setEditGallery([])
                }}
                className="px-4 py-2 rounded-lg border text-foreground"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => updateProductWithVariantsMutation.mutate()}
                disabled={updateProductWithVariantsMutation.isPending}
                className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-white disabled:opacity-50"
              >
                {updateProductWithVariantsMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      ) : null}


      {isVariantsOpen ? (
        <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4">
          <div className="bg-card rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
            <div className="p-6 border-b flex items-center justify-between shrink-0 bg-card">
              <h3 className="text-lg font-semibold text-foreground">
                Variantes — {selectedProductForVariants?.name || 'Produit'}
              </h3>
              <button type="button" onClick={() => setIsVariantsOpen(false)} className="text-muted-foreground hover:text-foreground">
                Fermer
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto">
              <div className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="block text-sm text-foreground">Attributs principaux</label>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingAttributes((prev) => [...prev, { ...EMPTY_ATTRIBUTE }])
                      setEditingAttributeDrafts({})
                    }}
                    className="text-sm text-primary hover:text-primary/80"
                  >
                    + Ajouter attribut
                  </button>
                </div>

                <div className="flex flex-wrap gap-2">
                  {SUGGESTED_MAIN_VARIANTS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => {
                        const exists = (editingAttributes || []).some((attr) => String(attr.name || '').trim().toLowerCase() === suggestion.toLowerCase())
                        if (exists) return
                        setEditingAttributes((prev) => [...prev, { name: suggestion, values: '' }])
                        setEditingAttributeDrafts({})
                      }}
                      className="px-2.5 py-1 rounded-md border text-xs text-foreground hover:bg-secondary"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>

                {(editingAttributes || []).length > 0 ? (
                  <div className="hidden md:grid md:grid-cols-[180px_1fr_120px] gap-3 px-1">
                    <p className="text-xs font-medium text-muted-foreground">Attribut</p>
                    <p className="text-xs font-medium text-muted-foreground">Sous-variantes (séparées par virgule)</p>
                    <p className="text-xs font-medium text-muted-foreground text-center">Action</p>
                  </div>
                ) : null}

                {(editingAttributes || []).map((attribute, index) => (
                  <div key={`editing-attribute-${index}`} className="grid grid-cols-1 md:grid-cols-[180px_1fr_120px] gap-3 items-end p-3 rounded-lg border border-border/60 bg-muted/20">
                    <div>
                      <label className="md:hidden block text-xs text-muted-foreground mb-1">Attribut</label>
                      <input
                        value={attribute.name}
                        onChange={(e) =>
                          setEditingAttributes((prev) => prev.map((a, i) => (i === index ? { ...a, name: e.target.value } : a)))
                        }
                        className="w-full border rounded-lg px-3 py-2"
                        placeholder="Ex: Couleur"
                      />
                    </div>
                    <div>
                      <label className="md:hidden block text-xs text-muted-foreground mb-1">Sous-variantes</label>
                      <div className="w-full border rounded-lg px-2 py-1 min-h-[42px] flex flex-wrap items-center gap-1.5">
                        {splitAttributeValues(attribute.values).map((value, valueIndex) => (
                          <span key={`${value}-${valueIndex}`} className="px-2 py-0.5 text-xs rounded border bg-secondary text-foreground">
                            {value}
                          </span>
                        ))}
                        <input
                          value={editingAttributeDrafts[index] || ''}
                          onChange={(e) => {
                            const raw = e.target.value
                            if (!raw.includes(',')) {
                              setEditingAttributeDrafts((prev) => ({ ...prev, [index]: raw }))
                              return
                            }

                            const parts = raw.split(',')
                            const committed = parts
                              .slice(0, -1)
                              .map((p) => p.trim())
                              .filter(Boolean)
                            const lastDraft = parts[parts.length - 1] || ''

                            if (committed.length > 0) {
                              setEditingAttributes((prev) =>
                                prev.map((a, i) =>
                                  i === index ? { ...a, values: appendAttributeValues(a.values, committed) } : a
                                )
                              )
                            }

                            setEditingAttributeDrafts((prev) => ({ ...prev, [index]: lastDraft }))
                          }}
                          onKeyDown={(e) => {
                            if ((e.key === ',' || e.key === 'Enter') && String(editingAttributeDrafts[index] || '').trim()) {
                              e.preventDefault()
                              const token = String(editingAttributeDrafts[index] || '').trim()
                              setEditingAttributes((prev) =>
                                prev.map((a, i) =>
                                  i === index ? { ...a, values: appendAttributeValues(a.values, [token]) } : a
                                )
                              )
                              setEditingAttributeDrafts((prev) => ({ ...prev, [index]: '' }))
                              return
                            }

                            if (e.key === 'Backspace' && !String(editingAttributeDrafts[index] || '').trim()) {
                              const values = splitAttributeValues(attribute.values)
                              if (values.length === 0) return
                              e.preventDefault()
                              setEditingAttributes((prev) =>
                                prev.map((a, i) =>
                                  i === index ? { ...a, values: values.slice(0, -1).join(', ') } : a
                                )
                              )
                            }
                          }}
                          className="flex-1 min-w-[140px] bg-transparent outline-none px-1 py-1 text-sm"
                          placeholder={splitAttributeValues(attribute.values).length > 0 ? 'Ajouter...' : 'Ex: Noir, Blanc, Vert'}
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingAttributes((prev) => prev.filter((_, i) => i !== index))
                        setEditingAttributeDrafts({})
                      }}
                      className="h-10 w-full px-3 py-2 rounded-lg border text-red-600 flex items-center justify-center md:self-end"
                    >
                      Supprimer
                    </button>
                  </div>
                ))}

                {(editingAttributes || []).length > 0 ? (
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingAttributes((prev) => [...prev, { ...EMPTY_ATTRIBUTE }])
                        setEditingAttributeDrafts({})
                      }}
                      className="text-sm text-primary hover:text-primary/80"
                    >
                      + Ajouter attribut
                    </button>
                  </div>
                ) : null}

              </div>

              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => {
                    const generated = generateVariantsFromAttributes({
                      attributes: editingAttributes,
                      currentVariants: editingVariants,
                      baseSku: String(selectedProductForVariants?.sku || ''),
                      defaultSellingPrice: String(selectedProductForVariants?.default_selling_price ?? 0),
                    })
                    if (generated.length === 0) {
                      setVariantsError('Ajoutez des attributs et des sous-variantes avant génération.')
                      return
                    }
                    setVariantsError('')
                    setEditingVariants(generated)
                  }}
                  className="px-4 py-2 rounded-lg border bg-white text-black text-sm hover:bg-gray-50"
                >
                  ✨ Générer les variantes automatiquement
                </button>
              </div>

              <VariantEditor
                variants={editingVariants}
                onChange={setEditingVariants}
                resolveUrl={resolveImageUrl}
                error={variantsError}
              />
            </div>

            <div className="p-6 border-t flex items-center justify-end gap-3 shrink-0 bg-card">
              <button
                type="button"
                onClick={() => setIsVariantsOpen(false)}
                className="px-4 py-2 rounded-lg border text-foreground"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => saveVariantsMutation.mutate()}
                disabled={saveVariantsMutation.isPending}
                className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-white disabled:opacity-50"
              >
                {saveVariantsMutation.isPending ? 'Enregistrement...' : 'Enregistrer variantes'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isCreateOpen ? (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-card rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col">
            <div className="p-6 border-b flex items-center justify-between shrink-0 bg-card">
              <h3 className="text-lg font-semibold text-foreground">Nouveau produit</h3>
              <button type="button" onClick={() => setIsCreateOpen(false)} className="text-muted-foreground hover:text-foreground">
                Fermer
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm text-foreground mb-1">Store</label>
                  <select
                    value={selectedCreateStoreId}
                    onChange={(e) => setSelectedCreateStoreId(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2"
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
                  <label className="block text-sm text-foreground mb-1">Nom du produit</label>
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2"
                    placeholder="Ex: T-shirt Premium"
                  />
                </div>

                <div>
                  <label className="block text-sm text-foreground mb-1">SKU</label>
                  <input
                    value={newSku}
                    onChange={(e) => setNewSku(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2"
                    placeholder="Ex: TSH-001"
                  />
                </div>

                <div className="md:col-span-2 border rounded-lg p-3 bg-muted/10">
                  <label className="inline-flex items-center gap-2 text-sm text-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newHasVariants}
                      onChange={(e) => {
                        const checked = e.target.checked
                        setNewHasVariants(checked)
                        if (!checked) {
                          setNewAttributes([])
                          setNewAttributeDrafts({})
                          setNewVariants([])
                        }
                      }}
                    />
                    Ce produit a des variantes
                  </label>
                </div>

                {!newHasVariants ? (
                  <div>
                    <label className="block text-sm text-foreground mb-1">Prix de vente</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={newSellingPrice}
                      onChange={(e) => setNewSellingPrice(e.target.value)}
                      className="w-full border rounded-lg px-3 py-2"
                    />
                  </div>
                ) : null}

                <div>
                  <label className="block text-sm text-foreground mb-1">Publication sur le site</label>
                  <PublicationStatusSelect
                    value={newPublicationStatus}
                    onChange={setNewPublicationStatus}
                    className="w-full"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Seuls les produits « Publié » sont exposés à l&apos;API catalogue du site.
                  </p>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm text-foreground mb-1">Slug (URL du produit)</label>
                  <input
                    value={newSlug}
                    onChange={(e) => setNewSlug(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 font-mono text-sm"
                    placeholder="table-basse-trapeze"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Généré automatiquement depuis le nom si laissé vide, puis conservé tel quel.
                  </p>
                </div>

                <div>
                  <label className="block text-sm text-foreground mb-1">Ancien prix (prix barré)</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={newOldPrice}
                    onChange={(e) => setNewOldPrice(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2"
                    placeholder="Optionnel"
                  />
                </div>

                <div>
                  <label className="block text-sm text-foreground mb-1">Catégorie</label>
                  <CategorySelect
                    categories={categoriesForStore(selectedCreateStoreId)}
                    value={newCategoryId}
                    onChange={setNewCategoryId}
                    storeId={selectedCreateStoreId || null}
                    onCreated={async () => {
                      await refetchCategories()
                    }}
                    className="w-full border rounded-lg px-3 py-2"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm text-foreground mb-1">Description courte</label>
                  <input
                    value={newShortDescription}
                    onChange={(e) => setNewShortDescription(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2"
                    placeholder="Résumé affiché sur les cartes du catalogue"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm text-foreground mb-1">Description complète</label>
                  <textarea
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    rows={4}
                    className="w-full border rounded-lg px-3 py-2"
                    placeholder="Description détaillée affichée sur la fiche produit"
                  />
                </div>

                <div className="md:col-span-2">
                  <ProductGalleryEditor
                    label="Photos du produit"
                    items={newGallery}
                    onChange={setNewGallery}
                    resolveUrl={resolveImageUrl}
                  />
                </div>

                {newHasVariants ? (
                <div className="md:col-span-2 border rounded-lg p-4 space-y-3">
                  <div className="border rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="block text-sm text-foreground">Attributs principaux</label>
                      <button
                        type="button"
                        onClick={() => {
                          setNewAttributes((prev) => [...prev, { ...EMPTY_ATTRIBUTE }])
                          setNewAttributeDrafts({})
                        }}
                        className="text-sm text-primary hover:text-primary/80"
                      >
                        + Ajouter attribut
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {SUGGESTED_MAIN_VARIANTS.map((suggestion) => (
                        <button
                          key={suggestion}
                          type="button"
                          onClick={() => {
                            const exists = (newAttributes || []).some((attr) => String(attr.name || '').trim().toLowerCase() === suggestion.toLowerCase())
                            if (exists) return
                            setNewAttributes((prev) => [...prev, { name: suggestion, values: '' }])
                            setNewAttributeDrafts({})
                          }}
                          className="px-2.5 py-1 rounded-md border text-xs text-foreground hover:bg-secondary"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>

                    {(newAttributes || []).length > 0 ? (
                      <>
                        <div className="hidden md:grid md:grid-cols-[180px_1fr_120px] gap-3 px-1">
                          <p className="text-xs font-medium text-muted-foreground">Attribut</p>
                          <p className="text-xs font-medium text-muted-foreground">Sous-variantes (séparées par virgule)</p>
                          <p className="text-xs font-medium text-muted-foreground text-center">Action</p>
                        </div>
                      </>
                    ) : null}

                    {(newAttributes || []).map((attribute, index) => (
                      <div key={`new-attribute-${index}`} className="grid grid-cols-1 md:grid-cols-[180px_1fr_120px] gap-3 items-end p-3 rounded-lg border border-border/60 bg-muted/20">
                        <div>
                          <label className="md:hidden block text-xs text-muted-foreground mb-1">Attribut</label>
                          <input
                            value={attribute.name}
                            onChange={(e) =>
                              setNewAttributes((prev) => prev.map((a, i) => (i === index ? { ...a, name: e.target.value } : a)))
                            }
                            className="w-full border rounded-lg px-3 py-2"
                            placeholder="Ex: Couleur"
                          />
                        </div>
                        <div>
                          <label className="md:hidden block text-xs text-muted-foreground mb-1">Sous-variantes</label>
                          <div className="w-full border rounded-lg px-2 py-1 min-h-[42px] flex flex-wrap items-center gap-1.5">
                            {splitAttributeValues(attribute.values).map((value, valueIndex) => (
                              <span key={`${value}-${valueIndex}`} className="px-2 py-0.5 text-xs rounded border bg-secondary text-foreground">
                                {value}
                              </span>
                            ))}
                            <input
                              value={newAttributeDrafts[index] || ''}
                              onChange={(e) => {
                                const raw = e.target.value
                                if (!raw.includes(',')) {
                                  setNewAttributeDrafts((prev) => ({ ...prev, [index]: raw }))
                                  return
                                }

                                const parts = raw.split(',')
                                const committed = parts
                                  .slice(0, -1)
                                  .map((p) => p.trim())
                                  .filter(Boolean)
                                const lastDraft = parts[parts.length - 1] || ''

                                if (committed.length > 0) {
                                  setNewAttributes((prev) =>
                                    prev.map((a, i) =>
                                      i === index ? { ...a, values: appendAttributeValues(a.values, committed) } : a
                                    )
                                  )
                                }

                                setNewAttributeDrafts((prev) => ({ ...prev, [index]: lastDraft }))
                              }}
                              onKeyDown={(e) => {
                                if ((e.key === ',' || e.key === 'Enter') && String(newAttributeDrafts[index] || '').trim()) {
                                  e.preventDefault()
                                  const token = String(newAttributeDrafts[index] || '').trim()
                                  setNewAttributes((prev) =>
                                    prev.map((a, i) =>
                                      i === index ? { ...a, values: appendAttributeValues(a.values, [token]) } : a
                                    )
                                  )
                                  setNewAttributeDrafts((prev) => ({ ...prev, [index]: '' }))
                                  return
                                }

                                if (e.key === 'Backspace' && !String(newAttributeDrafts[index] || '').trim()) {
                                  const values = splitAttributeValues(attribute.values)
                                  if (values.length === 0) return
                                  e.preventDefault()
                                  setNewAttributes((prev) =>
                                    prev.map((a, i) =>
                                      i === index ? { ...a, values: values.slice(0, -1).join(', ') } : a
                                    )
                                  )
                                }
                              }}
                              className="flex-1 min-w-[140px] bg-transparent outline-none px-1 py-1 text-sm"
                              placeholder={splitAttributeValues(attribute.values).length > 0 ? 'Ajouter...' : 'Ex: Noir, Blanc, Vert'}
                            />
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setNewAttributes((prev) => prev.filter((_, i) => i !== index))
                            setNewAttributeDrafts({})
                          }}
                          className="h-10 w-full px-3 py-2 rounded-lg border text-red-600 flex items-center justify-center md:self-end"
                        >
                          Supprimer
                        </button>
                      </div>
                    ))}

                    {(newAttributes || []).length > 0 ? (
                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            setNewAttributes((prev) => [...prev, { ...EMPTY_ATTRIBUTE }])
                            setNewAttributeDrafts({})
                          }}
                          className="text-sm text-primary hover:text-primary/80"
                        >
                          + Ajouter attribut
                        </button>
                      </div>
                    ) : null}

                    {(newAttributes || []).length > 0 ? (
                      <div className="p-3 rounded-lg border border-dashed border-border/70 bg-muted/10">
                        <p className="text-[11px] text-muted-foreground">
                          Astuce: tapez une valeur puis une virgule pour ajouter une autre sous-variante.
                        </p>
                      </div>
                    ) : null}

                  </div>

                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={() => {
                        const generated = generateVariantsFromAttributes({
                          attributes: newAttributes,
                          currentVariants: newVariants,
                          baseSku: newSku,
                          defaultSellingPrice: newSellingPrice,
                        })
                        if (generated.length === 0) {
                          setCreateError('Ajoutez des attributs et des sous-variantes avant génération.')
                          return
                        }
                        setCreateError('')
                        setNewVariants(generated)
                      }}
                      className="px-4 py-2 rounded-lg border bg-white text-black text-sm hover:bg-gray-50"
                    >
                      ✨ Générer les variantes automatiquement
                    </button>
                  </div>

                  <div>
                    <label className="block text-sm text-foreground">Variantes (optionnel)</label>
                    <p className="text-xs text-muted-foreground">
                      Chaque variante peut avoir son propre prix, ancien prix, photos et ordre d’affichage.
                    </p>
                  </div>

                  <VariantEditor
                    variants={newVariants}
                    onChange={setNewVariants}
                    resolveUrl={resolveImageUrl}
                  />
                </div>
                ) : null}
              </div>

              {createError ? <div className="text-sm text-red-600">{createError}</div> : null}
            </div>

            <div className="p-6 border-t flex items-center justify-end gap-3 shrink-0 bg-card">
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="px-4 py-2 rounded-lg border text-foreground"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => createProductMutation.mutate()}
                disabled={createProductMutation.isPending || (newHasVariants && newVariants.length === 0)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed ${
                  createProductMutation.isPending || (newHasVariants && newVariants.length === 0)
                    ? 'bg-muted text-muted-foreground border border-border'
                    : 'bg-primary hover:bg-primary/90 text-white'
                }`}
              >
                {createProductMutation.isPending ? 'Création...' : 'Créer le produit'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {/* Products Table */}
      <div className="bg-card rounded-xl shadow overflow-hidden">
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="p-8 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              <p className="text-muted-foreground mt-2">Chargement des produits...</p>
            </div>
          ) : filteredProducts.length > 0 ? (
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-secondary">
                <tr>
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedProductIds(filteredProducts.map((product) => String(product.id)))
                        } else {
                          setSelectedProductIds([])
                        }
                      }}
                    />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    ID
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Produit
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    SKU
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Statut
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Prix
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Variantes
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Coût
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Stock
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Valeur
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-card divide-y divide-border">
                {filteredProducts.map((product) => {
                  const stock = inventoryData?.[product.id] || 0
                  const stockValue = stock * product.default_purchase_cost
                  const productImageUrl = getProductImageUrl(product.image_url)
                  const productVariants = variantsByProduct?.[product.id] || []
                  const hasVariants = productVariants.length > 0
                  const isExpanded = Boolean(expandedVariantsByProduct[product.id])
                  const variantPrices = productVariants
                    .map((variant: any) => Number(variant?.selling_price ?? 0))
                    .filter((value: number) => Number.isFinite(value))
                  const variantCosts = productVariants
                    .map((variant: any) => Number(variant?.purchase_cost ?? 0))
                    .filter((value: number) => Number.isFinite(value))
                  const minVariantPrice = variantPrices.length ? Math.min(...variantPrices) : null
                  const maxVariantPrice = variantPrices.length ? Math.max(...variantPrices) : null
                  const minVariantCost = variantCosts.length ? Math.min(...variantCosts) : null
                  const maxVariantCost = variantCosts.length ? Math.max(...variantCosts) : null

                  return (
                    <Fragment key={product.id}>
                    <tr className="hover:bg-secondary">
                      <td className="px-3 py-4 align-top">
                        <input
                          type="checkbox"
                          checked={selectedProductIds.includes(String(product.id))}
                          onChange={(e) => {
                            setSelectedProductIds((prev) => {
                              if (e.target.checked) {
                                if (prev.includes(String(product.id))) return prev
                                return [...prev, String(product.id)]
                              }
                              return prev.filter((id) => id !== String(product.id))
                            })
                          }}
                        />
                      </td>
                      <td className="px-4 py-4 align-top">
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(String(product.id))
                            toast('ID copié', {
                              description: String(product.id),
                              icon: <Copy className="w-4 h-4 text-[#1fa971]" />,
                            })
                          }}
                          className="text-xs text-muted-foreground font-mono hover:text-foreground hover:bg-secondary/50 px-1.5 py-0.5 rounded transition-colors cursor-pointer"
                          title="Cliquer pour copier l'ID"
                        >
                          {String(product.id).slice(0, 8)}...
                        </button>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          {hasVariants ? (
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedVariantsByProduct((prev) => ({
                                  ...prev,
                                  [product.id]: !prev[product.id],
                                }))
                              }
                              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                              title={isExpanded ? 'Masquer les variantes' : 'Afficher les variantes'}
                            >
                              {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                              <span>{productVariants.length}</span>
                            </button>
                          ) : (
                            <span className="w-8" />
                          )}
                          <div className="flex-shrink-0 h-10 w-10 rounded-lg overflow-hidden bg-secondary">
                            {productImageUrl && !failedImages[product.id] ? (
                              <img
                                src={productImageUrl}
                                alt={product.name}
                                className="h-10 w-10 object-cover"
                                loading="lazy"
                                onError={() => {
                                  setFailedImages(prev => ({ ...prev, [product.id]: true }))
                                }}
                              />
                            ) : (
                              <div className="h-10 w-10 flex items-center justify-center text-xs font-semibold text-muted-foreground">
                                {String(product.name || 'P').charAt(0).toUpperCase()}
                              </div>
                            )}
                          </div>
                          <div className="ml-4">
                            <div className="text-sm font-medium text-foreground">{product.name}</div>
                            <div className="text-sm text-muted-foreground">
                              Ajouté le {new Date(product.created_at).toLocaleDateString('fr-FR')}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-foreground">{product.sku || '-'}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex flex-col items-start gap-1.5">
                          <PublicationStatusBadge status={product.publication_status} />
                          <PublicationStatusSelect
                            value={product.publication_status}
                            disabled={updatePublicationStatusMutation.isPending}
                            onChange={(status) =>
                              updatePublicationStatusMutation.mutate({
                                productId: String(product.id),
                                status,
                              })
                            }
                            className="px-2 py-1 text-xs"
                          />
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-foreground">
                          {minVariantPrice !== null && maxVariantPrice !== null
                            ? `${formatCurrency(minVariantPrice)} – ${formatCurrency(maxVariantPrice)}`
                            : formatCurrency(product.default_selling_price)}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-foreground">{productVariants.length}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-foreground">
                          {minVariantCost !== null && maxVariantCost !== null
                            ? `${formatCurrency(minVariantCost)} – ${formatCurrency(maxVariantCost)}`
                            : product.default_purchase_cost > 0
                              ? formatCurrency(product.default_purchase_cost)
                              : '-'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className={`text-sm font-medium ${stock > 0 ? 'text-green-600' : stock === 0 ? 'text-yellow-600' : 'text-red-600'}`}>
                          {stock} unités
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {stock > 0 ? 'En stock' : stock === 0 ? 'Rupture' : 'Stock négatif'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-foreground">{formatCurrency(stockValue)}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="relative inline-block text-left">
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-foreground"
                            onClick={(e) => {
                              const nextId = openActionsProductId === product.id ? null : product.id
                              if (!nextId) {
                                setOpenActionsProductId(null)
                                return
                              }

                              const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect()
                              const menuWidth = 176
                              const menuHeight = 172
                              const left = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, rect.right - menuWidth))
                              const spaceBelow = window.innerHeight - rect.bottom
                              const shouldOpenUp = spaceBelow < menuHeight + 8
                              const top = shouldOpenUp
                                ? Math.max(8, rect.top - menuHeight - 6)
                                : Math.min(window.innerHeight - menuHeight - 8, rect.bottom + 6)
                              setActionsMenuPosition({ top, left })
                              setOpenActionsProductId(nextId)
                            }}
                          >
                            <MoreVertical className="w-4 h-4" />
                          </button>

                          {openActionsProductId === product.id ? (
                            <div
                              className="fixed w-44 bg-card border border-border rounded-lg shadow-lg z-50 py-1 flex flex-col"
                              style={{ top: actionsMenuPosition.top, left: actionsMenuPosition.left }}
                            >
                              <button
                                type="button"
                                className="w-full text-left px-3 py-2 text-sm hover:bg-secondary"
                                onClick={() => {
                                  setOpenActionsProductId(null)
                                  setEditError('')
                                  setSelectedProductForEdit(product)
                                  setEditName(String(product.name || ''))
                                  setEditSku(String(product.sku || ''))
                                  setEditSellingPrice(String(product.default_selling_price || 0))
                                  setEditPublicationStatus(normalizePublicationStatus(product.publication_status))
                                  setEditStockTrackingMode(product.stock_tracking_mode === 'shared' ? 'shared' : 'variant')
                                  setEditSlug(String(product.slug || ''))
                                  setEditShortDescription(String(product.short_description || ''))
                                  setEditDescription(String(product.description || ''))
                                  setEditOldPrice(
                                    product.old_price === null || product.old_price === undefined
                                      ? ''
                                      : String(product.old_price)
                                  )
                                  setEditCategoryId(String(product.category_id || ''))
                                  setEditGallery(productGalleryFromRows(product.id))
                                  const variants = (variantsByProduct?.[product.id] || []).map((variant: any) => ({
                                    id: variant.id,
                                    name: String(variant.name || ''),
                                    sku: String(variant.sku || ''),
                                    selling_price: String(variant.selling_price ?? 0),
                                    purchase_cost: String(variant.purchase_cost ?? 0),
                                    old_price:
                                      variant.old_price === null || variant.old_price === undefined
                                        ? ''
                                        : String(variant.old_price),
                                    stock_multiplier: String(variant.stock_multiplier ?? 1),
                                    is_default: Boolean(variant.is_default),
                                    sort_order: Number(variant.sort_order ?? 0),
                                    option_values: variant.option_values || {},
                                    images: variantGalleryFromRows(variant.id),
                                  }))
                                  setEditingAttributes(deriveAttributesFromVariants(variants))
                                  setEditingVariants(variants)
                                  setIsEditOpen(true)
                                }}
                              >
                                Modifier
                              </button>
                              <button
                                type="button"
                                className="w-full text-left px-3 py-2 text-sm hover:bg-secondary"
                                onClick={() => {
                                  setOpenActionsProductId(null)
                                  duplicateProductMutation.mutate(product)
                                }}
                              >
                                Dupliquer
                              </button>

                              <button
                                type="button"
                                className="w-full text-left px-3 py-2 text-sm hover:bg-secondary text-red-600"
                                onClick={() => {
                                  setOpenActionsProductId(null)
                                  const confirmed = window.confirm(`Supprimer le produit \"${product.name}\" ?`)
                                  if (!confirmed) return
                                  deleteProductMutation.mutate(product)
                                }}
                              >
                                Supprimer
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                    {hasVariants && isExpanded ? (
                      <tr className="bg-secondary/30">
                        <td colSpan={11} className="px-6 py-3">
                          <div className="rounded-lg border border-border/70 bg-card overflow-x-auto">
                            <table className="min-w-full">
                              <thead className="bg-secondary/60">
                                <tr>
                                  <th className="px-4 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">Variante</th>
                                  <th className="px-4 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">ID variante</th>
                                  <th className="px-4 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">SKU</th>
                                  <th className="px-4 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">Prix</th>
                                  <th className="px-4 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">Coût</th>
                                  <th className="px-4 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">Qté / pack</th>
                                  <th className="px-4 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">Stock</th>
                                </tr>
                              </thead>
                              <tbody>
                                {productVariants.map((variant: any) => {
                                  const ownStock = variantStockData?.[variant.id]
                                  const isSharedStock = product.stock_tracking_mode === 'shared'
                                  const variantStock = isSharedStock ? Number(stock || 0) : Number(ownStock || 0)
                                  const multiplier = normalizeStockMultiplier(variant.stock_multiplier)
                                  return (
                                    <tr key={variant.id} className="border-t border-border/60">
                                      <td className="px-4 py-2 text-sm text-foreground">{String(variant.name || '-')}</td>
                                      <td className="px-4 py-2 text-sm">
                                        {variant.id ? (
                                          <div className="flex items-center gap-1">
                                            <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground">
                                              {String(variant.id).slice(0, 8)}…
                                            </code>
                                            <button
                                              type="button"
                                              title="Copier l'ID de la variante"
                                              onClick={() => {
                                                navigator.clipboard.writeText(String(variant.id))
                                                toast('ID de variante copié', {
                                                  description: String(variant.id),
                                                  icon: <Copy className="w-4 h-4 text-[#1fa971]" />,
                                                })
                                              }}
                                              className="rounded p-1 text-muted-foreground hover:bg-muted"
                                            >
                                              <Copy className="h-3.5 w-3.5" />
                                            </button>
                                          </div>
                                        ) : (
                                          <span className="text-xs text-muted-foreground">-</span>
                                        )}
                                      </td>
                                      <td className="px-4 py-2 text-sm text-muted-foreground">{String(variant.sku || '-')}</td>
                                      <td className="px-4 py-2 text-sm text-foreground">{formatCurrency(Number(variant.selling_price || 0))}</td>
                                      <td className="px-4 py-2 text-sm text-foreground">{formatCurrency(Number(variant.purchase_cost || 0))}</td>
                                      <td className="px-4 py-2 text-sm text-foreground">
                                        {multiplier > 1 ? `${multiplier} unités` : '1 unité'}
                                      </td>
                                      <td className={`px-4 py-2 text-sm font-medium ${variantStock > 0 ? 'text-green-600' : variantStock === 0 ? 'text-yellow-600' : 'text-red-600'}`}>
                                        {variantStock}
                                        {isSharedStock ? (
                                          <span className="ml-1 text-[11px] font-normal text-muted-foreground">(global)</span>
                                        ) : null}
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          ) : (
            <div className="p-8 text-center">
              <div className="text-muted-foreground mb-4">Aucun produit trouvé</div>
              <p className="text-muted-foreground">
                {search ? 'Essayez de modifier votre recherche' : 'Ajoutez votre premier produit'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
