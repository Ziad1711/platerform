// ============================================================
// Types provider-agnostiques pour le système de livraison
// ============================================================

/** Identifiant unique d'une intégration delivery */
export type DeliveryIntegrationId = string

/** Identifiant d'un store */
export type StoreId = string

/** Identifiant d'un utilisateur */
export type UserId = string

/** Identifiant d'une commande */
export type OrderId = string

/** Statut possible d'une entité delivery */
export type DeliveryEntityType = 'parcel' | 'voucher'

/** Résultat de création d'un colis */
export type CreateParcelResult = {
  /** Identifiant retourné par le provider (UUID ou code court) */
  providerId: string
  /** Payload brut retourné par l'API */
  raw: unknown
}

/** Résultat de création d'un voucher */
export type CreateVoucherResult = {
  /** Identifiant du voucher chez le provider */
  providerVoucherKey: string
  /** Nombre de colis dans le voucher */
  totalParcels: number
  /** Payload brut retourné par l'API */
  raw: unknown
}

/** Résultat de tracking d'un colis */
export type TrackParcelResult = {
  /** Nom du statut chez le provider (ex: "Livrée", "Expédiée") */
  rawStatus: string
  /** Statut normalisé order status */
  orderStatus: string | null
  /** Statut normalisé delivery status */
  deliveryStatus: string
  /** Champ de date correspondant (ex: "delivered_at") */
  statusDateField: string | null
  /** Payload brut */
  raw: unknown
}

/** Informations nécessaires pour créer un colis */
export type ParcelCreationInput = {
  articleName: string
  price: number
  phone: string
  cityKey: number
  shopKey: number
  address?: string
  recipient?: string
  remark?: string
}

/** Informations nécessaires pour créer un voucher */
export type VoucherCreationInput = {
  shopKey: number
  parcelKeys: Array<string | number>
}

/** Configuration d'intégration delivery */
export type DeliveryIntegrationConfig = {
  integrationId: string
  token: string
  baseUrl: string | null
  userId: string
  storeId: string
}

/** Résultat de normalisation de ville */
export type NormalizedCity = {
  cityName: string
  cityKey: number | null
  source: 'exact_match' | 'alias_cache' | 'ai_learned' | 'ai_failed'
}

/** Niveaux de log */
export type LogLevel = 'info' | 'warn' | 'error'

/** Entrée de log structurée */
export type LogEntry = {
  level: LogLevel
  action: string
  integrationId: string
  storeId: string
  userId: string
  message: string
  details?: Record<string, unknown>
  durationMs?: number
  createdAt: string
}

/** Commande simplifiée pour les services delivery */
export type OrderDeliveryInfo = {
  id: string
  storeId: string
  city?: string | null
  address?: string | null
  phone?: string | null
  customerName?: string | null
  totalSellingPrice?: number | string | null
  trackingNumber?: string | null
  rapidDeliveryCityKey?: number | string | null
  rapidDeliveryParcelKey?: string | null
  rapidDeliveryVoucherKey?: string | null
  orderItems?: Array<{ productName?: string | null }> | null
}
