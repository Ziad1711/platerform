import type { AnalyticsRange, AssistantIntent } from '@/lib/assistant/types'
import {
  getControlledDynamicDataset,
  getAdsSpend,
  getDashboardKPIs,
  getProfitSummary,
  getRecentOrders,
  getStockSummary,
  getSupplierSummary,
  getTopProducts,
} from '@/lib/assistant/analytics'
import { createClient } from '@/lib/supabase/server'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

export async function buildIntentContext(
  supabase: SupabaseServerClient,
  storeIds: string[],
  intent: AssistantIntent,
  range: AnalyticsRange
) {
  if (intent === 'dashboard_summary') {
    return {
      intent,
      range,
      data: {
        kpis: await getDashboardKPIs(supabase, storeIds, range),
        ads: await getAdsSpend(supabase, storeIds, range),
      },
    }
  }

  if (intent === 'top_products') {
    return {
      intent,
      range,
      data: {
        topProducts: await getTopProducts(supabase, storeIds, range),
        profit: await getProfitSummary(supabase, storeIds, range),
      },
    }
  }

  if (intent === 'ads_analysis') {
    return {
      intent,
      range,
      data: {
        ads: await getAdsSpend(supabase, storeIds, range),
        kpis: await getDashboardKPIs(supabase, storeIds, range),
      },
    }
  }

  if (intent === 'profit_analysis') {
    return {
      intent,
      range,
      data: {
        profit: await getProfitSummary(supabase, storeIds, range),
        topProducts: await getTopProducts(supabase, storeIds, range),
      },
    }
  }

  if (intent === 'stock_analysis') {
    return {
      intent,
      range,
      data: {
        stock: await getStockSummary(supabase, storeIds),
      },
    }
  }

  if (intent === 'supplier_summary') {
    return {
      intent,
      range,
      data: {
        suppliers: await getSupplierSummary(supabase, storeIds),
      },
    }
  }

  if (intent === 'recent_orders') {
    return {
      intent,
      range,
      data: {
        recentOrders: await getRecentOrders(supabase, storeIds, range),
        kpis: await getDashboardKPIs(supabase, storeIds, range),
      },
    }
  }

  if (
    intent === 'comparison_request' ||
    intent === 'chart_request' ||
    intent === 'performance_request' ||
    intent === 'generic_business_chat'
  ) {
    return {
      intent,
      range,
      data: await getControlledDynamicDataset(supabase, storeIds, range),
    }
  }

  return {
    intent,
    range,
    data: {
      kpis: await getDashboardKPIs(supabase, storeIds, range),
      topProducts: await getTopProducts(supabase, storeIds, range),
    },
  }
}
