import type { Schedule, Weekday } from '@althar/contracts'
import { DateTime, Duration, Option } from 'effect'

/*
 * An automation's slots (docs/plans/automations.md, "Schedules"). A slot is
 * the local date and time its schedule says, `2026-10-21T09:00`, not when it
 * starts: it is how an occurrence is told apart from every other, so a day's
 * 9:00 runs once however the clock moves. Its time comes in the computer's zone of
 * the moment, as Calendar's floating times do: a 2:30 a daylight-saving
 * change skips comes at 3:30, a 1:30 it repeats comes the first time, and
 * flying across zones never brings a day's 9:00 twice.
 */

/** A local date and time, to the minute: `2026-10-21T09:00`. Slots sort as their text does. */
export type Slot = string

/** Never more than this after its time: a nightly 2:00 still runs at 8:52, and nothing older does. */
export const MOST_LATE = Duration.hours(12)

/** How far after its time an automation starts at most, so those due together start apart. */
export const MOST_STAGGER = Duration.minutes(4)

const pad = (n: number) => String(n).padStart(2, '0')

const slotOf = (year: number, month: number, day: number, hour: number, minute: number): Slot =>
  `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`

const partsOf = (slot: Slot) => {
  const [date = '', time = ''] = slot.split('T')
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number)
  const [hour = 0, minute = 0] = time.split(':').map(Number)
  return { year, month, day, hour, minute }
}

/** A local date and time moved on by days and minutes, on the calendar alone. */
const moved = (slot: Slot, days: number, minutes = 0): Slot => {
  const { year, month, day, hour, minute } = partsOf(slot)
  const at = new Date(Date.UTC(year, month - 1, day + days, hour, minute + minutes))
  return slotOf(at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate(), at.getUTCHours(), at.getUTCMinutes())
}

/** A slot's day of the week, as ISO numbers it. */
const weekdayOf = (slot: Slot): Weekday => {
  const { year, month, day } = partsOf(slot)
  const sunday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return (sunday === 0 ? 7 : sunday) as Weekday
}

/** The same day at another time. */
const atTime = (slot: Slot, hour: number, minute: number): Slot => {
  const { year, month, day } = partsOf(slot)
  return slotOf(year, month, day, hour, minute)
}

const timeOf = (at: string) => {
  const [hour = 0, minute = 0] = at.split(':').map(Number)
  return { hour, minute }
}

/** How many days a month has: 28 to 31, February's 29 in a leap year. */
const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate()

/** A month some months on from one, as a year and month. */
const monthsOn = (year: number, month: number, by: number) => {
  const index = year * 12 + (month - 1) + by
  return { year: Math.floor(index / 12), month: (index % 12) + 1 }
}

/**
 * The monthly schedule's slot in a month: its day, or the last of the month
 * where it doesn't have it (the 31st in April, the 30th in February), or the
 * nth weekday, the last of them counted from the month's end.
 */
const slotInMonth = (schedule: Extract<Schedule, { every: 'month' }>, year: number, month: number): Slot => {
  const { hour, minute } = timeOf(schedule.at)
  const last = daysIn(year, month)
  const { on } = schedule
  if ('day' in on) return slotOf(year, month, on.day === -1 ? last : Math.min(on.day, last), hour, minute)
  const weekday = (day: number) => weekdayOf(slotOf(year, month, day, 0, 0))
  const day = on.nth === -1 ? last - ((weekday(last) - on.weekday + 7) % 7) : 1 + ((on.weekday - weekday(1) + 7) % 7) + (on.nth - 1) * 7
  return slotOf(year, month, day, hour, minute)
}

/** The schedule's first slot after a local time. */
export const slotAfter = (schedule: Schedule, local: Slot): Slot => {
  if (schedule.every === 'hour') {
    const here = atTime(local, partsOf(local).hour, schedule.minute)
    return here > local ? here : moved(here, 0, 60)
  }
  if (schedule.every === 'month') {
    const { year, month } = partsOf(local)
    // This month's slot may be past already; next month's never is.
    for (let ahead = 0; ahead <= 1; ahead++) {
      const on = monthsOn(year, month, ahead)
      const candidate = slotInMonth(schedule, on.year, on.month)
      if (candidate > local) return candidate
    }
    // Unreachable: next month's slot is always after.
    return moved(local, 31)
  }
  const { hour, minute } = timeOf(schedule.at)
  for (let days = 0; days <= 7; days++) {
    const candidate = atTime(moved(local, days), hour, minute)
    if (candidate > local && schedule.days.includes(weekdayOf(candidate))) return candidate
  }
  // Unreachable with at least one day: a week on always has it.
  return atTime(moved(local, 7), hour, minute)
}

