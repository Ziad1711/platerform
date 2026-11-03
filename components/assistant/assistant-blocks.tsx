'use client'

/**
 * Rendu d'une réponse en blocs typés.
 *
 * - direction fixée par le document, jamais devinée cellule par cellule ;
 * - valeurs numériques isolées en LTR (aucune inversion de chiffres) ;
 * - aucun HTML brut, aucun Markdown interprété ;
 * - les libellés arrivent déjà localisés depuis le serveur.
 */
import type { ReactNode } from 'react'
import type {
  ChartBlock,
  ResponseBlock,
  ResponseDocument,
  TableBlock,
} from '@/lib/assistant/blocks/types'
import AssistantChartCard from '@/components/assistant/assistant-chart-card'

/** Séquences numériques à isoler du contexte RTL. */
const LTR_RUN = /(\d[\d\s\u00A0\u202F.,:%/-]*|\d{1,2}\s+\S+\s+\d{4})/g

/** Texte mixte : les nombres et dates restent lisibles en lecture LTR. */
export function renderBidiText(text: string): ReactNode {
  const parts = text.split(LTR_RUN)
  if (parts.length === 1) return <bdi dir="auto">{text}</bdi>
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <bdi key={index} dir="ltr" className="inline-block whitespace-nowrap">
        {part}
      </bdi>
    ) : (
      <bdi key={index} dir="auto">{part}</bdi>
    ),
  )
}

function cellDirection(direction: 'ltr' | 'rtl', value: string): 'ltr' | 'rtl' {
  // Une cellule numérique reste LTR même dans un tableau RTL.
  return /^[+\-−]?\d/.test(value.trim()) ? 'ltr' : direction
}

function ComposedTable({ table, direction }: { table: TableBlock; direction: 'ltr' | 'rtl' }) {
  return (
    <div
      dir={direction}
      role="region"
      tabIndex={0}
      aria-label={table.columns.map((column) => column.label).join(' · ')}
      className="mt-2 max-w-full overflow-x-auto rounded-lg border border-border bg-card/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {table.title ? (
        <p className="border-b border-border/60 px-2 py-1.5 text-[11px] font-semibold text-foreground/90">
          {renderBidiText(table.title)}
        </p>
      ) : null}
      <table className="w-full min-w-[20rem] border-collapse text-xs">
        <thead className="bg-secondary/80">
          <tr>
            {table.columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={`border-b border-border px-2 py-2 font-semibold ${
                  column.align === 'end' ? 'text-end' : 'text-start'
                }`}
              >
                <bdi dir={column.direction}>{column.label}</bdi>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row.key} className="odd:bg-card even:bg-secondary/40">
              {row.cells.map((cell, index) => (
                <td
                  key={`${row.key}-${index}`}
                  className={`border-b border-border/60 px-2 py-1.5 ${
                    index === 0 ? 'text-start font-medium' : 'text-end tabular-nums whitespace-nowrap'
                  }`}
                >
                  <bdi dir={cellDirection(index === 0 ? direction : cell.direction, cell.value)}>
                    {cell.value}
                  </bdi>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {table.caption ? (
        <p className="border-t border-border/60 px-2 py-1.5 text-[11px] leading-4 text-muted-foreground">
          {renderBidiText(table.caption)}
        </p>
      ) : null}
    </div>
  )
}

/** Le graphique réutilise la carte Recharts existante, sans nouveau rendu. */
function ComposedChart({ chart, direction }: { chart: ChartBlock; direction: 'ltr' | 'rtl' }) {
  const seriesKey = Object.keys(chart.points[0]?.values ?? {})[0]
  if (!seriesKey) return null

  return (
    <div dir={direction} className="mt-2">
      <AssistantChartCard
        response={{
          message_text: '',
          chart: true,
          chart_type: chart.kind,
          chart_unit: chart.unit,
          chart_title: chart.title,
          chart_data: chart.points.map((point) => ({
            date: point.x,
            value: point.values[seriesKey] ?? null,
            valueLabel:
              point.values[seriesKey] === null || point.values[seriesKey] === undefined
                ? ''
                : String(point.values[seriesKey]),
          })),
        }}
      />
    </div>
  )
}

function BlockView({ block, direction }: { block: ResponseBlock; direction: 'ltr' | 'rtl' }) {
  switch (block.type) {
    case 'summary':
      return <p className="text-sm leading-6 text-foreground">{renderBidiText(block.text)}</p>

    case 'kpi':
      return (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {block.items.map((item) => (
            <span
              key={item.id}
              className="inline-flex items-baseline gap-1 rounded-md border border-border bg-secondary/60 px-2 py-1"
            >
              <bdi dir="auto" className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {item.label}
              </bdi>
              <bdi dir="ltr" className="text-[12px] font-semibold tabular-nums text-foreground">
                {item.value}
              </bdi>
              {item.state === 'partial' ? (
                <span aria-hidden className="text-[10px] text-amber-600">•</span>
              ) : null}
            </span>
          ))}
        </div>
      )

    case 'table':
      return <ComposedTable table={block.table} direction={direction} />

    case 'chart':
      return <ComposedChart chart={block.chart} direction={direction} />

    case 'insights':
    case 'recommendations':
      return (
        <div className="mt-2.5">
          <p className="text-xs font-semibold text-foreground">{block.title}</p>
          <ul className="mt-1 list-disc space-y-1 ps-4">
            {block.items.map((item, index) => (
              <li key={index} className="text-[13px] leading-5 text-foreground/90">
                {renderBidiText(item)}
              </li>
            ))}
          </ul>
        </div>
      )

    case 'notice':
      return (
        <div className="mt-2.5 rounded-lg border border-amber-200/70 bg-amber-50/70 px-3 py-2">
          <p className="flex items-start gap-1.5 text-[11px] leading-4 text-amber-800">
            <span aria-hidden className="mt-[3px] inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
            <span>{renderBidiText(block.text)}</span>
          </p>
          {block.details && block.details.length > 0 ? (
            <details className="mt-1.5">
              <summary className="cursor-pointer list-none text-[11px] text-amber-800/90 underline decoration-dotted">
                +
              </summary>
              <ul className="mt-1.5 list-disc space-y-1 ps-4">
                {block.details.map((detail, index) => (
                  <li key={index} className="text-[11px] leading-4 text-amber-800/90">
                    {renderBidiText(detail)}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      )

    case 'clarification':
      return <p className="text-sm leading-6 text-foreground">{renderBidiText(block.question)}</p>

    default:
      return null
  }
}

export default function AssistantBlocks({ document }: { document: ResponseDocument }) {
  const direction = document.direction

  return (
    <div dir={direction} className="space-y-1.5 text-start">
      {document.blocks.map((block, index) => (
        <BlockView key={index} block={block} direction={direction} />
      ))}
    </div>
  )
}
