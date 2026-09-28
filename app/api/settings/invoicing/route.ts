import { NextResponse } from 'next/server'
import { requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { hasPermission, type Role } from '@/lib/auth/permissions'
import {
  INVOICE_SETTINGS_SELECT,
  getInvoiceErrorStatus,
  normalizeInvoiceSettings,
  parseInvoiceSettingsPayload,
} from '@/lib/invoices/settings'
import type { StoreInvoiceSettings } from '@/lib/invoices/types'

async function getStoreName(
  supabase: Awaited<ReturnType<typeof requireAuthenticatedUser>>['supabase'],
  storeId: string
) {
  const { data } = await supabase.from('stores').select('name').eq('id', storeId).maybeSingle()
  return (data?.name as string | null | undefined) ?? null
}

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const storeId = String(new URL(request.url).searchParams.get('storeId') || '').trim()

    if (!storeId) {
      return NextResponse.json({ error: 'MISSING_STORE_ID' }, { status: 400 })
    }

    const member = await verifyStoreAccess(supabase, user.id, storeId)
    if (!hasPermission(member.role as Role, 'invoices.view')) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }

    const { data, error } = await supabase
      .from('store_invoice_settings')
      .select(INVOICE_SETTINGS_SELECT)
      .eq('store_id', storeId)
      .maybeSingle()

    if (error) throw error

    const storeName = data ? null : await getStoreName(supabase, storeId)

    return NextResponse.json({
      settings: normalizeInvoiceSettings(
        (data as unknown as Partial<StoreInvoiceSettings> | null) ?? null,
        storeId,
        storeName
      ),
      configured: Boolean(data),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'INVOICE_SETTINGS_FETCH_FAILED'
    return NextResponse.json({ error: message }, { status: getInvoiceErrorStatus(message) })
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const storeId = String(body.storeId || '').trim()

    if (!storeId) {
      return NextResponse.json({ error: 'MISSING_STORE_ID' }, { status: 400 })
    }

    const member = await verifyStoreAccess(supabase, user.id, storeId)
    if (!hasPermission(member.role as Role, 'invoices.settings')) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }

    const parsed = parseInvoiceSettingsPayload(body, storeId)
    if ('error' in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }

    const payload = {
      store_id: storeId,
      ...parsed.settings,
      updated_by: user.id,
    }

    const { data, error } = await supabase
      .from('store_invoice_settings')
      .upsert(payload, { onConflict: 'store_id' })
      .select(INVOICE_SETTINGS_SELECT)
      .single()

    if (error) throw error

    return NextResponse.json({
      settings: normalizeInvoiceSettings(
        data as unknown as Partial<StoreInvoiceSettings>,
        storeId
      ),
      configured: true,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'INVOICE_SETTINGS_SAVE_FAILED'
    return NextResponse.json({ error: message }, { status: getInvoiceErrorStatus(message) })
  }
}
