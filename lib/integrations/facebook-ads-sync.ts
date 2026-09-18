import type { SupabaseClient } from '@supabase/supabase-js'
import { getFacebookCampaignInsights } from '@/lib/integrations/facebook-ads'
import { getFacebookDecryptedToken } from '@/lib/integrations/facebook-ads-connect'

type AdminClient = SupabaseClient<any, 'public', any>

export type FacebookSyncMode = 'simple' | 'product'

type FacebookSyncJobRow = {
  id: string
  integration_id: string
  user_id: string
  store_id: string | null
  job_type: 'daily_final' | 'attribution_resync' | 'manual' | 'live_refresh' | 'token_refresh'
  sync_from: string
  sync_to: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  attempts: number
}

type ScopedAccountRow = {
  sync_mode: string | null
  facebook_ad_accounts: Array<{
    id: string
    account_id: string
    account_currency: string
  }> | null
}

type MappingRow = {
  ad_account_id: string
  external_campaign_id: string
  campaign_name: string
  product_id: string | null
  facebook_ad_accounts: {
    account_id: string
    account_currency: string
  } | null
}

type SyncTarget = {
  accountId: string
  currency: string
  mode: FacebookSyncMode
  mappingByCampaign: Map<string, MappingRow>
}

const MAX_SYNC_ATTEMPTS = 3

export function normalizeFacebookSyncMode(value: unknown): FacebookSyncMode {
  return String(value || '').trim().toLowerCase() === 'simple' ? 'simple' : 'product'
}

export function getCasablancaDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Casablanca',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function shiftDateKey(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function getFacebookFinalizedThrough(date = new Date()) {
  return shiftDateKey(getCasablancaDateKey(date), -1)
}

function toSpendDate(value: string) {
  return `${value}T00:00:00.000Z`
}

function buildSpendKey(row: {
  storeId: string
  accountId: string
  campaignId: string
  productId: string
  spendDate: string
}) {
  return [row.storeId, row.accountId, row.campaignId, row.productId, row.spendDate].join('::')
}

