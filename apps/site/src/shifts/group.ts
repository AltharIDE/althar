import { ShiftKind, type Shift } from '../content/shifts'

/*
 * Ordering and grouping for the shifts list. Pure: each takes a list and
 * returns a new one, so the page and the homepage ticker read the same
 * order.
 */

const DAY = 86_400_000
const time = (date: string) => Date.parse(`${date}T00:00:00Z`)

/** Newest first. Same-day shifts keep the order they were written in. */
export const newestFirst = (shifts: readonly Shift[]): Shift[] =>
  shifts
    .map((s, i) => ({ s, i }))
    .sort((a, b) => time(b.s.date) - time(a.s.date) || a.i - b.i)
    .map(({ s }) => s)

export const latest = (shifts: readonly Shift[], n: number): Shift[] => newestFirst(shifts).slice(0, n)

export interface Month {
  /** YYYY-MM */
  key: string
  label: string
  items: Shift[]
}

const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })

/** One group per month, newest month first, newest shift first within it. */
export function byMonth(shifts: readonly Shift[]): Month[] {
  const months: Month[] = []
  for (const s of newestFirst(shifts)) {
    const key = s.date.slice(0, 7)
    let m = months.at(-1)
    if (m?.key !== key) {
      m = { key, label: MONTH.format(time(s.date)), items: [] }
      months.push(m)
    }
    m.items.push(s)
  }
  return months
}

/** The days from the oldest shift to the newest, both included. */
export function daysCovered(shifts: readonly Shift[]): number {
  if (shifts.length === 0) return 0
  const times = shifts.map((s) => time(s.date))
  return Math.round((Math.max(...times) - Math.min(...times)) / DAY) + 1
}

export function countByKind(shifts: readonly Shift[]): Record<ShiftKind, number> {
  const counts = Object.fromEntries(Object.values(ShiftKind).map((k) => [k, 0])) as Record<ShiftKind, number>
  for (const s of shifts) counts[s.kind] += 1
  return counts
}

/** Only one kind; null keeps them all. */
export const onlyKind = (shifts: readonly Shift[], kind: ShiftKind | null): Shift[] =>
  kind ? shifts.filter((s) => s.kind === kind) : [...shifts]

const SHORT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** 30 Sep */
export const shortDate = (date: string) => SHORT.format(time(date))
