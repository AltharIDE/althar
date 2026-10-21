import { Schema } from 'effect'

/*
 * When an automation runs (docs/plans/automations.md, "Schedules"): on some
 * days of the week at a time, or every hour at a minute. Never more often
 * than once an hour. The runtime works out its slots in the Mac's zone of the
 * moment; the window says it in words. Both read the same shape, so the card,
 * the page and the coordinator say it the same way.
 */

/** A day of the week, as ISO numbers it: 1 is Monday, 7 is Sunday. */
export const Weekday = Schema.Literals([1, 2, 3, 4, 5, 6, 7])
export type Weekday = typeof Weekday.Type

/** A time of day on a 24-hour clock: 09:00, 22:30. */
export const TimeOfDay = Schema.String.check(Schema.isPattern(/^([01]\d|2[0-3]):[0-5]\d$/))

export const Schedule = Schema.Union([
  /** On the days named, at the time, where the Mac is. */
  Schema.Struct({ every: Schema.Literal('week'), days: Schema.Array(Weekday).check(Schema.isMinLength(1)), at: TimeOfDay }),
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

/** The schedule in words, inside a sentence: "runs every weekday at 9:00", its days' names as they are. */
export const scheduleInLine = (schedule: Schedule) => {
  const words = scheduleWords(schedule)
  return `${words.charAt(0).toLowerCase()}${words.slice(1)}`
}

/** The schedule in words, as the card and the page say it: "Every weekday at 9:00", "Every hour at :15". */
export const scheduleWords = (schedule: Schedule) =>
  schedule.every === 'hour'
    ? schedule.minute === 0
      ? 'Every hour'
      : `Every hour at :${String(schedule.minute).padStart(2, '0')}`
    : `${daysWords(schedule.days)} at ${timeWords(schedule.at)}`
