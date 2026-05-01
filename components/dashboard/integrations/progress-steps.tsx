'use client'

type ProgressStep = {
  key: string
  label: string
}

export default function ProgressSteps({ steps, currentStep }: { steps: ProgressStep[]; currentStep: string }) {
  const currentIndex = Math.max(steps.findIndex((step) => step.key === currentStep), 0)

  return (
    <div className="space-y-2">
      {steps.map((step, index) => {
        const done = index < currentIndex
        const active = step.key === currentStep

        return (
          <div key={step.key} className="flex items-center gap-3">
            <div className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs ${done ? 'border-emerald-500 bg-emerald-500 text-white' : active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground'}`}>
              {done ? '✓' : index + 1}
            </div>
            <span className={active ? 'text-sm font-medium text-foreground' : 'text-sm text-muted-foreground'}>{step.label}</span>
          </div>
        )
      })}
    </div>
  )
}