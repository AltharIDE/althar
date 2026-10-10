import { ShiftKind, type Shift } from '../content/shifts'

/*
 * Ordering and grouping for the shifts list. Pure: each takes a list and
 * returns a new one, so the page and the homepage ticker read the same
 * order.
 */

const DAY = 86_400_000
const time = (date: string) => Date.parse(`${date}T00:00:00Z`)

/** Newest first. Same-day shifts keep the order they were written in. */
export const newestFirst = <T extends Shift>(shifts: readonly T[]): T[] =>
  shifts
    .map((s, i) => ({ s, i }))
    .sort((a, b) => time(b.s.date) - time(a.s.date) || a.i - b.i)
    .map(({ s }) => s)

/** Soonest first, for what is still to come. Same-day shifts keep the order they were written in. */
export const soonestFirst = <T extends Shift>(shifts: readonly T[]): T[] =>
  shifts
    .map((s, i) => ({ s, i }))
    .sort((a, b) => time(a.s.date) - time(b.s.date) || a.i - b.i)
    .map(({ s }) => s)

export const latest = (shifts: readonly Shift[], n: number): Shift[] => newestFirst(shifts).slice(0, n)

export interface Month<T extends Shift = Shift> {
  /** YYYY-MM */
  key: string
  label: string
  items: T[]
}

const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })

/** One group per month, in the order given: newest first unless told otherwise. */
export function byMonth<T extends Shift>(shifts: readonly T[], order: (shifts: readonly T[]) => T[] = newestFirst): Month<T>[] {
  const months: Month<T>[] = []
  for (const s of order(shifts)) {
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
export const onlyKind = <T extends Shift>(shifts: readonly T[], kind: ShiftKind | null): T[] =>
  kind ? shifts.filter((s) => s.kind === kind) : [...shifts]

const SHORT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** 30 Sep */
export const shortDate = (date: string) => SHORT.format(time(date))

const today = (now: number) => new Date(now).toISOString().slice(0, 10)

/** What has not happened yet: the shifts dated today or later. */
export const stillAhead = <T extends Shift>(shifts: readonly T[], now: number): T[] => shifts.filter((s) => s.date >= today(now))

/** How far off a day is: today, tomorrow, in 9 days, in 3 months. */
export function untilWord(date: string, now: number): string {
  const days = Math.round((time(date) - time(today(now))) / DAY)
  if (days <= 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days <= 45) return `in ${days} days`
  return `in ${Math.round(days / 30)} months`
}
