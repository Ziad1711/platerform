import { LayoutGrid, Megaphone, Sparkles, Truck, UserCheck } from 'lucide-react'
import type { MarketingSolutionIcon } from '@/lib/marketing/site'

/** Icônes partagées entre le menu desktop et l'accordéon mobile. */
export const SOLUTION_ICONS: Record<MarketingSolutionIcon, typeof LayoutGrid> = {
  layout: LayoutGrid,
  sparkles: Sparkles,
  megaphone: Megaphone,
  truck: Truck,
  userCheck: UserCheck,
}
