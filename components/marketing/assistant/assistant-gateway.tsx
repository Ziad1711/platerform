import { AssistantLauncher } from './assistant-launcher'
import { publicAssistantConfigured } from '@/lib/marketing/assistant/provider'

/**
 * Decision serveur (runtime), jamais figee au build :
 * - Production : l'assistant n'apparait que si PUBLIC_AI_ENABLED=enabled et
 *   qu'un fournisseur reel est configurable ;
 * - Developpement / qualification : l'icone reste visible meme sans fournisseur,
 *   et le panneau affiche un etat explicite. Aucune reponse synthetique n'est
 *   presentee comme un assistant live.
 */
export function AssistantGateway() {
  const enabled =
    String(process.env.PUBLIC_AI_ENABLED || '').trim().toLowerCase() === 'enabled' ||
    process.env.NODE_ENV !== 'production'
  const configured = publicAssistantConfigured()
  const development = process.env.NODE_ENV !== 'production'
  return enabled && (configured || development) ? <AssistantLauncher available={configured} /> : null
}
