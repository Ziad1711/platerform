import type { ReactNode } from 'react'

/** Direction de la réponse entière, sans tenir compte du Markdown, des dates et des montants. */
export function messageDirection(content: string): 'rtl' | 'ltr' {
  const plain = content.replace(/^\s*(?:#{1,3}|[-*]|\d+[.)])\s+/gm, '').replace(/\*\*/g, '').replace(/(?:[€$£]\s?)?[+-]?\d+(?:[.,/-]\d+)*(?:\s?(?:MAD|DHS|DH|EUR|USD|%))?/gi, '')
  const arabic = (plain.match(/[\u0621-\u064a\u066e-\u06d3]/g) ?? []).length
  const latin = (plain.match(/[A-Za-z]/g) ?? []).length
  return arabic > 0 && arabic >= latin * 0.5 ? 'rtl' : 'ltr'
}

// Uniquement les séquences numériques à l'intérieur d'une phrase RTL.
// Ne pas englober les espaces, mots arabes ou ponctuation de la phrase.
const NUMBER_RUN = /((?:[€$£]\s?)?[+-]?\d+(?:(?:[.,/-]\d+)|(?:[\u00a0\u202f ]\d{3}))*(?:[\u00a0\u202f ]?(?:MAD|DHS|DH|EUR|USD|%))?)/g

function bidiText(text: string, direction: 'rtl' | 'ltr'): ReactNode {
  if (direction === 'ltr') return text
  return text.split(NUMBER_RUN).map((part, index) => index % 2 === 1
    ? <bdi key={index} dir="ltr">{part}</bdi>
    : part)
}

function inline(text: string, direction: 'rtl' | 'ltr') {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => part.startsWith('**') && part.endsWith('**')
    ? <strong key={index} className="font-semibold">{bidiText(part.slice(2, -2), direction)}</strong>
    : <span key={index}>{bidiText(part, direction)}</span>)
}

function cells(line: string) {
  return line.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'))
    .filter((cell, index, all) => !(all.length > 1 && !cell && (index === 0 || index === all.length - 1)))
}

const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/

export default function AssistantMessageContent({ content, direction }: { content: string; direction: 'rtl' | 'ltr' }) {
  const lines = content.split('\n')
  const nodes: ReactNode[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim()
    if (trimmed.includes('|') && index + 1 < lines.length && TABLE_SEPARATOR.test(lines[index + 1]) && cells(lines[index]).length === cells(lines[index + 1]).length) {
      const headers = cells(lines[index])
      const rows: string[][] = []
      let next = index + 2
      while (next < lines.length && lines[next].includes('|') && cells(lines[next]).length === headers.length) rows.push(cells(lines[next++]))
      nodes.push(<div key={index} className="my-2 max-w-full overflow-x-auto rounded-lg border border-border bg-card/90">
        <table dir={direction} className="min-w-full text-xs"><thead className="bg-secondary"><tr>
          {headers.map((cell, i) => <th key={i} className="border-b px-2 py-1.5 text-start font-semibold"><span dir="auto">{inline(cell, direction)}</span></th>)}
        </tr></thead><tbody>{rows.map((row, i) => <tr key={i} className="odd:bg-card even:bg-secondary/60">
          {row.map((cell, j) => <td key={j} className="border-b px-2 py-1.5 text-start"><span dir="auto">{inline(cell, direction)}</span></td>)}
        </tr>)}</tbody></table>
      </div>)
      index = next - 1
      continue
    }
    if (/^#{1,3}\s+/.test(trimmed)) {
      const heading = trimmed.replace(/^#{1,3}\s+/, '')
      nodes.push(<h3 key={index} className="mt-3 first:mt-0 text-sm font-semibold text-start">{inline(heading, direction)}</h3>)
      continue
    }
    const numbered = /^(\d+)[.)]\s+/.exec(trimmed)
    if (numbered || trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const marker = numbered ? `${numbered[1]}.` : '•'
      const value = numbered ? trimmed.slice(numbered[0].length) : trimmed.slice(2)
      nodes.push(<div key={index} className="flex min-w-0 items-start gap-2 text-start">
        <span dir="ltr" className="shrink-0 tabular-nums text-muted-foreground">{marker}</span>
        <span className="min-w-0 flex-1">{inline(value, direction)}</span>
      </div>)
      continue
    }
    if (!trimmed) { nodes.push(<div key={index} className="h-2" />); continue }
    nodes.push(<p key={index} className="text-start">{inline(lines[index], direction)}</p>)
  }

  return <div dir={direction} lang={direction === 'rtl' ? 'ar' : 'fr'} className="space-y-1 text-start [unicode-bidi:isolate]">{nodes}</div>
}