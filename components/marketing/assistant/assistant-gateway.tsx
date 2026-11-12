import { AssistantLauncher } from './assistant-launcher'

/**
 * Decision serveur (runtime), jamais figee au build :
 * - Production : l'assistant n'apparait que si PUBLIC_AI_ENABLED=enabled ;
 * - Developpement / qualification : visible pour les tests locaux (fournisseur simule).
 */
export function AssistantGateway() {
  const enabled =
    String(process.env.PUBLIC_AI_ENABLED || '').trim().toLowerCase() === 'enabled' ||
    process.env.NODE_ENV !== 'production'
  return enabled ? <AssistantLauncher /> : null
}
