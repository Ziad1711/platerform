import { 
  CheckCircle2, 
  PackageCheck, 
  BarChart3, 
  Boxes,
  BellRing,
  Truck,
  Zap,
  type LucideIcon 
} from 'lucide-react'

export type WorkflowNode = {
  id: string
  title: string
  description: string
  logo: string | LucideIcon
  position: { x: number; y: number }
  type: 'provider' | 'platform' | 'integration' | 'output'
  glow?: boolean
  tooltip?: string
}

export type WorkflowConnection = {
  from: string
  to: string
  animated: boolean
  label?: string
}

export type WorkflowBranch = {
  id: string
  title: string
  description: string
  logo: string | LucideIcon
  connectsTo: string
  position: { x: number; y: number }
  tooltip?: string
}

export const nodes: WorkflowNode[] = [
  {
    id: 'provider',
    title: 'Store',
    description: 'Commande créée',
    logo: '/icons/youcan-shop-icon-filled-256.png',
    position: { x: 200, y: 150 },
    type: 'provider',
    tooltip: 'YouCan, Shopify ou LightFunnels — la commande arrive automatiquement',
  },
  {
    id: 'jisra-receive',
    title: 'jisra Core',
    description: 'Capture auto',
    logo: '/icons/icon-192.svg',
    position: { x: 500, y: 150 },
    type: 'platform',
    glow: true,
    tooltip: 'La commande est stockée en base et une notification push est envoyée',
  },
  {
    id: 'notif-push',
    title: 'Alerte',
    description: 'Notif push live',
    logo: BellRing,
    position: { x: 800, y: 150 },
    type: 'integration',
    tooltip: 'L\'agent de confirmation reçoit une notification mobile instantanée',
  },
  {
    id: 'confirm',
    title: 'Validation',
    description: 'En 1 clic',
    logo: CheckCircle2,
    position: { x: 1100, y: 150 },
    type: 'platform',
    tooltip: 'Validation du bon de ramassage par l\'agent de confirmation',
  },
  {
    id: 'delivery',
    title: 'Expédition',
    description: 'Tracking auto',
    logo: Truck,
    position: { x: 1320, y: 350 },
    type: 'integration',
    tooltip: 'Création automatique du colis chez Rapid Delivery avec tracking number',
  },
  {
    id: 'delivered',
    title: 'Livré',
    description: 'Statut synchro',
    logo: PackageCheck,
    position: { x: 900, y: 450 },
    type: 'output',
    tooltip: 'Le statut "delivered" est synchronisé automatiquement dans jisra',
  },
  {
    id: 'kpis',
    title: 'Analytics',
    description: 'Profit live',
    logo: BarChart3,
    position: { x: 200, y: 450 },
    type: 'output',
    tooltip: 'CA, profit, ROAS et marge mis à jour en temps réel dans le dashboard',
  },
]

export const connections: WorkflowConnection[] = [
  { from: 'provider', to: 'jisra-receive', animated: true },
  { from: 'jisra-receive', to: 'notif-push', animated: true },
  { from: 'notif-push', to: 'confirm', animated: true },
  { from: 'confirm', to: 'stock', animated: true },
  { from: 'stock', to: 'delivery', animated: true },
  { from: 'delivery', to: 'delivered', animated: true },
  { from: 'delivered', to: 'kpis', animated: true },
  { from: 'ads', to: 'kpis', animated: true },
  { from: 'jisra-receive', to: 'ads', animated: true },
]

export const branches: WorkflowBranch[] = [
  {
    id: 'ads',
    title: 'Meta Ads',
    description: 'Coût importé',
    logo: '/icons/meta_PNG5.png',
    connectsTo: 'jisra-receive',
    position: { x: 500, y: 350 },
    tooltip: 'Coût Facebook Ads importé automatiquement depuis Meta Ads Manager',
  },
  {
    id: 'stock',
    title: 'Stock',
    description: 'Inventaire sync',
    logo: Boxes,
    connectsTo: 'confirm',
    position: { x: 1100, y: 350 },
    tooltip: 'Stock du produit décrémenté automatiquement à la confirmation',
  },
]

