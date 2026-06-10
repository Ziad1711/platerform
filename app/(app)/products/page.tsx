'use client'

import { useStore } from '@/lib/store-context'
import { createClient } from '@/lib/supabase/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatCurrency } from '@/lib/utils'
import StoreSelector from '@/components/dashboard/store-selector'
import { JisraMark } from '@/components/logo'
import { Search, Filter, MoreVertical, Plus, ChevronRight, ChevronDown, Copy } from 'lucide-react'
import { Fragment, useEffect, useState } from 'react'
import { toast } from 'sonner'

type ProductVariantForm = {
  id?: string
  name: string
  sku: string
  selling_price: string
  purchase_cost: string
  option_values?: Record<string, string>
}

type VariantAttributeForm = {
  id?: string
  name: string
  values: string
}

const EMPTY_VARIANT: ProductVariantForm = {
  name: '',
  sku: '',
  selling_price: '0',
  purchase_cost: '0',
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
    return {
      id: existing?.id,
      name: buildVariantName(optionValues),
      sku: String(existing?.sku || '').trim() || buildVariantSku(baseSku, optionValues),
      selling_price: String(existing?.selling_price || defaultSellingPrice || '0'),
      purchase_cost: String(existing?.purchase_cost || '0'),
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
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({})
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [selectedCreateStoreId, setSelectedCreateStoreId] = useState('')
  const [newName, setNewName] = useState('')
  const [newSku, setNewSku] = useState('')
  const [newSellingPrice, setNewSellingPrice] = useState('0')
  const [newHasVariants, setNewHasVariants] = useState(false)
  const [newAttributes, setNewAttributes] = useState<VariantAttributeForm[]>([])
  const [newAttributeDrafts, setNewAttributeDrafts] = useState<Record<number, string>>({})
  const [newVariants, setNewVariants] = useState<ProductVariantForm[]>([])
  const [newImageFile, setNewImageFile] = useState<File | null>(null)
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
  const [editSellingPrice, setEditSellingPrice] = useState('0')
  const [editError, setEditError] = useState('')
  const [editImageFile, setEditImageFile] = useState<File | null>(null)
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
        .select('id, product_id, name, sku, selling_price, purchase_cost, option_values')
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

      let imagePath: string | null = null

      if (newImageFile) {
        const extension = (newImageFile.name.split('.').pop() || 'jpg').toLowerCase()
        const filePath = `${selectedCreateStoreId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`

        const { error: uploadError } = await supabase.storage
          .from('products')
          .upload(filePath, newImageFile, { cacheControl: '3600', upsert: false })

        if (uploadError) throw uploadError
        imagePath = filePath
      }

      const normalizedVariants = (newHasVariants ? (newVariants || []) : [])
        .map((variant) => ({
          name: variant.name.trim() || buildVariantName(variant.option_values || {}),
          sku: variant.sku.trim(),
          selling_price: Number(variant.selling_price || 0),
          purchase_cost: Number(variant.purchase_cost || 0),
          option_values: variant.option_values || {},
        }))
        .filter((variant) => variant.name || variant.sku || Object.keys(variant.option_values || {}).length > 0)

      if (newHasVariants && normalizedVariants.length === 0) {
        throw new Error('Ce produit a des variantes: ajoutez au moins une variante.')
      }

      for (const variant of normalizedVariants) {
        if (!variant.name) throw new Error('Chaque variante doit avoir un nom.')
        if (!variant.sku) throw new Error('Chaque variante doit avoir un SKU.')
      }

      const { data: insertedProduct, error } = await supabase
        .from('products')
        .insert({
          store_id: selectedCreateStoreId,
          name: newName.trim(),
          sku: newSku.trim() || null,
          default_selling_price: newHasVariants ? 0 : Number(newSellingPrice || 0),
          default_purchase_cost: 0,
          image_url: imagePath,
        })
        .select('id')
        .single()

      if (error) throw error

      if (normalizedVariants.length > 0) {
        const { error: variantsError } = await supabase
          .from('product_variants')
          .insert(
            normalizedVariants.map((variant) => ({
              store_id: selectedCreateStoreId,
              product_id: insertedProduct.id,
              name: variant.name,
              sku: variant.sku,
              selling_price: variant.selling_price,
              purchase_cost: variant.purchase_cost,
              option_values: variant.option_values,
            }))
          )

        if (variantsError) throw variantsError
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['products'] }),
        queryClient.invalidateQueries({ queryKey: ['product-variants-by-product'] }),
      ])
      setIsCreateOpen(false)
      setSelectedCreateStoreId(currentStoreId || '')
      setNewName('')
      setNewSku('')
      setNewSellingPrice('0')
      setNewHasVariants(false)
      setNewAttributes([])
      setNewAttributeDrafts({})
      setNewVariants([])
      setNewImageFile(null)
      setCreateError('')
    },
    onError: (error: any) => {
      setCreateError(error?.message || 'Erreur lors de la création du produit.')
    },
  })

  const saveVariantsMutation = useMutation({
    mutationFn: async () => {
      if (!selectedProductForVariants?.id) throw new Error('Produit invalide.')

      const normalizedVariants = (editingVariants || [])
        .map((variant) => ({
          name: variant.name.trim() || buildVariantName(variant.option_values || {}),
          sku: variant.sku.trim(),
          selling_price: Number(variant.selling_price || 0),
          purchase_cost: Number(variant.purchase_cost || 0),
          option_values: variant.option_values || {},
        }))
        .filter((variant) => variant.name || variant.sku || Object.keys(variant.option_values || {}).length > 0)

      for (const variant of normalizedVariants) {
        if (!variant.name) throw new Error('Chaque variante doit avoir un nom.')
        if (!variant.sku) throw new Error('Chaque variante doit avoir un SKU.')
      }

      const { error: deleteError } = await supabase
        .from('product_variants')
        .delete()
        .eq('product_id', selectedProductForVariants.id)

      if (deleteError) throw deleteError

      if (normalizedVariants.length > 0) {
        const { error: insertError } = await supabase
          .from('product_variants')
          .insert(
            normalizedVariants.map((variant) => ({
              store_id: selectedProductForVariants.store_id,
              product_id: selectedProductForVariants.id,
              name: variant.name,
              sku: variant.sku,
              selling_price: variant.selling_price,
              purchase_cost: variant.purchase_cost,
              option_values: variant.option_values,
            }))
          )

        if (insertError) throw insertError
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['product-variants-by-product'] })
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

      let imagePath: string | null | undefined = undefined

      if (editImageFile) {
        if (editImageFile.size > 0) {
          const extension = (editImageFile.name.split('.').pop() || 'jpg').toLowerCase()
          const filePath = `${selectedProductForEdit.store_id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`

          const { error: uploadError } = await supabase.storage
            .from('products')
            .upload(filePath, editImageFile, { cacheControl: '3600', upsert: false })

          if (uploadError) throw uploadError
          imagePath = filePath
        } else {
          imagePath = null
        }
      }

      const updateData: Record<string, any> = {
        name: editName.trim(),
        sku: editSku.trim() || null,
        default_selling_price: hasVariants ? 0 : Number(editSellingPrice || 0),
      }

      if (imagePath !== undefined) {
        updateData.image_url = imagePath
      }

      const { error } = await supabase
        .from('products')
        .update(updateData)
        .eq('id', selectedProductForEdit.id)

      if (error) throw error

      if (hasVariants) {
        const normalizedVariants = (editingVariants || [])
          .map((variant) => ({
            name: variant.name.trim() || buildVariantName(variant.option_values || {}),
            sku: variant.sku.trim(),
            selling_price: Number(variant.selling_price || 0),
            purchase_cost: Number(variant.purchase_cost || 0),
            option_values: variant.option_values || {},
          }))
          .filter((variant) => variant.name || variant.sku || Object.keys(variant.option_values || {}).length > 0)

        for (const variant of normalizedVariants) {
          if (!variant.name) throw new Error('Chaque variante doit avoir un nom.')
          if (!variant.sku) throw new Error('Chaque variante doit avoir un SKU.')
        }

        const { error: deleteError } = await supabase
          .from('product_variants')
          .delete()
          .eq('product_id', selectedProductForEdit.id)

        if (deleteError) throw deleteError

        if (normalizedVariants.length > 0) {
          const { error: insertError } = await supabase
            .from('product_variants')
            .insert(
              normalizedVariants.map((variant) => ({
                store_id: selectedProductForEdit.store_id,
                product_id: selectedProductForEdit.id,
                name: variant.name,
                sku: variant.sku,
                selling_price: variant.selling_price,
                purchase_cost: variant.purchase_cost,
                option_values: variant.option_values,
              }))
            )

          if (insertError) throw insertError
        }
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['products'] }),
        queryClient.invalidateQueries({ queryKey: ['product-variants-by-product'] }),
        queryClient.invalidateQueries({ queryKey: ['inventory-movements'] }),
      ])
      setIsEditOpen(false)
      setSelectedProductForEdit(null)
      setEditName('')
      setEditSku('')
      setEditSellingPrice('0')
      setEditError('')
      setEditImageFile(null)
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

      const { data: insertedProduct, error: insertProductError } = await supabase
        .from('products')
        .insert({
          store_id: product.store_id,
          name: duplicateName,
          sku: product.sku || null,
          default_selling_price: Number(product.default_selling_price || 0),
          default_purchase_cost: Number(product.default_purchase_cost || 0),
          image_url: product.image_url || null,
        })
        .select('id')
        .single()

      if (insertProductError) throw insertProductError

      if (productVariants.length > 0) {
        const { error: insertVariantsError } = await supabase
          .from('product_variants')
          .insert(
            productVariants.map((variant: any) => ({
              store_id: product.store_id,
              product_id: insertedProduct.id,
              name: variant.name,
              sku: variant.sku,
              selling_price: Number(variant.selling_price || 0),
              purchase_cost: Number(variant.purchase_cost || 0),
              option_values: variant.option_values || {},
            }))
          )

        if (insertVariantsError) throw insertVariantsError
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['products'] }),
        queryClient.invalidateQueries({ queryKey: ['product-variants-by-product'] }),
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

  const filteredProducts = (products || []).filter((product) => {
    const stock = inventoryData?.[product.id] || 0
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
                  setEditImageFile(null)
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
                <label className="block text-sm font-medium text-foreground mb-2">Photo produit</label>
                <div className="flex items-center gap-4">
                  <div className="relative flex-shrink-0">
                    {editImageFile && editImageFile.size > 0 ? (
                      <img
                        src={URL.createObjectURL(editImageFile)}
                        alt="Aperçu"
                        className="h-20 w-20 rounded-xl object-cover border-2 border-border shadow-sm"
                      />
                    ) : selectedProductForEdit?.image_url && !editImageFile ? (
                      <img
                        src={getProductImageUrl(selectedProductForEdit.image_url) || ''}
                        alt="Produit"
                        className="h-20 w-20 rounded-xl object-cover border-2 border-border shadow-sm"
                      />
                    ) : (
                      <div className="h-20 w-20 rounded-xl border-2 border-dashed border-border bg-muted/30 flex items-center justify-center text-muted-foreground">
                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                      </div>
                    )}
                  </div>
                  <div className="flex-1">
                    <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-card hover:bg-secondary text-sm font-medium text-foreground transition-colors">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                      {editImageFile && editImageFile.size > 0 ? 'Changer' : 'Télécharger'}
                      <input
                        type="file"
                        accept="image/*"
                        key={editImageFile ? 'has-file' : 'no-file'}
                        onChange={(e) => setEditImageFile(e.target.files?.[0] || null)}
                        className="hidden"
                      />
                    </label>
                    {editImageFile && editImageFile.size > 0 ? (
                      <button
                        type="button"
                        onClick={() => setEditImageFile(null)}
                        className="ml-2 text-sm text-red-600 hover:text-red-700"
                      >
                        Supprimer
                      </button>
                    ) : selectedProductForEdit?.image_url && !editImageFile ? (
                      <button
                        type="button"
                        onClick={() => setEditImageFile(new File([], ''))}
                        className="ml-2 text-sm text-red-600 hover:text-red-700"
                      >
                        Supprimer
                      </button>
                    ) : null}
                    <p className="text-xs text-muted-foreground mt-1.5">PNG, JPG ou WebP. La photo sera stockée dans le bucket `products`.</p>
                  </div>
                </div>
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

              {(editingVariants || []).map((variant, index) => (
                <div key={`edit-variant-${variant.id || 'new'}-${index}`} className="grid grid-cols-1 md:grid-cols-[1.3fr_1fr_0.8fr_0.8fr_auto] gap-3 items-end border rounded-lg p-3">
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Nom variante</label>
                    <input
                      value={variant.name}
                      onChange={(e) =>
                        setEditingVariants((prev) => prev.map((v, i) => (i === index ? { ...v, name: e.target.value } : v)))
                      }
                      className="w-full border rounded-lg px-3 py-2"
                      placeholder="Ex: 1kg, Noir"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">SKU variante</label>
                    <input
                      value={variant.sku}
                      onChange={(e) =>
                        setEditingVariants((prev) => prev.map((v, i) => (i === index ? { ...v, sku: e.target.value } : v)))
                      }
                      className="w-full border rounded-lg px-3 py-2"
                      placeholder="Ex: TSH-001-1KG"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Prix vente</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={variant.selling_price}
                      onChange={(e) =>
                        setEditingVariants((prev) => prev.map((v, i) => (i === index ? { ...v, selling_price: e.target.value } : v)))
                      }
                      className="w-full border rounded-lg px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Coût achat</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={variant.purchase_cost}
                      onChange={(e) =>
                        setEditingVariants((prev) => prev.map((v, i) => (i === index ? { ...v, purchase_cost: e.target.value } : v)))
                      }
                      className="w-full border rounded-lg px-3 py-2"
                    />
                  </div>
                  <div>
                    <button
                      type="button"
                      onClick={() => setEditingVariants((prev) => prev.filter((_, i) => i !== index))}
                      className="px-3 py-2 rounded-lg border text-red-600"
                    >
                      Supprimer
                    </button>
                  </div>
                </div>
              ))}

              <button
                type="button"
                onClick={() => setEditingVariants((prev) => [...prev, { ...EMPTY_VARIANT }])}
                className="text-sm text-primary hover:text-primary/80"
              >
                + Ajouter une variante
              </button>

              {editError ? <div className="text-sm text-red-600">{editError}</div> : null}
            </div>

            <div className="p-6 border-t flex items-center justify-end gap-3 shrink-0 bg-card">
              <button
                type="button"
                onClick={() => {
                  setIsEditOpen(false)
                  setSelectedProductForEdit(null)
                  setEditError('')
                  setEditImageFile(null)
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

              {(editingVariants || []).map((variant, index) => (
                <div key={`${variant.id || 'new'}-${index}`} className="grid grid-cols-1 md:grid-cols-[1.3fr_1fr_0.8fr_0.8fr_auto] gap-3 items-end border rounded-lg p-3">
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Nom variante</label>
                    <input
                      value={variant.name}
                      onChange={(e) =>
                        setEditingVariants((prev) => prev.map((v, i) => (i === index ? { ...v, name: e.target.value } : v)))
                      }
                      className="w-full border rounded-lg px-3 py-2"
                      placeholder="Ex: 1kg, Noir"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">SKU variante</label>
                    <input
                      value={variant.sku}
                      onChange={(e) =>
                        setEditingVariants((prev) => prev.map((v, i) => (i === index ? { ...v, sku: e.target.value } : v)))
                      }
                      className="w-full border rounded-lg px-3 py-2"
                      placeholder="Ex: TSH-001-1KG"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Prix vente</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={variant.selling_price}
                      onChange={(e) =>
                        setEditingVariants((prev) => prev.map((v, i) => (i === index ? { ...v, selling_price: e.target.value } : v)))
                      }
                      className="w-full border rounded-lg px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Coût achat</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={variant.purchase_cost}
                      onChange={(e) =>
                        setEditingVariants((prev) => prev.map((v, i) => (i === index ? { ...v, purchase_cost: e.target.value } : v)))
                      }
                      className="w-full border rounded-lg px-3 py-2"
                    />
                  </div>
                  <div>
                    <button
                      type="button"
                      onClick={() => setEditingVariants((prev) => prev.filter((_, i) => i !== index))}
                      className="px-3 py-2 rounded-lg border text-red-600"
                    >
                      Supprimer
                    </button>
                  </div>
                </div>
              ))}

              <button
                type="button"
                onClick={() => setEditingVariants((prev) => [...prev, { ...EMPTY_VARIANT }])}
                className="text-sm text-primary hover:text-primary/80"
              >
                + Ajouter une variante
              </button>

              {variantsError ? <div className="text-sm text-red-600">{variantsError}</div> : null}
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

                <div className="md:col-span-2">
                  <label className="block text-sm text-foreground mb-1">Photo produit</label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setNewImageFile(e.target.files?.[0] || null)}
                    className="w-full border rounded-lg px-3 py-2"
                  />
                  <p className="text-xs text-muted-foreground mt-1">La photo sera enregistrée dans le bucket Storage `products`.</p>
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

                  <div className="flex items-center justify-between">
                    <label className="block text-sm text-foreground">Variantes (optionnel)</label>
                    <button
                      type="button"
                      onClick={() => setNewVariants((prev) => [...prev, { ...EMPTY_VARIANT }])}
                      className="text-sm text-primary hover:text-primary/80"
                    >
                      + Ajouter
                    </button>
                  </div>

                  {(newVariants || []).map((variant, index) => (
                    <div key={`new-variant-${index}`} className="grid grid-cols-1 md:grid-cols-[1.3fr_1fr_0.8fr_0.8fr_auto] gap-3 items-end">
                      <div>
                        <label className="block text-xs text-muted-foreground mb-1">Nom</label>
                        <input
                          value={variant.name}
                          onChange={(e) =>
                            setNewVariants((prev) => prev.map((v, i) => (i === index ? { ...v, name: e.target.value } : v)))
                          }
                          className="w-full border rounded-lg px-3 py-2"
                          placeholder="Ex: 500g"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-muted-foreground mb-1">SKU</label>
                        <input
                          value={variant.sku}
                          onChange={(e) =>
                            setNewVariants((prev) => prev.map((v, i) => (i === index ? { ...v, sku: e.target.value } : v)))
                          }
                          className="w-full border rounded-lg px-3 py-2"
                          placeholder="Ex: SKU-500G"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-muted-foreground mb-1">Prix</label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={variant.selling_price}
                          onChange={(e) =>
                            setNewVariants((prev) => prev.map((v, i) => (i === index ? { ...v, selling_price: e.target.value } : v)))
                          }
                          className="w-full border rounded-lg px-3 py-2"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-muted-foreground mb-1">Coût</label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={variant.purchase_cost}
                          onChange={(e) =>
                            setNewVariants((prev) => prev.map((v, i) => (i === index ? { ...v, purchase_cost: e.target.value } : v)))
                          }
                          className="w-full border rounded-lg px-3 py-2"
                        />
                      </div>
                      <div>
                        <button
                          type="button"
                          onClick={() => setNewVariants((prev) => prev.filter((_, i) => i !== index))}
                          className="px-3 py-2 rounded-lg border text-red-600"
                        >
                          Supprimer
                        </button>
                      </div>
                    </div>
                  ))}
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
                                  const variants = (variantsByProduct?.[product.id] || []).map((variant: any) => ({
                                    id: variant.id,
                                    name: String(variant.name || ''),
                                    sku: String(variant.sku || ''),
                                    selling_price: String(variant.selling_price ?? 0),
                                    purchase_cost: String(variant.purchase_cost ?? 0),
                                    option_values: variant.option_values || {},
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
                        <td colSpan={10} className="px-6 py-3">
                          <div className="rounded-lg border border-border/70 bg-card overflow-hidden">
                            <table className="min-w-full">
                              <thead className="bg-secondary/60">
                                <tr>
                                  <th className="px-4 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">Variante</th>
                                  <th className="px-4 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">SKU</th>
                                  <th className="px-4 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">Prix</th>
                                  <th className="px-4 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">Coût</th>
                                  <th className="px-4 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">Stock</th>
                                </tr>
                              </thead>
                              <tbody>
                                {productVariants.map((variant: any) => {
                                  const variantStock = Number(variantStockData?.[variant.id] || 0)
                                  return (
                                    <tr key={variant.id} className="border-t border-border/60">
                                      <td className="px-4 py-2 text-sm text-foreground">{String(variant.name || '-')}</td>
                                      <td className="px-4 py-2 text-sm text-muted-foreground">{String(variant.sku || '-')}</td>
                                      <td className="px-4 py-2 text-sm text-foreground">{formatCurrency(Number(variant.selling_price || 0))}</td>
                                      <td className="px-4 py-2 text-sm text-foreground">{formatCurrency(Number(variant.purchase_cost || 0))}</td>
                                      <td className={`px-4 py-2 text-sm font-medium ${variantStock > 0 ? 'text-green-600' : variantStock === 0 ? 'text-yellow-600' : 'text-red-600'}`}>
                                        {variantStock}
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
