/**
 * Admission distribuée d'une requête coûteuse.
 *
 * Le limiteur en mémoire (`rate-limit.ts`) ne couvre qu'une instance Vercel :
 * deux instances peuvent engager deux appels fournisseur simultanés pour le même
 * compte. Cette barrière déporte la décision en base, dans la transaction qui
 * possède déjà le registre d'idempotence.
 *
 * Elle est **fermée par défaut** : la fonction `rpc_assistant_assert_user_admission`
 * n'existe pas encore en Production (aucune migration dans cette mission). Tant
 * que `ASSISTANT_DISTRIBUTED_ADMISSION` n'est pas `enabled`, comportement
 * inchangé et absence de garantie inter-instances documentée.
 *
 * En cas d'erreur RPC, la décision est **fail-closed** : sans preuve d'admission,
 * aucune dépense n'est engagée.
 */
import type { createClient } from '@/lib/supabase/server'
import { isDistributedAdmissionEnabled } from '@/lib/assistant/engine/policy'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

export const ADMISSION_RPC = 'rpc_assistant_assert_user_admission'
/** Requêtes simultanées autorisées par compte (coût fournisseur borné). */
export const MAX_INFLIGHT_PER_USER = 1

export type AdmissionOutcome = 'disabled' | 'admitted'

export async function assertDistributedAdmission(
  supabase: SupabaseServerClient,
  input: {
    userId: string
    maxInflight?: number
    env?: Record<string, string | undefined>
  },
): Promise<AdmissionOutcome> {
  if (!isDistributedAdmissionEnabled(input.env ?? process.env)) return 'disabled'

  const { error } = await supabase.rpc(ADMISSION_RPC, {
    p_user_id: input.userId,
    p_max_inflight: Math.max(1, Math.trunc(input.maxInflight ?? MAX_INFLIGHT_PER_USER)),
  })

  if (error) {
    console.error('[assistant] admission_unavailable', { code: error.code || 'unknown' })
    throw new Error('ASSISTANT_BACKEND_UNAVAILABLE')
  }
  return 'admitted'
}