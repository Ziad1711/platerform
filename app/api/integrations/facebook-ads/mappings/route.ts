import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const storeId = String(new URL(request.url).searchParams.get('storeId') || '').trim()
    if (!storeId) return NextResponse.json({ error: 'MISSING_STORE_ID' }, { status: 400 })
    await verifyStoreAccess(supabase, user.id, storeId)

    const admin = createAdminClient()
    const [{ data: products, error: productsError }, { data: mappings, error: mappingsError }] = await Promise.all([
      admin.from('products').select('id, name').eq('store_id', storeId).order('name', { ascending: true }),
      admin
        .from('facebook_campaign_mappings')
        .select('id, ad_account_id, external_campaign_id, campaign_name, product_id, is_active')
        .eq('store_id', storeId),
    ])

    if (productsError) throw productsError
    if (mappingsError) throw mappingsError
    return NextResponse.json({ products: products || [], mappings: mappings || [] })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'FACEBOOK_MAPPINGS_FETCH_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as {
      storeId?: string
      mappings?: Array<{
        adAccountId?: string
        externalCampaignId?: string
        campaignName?: string
        productId?: string
      }>
    }

    const storeId = String(body.storeId || '').trim()
    if (!storeId) return NextResponse.json({ error: 'MISSING_STORE_ID' }, { status: 400 })
    await verifyStoreAccess(supabase, user.id, storeId)

    const mappings = Array.isArray(body.mappings) ? body.mappings : []
    const sanitized = mappings
      .map((item) => ({
        ad_account_id: String(item.adAccountId || '').trim(),
        external_campaign_id: String(item.externalCampaignId || '').trim(),
        campaign_name: String(item.campaignName || '').trim() || 'Campaign',
        product_id: String(item.productId || '').trim(),
      }))
      .filter((item) => item.ad_account_id && item.external_campaign_id && item.product_id)

    const admin = createAdminClient()
    const { data: integration, error: integrationError } = await admin
      .from('integrations')
      .select('id')
      .eq('user_id', user.id)
      .eq('provider', 'facebook-ads')
      .maybeSingle()
    if (integrationError) throw integrationError
    if (!integration?.id) return NextResponse.json({ error: 'FACEBOOK_INTEGRATION_NOT_FOUND' }, { status: 404 })

    await admin.from('facebook_campaign_mappings').delete().eq('store_id', storeId)

    if (sanitized.length > 0) {
      const { error } = await admin.from('facebook_campaign_mappings').upsert(
        sanitized.map((item) => ({
          integration_id: integration.id,
          store_id: storeId,
          ad_account_id: item.ad_account_id,
          external_campaign_id: item.external_campaign_id,
          campaign_name: item.campaign_name,
          product_id: item.product_id,
          is_active: true,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: 'ad_account_id,external_campaign_id,store_id' }
      )
      if (error) throw error
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'FACEBOOK_MAPPINGS_SAVE_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}