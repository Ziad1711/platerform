import type { ReactNode } from 'react'
import { Link2, Star, Users } from 'lucide-react'
import { cn } from '@/lib/utils'

type IntegrationCardProps = {
  name: string
  description: string
  usersCount: number
  ratingAvg: number
  totalReviews: number
  isConnected: boolean
  onAction: () => void
  isFeatured?: boolean
  logoUrl?: string | null
  logo?: ReactNode
}

export default function IntegrationCard({
  name,
  description,
  usersCount,
  ratingAvg,
  totalReviews,
  isConnected,
  onAction,
  isFeatured = false,
  logo = <Link2 className="h-6 w-6 text-foreground" />,
  logoUrl,
}: IntegrationCardProps) {
  return (
    <div
      className={cn(
        'group relative rounded-2xl border border-border/50 bg-card p-6 shadow-sm transition-all duration-300',
        'hover:-translate-y-1 hover:scale-[1.02] hover:shadow-xl',
        isFeatured && 'border-primary/20 shadow-lg hover:shadow-2xl'
      )}
    >
      {/* Status Badge - top right */}
      <div className="absolute right-4 top-4">
        <span
          className={cn(
            'inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold',
            isConnected
              ? 'bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-400'
              : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
          )}
        >
          {isConnected ? 'Connected' : 'Not connected'}
        </span>
      </div>

      {/* Logo Container */}
      <div className="mb-5">
        <div
          className={cn(
            'flex h-14 w-14 items-center justify-center rounded-xl',
            isFeatured
              ? 'bg-primary/10 border border-primary/20'
              : 'bg-gray-100 dark:bg-gray-800'
          )}
        >
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={`${name} logo`} className="h-8 w-8 rounded object-contain" />
          ) : (
            logo
          )}
        </div>
      </div>

      {/* Content */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-foreground">{name}</h3>
        <p className="text-sm text-muted-foreground line-clamp-2 min-h-[2.5rem]">
          {description}
        </p>
      </div>

      {/* Social Proof */}
      <div className="mt-5 space-y-2 text-xs text-gray-500 dark:text-gray-400">
        <div className="flex items-center gap-2">
          <Users className="h-3 w-3" />
          <span>{usersCount.toLocaleString()} connected</span>
        </div>
        <div className="flex items-center gap-2">
          <Star className="h-3 w-3 fill-current" />
          <span>{ratingAvg.toFixed(1)} ({totalReviews.toLocaleString()} reviews)</span>
        </div>
      </div>

      {/* Action Button */}
      <button
        type="button"
        onClick={onAction}
        className={cn(
          'mt-5 w-full rounded-xl px-4 py-3 text-sm font-medium transition-all duration-200',
          'focus:outline-none focus:ring-2 focus:ring-primary/50',
          isConnected
            ? 'bg-secondary text-foreground hover:bg-secondary/80 active:scale-95'
            : 'bg-primary text-white hover:bg-primary/90 active:scale-95'
        )}
      >
        {isConnected ? 'Manage' : 'Connect'}
      </button>
    </div>
  )
}
