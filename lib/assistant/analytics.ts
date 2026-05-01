import { createClient } from '@/lib/supabase/server'
import type { AnalyticsRange } from '@/lib/assistant/types'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

type OrderRow = {
  id: string
  store_id?: string
  order_date?: string
  created_at?: string
  status: string | null
  total_selling_price?: number | string | null
  ads_cost_allocated?: number | string | null
  delivery_fee?: number | string | null
  confirmation_cost_allocated?: number | string | null
}

type AmountRow = { amount?: number | string | null }

function applyStoreFilter<T extends { eq: Function; in: Function }>(query: T, storeIds: string[]) {
  if (storeIds.length === 1) {
    return query.eq('store_id', storeIds[0])
  }
  return query.in('store_id', storeIds)
}

function resolveDateRange(range: AnalyticsRange) {
  const now = new Date()

  const getCasablancaDateParts = (date: Date) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Casablanca',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date)

    const year = Number(parts.find((p) => p.type === 'year')?.value || '1970')
    const month = Number(parts.find((p) => p.type === 'month')?.value || '01')
    const day = Number(parts.find((p) => p.type === 'day')?.value || '01')
    return { year, month, day }
  }

  const getOffsetMinutes = (date: Date) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Casablanca',
      timeZoneName: 'shortOffset',
    }).formatToParts(date)

    const tz = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT+0'
    const match = tz.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/) 
    if (!match) return 0
    const sign = match[1] === '-' ? -1 : 1
    const hours = Number(match[2] || 0)
    const minutes = Number(match[3] || 0)
    return sign * (hours * 60 + minutes)
  }

  const buildCasablancaMidnightUtc = (year: number, month: number, day: number) => {
    const approxUtc = new Date(Date.UTC(year, month - 1, day, 0, 0, 0))
    const offsetMinutes = getOffsetMinutes(approxUtc)
    return new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - offsetMinutes * 60 * 1000)
  }

  const todayParts = getCasablancaDateParts(now)
  const todayMidnightUtc = buildCasablancaMidnightUtc(todayParts.year, todayParts.month, todayParts.day)

  const end = new Date(now)
  const start = new Date(now)

  if (range === 'yesterday') {
    const yesterdayMidnightUtc = new Date(todayMidnightUtc)
    yesterdayMidnightUtc.setUTCDate(yesterdayMidnightUtc.getUTCDate() - 1)

    return {
      start: yesterdayMidnightUtc.toISOString(),
      end: todayMidnightUtc.toISOString(),
    }
  }

  if (range === '7d') {
    start.setDate(start.getDate() - 7)
  } else if (range === '30d') {
    start.setDate(start.getDate() - 30)
  } else if (range === 'month') {
    start.setDate(1)
    start.setHours(0, 0, 0, 0)
  } else {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    start.setFullYear(monthStart.getFullYear(), monthStart.getMonth() - 1, 1)
    end.setTime(monthStart.getTime())
  }

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  }
}

export async function getDashboardKPIs(supabase: SupabaseServerClient, storeIds: string[], range: AnalyticsRange) {
  const { start, end } = resolveDateRange(range)

  const [ordersRes, adSpendRes] = await Promise.all([
    applyStoreFilter(
      supabase
        .from('orders')
        .select('id, store_id, order_date, created_at, status, total_selling_price, ads_cost_allocated, delivery_fee, confirmation_cost_allocated')
        .gte('order_date', start)
        .lt('order_date', end),
      storeIds
    ),
    applyStoreFilter(
      supabase
        .from('ad_spend_daily')
        .select('amount')
        .gte('spend_date', start)
        .lt('spend_date', end),
      storeIds
    ),
  ])

  if (ordersRes.error || adSpendRes.error) throw new Error('ANALYTICS_KPI_FAILED')

  const orders = ((ordersRes.data || []) as OrderRow[])
  const adSpendRows = ((adSpendRes.data || []) as AmountRow[])
  const adSpendTotal = adSpendRows.reduce((sum: number, row: AmountRow) => sum + Number(row.amount || 0), 0)

  const totalOrders = orders.length
  const delivered = orders.filter((o: OrderRow) => o.status === 'delivered')
  const deliveredOrders = delivered.length
  const revenue = delivered.reduce((sum: number, o: OrderRow) => sum + Number(o.total_selling_price || 0), 0)
  const allocatedAdCost = orders.reduce((sum: number, o: OrderRow) => sum + Number(o.ads_cost_allocated || 0), 0)
  const adCost = adSpendTotal > 0 ? adSpendTotal : allocatedAdCost
  const deliveryCost = delivered.reduce((sum: number, o: OrderRow) => sum + Number(o.delivery_fee || 0), 0)
  const confirmationCost = delivered.reduce((sum: number, o: OrderRow) => sum + Number(o.confirmation_cost_allocated || 0), 0)

  if (range === 'yesterday') {
    console.info('[assistant:yesterday:orders_rows]', {
      start,
      end,
      rows: orders.map((o: OrderRow) => ({
        id: o.id,
        order_date: (o as any).order_date,
        created_at: (o as any).created_at,
        status: o.status,
        total_selling_price: o.total_selling_price,
        store_id: (o as any).store_id,
      })),
    })
  }

  return {
    range,
    totalOrders,
    deliveredOrders,
    deliveredRate: totalOrders > 0 ? Number(((deliveredOrders / totalOrders) * 100).toFixed(2)) : 0,
    revenue,
    adCost,
    deliveryCost,
    confirmationCost,
  }
}

