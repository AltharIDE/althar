/*
 * What the responsiveness run holds each measurement to, and the summary it
 * ends with: one row for each measurement, by an id that stays the same
 * from one commit to the next, so two runs' JSON can be compared row by row
 * (compare.ts). A timing is held to its budget on its p95; the event loop on
 * its p99 and its worst; counts and rates have no budget, and say so.
 */

export const BUDGETS = {
  /** Every call a window makes, a read or a command. */
  call: { ms: 100, source: 'foundations.md, The UI is instant, rule 5: 100 ms for a window call with the Mac busy' },
  loopP99: { ms: 50, source: "this run's: half of lag.ts's 100 ms (foundations.md, The window answers while the computer is busy)" },
  loopMax: { ms: 100, source: 'lag.ts logs a window of five seconds whose loop ran 100 ms late (foundations.md, The window answers)' },
} as const

export type Verdict = 'ok' | 'OVER' | 'info' | 'skipped'

export interface Row {
  /** `phase.group.what`: the same on every commit. */
  readonly id: string
  readonly phase: string
  readonly group: string
  readonly what: string
  readonly unit: string
  readonly n?: number
  readonly p50?: number
  readonly p95?: number
  readonly max?: number
  /** A count or a rate, where it is one. */
  readonly value?: number
  readonly budget?: number
  /** What the budget is held against. */
  readonly on?: 'p95' | 'p99' | 'max'
  readonly source?: string
  readonly verdict: Verdict
  readonly note?: string
}

export interface Timing {
  readonly n: number
  readonly p50: number
  readonly p95: number
  readonly max: number
}

/** A timing's row, held to a window call's budget unless it has none. */
export const timed = (
  phase: string,
  group: string,
  what: string,
  timing: Timing | undefined,
  budget: { readonly ms: number; readonly source: string } | null = BUDGETS.call,
  note?: string,
): Row => {
  const id = `${phase}.${group}.${what}`
  if (timing === undefined || timing.n === 0)
    return { id, phase, group, what, unit: 'ms', verdict: 'skipped', note: note ?? 'nothing measured' }
  return {
    id,
    phase,
    group,
    what,
    unit: 'ms',
    n: timing.n,
    p50: timing.p50,
    p95: timing.p95,
    max: timing.max,
    ...(budget === null
      ? { verdict: 'info' as const }
      : {
          budget: budget.ms,
          on: 'p95' as const,
          source: budget.source,
          verdict: timing.p95 > budget.ms ? ('OVER' as const) : ('ok' as const),
        }),
    ...(note === undefined ? {} : { note }),
  }
}

/** The event loop's rows: its p50, and its p99 and worst, each against its budget. */
export const loop = (
  phase: string,
  group: string,
  delay: { readonly p50: number; readonly p99: number; readonly max: number },
): ReadonlyArray<Row> => [
  { id: `${phase}.${group}.loop p50`, phase, group, what: 'loop p50', unit: 'ms', value: delay.p50, verdict: 'info' },
  {
    id: `${phase}.${group}.loop p99`,
    phase,
    group,
    what: 'loop p99',
    unit: 'ms',
    value: delay.p99,
    budget: BUDGETS.loopP99.ms,
    on: 'p99',
    source: BUDGETS.loopP99.source,
    verdict: delay.p99 > BUDGETS.loopP99.ms ? 'OVER' : 'ok',
  },
  {
    id: `${phase}.${group}.loop max`,
    phase,
    group,
    what: 'loop max',
    unit: 'ms',
    value: delay.max,
    budget: BUDGETS.loopMax.ms,
    on: 'max',
    source: BUDGETS.loopMax.source,
    verdict: delay.max > BUDGETS.loopMax.ms ? 'OVER' : 'ok',
  },
]

/** A count or a rate, with no budget. */
export const counted = (phase: string, group: string, what: string, value: number | undefined, unit: string, note?: string): Row =>
  value === undefined
    ? { id: `${phase}.${group}.${what}`, phase, group, what, unit, verdict: 'skipped', note: note ?? 'not measured on this commit' }
    : {
        id: `${phase}.${group}.${what}`,
        phase,
        group,
        what,
        unit,
        value: Math.round(value * 10) / 10,
        verdict: 'info',
        ...(note === undefined ? {} : { note }),
      }

const cell = (value: number | undefined) => (value === undefined ? '' : String(value))

/** The rows as a table, for stdout. */
export const table = (rows: ReadonlyArray<Row>) => {
  const head = ['measurement', 'n', 'p50', 'p95', 'max/value', 'budget', 'verdict']
  const lines = rows.map((row) => [
    row.id,
    cell(row.n),
    cell(row.p50),
    cell(row.p95),
    cell(row.value ?? row.max),
    row.budget === undefined ? '' : `${row.on} ≤ ${row.budget}`,
    row.verdict + (row.note === undefined ? '' : ` (${row.note})`),
  ])
  const widths = head.map((_, index) => Math.max(head[index]!.length, ...lines.map((line) => line[index]!.length)))
  const line = (cells: ReadonlyArray<string>) =>
    cells
      .map((one, index) => (index === 0 || index === cells.length - 1 ? one.padEnd(widths[index]!) : one.padStart(widths[index]!)))
      .join('  ')
  return [line(head), widths.map((width) => '-'.repeat(width)).join('  '), ...lines.map(line)].join('\n')
}