export async function resolveFacebookExchangeRate(
  client: AdminClient,
  ownerUserId: string | null,
  baseCurrency: string,
  targetCurrency: string,
  rateDate = new Date().toISOString().slice(0, 10)
) {
  const base = String(baseCurrency || '').trim().toUpperCase()
  const target = String(targetCurrency || '').trim().toUpperCase()
  if (!base || !target || base === target) return 1

  const findRate = async (ownerId: string | null) => {
    let query = client
      .from('exchange_rates')
      .select('rate')
      .eq('base_currency', base)
      .eq('target_currency', target)
      .lte('rate_date', rateDate)

    query = ownerId ? query.eq('owner_user_id', ownerId) : query.is('owner_user_id', null)
    const { data, error } = await query
      .order('rate_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) throw error
    const rate = Number(data?.rate || 0)
    return rate > 0 ? rate : null
  }

  if (ownerUserId) {
    const ownerRate = await findRate(ownerUserId)
    if (ownerRate) return ownerRate
  }

  return findRate(null)
}

async function loadSyncTargets(
  client: AdminClient,
  job: FacebookSyncJobRow,
  mappingRows: MappingRow[]
) {
  const mappingByAccount = new Map<string, MappingRow[]>()
  for (const mapping of mappingRows) {
    const current = mappingByAccount.get(mapping.ad_account_id) || []
    current.push(mapping)
    mappingByAccount.set(mapping.ad_account_id, current)
  }

  const { data: scopedAccounts, error: scopedAccountsError } = await client
    .from('facebook_ad_account_store_configs')
    .select('sync_mode, facebook_ad_accounts!inner(id, account_id, account_currency)')
    .eq('integration_id', job.integration_id)
    .eq('store_id', job.store_id)
    .eq('is_active', true)

  if (scopedAccountsError) throw scopedAccountsError

  const targets: SyncTarget[] = []
  const scopedRows = (scopedAccounts || []) as unknown as ScopedAccountRow[]

  if (scopedRows.length > 0) {
    for (const account of scopedRows) {
      const linkedAccount = Array.isArray(account.facebook_ad_accounts)
        ? account.facebook_ad_accounts[0]
        : account.facebook_ad_accounts
      if (!linkedAccount) continue
      const mode = normalizeFacebookSyncMode(account.sync_mode)
      const accountMappings = mode === 'product' ? mappingByAccount.get(linkedAccount.id) || [] : []
      if (mode === 'product' && accountMappings.length === 0) continue

      targets.push({
        accountId: String(linkedAccount.account_id || ''),
        currency: String(linkedAccount.account_currency || 'USD').toUpperCase(),
        mode,
        mappingByCampaign: new Map(accountMappings.map((item) => [item.external_campaign_id, item])),
      })
    }

    return targets.filter((target) => target.accountId)
  }

  // Compatibilité: anciens ad accounts sans store_id, on déduit le compte depuis les mappings existants.
  for (const accountMappings of mappingByAccount.values()) {
    const first = accountMappings[0]
    const fbAccountId = String(first.facebook_ad_accounts?.account_id || '')
    if (!fbAccountId) continue

    targets.push({
      accountId: fbAccountId,
      currency: String(first.facebook_ad_accounts?.account_currency || 'USD').toUpperCase(),
      mode: 'product',
      mappingByCampaign: new Map(accountMappings.map((item) => [item.external_campaign_id, item])),
    })
  }

  return targets
}

export async function processFacebookSyncJob(client: AdminClient, jobId: string) {
  const { data: job, error: jobError } = await client
    .from('facebook_sync_jobs')
    .select('id, integration_id, user_id, store_id, job_type, sync_from, sync_to, status, attempts')
    .eq('id', jobId)
    .single<FacebookSyncJobRow>()

  if (jobError) throw jobError
  if (!job.store_id) throw new Error('FACEBOOK_SYNC_JOB_MISSING_STORE')

  if (!['pending', 'failed'].includes(job.status) || job.attempts >= MAX_SYNC_ATTEMPTS) {
    throw new Error('FACEBOOK_SYNC_JOB_NOT_PROCESSABLE')
  }

  const { data: claimedJob, error: claimError } = await client
    .from('facebook_sync_jobs')
    .update({
      status: 'running',
      attempts: (job.attempts || 0) + 1,
      started_at: new Date().toISOString(),
      error_message: null,
    })
    .eq('id', job.id)
    .eq('status', job.status)
    .eq('attempts', job.attempts)
    .select('id')
    .maybeSingle()

  if (claimError) throw claimError
  if (!claimedJob?.id) throw new Error('FACEBOOK_SYNC_JOB_ALREADY_CLAIMED')

  try {
    const storeId = String(job.store_id)
    const token = await getFacebookDecryptedToken(client, job.integration_id)

    const [{ data: store, error: storeError }, { data: mappings, error: mappingsError }] = await Promise.all([
      client.from('stores').select('currency, owner_user_id').eq('id', storeId).single(),
      client
        .from('facebook_campaign_mappings')
        .select('ad_account_id, external_campaign_id, campaign_name, product_id, facebook_ad_accounts!inner(account_id, account_currency)')
        .eq('store_id', storeId)
        .eq('integration_id', job.integration_id)
        .eq('is_active', true)
        .not('product_id', 'is', null),
    ])

    if (storeError) throw storeError
    if (mappingsError) throw mappingsError

    const storeCurrency = String(store?.currency || 'MAD').toUpperCase()
    const storeOwnerId = store?.owner_user_id ? String(store.owner_user_id) : null
    const mappingRows = (mappings || []) as unknown as MappingRow[]
    const targets = await loadSyncTargets(client, job, mappingRows)

    if (targets.length === 0) {
      await client
        .from('facebook_sync_jobs')
        .update({ status: 'completed', finished_at: new Date().toISOString(), error_message: null })
        .eq('id', job.id)
      return { inserted: 0, updated: 0, reason: 'NO_ACTIVE_AD_ACCOUNT_OR_MAPPING' }
    }

    const { data: existingRows, error: existingError } = await client
      .from('ad_spend_daily')
      .select('id, store_id, spend_date, external_account_id, external_campaign_id, product_id')
      .eq('store_id', storeId)
      .eq('platform', 'facebook')
      .gte('spend_date', toSpendDate(job.sync_from))
      .lte('spend_date', toSpendDate(job.sync_to))

    if (existingError) throw existingError

    const existingMap = new Map(
      (existingRows || []).map((row: any) => [
        buildSpendKey({
          storeId: String(row.store_id),
          accountId: String(row.external_account_id || ''),
          campaignId: String(row.external_campaign_id || ''),
          productId: String(row.product_id || ''),
          spendDate: String(row.spend_date).slice(0, 10),
        }),
        row,
      ])
    )

    const rateCache = new Map<string, number>()
    const rateFor = async (currency: string, rateDate: string) => {
      const cacheKey = `${currency}:${rateDate}`
      const cached = rateCache.get(cacheKey)
      if (cached !== undefined) return cached
      const resolved = await resolveFacebookExchangeRate(client, storeOwnerId, currency, storeCurrency, rateDate)
      if (!resolved || resolved <= 0) {
        throw new Error(`EXCHANGE_RATE_NOT_FOUND:${currency}->${storeCurrency}`)
      }
      rateCache.set(cacheKey, resolved)
      return resolved
    }

    const inserts: Array<Record<string, unknown>> = []
    const syncedKeys = new Set<string>()
    const affectedDates = new Set<string>()
    let updated = 0

    for (const target of targets) {
      const campaignIds = target.mode === 'product' ? Array.from(target.mappingByCampaign.keys()) : []

      const insights = await getFacebookCampaignInsights({
        accessToken: token,
        accountId: target.accountId,
        campaignIds,
        dateFrom: job.sync_from,
        dateTo: job.sync_to,
      })

      for (const insight of insights) {
        const mapping = target.mappingByCampaign.get(insight.campaignId) || null
        if (target.mode === 'product' && !mapping) continue
        const productId = mapping?.product_id ? String(mapping.product_id) : null
        const spendDate = insight.dateStart
        affectedDates.add(spendDate)
        const exchangeRate = await rateFor(target.currency, spendDate)
        const payload = {
          store_id: storeId,
          spend_date: toSpendDate(spendDate),
          platform: 'facebook',
          campaign_name: insight.campaignName || mapping?.campaign_name || 'Campaign',
          product_id: productId,
          spend: insight.spend,
          spend_currency: target.currency,
          currency_convert: storeCurrency,
          spend_converted: Number(((insight.spend || 0) * exchangeRate).toFixed(4)),

          is_provisional: job.job_type === 'live_refresh',
          external_account_id: insight.accountId,
          external_campaign_id: insight.campaignId,
          // Métriques de performance
          impressions: insight.impressions || 0,
          clicks: insight.clicks || 0,
          reach: insight.reach || 0,
          frequency: insight.frequency || 0,
          // Métriques de coût (devise du ad account)
          cpc: insight.cpc || 0,
          cpm: insight.cpm || 0,
          cpp: insight.cpp || 0,
          ctr: insight.ctr || 0,
          // Métriques de coût converties
          cpc_converted: Number(((insight.cpc || 0) * exchangeRate).toFixed(4)),
          cpm_converted: Number(((insight.cpm || 0) * exchangeRate).toFixed(4)),
          cpp_converted: Number(((insight.cpp || 0) * exchangeRate).toFixed(4)),

          // Conversions
          actions_total: insight.actionsTotal || 0,
          purchases: insight.purchases || 0,
          add_to_cart: insight.addToCart || 0,
          initiate_checkout: insight.initiateCheckout || 0,
          view_content: insight.viewContent || 0,
          // Valeur des conversions
          conversion_value: insight.conversionValue || 0,
          conversion_value_converted: Number(((insight.conversionValue || 0) * exchangeRate).toFixed(4)),
          conversion_value_currency: target.currency,

          // Engagement
          post_engagement: insight.postEngagement || 0,
          page_engagement: insight.pageEngagement || 0,
          link_clicks: insight.linkClicks || 0,
          outbound_clicks: insight.outboundClicks || 0,
          // Vidéo
          video_views: insight.video30SecWatched || 0,
          video_avg_time_watched: insight.videoAvgTimeWatched || 0,
          // Métadonnées brutes
          raw_metrics: {
            actions: insight.actions,
            action_values: insight.actionValues,
            cost_per_action_type: insight.costPerActionType,
            outbound_clicks_ctr: insight.outboundClicksCtr,
            sync_mode: target.mode,
          },
        }

        const key = buildSpendKey({
          storeId,
          accountId: insight.accountId,
          campaignId: insight.campaignId,
          productId: productId || '',
          spendDate,
        })

        syncedKeys.add(key)
        const existing = existingMap.get(key)
        if (existing?.id) {
          const { error } = await client.from('ad_spend_daily').update(payload).eq('id', existing.id)
          if (error) throw error
          updated += 1
        } else {
          inserts.push(payload)
        }
      }
    }

    if (inserts.length > 0) {
      const { error: insertError } = await client.from('ad_spend_daily').insert(inserts)
      if (insertError) throw insertError
    }

    const targetAccountIds = new Set(targets.map((target) => target.accountId))
    const obsoleteIds = (existingRows || [])
      .filter((row: any) => {
        const accountId = String(row.external_account_id || '')
        if (!targetAccountIds.has(accountId)) return false
        const key = buildSpendKey({
          storeId: String(row.store_id),
          accountId,
          campaignId: String(row.external_campaign_id || ''),
          productId: String(row.product_id || ''),
          spendDate: String(row.spend_date).slice(0, 10),
        })
        return !syncedKeys.has(key)
      })
      .map((row: any) => String(row.id))

    if (obsoleteIds.length > 0) {
      ;(existingRows || [])
        .filter((row: any) => obsoleteIds.includes(String(row.id)))
        .forEach((row: any) => affectedDates.add(String(row.spend_date).slice(0, 10)))

      const { error: cleanupError } = await client.from('ad_spend_daily').delete().in('id', obsoleteIds)
      if (cleanupError) throw cleanupError
    }

    // Les triggers recalculent après insert/update, mais pas après suppression des anciennes lignes.
    for (const spendDate of affectedDates) {
      const { error: allocationError } = await client.rpc('allocate_ads_cost_for_day', {
        p_store_id: storeId,
        p_day: spendDate,
      })
      if (allocationError) throw allocationError
    }

    await client
      .from('facebook_sync_jobs')
      .update({ status: 'completed', finished_at: new Date().toISOString(), error_message: null })
      .eq('id', job.id)

    return { inserted: inserts.length, updated }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'FACEBOOK_SYNC_JOB_FAILED'

    await client.from('facebook_sync_errors').insert({
      integration_id: job.integration_id,
      store_id: job.store_id,
      error_message: message,
      payload: { jobId: job.id, jobType: job.job_type, syncFrom: job.sync_from, syncTo: job.sync_to },
    })

    await client
      .from('facebook_sync_jobs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), error_message: message })
      .eq('id', job.id)

    throw error
  }
}

export async function processPendingFacebookSyncJobs(client: AdminClient, userId: string, jobId?: string) {
  let query = client
    .from('facebook_sync_jobs')
    .select('id, integration_id, user_id, store_id, job_type, sync_from, sync_to, status, attempts')
    .eq('user_id', userId)
    .in('status', ['pending', 'failed'])
    .lt('attempts', MAX_SYNC_ATTEMPTS)
    .order('created_at', { ascending: true })

  if (jobId) query = query.eq('id', jobId)

  const { data, error } = await query
  if (error) throw error

  const jobs = (data || []) as FacebookSyncJobRow[]
  const results: Array<Record<string, unknown>> = []

  for (const job of jobs) {
    try {
      results.push({ jobId: job.id, ...(await processFacebookSyncJob(client, job.id)) })
    } catch (error) {
      results.push({ jobId: job.id, error: error instanceof Error ? error.message : 'FACEBOOK_SYNC_JOB_FAILED' })
    }
  }

  return results
}

export async function enqueueFacebookDailySyncJobs(client: AdminClient, lookbackDays = 7) {
  const syncTo = getFacebookFinalizedThrough()
  const syncFrom = shiftDateKey(syncTo, -(Math.max(lookbackDays, 1) - 1))

  const { data: integrations, error } = await client
    .from('integrations')
    .select('id, user_id')
    .eq('provider', 'facebook-ads')
    .eq('status', 'connected')

  if (error) throw error

  const created: Array<{ jobId: string; userId: string }> = []

  for (const integration of (integrations || []) as Array<{ id: string; user_id: string }>) {
    const { data: accountRows, error: accountRowsError } = await client
      .from('facebook_ad_account_store_configs')
      .select('store_id')
      .eq('integration_id', integration.id)
      .eq('is_active', true)

    if (accountRowsError) throw accountRowsError

    const storeIds = Array.from(
      new Set((accountRows || []).map((row: any) => String(row.store_id || '')).filter(Boolean))
    )

    for (const storeId of storeIds) {
      const { data: todaysJobs } = await client
        .from('facebook_sync_jobs')
        .select('id, status, started_at')
        .eq('integration_id', integration.id)
        .eq('store_id', storeId)
        .eq('job_type', 'daily_final')
        .eq('sync_to', syncTo)

      const oneHourAgo = Date.now() - 3600000
      const hasBlockingJob = (todaysJobs || []).some((job: any) => {
        if (job.status === 'pending' || job.status === 'completed') return true
        if (job.status === 'running') {
          return job.started_at ? new Date(job.started_at).getTime() >= oneHourAgo : true
        }
        return false
      })

      if (hasBlockingJob) continue

      const { data: job, error: jobError } = await client
        .from('facebook_sync_jobs')
        .insert({
          integration_id: integration.id,
          user_id: integration.user_id,
          store_id: storeId,
          job_type: 'daily_final',
          sync_from: syncFrom,
          sync_to: syncTo,
          status: 'pending',
        })
        .select('id')
        .single()

      if (jobError) throw jobError
      created.push({ jobId: String(job.id), userId: String(integration.user_id) })
    }
  }

  return created
}