export async function getTopProducts(supabase: SupabaseServerClient, storeIds: string[], range: AnalyticsRange) {
  const { start, end } = resolveDateRange(range)

  const { data: deliveredOrders, error: ordersError } = await applyStoreFilter(
    supabase
      .from('orders')
      .select('id')
      .eq('status', 'delivered')
      .gte('order_date', start)
      .lt('order_date', end),
    storeIds
  )

  if (ordersError) throw new Error('ANALYTICS_TOP_PRODUCTS_FAILED')

  const deliveredOrderIds = ((deliveredOrders || []) as Array<{ id: string }>).map((o) => o.id)
  if (deliveredOrderIds.length === 0) return []

  let itemsQuery = supabase
    .from('order_items')
    .select('product_id, quantity, unit_selling_price, unit_purchase_cost_snapshot, products(name)')
    .in('order_id', deliveredOrderIds)

  itemsQuery = applyStoreFilter(itemsQuery, storeIds)

  const { data: items, error } = await itemsQuery

  if (error) throw new Error('ANALYTICS_TOP_PRODUCTS_FAILED')

  const map = new Map<string, { productName: string; qty: number; revenue: number; profit: number }>()

  for (const item of items || []) {
    const id = String(item.product_id)
    const qty = Number(item.quantity || 0)
    const price = Number(item.unit_selling_price || 0)
    const cost = Number(item.unit_purchase_cost_snapshot || 0)
    const entry = map.get(id) || {
      productName: (item.products as { name?: string } | null)?.name || 'Produit',
      qty: 0,
      revenue: 0,
      profit: 0,
    }

    entry.qty += qty
    entry.revenue += qty * price
    entry.profit += qty * (price - cost)
    map.set(id, entry)
  }

  return Array.from(map.entries())
    .map(([productId, value]) => ({ productId, ...value }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5)
}

export async function getAdsSpend(supabase: SupabaseServerClient, storeIds: string[], range: AnalyticsRange) {
  const { start, end } = resolveDateRange(range)

  const query = supabase
    .from('ad_spend_daily')
    .select('platform, amount')
    .gte('spend_date', start)
    .lt('spend_date', end)

  const { data, error } = await applyStoreFilter(query, storeIds)

  if (error) throw new Error('ANALYTICS_ADS_FAILED')

  const rows = (data || []) as Array<{ platform?: string | null; amount?: number | string | null }>
  const total = rows.reduce((sum: number, row) => sum + Number(row.amount || 0), 0)
  const byPlatform: Record<string, number> = {}
  for (const row of rows) {
    const key = row.platform || 'unknown'
    byPlatform[key] = (byPlatform[key] || 0) + Number(row.amount || 0)
  }

  return { total, byPlatform }
}

export async function getProfitSummary(supabase: SupabaseServerClient, storeIds: string[], range: AnalyticsRange) {
  const { start, end } = resolveDateRange(range)

  const [ordersRes, adsRes, expensesRes] = await Promise.all([
    applyStoreFilter(
      supabase
        .from('orders')
        .select('id, status, total_selling_price, delivery_fee, confirmation_cost_allocated, ads_cost_allocated')
        .gte('order_date', start)
        .lt('order_date', end),
      storeIds
    ),
    applyStoreFilter(
      supabase
        .from('ad_spend_daily')
        .select('amount')
        .gte('spend_date', start)
        .lt('spend_date', end),
      storeIds
    ),
    applyStoreFilter(
      supabase
        .from('expenses')
        .select('amount')
        .gte('expense_date', start)
        .lt('expense_date', end),
      storeIds
    ),
  ])

  if (ordersRes.error || adsRes.error || expensesRes.error) {
    throw new Error('ANALYTICS_PROFIT_FAILED')
  }

  const ordersRows = ((ordersRes.data || []) as OrderRow[])
  const adsRows = ((adsRes.data || []) as AmountRow[])
  const expensesRows = ((expensesRes.data || []) as AmountRow[])

  const delivered = ordersRows.filter((o: OrderRow) => o.status === 'delivered')
  const deliveredOrderIds = delivered.map((o) => o.id)

  let purchaseCost = 0
  if (deliveredOrderIds.length > 0) {
    let orderItemsQuery = supabase
      .from('order_items')
      .select('quantity, unit_purchase_cost_snapshot')
      .in('order_id', deliveredOrderIds)

    orderItemsQuery = applyStoreFilter(orderItemsQuery, storeIds)

    const { data: orderItems, error: orderItemsError } = await orderItemsQuery
    if (orderItemsError) throw new Error('ANALYTICS_PROFIT_FAILED')

    purchaseCost = (orderItems || []).reduce(
      (sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_purchase_cost_snapshot || 0),
      0
    )
  }

  const revenue = delivered.reduce((sum: number, o: OrderRow) => sum + Number(o.total_selling_price || 0), 0)
  const adSpendDaily = adsRows.reduce((sum: number, row: AmountRow) => sum + Number(row.amount || 0), 0)
  const allocatedAdCost = ordersRows.reduce((sum: number, o: OrderRow) => sum + Number(o.ads_cost_allocated || 0), 0)
  const adSpend = adSpendDaily > 0 ? adSpendDaily : allocatedAdCost
  const extraExpenses = expensesRows.reduce((sum: number, row: AmountRow) => sum + Number(row.amount || 0), 0)
  const deliveryCost = delivered.reduce((sum: number, o: OrderRow) => sum + Number(o.delivery_fee || 0), 0)
  const confirmationCost = delivered.reduce((sum: number, o: OrderRow) => sum + Number(o.confirmation_cost_allocated || 0), 0)

  const profit = revenue - purchaseCost - adSpend - extraExpenses - deliveryCost - confirmationCost

  return {
    revenue,
    purchaseCost,
    adSpend,
    extraExpenses,
    deliveryCost,
    confirmationCost,
    profit,
    marginRate: revenue > 0 ? Number(((profit / revenue) * 100).toFixed(2)) : 0,
  }
}

export async function getRecentOrders(supabase: SupabaseServerClient, storeIds: string[], range: AnalyticsRange) {
  const { start, end } = resolveDateRange(range)

  const query = supabase
    .from('orders')
    .select('id, customer_name, status, total_selling_price, order_date')
    .gte('order_date', start)
    .lt('order_date', end)
    .order('order_date', { ascending: false })
    .limit(8)

  const { data, error } = await applyStoreFilter(query, storeIds)

  if (error) throw new Error('ANALYTICS_ORDERS_FAILED')

  return data || []
}

export async function getStockSummary(supabase: SupabaseServerClient, storeIds: string[]) {
  const query = supabase
    .from('inventory_movements')
    .select('product_id, movement_type, quantity, products(name)')

  const { data, error } = await applyStoreFilter(query, storeIds)

  if (error) throw new Error('ANALYTICS_STOCK_FAILED')

  const map = new Map<string, { productName: string; inQty: number; outQty: number; stock: number }>()

  for (const row of data || []) {
    const productId = String(row.product_id)
    const qty = Number(row.quantity || 0)
    const entry = map.get(productId) || {
      productName: (row.products as { name?: string } | null)?.name || 'Produit',
      inQty: 0,
      outQty: 0,
      stock: 0,
    }

    if (row.movement_type === 'in') entry.inQty += qty
    if (row.movement_type === 'out') entry.outQty += qty
    if (row.movement_type === 'adjustment') {
      entry.stock += qty
    }

    entry.stock = entry.inQty - entry.outQty + entry.stock
    map.set(productId, entry)
  }

  const rows = Array.from(map.entries()).map(([productId, item]) => ({ productId, ...item }))
  const lowStock = rows.filter((r) => r.stock <= 5).length

  return {
    totalProducts: rows.length,
    lowStock,
    items: rows.sort((a, b) => a.stock - b.stock).slice(0, 10),
  }
}

export async function getSupplierSummary(supabase: SupabaseServerClient, storeIds: string[]) {
  const [suppliersRes, ledgerRes] = await Promise.all([
    applyStoreFilter(supabase.from('suppliers').select('id, name'), storeIds),
    applyStoreFilter(supabase.from('supplier_ledger').select('supplier_id, entry_type, amount'), storeIds),
  ])

  if (suppliersRes.error || ledgerRes.error) {
    throw new Error('ANALYTICS_SUPPLIERS_FAILED')
  }

  const debtBySupplier: Record<string, number> = {}
  for (const row of (ledgerRes.data || []) as Array<{ supplier_id: string; entry_type: string | null; amount?: number | string | null }>) {
    const supplierId = String(row.supplier_id)
    const amount = Number(row.amount || 0)
    const signed = row.entry_type === 'debit' ? amount : -amount
    debtBySupplier[supplierId] = (debtBySupplier[supplierId] || 0) + signed
  }

  const suppliers = ((suppliersRes.data || []) as Array<{ id: string; name: string | null }>).map((s) => ({
    supplierId: s.id,
    name: s.name,
    balance: Number((debtBySupplier[s.id] || 0).toFixed(2)),
  }))

  return {
    totalSuppliers: suppliers.length,
    topDebts: suppliers.sort((a, b) => b.balance - a.balance).slice(0, 5),
  }
}

export async function getDailyRevenueTrend(supabase: SupabaseServerClient, storeIds: string[], range: AnalyticsRange) {
  const { start, end } = resolveDateRange(range)
  const query = supabase
    .from('orders')
    .select('order_date, total_selling_price, status')
    .gte('order_date', start)
    .lt('order_date', end)

  const { data, error } = await applyStoreFilter(query, storeIds)
  if (error) throw new Error('ANALYTICS_REVENUE_TREND_FAILED')

  const byDate: Record<string, number> = {}
  for (const row of (data || []) as Array<{ order_date: string; total_selling_price?: number | string | null; status?: string | null }>) {
    if (row.status !== 'delivered') continue
    const key = new Date(String(row.order_date)).toISOString().slice(0, 10)
    byDate[key] = (byDate[key] || 0) + Number(row.total_selling_price || 0)
  }

  return Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, revenue]) => ({ date, revenue: Number(Number(revenue).toFixed(2)) }))
}

