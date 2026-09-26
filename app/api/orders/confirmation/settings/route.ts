import { NextResponse } from 'next/server'
import { requireAuthenticatedUser, verifyStoreAccess } from '@/lib/assistant/security'
import { hasPermission, type Role } from '@/lib/auth/permissions'
import {
  DEFAULT_MAX_ATTEMPTS,
  MAX_MAX_ATTEMPTS,
  MIN_MAX_ATTEMPTS,
} from '@/lib/confirmation/constants'
import {
  CONFIRMATION_SETTINGS_SELECT,
  normalizeSettings,
} from '@/lib/confirmation/settings'
import { getConfirmationErrorStatus } from '@/lib/confirmation/api-errors'

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const storeId = String(new URL(request.url).searchParams.get('storeId') || '').trim()

    if (!storeId) {
      return NextResponse.json({ error: 'MISSING_STORE_ID' }, { status: 400 })
    }

    const member = await verifyStoreAccess(supabase, user.id, storeId)
    if (!hasPermission(member.role as Role, 'confirmation.view')) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }

    const { data, error } = await supabase
      .from('confirmation_settings')
      .select(CONFIRMATION_SETTINGS_SELECT)
      .eq('store_id', storeId)
      .maybeSingle()

    if (error) throw error

    return NextResponse.json({ settings: normalizeSettings(data, storeId) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CONFIRMATION_SETTINGS_FETCH_FAILED'
    return NextResponse.json({ error: message }, { status: getConfirmationErrorStatus(message) })
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()
    const body = (await request.json().catch(() => ({}))) as {
      storeId?: string
      maxAttempts?: number
      autoCancelOnMaxAttempts?: boolean
      requireCancellationReason?: boolean
      requireCallbackDatetime?: boolean
      commissionEnabled?: boolean
      defaultCommissionAmount?: number
      defaultCommissionTrigger?: 'confirmed' | 'delivered'
    }

    const storeId = String(body.storeId || '').trim()
    if (!storeId) {
      return NextResponse.json({ error: 'MISSING_STORE_ID' }, { status: 400 })
    }

    const member = await verifyStoreAccess(supabase, user.id, storeId)
    if (!hasPermission(member.role as Role, 'confirmation.settings')) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }

    const maxAttempts = Number(body.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)
    if (!Number.isFinite(maxAttempts) || maxAttempts < MIN_MAX_ATTEMPTS || maxAttempts > MAX_MAX_ATTEMPTS) {
      return NextResponse.json({ error: 'INVALID_MAX_ATTEMPTS' }, { status: 400 })
    }

    const defaultCommissionAmount = Number(body.defaultCommissionAmount ?? 0)
    if (!Number.isFinite(defaultCommissionAmount) || defaultCommissionAmount < 0) {
      return NextResponse.json({ error: 'INVALID_COMMISSION_AMOUNT' }, { status: 400 })
    }
    const defaultCommissionTrigger =
      body.defaultCommissionTrigger === 'confirmed' ? 'confirmed' : 'delivered'

    const payload = {
      store_id: storeId,
      max_attempts: Math.trunc(maxAttempts),
      auto_cancel_on_max_attempts: body.autoCancelOnMaxAttempts !== false,
      require_cancellation_reason: body.requireCancellationReason !== false,
      require_callback_datetime: body.requireCallbackDatetime !== false,
      commission_enabled: body.commissionEnabled === true,
      default_commission_amount: defaultCommissionAmount,
      default_commission_trigger: defaultCommissionTrigger,
      updated_at: new Date().toISOString(),
    }

    const { data, error } = await supabase
      .from('confirmation_settings')
      .upsert(payload, { onConflict: 'store_id', ignoreDuplicates: false })
      .select(CONFIRMATION_SETTINGS_SELECT)
      .maybeSingle()

    if (error) throw error

    return NextResponse.json({ ok: true, settings: normalizeSettings(data || payload, storeId) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CONFIRMATION_SETTINGS_SAVE_FAILED'
    return NextResponse.json({ error: message }, { status: getConfirmationErrorStatus(message) })
  }
}
