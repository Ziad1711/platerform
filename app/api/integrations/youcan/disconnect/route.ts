import { NextResponse } from 'next/server'
import { requireAuthenticatedUser } from '@/lib/assistant/security'
import { deleteYouCanRestHook } from '@/lib/integrations/youcan'
import { decryptSecret } from '@/lib/security/crypto'

export async function POST() {
  try {
    const { supabase, user } = await requireAuthenticatedUser()

    // Get the YouCan integration
    const { data: integration, error: intError } = await supabase
      .from('integrations')
      .select('id, access_token')
      .eq('user_id', user.id)
      .eq('provider', 'youcan')
      .maybeSingle()

    if (intError) throw intError
    
    if (integration) {
      // 1. Try to clean up webhook on YouCan
      try {
        const { data: config } = await supabase
          .from('youcan_integration_configs')
          .select('webhook_order_create_id')
          .eq('integration_id', integration.id)
          .maybeSingle()

        if (config?.webhook_order_create_id) {
          const accessToken = decryptSecret(integration.access_token)
          if (accessToken) {
            await deleteYouCanRestHook({
              accessToken,
              subscriptionId: config.webhook_order_create_id
            }).catch(err => console.error('[youcan][disconnect] webhook delete failed', err))
          }
        }
      } catch (cleanupErr) {
        console.error('[youcan][disconnect] cleanup failed', cleanupErr)
      }

      // 2. Delete the integration config
      await supabase
        .from('youcan_integration_configs')
        .delete()
        .eq('integration_id', integration.id)

      // 3. Delete the main integration record
      const { error: deleteError } = await supabase
        .from('integrations')
        .delete()
        .eq('id', integration.id)

      if (deleteError) throw deleteError
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'DISCONNECT_FAILED'
    console.error('[youcan][disconnect] failed', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
