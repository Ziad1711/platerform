import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptSecret, encryptSecret, isEncryptedSecret } from '@/lib/security/crypto'
import { getFacebookCampaignInsights } from '@/lib/integrations/facebook-ads'

type AdminClient = SupabaseClient<any, 'public', any>

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

type MappingRow = {
  ad_account_id: string
  external_campaign_id: string
  campaign_name: string
  product_id: string
  facebook_ad_accounts: {
    account_id: string
    account_currency: string
  } | null
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

export async function getFacebookAdsProviderId(client: AdminClient) {
  const { data, error } = await client
    .from('integration_providers')
    .select('id')
    .eq('slug', 'facebook-ads')
    .maybeSingle()

  if (error) throw error
  if (!data?.id) throw new Error('FACEBOOK_ADS_PROVIDER_NOT_FOUND')
  return String(data.id)
}

export async function getFacebookIntegration(client: AdminClient, userId: string) {
  const { data, error } = await client
    .from('integrations')
    .select('id, access_token, status')
    .eq('user_id', userId)
    .eq('provider', 'facebook-ads')
    .maybeSingle()

  if (error) throw error
  return data
}

export async function getFacebookDecryptedToken(client: AdminClient, integrationId: string) {
  const { data, error } = await client
    .from('integrations')
    .select('access_token')
    .eq('id', integrationId)
    .single()

  if (error) throw error
  const raw = String(data.access_token || '')
  const decrypted = decryptSecret(raw)

  if (!isEncryptedSecret(raw)) {
    await client
      .from('integrations')
      .update({ access_token: encryptSecret(decrypted), updated_at: new Date().toISOString() })
      .eq('id', integrationId)
  }

  return decrypted
}

export async function processFacebookSyncJob(client: AdminClient, jobId: string) {
  const { data: job, error: jobError } = await client
    .from('facebook_sync_jobs')
    .select('id, integration_id, user_id, store_id, job_type, sync_from, sync_to, status, attempts')
    .eq('id', jobId)
    .single<FacebookSyncJobRow>()

  if (jobError) throw jobError
  if (!job.store_id) throw new Error('FACEBOOK_SYNC_JOB_MISSING_STORE')

  await client
    .from('facebook_sync_jobs')
    .update({
      status: 'running',
      attempts: (job.attempts || 0) + 1,
      started_at: new Date().toISOString(),
      error_message: null,
    })
    .eq('id', job.id)

  try {
    const token = await getFacebookDecryptedToken(client, job.integration_id)

    const [{ data: store, error: storeError }, { data: mappings, error: mappingsError }] = await Promise.all([
      client.from('stores').select('currency').eq('id', job.store_id).single(),
      client
        .from('facebook_campaign_mappings')
        .select('ad_account_id, external_campaign_id, campaign_name, product_id, facebook_ad_accounts!inner(account_id, account_currency)')
        .eq('store_id', job.store_id)
        .eq('integration_id', job.integration_id)
        .eq('is_active', true),
    ])

    if (storeError) throw storeError
    if (mappingsError) throw mappingsError

    const storeCurrency = String(store?.currency || 'MAD').toUpperCase()

    // Récupérer le taux de change USD → devise du store
    let exchangeRate = 1
    if (storeCurrency !== 'USD') {
      const today = new Date().toISOString().split('T')[0]
      const { data: rateRow } = await client
        .from('exchange_rates')
        .select('rate')
        .eq('base_currency', 'USD')
        .eq('target_currency', storeCurrency)
        .eq('rate_date', today)
        .maybeSingle()

      if (rateRow?.rate) {
        exchangeRate = Number(rateRow.rate)
      } else {
        // Fallback : chercher le taux le plus récent
        const { data: fallback } = await client
          .from('exchange_rates')
          .select('rate')
          .eq('base_currency', 'USD')
          .eq('target_currency', storeCurrency)
          .order('rate_date', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (fallback?.rate) {
          exchangeRate = Number(fallback.rate)
        }
      }
    }

    const mappingRows = (mappings || []) as unknown as MappingRow[]

    if (mappingRows.length === 0) {
      await client
        .from('facebook_sync_jobs')
        .update({ status: 'completed', finished_at: new Date().toISOString() })
        .eq('id', job.id)
      return { inserted: 0, updated: 0 }
    }

    const grouped = new Map<string, MappingRow[]>()
    for (const mapping of mappingRows) {
      const current = grouped.get(mapping.ad_account_id) || []
      current.push(mapping)
      grouped.set(mapping.ad_account_id, current)
    }

    const { data: existingRows, error: existingError } = await client
      .from('ad_spend_daily')
      .select('id, store_id, spend_date, external_account_id, external_campaign_id, product_id')
      .eq('store_id', job.store_id)
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

    const inserts: Array<Record<string, unknown>> = []
    let updated = 0

    for (const [, accountMappings] of grouped) {
      const first = accountMappings[0]
      const fbAccountId = String(first.facebook_ad_accounts?.account_id || '')
      if (!fbAccountId) continue

      const insights = await getFacebookCampaignInsights({
        accessToken: token,
        accountId: fbAccountId,
        campaignIds: accountMappings.map((item) => item.external_campaign_id),
        dateFrom: job.sync_from,
        dateTo: job.sync_to,
      })

      const mappingByCampaign = new Map(accountMappings.map((item) => [item.external_campaign_id, item]))

      for (const insight of insights) {
        const mapping = mappingByCampaign.get(insight.campaignId)
        if (!mapping) continue

        const spendDate = insight.dateStart
        const payload = {
          store_id: job.store_id,
          spend_date: toSpendDate(spendDate),
          platform: 'facebook',
          campaign_name: insight.campaignName || mapping.campaign_name,
          product_id: mapping.product_id,
          spend: insight.spend,
          spend_currency: String(mapping.facebook_ad_accounts?.account_currency || 'USD').toUpperCase(),
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
          // Métriques de coût (USD)
          cpc: insight.cpc || 0,
          cpm: insight.cpm || 0,
          cpp: insight.cpp || 0,
          ctr: insight.ctr || 0,
          // Métriques de coût converties (MAD)
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
          conversion_value_currency: String(mapping.facebook_ad_accounts?.account_currency || 'USD').toUpperCase(),

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
          },
        }

        const key = buildSpendKey({
          storeId: job.store_id,
          accountId: insight.accountId,
          campaignId: insight.campaignId,
          productId: mapping.product_id,
          spendDate,
        })

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

    await client
      .from('facebook_sync_jobs')
      .update({
        status: 'completed',
        finished_at: new Date().toISOString(),
        error_message: null,
      })
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
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        error_message: message,
      })
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
    .order('created_at', { ascending: true })

  if (jobId) query = query.eq('id', jobId)

  const { data, error } = await query
  if (error) throw error

  const jobs = (data || []) as FacebookSyncJobRow[]
  const results = []

  for (const job of jobs) {
    results.push({ jobId: job.id, ...(await processFacebookSyncJob(client, job.id)) })
  }

  return results
}
