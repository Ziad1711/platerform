'use client'

import { ReactNode, useState } from 'react'
import { AlertTriangle, Check, Copy, Info } from 'lucide-react'
import { cn } from '@/lib/utils'

export function DocsSection({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section
      id={id}
      className="scroll-mt-6 border-t border-border/70 pt-8 first:border-t-0 first:pt-0"
    >
      <h2 className="text-xl font-semibold tracking-tight text-foreground">{title}</h2>
      {description ? (
        <p className="mt-2 text-sm leading-7 text-muted-foreground">{description}</p>
      ) : null}
      <div className="mt-5 space-y-4">{children}</div>
    </section>
  )
}

export function CodeBlock({
  title,
  code,
  className,
}: {
  title?: string
  code: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className={cn('overflow-hidden rounded-xl border border-border bg-muted/40', className)}>
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">{title || 'Exemple'}</span>
        <button
          type="button"
          onClick={() => void copy()}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copié' : 'Copier'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed">
        <code className="font-mono">{code}</code>
      </pre>
    </div>
  )
}

export function DocsNote({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warning' | 'success'
  title: string
  children: ReactNode
}) {
  const tones = {
    info: {
      container: 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950',
      title: 'text-blue-800 dark:text-blue-200',
      body: 'text-blue-700 dark:text-blue-300',
      icon: <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />,
    },
    warning: {
      container: 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950',
      title: 'text-amber-800 dark:text-amber-200',
      body: 'text-amber-700 dark:text-amber-300',
      icon: <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />,
    },
    success: {
      container: 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950',
      title: 'text-green-800 dark:text-green-200',
      body: 'text-green-700 dark:text-green-300',
      icon: <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />,
    },
  }

  const style = tones[tone]

  return (
    <div className={cn('rounded-xl border p-4', style.container)}>
      <div className="flex items-start gap-2">
        {style.icon}
        <div className="space-y-1">
          <p className={cn('text-sm font-medium', style.title)}>{title}</p>
          <div className={cn('space-y-1 text-xs', style.body)}>{children}</div>
        </div>
      </div>
    </div>
  )
}

export function DocsTable({
  headers,
  rows,
}: {
  headers: string[]
  rows: ReactNode[][]
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header} className="border-b border-border py-2 pr-3 font-medium text-foreground">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b border-border/50 last:border-0">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="py-2 pr-3 align-top text-muted-foreground">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function DocsCode({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-mono text-foreground">{children}</code>
  )
}

const METHOD_STYLES: Record<string, string> = {
  GET: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600',
  POST: 'border-violet-500/25 bg-violet-500/10 text-violet-600',
  PUT: 'border-amber-500/25 bg-amber-500/10 text-amber-600',
  PATCH: 'border-amber-500/25 bg-amber-500/10 text-amber-600',
  DELETE: 'border-red-500/25 bg-red-500/10 text-red-600',
}

export function MethodBadge({ method, className }: { method: string; className?: string }) {
  const normalized = String(method || '').toUpperCase()

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold tracking-wide',
        METHOD_STYLES[normalized] || 'border-border bg-muted text-muted-foreground',
        className
      )}
    >
      {normalized}
    </span>
  )
}

export function EndpointRow({
  method,
  path,
  scope,
}: {
  method: string
  path: string
  scope?: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2.5">
      <MethodBadge method={method} />
      <code className="font-mono text-xs text-foreground">{path}</code>
      {scope ? <span className="ml-auto text-[11px] text-muted-foreground">{scope}</span> : null}
    </div>
  )
}

export function HttpStatusBadge({ status, className }: { status: number | string; className?: string }) {
  const code = Number(status)
  const tone =
    code >= 500
      ? 'border-red-500/25 bg-red-500/10 text-red-600'
      : code >= 400
        ? 'border-amber-500/25 bg-amber-500/10 text-amber-600'
        : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600'

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold',
        tone,
        className
      )}
    >
      {status}
    </span>
  )
}

