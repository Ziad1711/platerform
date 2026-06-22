import { listYouCanOrders, listYouCanProducts } from '@/lib/integrations/youcan'
type SupabaseAdmin = any

function parseDate(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function normalizeAddressNode(value: any) {
  if (!value) return null

  if (Array.isArray(value)) {
    const firstObject = value.find((item) => item && typeof item === 'object' && !Array.isArray(item))
    return firstObject || null
  }

  if (typeof value === 'object') {
    return value
  }

  return null
}

function isMeaningfulAddress(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length === 0) return false

  // Reject values that are only punctuation, whitespace, or separators
  // e.g. ",", ", ", " ,", " - ", etc.
  const onlyPunctuation = /^[\s,;\-./\\|_]+$/.test(trimmed)
  if (onlyPunctuation) return false

  // Must contain at least one alphanumeric character (including Unicode/arabic)
  // to be meaningful. \p{L} matches any Unicode letter, \p{N} any Unicode number.
  return /[\p{L}\p{N}]/u.test(trimmed)
}

/** Generic: picks the first non-blank string from a list. No address-specific validation. */
function pickFirstNonBlankString(...values: any[]) {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const normalized = value.trim()
    if (normalized.length > 0) return normalized
  }

  return null
}

/** Address-specific: picks the first string that passes isMeaningfulAddress. */
function pickFirstNonEmptyAddress(...values: any[]) {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const normalized = value.trim()
    if (normalized.length > 0 && isMeaningfulAddress(normalized)) return normalized
  }

  return null
}

function pickAddressLine(addressNode: any) {
  if (!addressNode || typeof addressNode !== 'object') return null

  const extraFields =
    addressNode?.extra_fields && typeof addressNode.extra_fields === 'object'
      ? addressNode.extra_fields
      : null

  return pickFirstNonEmptyAddress(
    addressNode?.first_line,
    addressNode?.second_line,
    addressNode?.address,
    addressNode?.line1,
    addressNode?.line_1,
    addressNode?.street,
    addressNode?.full_address,
    addressNode?.Adresse,
    extraFields?.Adresse,
    extraFields?.address,
    extraFields?.line1,
    extraFields?.street,
    addressNode?.location
  )
}

function normalizeVariantSku(variant: any, youcanVariantId: string) {
  const rawSku = String(variant?.sku || '').trim()
  if (rawSku) return rawSku
  return `youcan:${youcanVariantId}`
}

function getVariantOptionValues(variant: any) {
  const raw = variant?.variations
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}

  const normalizedEntries = Object.entries(raw as Record<string, any>)
    .map(([key, value]) => [String(key || '').trim(), String(value || '').trim()] as const)
    .filter(([key, value]) => key.length > 0 && value.length > 0)
    .filter(([key, value]) => {
      const k = key.toLowerCase()
      const v = value.toLowerCase()

      // Placeholder YouCan variant: { Title: "Default Title" } / { title: "default" }
      if (k === 'default' && v === 'default') return false
      if (k === 'title' && (v === 'default' || v === 'default title')) return false
      return true
    })

  return Object.fromEntries(normalizedEntries)
}

function buildVariantDisplayName(variant: any) {
  const explicitName = String(variant?.name || '').trim()
  if (explicitName) return explicitName

  const optionValues = getVariantOptionValues(variant)
  const pairs = Object.entries(optionValues)
    .map(([key, value]) => `${String(key || '').trim()}: ${String(value || '').trim()}`)
    .filter((entry) => !entry.endsWith(':'))

  if (pairs.length > 0) return pairs.join(' / ')
  return 'Default'
}

function shouldImportProductVariant(variant: any, totalVariants: number) {
  if (totalVariants > 1) return true

  const optionValues = getVariantOptionValues(variant)
  return Object.keys(optionValues).length > 0
}

