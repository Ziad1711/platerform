import { cn } from '@/lib/utils'

type SpotlightProps = {
  className?: string
}

export function Spotlight({ className }: SpotlightProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-0 overflow-hidden',
        className
      )}
    >
      <div className="absolute left-1/2 top-0 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(31,169,113,0.22),rgba(31,169,113,0.08)_28%,transparent_68%)] blur-3xl" />
      <div className="absolute right-[-10%] top-[18%] h-[360px] w-[360px] rounded-full bg-[radial-gradient(circle,rgba(198,139,60,0.14),transparent_60%)] blur-3xl" />
      <div className="absolute left-[-8%] bottom-[6%] h-[300px] w-[300px] rounded-full bg-[radial-gradient(circle,rgba(45,209,143,0.14),transparent_60%)] blur-3xl" />
    </div>
  )
}