import { readFileSync } from 'node:fs'

/*
 * Two responsiveness runs side by side, row by row (budgets.ts), as a before
 * and after: `bun tests/real/compare.ts before.json after.json`. Each row's
 * p50 and p95, or its value, before and after, how much it changed, and its
 * verdict before and after; then the rows only one of them has.
 */

interface Row {
  readonly id: string
  readonly unit: string
  readonly p50?: number
  readonly p95?: number
  readonly value?: number
  readonly budget?: number
  readonly on?: string
  readonly verdict: string
}

// Read through `head` or the like, which stops reading: nothing more to say.
process.stdout.on('error', () => process.exit(0))
const [before, after] = process.argv.slice(2)
if (before === undefined || after === undefined) {
  process.stderr.write('usage: bun tests/real/compare.ts before.json after.json\n')
  process.exit(2)
}
const rowsOf = (file: string) => {
  const read = JSON.parse(readFileSync(file, 'utf8')) as { readonly commit?: string; readonly summary?: ReadonlyArray<Row> }
  return { commit: read.commit ?? '?', rows: new Map((read.summary ?? []).map((row) => [row.id, row])) }
}
const was = rowsOf(before)
const now = rowsOf(after)

/** What a row says: its p50 and p95, or its value. */
const said = (row: Row | undefined) =>
  row === undefined ? '' : row.p95 !== undefined ? `${row.p50}/${row.p95}` : row.value === undefined ? row.verdict : String(row.value)
/** What a row is compared by: its p95, or its value. */
const by = (row: Row | undefined) => row?.p95 ?? row?.value
const change = (from: Row | undefined, to: Row | undefined) => {
  const a = by(from)
  const b = by(to)
  if (a === undefined || b === undefined) return ''
  if (a === 0) return b === 0 ? '0%' : 'new'
  const percent = Math.round(((b - a) / a) * 100)
  return `${percent > 0 ? '+' : ''}${percent}%`
}

const ids = [...was.rows.keys(), ...[...now.rows.keys()].filter((id) => !was.rows.has(id))]
const head = ['measurement', `before ${was.commit.slice(0, 8)}`, `after ${now.commit.slice(0, 8)}`, 'change', 'budget', 'verdict']
const lines = ids.map((id) => {
  const from = was.rows.get(id)
  const to = now.rows.get(id)
  const budget = (to ?? from)?.budget
  return [
    `${id}${(to ?? from)?.p95 === undefined ? ` (${(to ?? from)?.unit})` : ''}`,
    said(from),
    said(to),
    change(from, to),
    budget === undefined ? '' : `${(to ?? from)?.on} ≤ ${budget}`,
    `${from?.verdict ?? '-'} → ${to?.verdict ?? '-'}`,
  ]
})
const widths = head.map((_, index) => Math.max(head[index]!.length, ...lines.map((line) => line[index]!.length)))
const print = (cells: ReadonlyArray<string>) =>
  process.stdout.write(
    `${cells.map((one, index) => (index === 0 || index === cells.length - 1 ? one.padEnd(widths[index]!) : one.padStart(widths[index]!))).join('  ')}\n`,
  )
print(head)
print(widths.map((width) => '-'.repeat(width)))
for (const line of lines) print(line)
const over = (rows: ReadonlyMap<string, Row>) => [...rows.values()].filter((row) => row.verdict === 'OVER').length
process.stdout.write(
  `\nover budget: ${over(was.rows)} before, ${over(now.rows)} after (p50/p95 in ms; change is of the p95, or the value)\n`,
)