async function upsertProductFromYouCan(params: {
  supabase: SupabaseAdmin
  integrationId: string
  userId: string
  storeId: string
  product: any
}) {
  const { supabase, integrationId, userId, storeId, product } = params

  const youcanProductId = String(product?.id || '')
  if (!youcanProductId) return null

  const { data: existingMap } = await supabase
    .from('youcan_entity_mappings')
    .select('internal_id')
    .eq('integration_id', integrationId)
    .eq('entity_type', 'product')
    .eq('youcan_id', youcanProductId)
    .maybeSingle()

  const defaultSellingPrice = Number(product?.price || 0)
  const defaultPurchaseCost = Number(product?.cost_price || 0)

  let productId = existingMap?.internal_id || null
  if (productId) {
    const { data: existingProduct } = await supabase
      .from('products')
      .select('id')
      .eq('id', productId)
      .maybeSingle()

    if (!existingProduct) {
      productId = null
    }
  }

  if (!productId) {
    const { data: inserted, error } = await supabase
      .from('products')
      .insert({
        store_id: storeId,
        name: String(product?.name || 'Produit YouCan'),
        sku: null,
        default_selling_price: Number.isFinite(defaultSellingPrice) ? defaultSellingPrice : 0,
        default_purchase_cost: Number.isFinite(defaultPurchaseCost) ? defaultPurchaseCost : 0,
        image_url: product?.thumbnail ? String(product.thumbnail) : null,
      })
      .select('id')
      .single()

    if (error) throw error
    productId = inserted.id
  } else {
    await supabase
      .from('products')
      .update({
        name: String(product?.name || 'Produit YouCan'),
        default_selling_price: Number.isFinite(defaultSellingPrice) ? defaultSellingPrice : 0,
        default_purchase_cost: Number.isFinite(defaultPurchaseCost) ? defaultPurchaseCost : 0,
        image_url: product?.thumbnail ? String(product.thumbnail) : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', productId)
  }

  await supabase.from('youcan_entity_mappings').upsert(
    {
      user_id: userId,
      integration_id: integrationId,
      store_id: storeId,
      entity_type: 'product',
      youcan_id: youcanProductId,
      internal_id: productId,
      payload: product,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'integration_id,entity_type,youcan_id' }
  )

  return { productId, youcanProductId }
}

async function upsertVariantFromYouCan(params: {
  supabase: SupabaseAdmin
  integrationId: string
  userId: string
  storeId: string
  productId: string
  variant: any
  allowWithoutOptions?: boolean
}) {
  const { supabase, integrationId, userId, storeId, productId, variant, allowWithoutOptions = false } = params

  const youcanVariantId = String(variant?.id || '')
  if (!youcanVariantId) return null

  const { data: existingMap } = await supabase
    .from('youcan_entity_mappings')
    .select('internal_id')
    .eq('integration_id', integrationId)
    .eq('entity_type', 'variant')
    .eq('youcan_id', youcanVariantId)
    .maybeSingle()

  const sellingPrice = Number(variant?.price || 0)
  const purchaseCost = Number(variant?.cost_price || 0)
  const sku = normalizeVariantSku(variant, youcanVariantId)
  const optionValues = getVariantOptionValues(variant)
  if (!allowWithoutOptions && Object.keys(optionValues).length === 0) {
    return null
  }
  const variantName = buildVariantDisplayName(variant)

  const { data: existingProduct } = await supabase
    .from('products')
    .select('id')
    .eq('id', productId)
    .maybeSingle()

  if (!existingProduct) {
    throw new Error(`PRODUCT_NOT_FOUND_FOR_VARIANT:${productId}`)
  }

  let variantId = existingMap?.internal_id || null
  if (variantId) {
    const { data: existingVariant } = await supabase
      .from('product_variants')
      .select('id')
      .eq('id', variantId)
      .maybeSingle()

    if (!existingVariant) {
      variantId = null
    }
  }

  if (!variantId) {
    const { data: existingBySku } = await supabase
      .from('product_variants')
      .select('id')
      .eq('product_id', productId)
      .eq('sku', sku)
      .maybeSingle()

    variantId = existingBySku?.id || null
  }

  if (!variantId) {
    const { data: inserted, error } = await supabase
      .from('product_variants')
      .insert({
        store_id: storeId,
        product_id: productId,
        name: variantName,
        sku,
        selling_price: Number.isFinite(sellingPrice) ? sellingPrice : 0,
        purchase_cost: Number.isFinite(purchaseCost) ? purchaseCost : 0,
        option_values: optionValues,
      })
      .select('id')
      .single()

    if (error) throw error
    variantId = inserted.id
  } else {
    await supabase
      .from('product_variants')
      .update({
        product_id: productId,
        name: variantName,
        sku,
        selling_price: Number.isFinite(sellingPrice) ? sellingPrice : 0,
        purchase_cost: Number.isFinite(purchaseCost) ? purchaseCost : 0,
        option_values: optionValues,
        updated_at: new Date().toISOString(),
      })
      .eq('id', variantId)
  }

  await supabase.from('youcan_entity_mappings').upsert(
    {
      user_id: userId,
      integration_id: integrationId,
      store_id: storeId,
      entity_type: 'variant',
      youcan_id: youcanVariantId,
      internal_id: variantId,
      payload: variant,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'integration_id,entity_type,youcan_id' }
  )

  return { variantId, youcanVariantId }
}

export async function importYouCanProducts(params: {
  supabase: SupabaseAdmin
  integrationId: string
  userId: string
  storeId: string
  accessToken: string
}) {
  const { supabase, integrationId, userId, storeId, accessToken } = params

  let page = 1
  let imported = 0

  while (true) {
    const payload = await listYouCanProducts({ accessToken, page })
    const products = payload.data || []

    for (const product of products) {
      const upsertedProduct = await upsertProductFromYouCan({
        supabase,
        integrationId,
        userId,
        storeId,
        product,
      })

      const productId = upsertedProduct?.productId
      if (!productId) continue

      const rawVariants = Array.isArray(product?.variants) ? product.variants : []
      const variants = rawVariants.filter((variant: any) =>
        shouldImportProductVariant(variant, rawVariants.length)
      )
      for (const variant of variants) {
        await upsertVariantFromYouCan({
          supabase,
          integrationId,
          userId,
          storeId,
          productId,
          variant,
          allowWithoutOptions: rawVariants.length > 1,
        })
      }

      imported += 1
    }

    const totalPages = Number(payload.meta?.pagination?.total_pages || 1)
    if (page >= totalPages) break
    page += 1
  }

  return imported
}

async function resolveInternalVariantAndProduct(params: {
  supabase: SupabaseAdmin
  integrationId: string
  storeId: string
  userId: string
  line: any
}) {
  const { supabase, integrationId, storeId, userId, line } = params
  const variantNode = line?.variant || {}
  const productNode = variantNode?.product || {}

  const youcanVariantId = String(variantNode?.id || line?.id || '')
  const youcanProductId = String(productNode?.id || '')
  const hasRealVariations = Object.keys(getVariantOptionValues({ variations: variantNode?.variations })).length > 0

  let internalProductId: string | null = null
  let internalVariantId: string | null = null

  if (youcanProductId) {
    const { data: productMap } = await supabase
      .from('youcan_entity_mappings')
      .select('internal_id')
      .eq('integration_id', integrationId)
      .eq('entity_type', 'product')
      .eq('youcan_id', youcanProductId)
      .maybeSingle()
    internalProductId = productMap?.internal_id || null
  }

  if (youcanVariantId && hasRealVariations) {
    const { data: variantMap } = await supabase
      .from('youcan_entity_mappings')
      .select('internal_id')
      .eq('integration_id', integrationId)
      .eq('entity_type', 'variant')
      .eq('youcan_id', youcanVariantId)
      .maybeSingle()
    internalVariantId = variantMap?.internal_id || null

    // Auto-repair: if the mapped variant no longer exists in product_variants,
    // reset the mapping to null so it gets rebuilt
    if (internalVariantId) {
      const { data: existingVariant } = await supabase
        .from('product_variants')
        .select('id')
        .eq('id', internalVariantId)
        .maybeSingle()

      if (!existingVariant) {
        // Stale mapping — clear it so upsertVariantFromYouCan will recreate
        await supabase
          .from('youcan_entity_mappings')
          .update({ internal_id: null, updated_at: new Date().toISOString() })
          .eq('integration_id', integrationId)
          .eq('entity_type', 'variant')
          .eq('youcan_id', youcanVariantId)

        internalVariantId = null
      }
    }
  }

  if (!internalProductId) {
    const upsertedProduct = await upsertProductFromYouCan({
      supabase,
      integrationId,
      userId,
      storeId,
      product: {
        id: youcanProductId || `fallback-${youcanVariantId}`,
        name: String(productNode?.name || 'Produit YouCan'),
        price: Number(line?.price || variantNode?.price || 0),
        cost_price: Number(variantNode?.cost_price || 0),
        thumbnail: productNode?.thumbnail || null,
      },
    })
    internalProductId = upsertedProduct?.productId || null
  }

  if (!internalVariantId && internalProductId && youcanVariantId && hasRealVariations) {
    const upsertedVariant = await upsertVariantFromYouCan({
      supabase,
      integrationId,
      userId,
      storeId,
      productId: internalProductId,
      variant: {
        id: youcanVariantId,
            name: variantNode?.name || 'Default',
        sku: variantNode?.sku || '',
        price: Number(line?.price || variantNode?.price || 0),
        cost_price: Number(variantNode?.cost_price || 0),
        variations: variantNode?.variations || {},
      },
    })
    internalVariantId = upsertedVariant?.variantId || null
  }

  return { internalProductId, internalVariantId, youcanVariantId }
}

export async function upsertYouCanOrderFromPayload(params: {
  supabase: SupabaseAdmin
  integrationId: string
  userId: string
  storeId: string
  order: any
  sinceDate?: string
}) {
  const { supabase, integrationId, userId, storeId, order, sinceDate } = params

  const createdAt = String(order?.created_at || '')
  const since = parseDate(sinceDate)
  const orderCreatedAt = parseDate(createdAt)
  if (since && orderCreatedAt && orderCreatedAt < since) {
    return { skipped: true }
  }

  const youcanOrderId = String(order?.id || '')
  if (!youcanOrderId) return { skipped: true }

  const { data: existingOrderMap } = await supabase
    .from('youcan_entity_mappings')
    .select('internal_id')
    .eq('integration_id', integrationId)
    .eq('entity_type', 'order')
    .eq('youcan_id', youcanOrderId)
    .maybeSingle()

  const customer = order?.customer || {}
  const shipping = order?.shipping || {}
  const payment = order?.payment || {}
  const shippingAddress = normalizeAddressNode(shipping?.address)
  const paymentAddress = normalizeAddressNode(payment?.address)
  const customerAddress = normalizeAddressNode(customer?.address)

  const customerNameFromFirstAndLast = `${String(customer?.first_name || '').trim()} ${String(customer?.last_name || '').trim()}`.trim()
  const customerName =
    pickFirstNonBlankString(customerNameFromFirstAndLast, customer?.full_name) || 'Client YouCan'

  const phone = pickFirstNonBlankString(
    customer?.phone,
    shippingAddress?.phone,
    paymentAddress?.phone,
    customerAddress?.phone
  )

  const address = pickFirstNonEmptyAddress(
    pickAddressLine(shippingAddress),
    pickAddressLine(paymentAddress),
    pickAddressLine(customerAddress)
  )

  const city = pickFirstNonBlankString(
    shippingAddress?.city,
    paymentAddress?.city,
    customerAddress?.city,
    customer?.city
  )

  const total = Number(order?.total || 0)
  const shippingPrice = Number(shipping?.price || 0)

  let internalOrderId = existingOrderMap?.internal_id || null
  if (internalOrderId) {
    const { data: existingOrderRow } = await supabase
      .from('orders')
      .select('id')
      .eq('id', internalOrderId)
      .maybeSingle()

    if (!existingOrderRow) {
      internalOrderId = null
    }
  }

  if (!internalOrderId) {
    const { data: insertedOrder, error: insertOrderError } = await supabase
      .from('orders')
      .insert({
        store_id: storeId,
        customer_name: customerName,
        phone,
        address,
        city: city,
        status: 'new',
        order_date: orderCreatedAt ? orderCreatedAt.toISOString() : new Date().toISOString(),
        total_selling_price: Number.isFinite(total) ? total : 0,
        delivery_charge_to_customer: Number.isFinite(shippingPrice) ? shippingPrice : 0,
        source: 'ads',
      })
      .select('id')
      .single()

    if (insertOrderError) throw insertOrderError
    internalOrderId = insertedOrder.id
  } else {
    const orderUpdatePayload: Record<string, any> = {
      customer_name: customerName,
      phone,
      source: 'ads',
      total_selling_price: Number.isFinite(total) ? total : 0,
      delivery_charge_to_customer: Number.isFinite(shippingPrice) ? shippingPrice : 0,
      updated_at: new Date().toISOString(),
    }

    if (address) {
      orderUpdatePayload.address = address
    }

    if (city) {
      orderUpdatePayload.city = city
    }

    await supabase
      .from('orders')
      .update(orderUpdatePayload)
      .eq('id', internalOrderId)

    await supabase.from('order_items').delete().eq('order_id', internalOrderId)
  }

  const lines = Array.isArray(order?.variants) ? order.variants : []
  const orderItems: any[] = []

  for (const line of lines) {
    const quantity = Number(line?.quantity || 1)
    const price = Number(line?.price || 0)
    const resolved = await resolveInternalVariantAndProduct({
      supabase,
      integrationId,
      storeId,
      userId,
      line,
    })

    if (!resolved.internalProductId) continue

    orderItems.push({
      store_id: storeId,
      order_id: internalOrderId,
      product_id: resolved.internalProductId,
      product_variant_id: resolved.internalVariantId,
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
      unit_selling_price: Number.isFinite(price) ? price : 0,
      unit_purchase_cost_snapshot: 0,
      item_type: 'product',
    })
  }

  if (orderItems.length > 0) {
    const { error: itemsError } = await supabase.from('order_items').insert(orderItems)
    if (itemsError) {
      // Cleanup: if this is a newly created order and items failed, remove the orphan order
      if (!existingOrderMap?.internal_id) {
        await supabase.from('orders').delete().eq('id', internalOrderId)
      }
      throw itemsError
    }
  }

  await supabase.from('youcan_entity_mappings').upsert(
    {
      user_id: userId,
      integration_id: integrationId,
      store_id: storeId,
      entity_type: 'order',
      youcan_id: youcanOrderId,
      internal_id: internalOrderId,
      payload: order,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'integration_id,entity_type,youcan_id' }
  )

  return { skipped: false, internalOrderId }
}

export async function importYouCanOrders(params: {
  supabase: SupabaseAdmin
  integrationId: string
  userId: string
  storeId: string
  accessToken: string
  sinceDate: string
}) {
  const { supabase, integrationId, userId, storeId, accessToken, sinceDate } = params

  let page = 1
  let imported = 0

  while (true) {
    const payload = await listYouCanOrders({ accessToken, page })
    const orders = payload.data || []

    for (const order of orders) {
      const result = await upsertYouCanOrderFromPayload({
        supabase,
        integrationId,
        userId,
        storeId,
        order,
        sinceDate,
      })
      if (!result.skipped) imported += 1
    }

    const totalPages = Number(payload.meta?.pagination?.total_pages || 1)
    if (page >= totalPages) break
    page += 1
  }

  return imported
}