/** The schedule's last slot at or before a local time. */
export const slotAtOrBefore = (schedule: Schedule, local: Slot): Slot => {
  if (schedule.every === 'hour') {
    const here = atTime(local, partsOf(local).hour, schedule.minute)
    return here <= local ? here : moved(here, 0, -60)
  }
  if (schedule.every === 'month') {
    const { year, month } = partsOf(local)
    // This month's slot may not have come yet; last month's always has.
    for (let back = 0; back <= 1; back++) {
      const on = monthsOn(year, month, -back)
      const candidate = slotInMonth(schedule, on.year, on.month)
      if (candidate <= local) return candidate
    }
    // Unreachable: last month's slot is always before.
    return moved(local, -31)
  }
  const { hour, minute } = timeOf(schedule.at)
  for (let days = 0; days <= 7; days++) {
    const candidate = atTime(moved(local, -days), hour, minute)
    if (candidate <= local && schedule.days.includes(weekdayOf(candidate))) return candidate
  }
  return atTime(moved(local, -7), hour, minute)
}

/** The zone the computer is in now, as its clock says. */
export const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone

/** When a slot comes in a zone, in epoch milliseconds: a time the zone skips comes as much later, one it repeats the first time. */
export const instantOf = (slot: Slot, zone: string): number => {
  const { year, month, day, hour, minute } = partsOf(slot)
  const zoned = DateTime.makeZoned(
    { year, month, day, hour, minute },
    { timeZone: zone, adjustForTimeZone: true, disambiguation: 'compatible' },
  )
  return Option.isSome(zoned) ? DateTime.toEpochMillis(zoned.value) : Date.UTC(year, month - 1, day, hour, minute)
}

/** An instant's local date and time in a zone. */
export const localOf = (at: number, zone: string): Slot => {
  const zoned = DateTime.makeZoned(at, { timeZone: zone })
  const date = Option.isSome(zoned) ? zoned.value : DateTime.makeUnsafe(at)
  const parts = Option.isSome(zoned) ? DateTime.toParts(date) : DateTime.toPartsUtc(date)
  return slotOf(parts.year, parts.month, parts.day, parts.hour, parts.minute)
}

/**
 * A fixed few minutes after its time, the same for an automation every
 * time, from its id: nine automations due at 9:00 don't start at once, and
 * nothing hammers the hour.
 */
export const staggerOf = (id: string): number => {
  // FNV-1a: small, and the same everywhere.
  let hash = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return (hash % (Duration.toSeconds(MOST_STAGGER) + 1)) * 1000
}

/** The last slot whose time, and the stagger after it, has come by now. */
export const lastCome = (schedule: Schedule, now: number, zone: string, stagger = 0): Slot => {
  let slot = slotAtOrBefore(schedule, localOf(now - stagger, zone))
  // A slot a daylight-saving change moved later may not have come yet.
  while (instantOf(slot, zone) + stagger > now) slot = slotAtOrBefore(schedule, moved(slot, 0, -1))
  return slot
}

/** The first slot whose time, and the stagger after it, is still to come. */
export const nextToCome = (schedule: Schedule, now: number, zone: string, stagger = 0): Slot => {
  let slot = slotAfter(schedule, localOf(now - stagger, zone))
  // A local time the zone repeats came the first time already.
  while (instantOf(slot, zone) + stagger <= now) slot = slotAfter(schedule, slot)
  return slot
}

/**
 * How long after its time a slot may still start: half the time to the
 * next, at most 12 hours. A weekday 9:00 runs until 14:00, even on a Friday;
 * an hourly one only within half an hour.
 */
export const windowOf = (schedule: Schedule, slot: Slot, zone: string): number => {
  const gap = instantOf(slotAfter(schedule, slot), zone) - instantOf(slot, zone)
  return Math.min(Math.max(gap, 0) / 2, Duration.toMillis(MOST_LATE))
}
