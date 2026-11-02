import type { AssistantStructuredResponse } from '@/lib/assistant/types'

export default function AssistantComparisonTable({ table, direction }: {
  table: NonNullable<AssistantStructuredResponse['comparison_table']>
  direction: 'rtl' | 'ltr'
}) {
  const arabic = direction === 'rtl'
  const headings = [arabic ? 'المؤشر' : 'Indicateur', table.currentLabel, table.baselineLabel, arabic ? 'الفرق' : 'Écart']
  return <div className="mt-3 max-w-full overflow-x-auto rounded-lg border border-border" role="region" aria-label={arabic ? 'جدول مقارنة الفترات' : 'Tableau comparatif'} tabIndex={0}>
    <table dir={direction} className="w-full min-w-[440px] border-collapse text-xs">
      <thead className="bg-secondary/80"><tr>{headings.map((heading, index) =>
        <th key={index} scope="col" dir={index === 0 || index === 3 ? direction : 'auto'} className="border-b px-2 py-2 text-start font-semibold">{heading}</th>)}</tr></thead>
      <tbody>{table.rows.map((row, index) => <tr key={index} className="odd:bg-card even:bg-secondary/40">
        <th scope="row" className="border-b px-2 py-2 text-start font-medium">{row.label}</th>
        {[row.current, row.baseline, row.delta].map((value, column) =>
          <td key={column} dir="ltr" className="border-b px-2 py-2 text-end tabular-nums whitespace-nowrap"><bdi dir="ltr">{value}</bdi></td>)}
      </tr>)}</tbody>
    </table>
  </div>
}