import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuthenticatedUser } from '@/lib/assistant/security'

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuthenticatedUser()
    const { searchParams } = new URL(request.url)

    const storeId = searchParams.get('storeId')
    const productId = searchParams.get('productId')
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const groupBy = searchParams.get('groupBy') || 'day'

    if (!storeId) {
      return NextResponse.json({ error: 'storeId is required' }, { status: 400 })
    }

    const admin = createAdminClient()

    // Date par défaut : 1er janvier de l'année en cours
    const currentYear = new Date().getFullYear()
    const defaultFrom = `${currentYear}-01-01`
    const defaultTo = new Date().toISOString().split('T')[0]

    const dateFrom = from || defaultFrom
    const dateTo = to || defaultTo

    // Vérifier que l'utilisateur a accès au store
    const { data: member } = await admin
      .from('store_members')
      .select('store_id')
      .eq('user_id', user.id)
      .eq('store_id', storeId)
      .maybeSingle()

    if (!member) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Requête de base
    let query = admin
      .from('ad_spend_daily')
      .select('*')
      .eq('store_id', storeId)
      .eq('platform', 'facebook')
      .gte('spend_date', `${dateFrom}T00:00:00.000Z`)
      .lte('spend_date', `${dateTo}T23:59:59.000Z`)

    if (productId) {
      query = query.eq('product_id', productId)
    }

    const { data: rows, error } = await query.order('spend_date', { ascending: true })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Fonction pour grouper par semaine ISO
    function getWeekKey(dateStr: string): string {
      const d = new Date(dateStr + 'T00:00:00Z')
      const dayNum = d.getUTCDay() || 7
      d.setUTCDate(d.getUTCDate() + 4 - dayNum)
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
      const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
      return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
    }

    // Fonction pour obtenir la clé de groupement
    function getGroupKey(dateStr: string): string {
      if (groupBy === 'week') return getWeekKey(dateStr)
      if (groupBy === 'month') return dateStr.slice(0, 7)
      return dateStr.slice(0, 10)
    }

    // Calcul du résumé
    const summary = {
      totalSpend: 0,
      totalSpendConverted: 0,
      totalImpressions: 0,
      totalClicks: 0,
      totalReach: 0,
      totalConversions: 0,
      totalConversionValue: 0,
      totalConversionValueConverted: 0,
      totalPurchases: 0,
      totalAddToCart: 0,
      totalInitiateCheckout: 0,
      avgCTR: 0,
      avgCPC: 0,
      avgCPM: 0,
      avgFrequency: 0,
      roas: 0,
      daysWithData: 0,
    }


    const byProduct = new Map<string, {
      productId: string
      productName: string
      spend: number
      impressions: number
      clicks: number
      conversions: number
      conversionValue: number
      purchases: number
    }>()

    const byCampaign = new Map<string, {
      campaignId: string
      campaignName: string
      productId: string
      productName: string
      spend: number
      impressions: number
      clicks: number
      ctr: number
      conversions: number
      conversionValue: number
      purchases: number
      cpc: number
      cpm: number
      days: number
    }>()

    const timeSeries = new Map<string, {
      date: string
      spend: number
      impressions: number
      clicks: number
      reach: number
      conversions: number
      conversionValue: number
      purchases: number
      ctr: number
      cpc: number
      cpm: number
    }>()

    const rowsArray = (rows || []) as any[]
    let ctrSum = 0
    let ctrCount = 0

    for (const row of rowsArray) {
      const dateKey = row.spend_date?.slice(0, 10) || ''

      // Summary
      summary.totalSpend += Number(row.spend || 0)
      summary.totalSpendConverted += Number(row.spend_converted || 0)
      summary.totalImpressions += Number(row.impressions || 0)
      summary.totalClicks += Number(row.clicks || 0)
      summary.totalReach += Number(row.reach || 0)
      summary.totalPurchases += Number(row.purchases || 0)
      summary.totalAddToCart += Number(row.add_to_cart || 0)
      summary.totalInitiateCheckout += Number(row.initiate_checkout || 0)
      summary.totalConversionValue += Number(row.conversion_value || 0)
      summary.totalConversionValueConverted += Number(row.conversion_value_converted || 0)
      summary.totalConversions += Number(row.actions_total || 0)


      if (Number(row.ctr || 0) > 0) {
        ctrSum += Number(row.ctr)
        ctrCount++
      }

      // Time series (avec groupBy)
      const groupKey = getGroupKey(dateKey)
      if (dateKey) {
        const existing = timeSeries.get(groupKey) || {
          date: groupKey,
          spend: 0,
          impressions: 0,
          clicks: 0,
          reach: 0,
          conversions: 0,
          conversionValue: 0,
          purchases: 0,
          ctr: 0,
          cpc: 0,
          cpm: 0,
        }
        existing.spend += Number(row.spend_converted || 0)
        existing.impressions += Number(row.impressions || 0)
        existing.clicks += Number(row.clicks || 0)
        existing.reach += Number(row.reach || 0)
        existing.conversions += Number(row.actions_total || 0)
        existing.conversionValue += Number(row.conversion_value_converted || 0)
        existing.purchases += Number(row.purchases || 0)
        if (Number(row.ctr || 0) > 0) existing.ctr = Number(row.ctr)
        if (Number(row.cpc || 0) > 0) existing.cpc = Number(row.cpc)
        if (Number(row.cpm || 0) > 0) existing.cpm = Number(row.cpm)
        timeSeries.set(groupKey, existing)
      }

      // By product
      const pid = row.product_id || 'unknown'
      if (!byProduct.has(pid)) {
        byProduct.set(pid, {
          productId: pid,
          productName: row.campaign_name || 'Inconnu',
          spend: 0,
          impressions: 0,
          clicks: 0,
          conversions: 0,
          conversionValue: 0,
          purchases: 0,
        })
      }
      const prod = byProduct.get(pid)!
      prod.spend += Number(row.spend_converted || 0)
      prod.impressions += Number(row.impressions || 0)
      prod.clicks += Number(row.clicks || 0)
      prod.conversions += Number(row.actions_total || 0)
      prod.conversionValue += Number(row.conversion_value_converted || 0)
      prod.purchases += Number(row.purchases || 0)

      // By campaign
      const cid = row.external_campaign_id || 'unknown'
      if (!byCampaign.has(cid)) {
        byCampaign.set(cid, {
          campaignId: cid,
          campaignName: row.campaign_name || 'Inconnu',
          productId: pid,
          productName: row.campaign_name || 'Inconnu',
          spend: 0,
          impressions: 0,
          clicks: 0,
          ctr: 0,
          conversions: 0,
          conversionValue: 0,
          purchases: 0,
          cpc: 0,
          cpm: 0,
          days: 0,
        })
      }
      const camp = byCampaign.get(cid)!
      camp.spend += Number(row.spend_converted || 0)
      camp.impressions += Number(row.impressions || 0)
      camp.clicks += Number(row.clicks || 0)
      camp.conversions += Number(row.actions_total || 0)
      camp.conversionValue += Number(row.conversion_value_converted || 0)
      camp.purchases += Number(row.purchases || 0)
      if (Number(row.ctr || 0) > 0) camp.ctr = Number(row.ctr)
      if (Number(row.cpc || 0) > 0) camp.cpc = Number(row.cpc)
      if (Number(row.cpm || 0) > 0) camp.cpm = Number(row.cpm)
      camp.days++
    }

    // Calcul des moyennes (basé sur les valeurs converties en MAD)
    summary.avgCTR = ctrCount > 0 ? +(ctrSum / ctrCount).toFixed(4) : 0
    summary.avgCPC = summary.totalClicks > 0 ? +(summary.totalSpendConverted / summary.totalClicks).toFixed(4) : 0
    summary.avgCPM = summary.totalImpressions > 0 ? +((summary.totalSpendConverted / summary.totalImpressions) * 1000).toFixed(4) : 0
    summary.avgFrequency = summary.totalReach > 0 ? +(summary.totalImpressions / summary.totalReach).toFixed(2) : 0
    summary.roas = summary.totalSpendConverted > 0 ? +(summary.totalConversionValueConverted / summary.totalSpendConverted).toFixed(2) : 0

    summary.daysWithData = timeSeries.size

    // Récupérer les noms des produits
    const productIds = Array.from(byProduct.keys()).filter((id) => id !== 'unknown')
    if (productIds.length > 0) {
      const { data: products } = await admin
        .from('products')
        .select('id, name')
        .in('id', productIds)

      if (products) {
        for (const p of products) {
          const entry = byProduct.get(p.id)
          if (entry) entry.productName = p.name
        }
      }
    }

    // Mettre à jour les noms de produits dans byCampaign
    for (const [, camp] of byCampaign) {
      const prod = byProduct.get(camp.productId)
      if (prod) camp.productName = prod.productName
    }

    // Limiter à 90 périodes max pour éviter les listes infinies
    const MAX_PERIODS = 90
    const sortedTimeSeries = Array.from(timeSeries.values()).sort((a, b) => a.date.localeCompare(b.date))
    const limitedTimeSeries = sortedTimeSeries.length > MAX_PERIODS
      ? sortedTimeSeries.slice(-MAX_PERIODS)
      : sortedTimeSeries

    const response = {
      summary,
      timeSeries: limitedTimeSeries,
      byProduct: Array.from(byProduct.values())
        .sort((a, b) => b.spend - a.spend)
        .map((p) => ({
          ...p,
          roas: p.spend > 0 ? +(p.conversionValue / p.spend).toFixed(2) : 0,
          cpc: p.clicks > 0 ? +(p.spend / p.clicks).toFixed(4) : 0,
        })),
      byCampaign: Array.from(byCampaign.values())
        .sort((a, b) => b.spend - a.spend)
        .map((c) => ({
          ...c,
          roas: c.spend > 0 ? +(c.conversionValue / c.spend).toFixed(2) : 0,
        })),
    }

    return NextResponse.json(response)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ADS_METRICS_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
