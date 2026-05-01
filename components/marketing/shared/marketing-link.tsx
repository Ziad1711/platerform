import type { ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { AnimatedButton } from '@/components/marketing/shared/animated-button'
import { cn } from '@/lib/utils'

type MarketingLinkProps = {
  href: string
  children: ReactNode
  variant?: 'primary' | 'secondary' | 'ghost'
  className?: string
}

const variants = {
  primary: 'primary',
  secondary: 'secondary',
  ghost: 'ghost',
} as const

export function MarketingLink({
  href,
  children,
  variant = 'primary',
  className,
}: MarketingLinkProps) {
  return (
    <AnimatedButton href={href} variant={variants[variant]} className={cn(className)}>
      {children}
      {variant === 'primary' ? <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" /> : null}
    </AnimatedButton>
  )
}