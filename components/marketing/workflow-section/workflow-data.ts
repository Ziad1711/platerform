import { 
  CheckCircle2, 
  PackageCheck, 
  BarChart3, 
  Boxes,
  BellRing,
  Truck,
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
    tooltip: 'YouCan ou LightFunnels — la commande arrive via l’intégration configurée',
  },
  {
    id: 'jisra-receive',
    title: 'jisra Core',
    description: 'Capture auto',
    logo: '/icons/icon-192.svg',
    position: { x: 500, y: 150 },
    type: 'platform',
    glow: true,
    tooltip: 'La commande est enregistrée dans Jisra et visible dans la liste des commandes',
  },
  {
    id: 'notif-push',
    title: 'Contrôle',
    description: 'Revue agent',
    logo: BellRing,
    position: { x: 800, y: 150 },
    type: 'integration',
    tooltip: 'L’agent de confirmation consulte la commande et vérifie les informations avant validation',
  },
  {
    id: 'confirm',
    title: 'Validation',
    description: 'Décision agent',
    logo: CheckCircle2,
    position: { x: 1100, y: 150 },
    type: 'platform',
    tooltip: 'Validation ou refus par l’agent de confirmation selon les informations disponibles',
  },
  {
    id: 'delivery',
    title: 'Expédition',
    description: 'Colis transporteur',
    logo: Truck,
    position: { x: 1320, y: 350 },
    type: 'integration',
    tooltip: 'Création du colis selon le transporteur configuré, avec numéro de suivi lorsque l’API le renvoie',
  },
  {
    id: 'delivered',
    title: 'Livré',
    description: 'Statut rapproché',
    logo: PackageCheck,
    position: { x: 900, y: 450 },
    type: 'output',
    tooltip: 'Le statut transmis par le transporteur peut être rapproché de la commande dans Jisra',
  },
  {
    id: 'kpis',
    title: 'Analytics',
    description: 'Profit recalculé',
    logo: BarChart3,
    position: { x: 200, y: 450 },
    type: 'output',
    tooltip: 'CA, profit, ROAS et marge recalculés à partir des commandes, dépenses et coûts enregistrés',
  },
]

export const connections: WorkflowConnection[] = [
  { from: 'provider', to: 'jisra-receive', animated: true },
  { from: 'jisra-receive', to: 'notif-push', animated: true },
  { from: 'notif-push', to: 'confirm', animated: true },
  { from: 'confirm', to: 'delivery', animated: true },
  { from: 'delivery', to: 'stock', animated: true },
  { from: 'stock', to: 'delivered', animated: true },
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
    tooltip: 'Dépenses Meta Ads importées puis rapprochées des commandes et des produits',
  },
  {
    id: 'stock',
    title: 'Stock',
    description: 'À l’expédition',
    logo: Boxes,
    connectsTo: 'delivery',
    position: { x: 1100, y: 350 },
    tooltip: 'Le stock est consommé lorsque la commande passe en ramassé, expédié ou livré',
  },
]

