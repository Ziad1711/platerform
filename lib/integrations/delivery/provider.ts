// ============================================================
// Interface abstraite pour un provider de livraison
// ============================================================

import { forcelogAdapter } from './forcelog-adapter'
import { ameexAdapter } from './ameex-adapter'
import { senditAdapter } from './sendit-adapter'
import type {
  CreateParcelResult,
  CreateVoucherResult,
  TrackParcelResult,
  ParcelCreationInput,
  VoucherCreationInput,
  DeliveryIntegrationConfig,
} from './types'

/**
 * Interface que chaque provider de livraison doit implémenter.
 * Permet d'ajouter un nouveau transporteur sans toucher aux routes/services.
 */
export interface DeliveryProvider {
  /** Identifiant unique du provider (ex: 'rapid-delivery', 'aramex') */
  readonly slug: string

  /** Crée un colis chez le provider */
  createParcel(config: DeliveryIntegrationConfig, input: ParcelCreationInput): Promise<CreateParcelResult>

  /** Crée un voucher (regroupement de colis) chez le provider */
  createVoucher(config: DeliveryIntegrationConfig, input: VoucherCreationInput): Promise<CreateVoucherResult>

  /** Track un colis par son numéro de suivi */
  trackParcel(config: DeliveryIntegrationConfig, trackingNumber: string): Promise<TrackParcelResult>

  /** Récupère les détails d'un voucher */
  getVoucher(config: DeliveryIntegrationConfig, voucherKey: string): Promise<unknown>

  /** Télécharge une étiquette/label */
  downloadLabel(config: DeliveryIntegrationConfig, path: string): Promise<{ body: ArrayBuffer; contentType: string; contentDisposition: string; byteLength: number }>

  /** Résout une clé courte à partir d'un UUID (si applicable) */
  resolveShortTrackingKey?(config: DeliveryIntegrationConfig, uuid: string): Promise<string | null>
}

const providerRegistry = new Map<string, DeliveryProvider>()

export function registerProvider(provider: DeliveryProvider) {
  providerRegistry.set(provider.slug, provider)
}

export function getProvider(slug: string): DeliveryProvider | undefined {
  return providerRegistry.get(slug)
}

export function listProviders(): DeliveryProvider[] {
  return Array.from(providerRegistry.values())
}

// Enregistrer les providers au chargement
registerProvider(forcelogAdapter)
registerProvider(ameexAdapter)
registerProvider(senditAdapter)
