import { Schema } from 'effect'

/*
 * When an automation runs (docs/plans/automations.md, "Schedules"): on some
 * days of the week at a time, on a day of the month or the nth weekday of it
 * at a time, or every hour at a minute. Never more often than once an hour. The runtime works out its slots in the computer's zone of the
 * moment; the window says it in words. Both read the same shape, so the card,
 * the page and the coordinator say it the same way.
 */

/** A day of the week, as ISO numbers it: 1 is Monday, 7 is Sunday. */
export const Weekday = Schema.Literals([1, 2, 3, 4, 5, 6, 7])
export type Weekday = typeof Weekday.Type

/** A time of day on a 24-hour clock: 09:00, 22:30. */
export const TimeOfDay = Schema.String.check(Schema.isPattern(/^([01]\d|2[0-3]):[0-5]\d$/))

/** Which of the month's weekdays: the first to the fourth, or the last (-1). */
export const Nth = Schema.Literals([1, 2, 3, 4, -1])
export type Nth = typeof Nth.Type

/**
 * The day a monthly schedule falls on: a day of the month (1 to 31, or -1 for
 * the last), or the nth weekday of it. A day the month doesn't have, the 31st
 * in April, is its last day.
 */
export const MonthDay = Schema.Union([
  Schema.Struct({ day: Schema.Int.check(Schema.makeFilter((day: number) => day === -1 || (day >= 1 && day <= 31))) }),
  Schema.Struct({ weekday: Weekday, nth: Nth }),
])
export type MonthDay = typeof MonthDay.Type

export const Schedule = Schema.Union([
  /** On the days named, at the time, where the computer is. */
  Schema.Struct({ every: Schema.Literal('week'), days: Schema.Array(Weekday).check(Schema.isMinLength(1)), at: TimeOfDay }),
  /** On a day of every month, or its nth weekday, at the time. */
  Schema.Struct({ every: Schema.Literal('month'), on: MonthDay, at: TimeOfDay }),
  /** Every hour, at the minute past. */
  Schema.Struct({ every: Schema.Literal('hour'), minute: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 59 })) }),
])
export type Schedule = typeof Schedule.Type

const DAYS: Readonly<Record<Weekday, string>> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
}

/** Its days in order, each once. */
export const daysOf = (days: ReadonlyArray<Weekday>): ReadonlyArray<Weekday> => [...new Set(days)].toSorted((a, b) => a - b)

const same = (a: ReadonlyArray<Weekday>, b: ReadonlyArray<Weekday>) => a.length === b.length && a.every((day, i) => day === b[i])

/** A time as people say it: 9:00, 22:30. */
export const timeWords = (at: string) => at.replace(/^0(\d)/, '$1')

/** Its days in a few words: every day, every weekday, every Friday, Monday and Thursday. */
export const daysWords = (days: ReadonlyArray<Weekday>) => {
  const sorted = daysOf(days)
  if (sorted.length === 7) return 'Every day'
  if (same(sorted, [1, 2, 3, 4, 5])) return 'Every weekday'
  if (same(sorted, [6, 7])) return 'Every weekend'
  const names = sorted.map((day) => DAYS[day])
  if (names.length === 1) return `Every ${names[0] ?? ''}`
  return `Every ${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`
}

const NTHS: Readonly<Record<Nth, string>> = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', [-1]: 'last' }

/** A number as a day of the month says it: 1st, 2nd, 3rd, 11th, 22nd. */
export const ordinal = (n: number) => {
  const tail = n % 100
  const suffix = tail >= 11 && tail <= 13 ? 'th' : (({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th')
  return `${n}${suffix}`
}

/** Which day of the month, in words: "the 1st", "the last day", "the first Monday". */
export const monthDayWords = (on: MonthDay) =>
  'weekday' in on ? `the ${NTHS[on.nth]} ${DAYS[on.weekday]}` : on.day === -1 ? 'the last day' : `the ${ordinal(on.day)}`

/** A monthly day the month may not have: the 29th to the 31st, which a shorter month runs on its last day. */
export const shortMonthsApply = (schedule: Schedule) => schedule.every === 'month' && 'day' in schedule.on && schedule.on.day >= 29

/** The schedule in words, inside a sentence: "runs every weekday at 9:00", its days' names as they are. */
export const scheduleInLine = (schedule: Schedule) => {
  const words = scheduleWords(schedule)
  return `${words.charAt(0).toLowerCase()}${words.slice(1)}`
}

/** The schedule in words, as the card and the page say it: "Every weekday at 9:00", "Every night at 2:00", "Every hour at :15". */
export const scheduleWords = (schedule: Schedule) => {
  if (schedule.every === 'hour') return schedule.minute === 0 ? 'Every hour' : `Every hour at :${String(schedule.minute).padStart(2, '0')}`
  if (schedule.every === 'month') return `Monthly, on ${monthDayWords(schedule.on)} at ${timeWords(schedule.at)}`
  // Every day in the small hours is every night.
  const night = daysOf(schedule.days).length === 7 && schedule.at < '06:00'
  return `${night ? 'Every night' : daysWords(schedule.days)} at ${timeWords(schedule.at)}`
}
