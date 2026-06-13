import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrustedOrigin, requireAuthenticatedUser } from '@/lib/assistant/security'

export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request)
    const { user } = await requireAuthenticatedUser()
    const admin = createAdminClient()
    const now = new Date().toISOString()

    // Désactiver l'intégration
    const { data: integrations, error: fetchError } = await admin
      .from('integrations')
      .select('id, store_id')
      .eq('user_id', user.id)
      .eq('provider', 'ozone')

    if (fetchError) throw fetchError

    for (const integration of integrations || []) {
      await admin
        .from('integrations')
        .update({ status: 'disconnected', updated_at: now })
        .eq('id', integration.id)

      // Désactiver delivery_company
      if (integration.store_id) {
        await admin
          .from('delivery_companies')
          .update({ is_active: false, updated_at: now })
          .eq('store_id', integration.store_id)
          .eq('api_provider', 'ozone')
      }
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('OZONE disconnect error:', error)
    return NextResponse.json({ error: 'Déconnexion OZONE impossible.' }, { status: 500 })
  }
}
