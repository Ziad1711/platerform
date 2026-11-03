/**
 * Admission distribuée d'une requête coûteuse.
 *
 * Le limiteur en mémoire (`rate-limit.ts`) ne couvre qu'une instance Vercel :
 * deux instances peuvent engager deux appels fournisseur simultanés pour le même
 * compte. Cette barrière déporte la décision en base.
 *
 * Elle est **fermée par défaut** : la fonction `rpc_assistant_assert_user_admission`
 * n'existe pas en Production (aucune migration dans cette mission). Tant que
 * `ASSISTANT_DISTRIBUTED_ADMISSION` n'est pas `enabled`, comportement inchangé et
 * absence de garantie inter-instances documentée.
 *
 * Deux exigences de sûreté :
 * 1. l'appel passe par le client **backend** : la RPC est réservée à
 *    `service_role`, un client utilisateur ne peut pas l'exécuter ;
 * 2. toute erreur est **fail-closed** : sans preuve d'admission, aucune dépense
 *    n'est engagée.
 *
 * La RPC doit réserver un créneau de façon atomique (voir
 * `docs/assistant/sql/06_assistant_user_admission.proposed.sql`) ; un simple
 * comptage ne serait pas une admission.
 */
import { requireAssistantBackendClient } from '@/lib/assistant/backend'
import { isDistributedAdmissionEnabled } from '@/lib/assistant/engine/policy'

export const ADMISSION_RPC = 'rpc_assistant_assert_user_admission'
/** Requêtes simultanées autorisées par compte (coût fournisseur borné). */
export const MAX_INFLIGHT_PER_USER = 1

export type AdmissionOutcome = 'disabled' | 'admitted'

export async function assertDistributedAdmission(input: {
  userId: string
  maxInflight?: number
  env?: Record<string, string | undefined>
}): Promise<AdmissionOutcome> {
  if (!isDistributedAdmissionEnabled(input.env ?? process.env)) return 'disabled'

  let backend
  try {
    backend = requireAssistantBackendClient()
  } catch {
    console.error('[assistant] admission_backend_unavailable')
    throw new Error('ASSISTANT_BACKEND_UNAVAILABLE')
  }

  const { error } = await backend.rpc(ADMISSION_RPC, {
    p_user_id: input.userId,
    p_max_inflight: Math.max(1, Math.trunc(input.maxInflight ?? MAX_INFLIGHT_PER_USER)),
  })

  if (error) {
    console.error('[assistant] admission_unavailable', { code: error.code || 'unknown' })
    throw new Error('ASSISTANT_BACKEND_UNAVAILABLE')
  }
  return 'admitted'
}