export async function getOrdersByStatus(supabase: SupabaseServerClient, storeIds: string[], range: AnalyticsRange) {
  const { start, end } = resolveDateRange(range)
  const query = supabase
    .from('orders')
    .select('status')
    .gte('order_date', start)
    .lt('order_date', end)

  const { data, error } = await applyStoreFilter(query, storeIds)
  if (error) throw new Error('ANALYTICS_ORDERS_STATUS_FAILED')

  const summary: Record<string, number> = {}
  for (const row of (data || []) as Array<{ status?: string | null }>) {
    const status = row.status || 'unknown'
    summary[status] = (summary[status] || 0) + 1
  }

  return summary
}

export async function getExpensesByCategory(supabase: SupabaseServerClient, storeIds: string[], range: AnalyticsRange) {
  const { start, end } = resolveDateRange(range)
  const query = supabase
    .from('expenses')
    .select('amount, expense_categories(name)')
    .gte('expense_date', start)
    .lt('expense_date', end)

  const { data, error } = await applyStoreFilter(query, storeIds)
  if (error) throw new Error('ANALYTICS_EXPENSES_CATEGORY_FAILED')

  const byCategory: Record<string, number> = {}
  for (const row of (data || []) as Array<{ amount?: number | string | null; expense_categories?: { name?: string | null } | null }>) {
    const name = row?.expense_categories?.name || 'Autres'
    byCategory[name] = (byCategory[name] || 0) + Number(row.amount || 0)
  }

  return byCategory
}

export async function getControlledDynamicDataset(supabase: SupabaseServerClient, storeIds: string[], range: AnalyticsRange) {
  const [kpis, profit, ads, topProducts, recentOrders, stock, suppliers, dailyRevenue, ordersStatus, expensesByCategory] =
    await Promise.all([
      getDashboardKPIs(supabase, storeIds, range),
      getProfitSummary(supabase, storeIds, range),
      getAdsSpend(supabase, storeIds, range),
      getTopProducts(supabase, storeIds, range),
      getRecentOrders(supabase, storeIds, range),
      getStockSummary(supabase, storeIds),
      getSupplierSummary(supabase, storeIds),
      getDailyRevenueTrend(supabase, storeIds, range),
      getOrdersByStatus(supabase, storeIds, range),
      getExpensesByCategory(supabase, storeIds, range),
    ])

  return {
    kpis,
    profit,
    ads,
    topProducts,
    recentOrders,
    stock,
    suppliers,
    dailyRevenue,
    ordersStatus,
    expensesByCategory,
  }
}
