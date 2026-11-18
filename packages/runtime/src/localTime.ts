import { Duration } from 'effect'

import { localOf } from './slots'

/*
 * The person's local date, time and zone, as a lead and the coordinator are told them (DEV-245), from the computer's own
 * clock and zone, so "today" is the person's and never UTC's. Each is told once, in its brief, which stays the same for the
 * session's life and so in the prompt cache, and again only with the first turn after a long gap or a new day: a line in that
 * turn's message, after all that is cached, rather than in every turn.
 */

/**
 * How long a session sits between turns before it is told the time again: four hours. A meeting or lunch leaves the time it
 * was told off by little, and the day the same; past a few hours, as over an evening or a night, "this morning" and "today"
 * go wrong. A new day or zone tells it again however short the gap, as at midnight.
 */
export const TIME_AGAIN_AFTER = Duration.hours(4)

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** An instant's local date and time in a zone, in words: `Wednesday 18 November 2026, 09:05, Europe/Budapest`. */
export const localTimeWords = (at: number, zone: string): string => {
  const [date = '', time = ''] = localOf(at, zone).split('T')
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number)
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] ?? ''
  return `${weekday} ${day} ${MONTHS[month - 1] ?? ''} ${year}, ${time}, ${zone}`
}

/** A brief's line of the person's local date, time and zone. */
export const timeLine = (at: number, zone: string): string =>
  `On the person's computer it is ${localTimeWords(at, zone)}: their local date, time and time zone as this session starts. Go by it for "today", "tomorrow" and any date or time you write, rather than UTC; Althar tells you again when you come back to this conversation after a long while.`

/** What a session is told first in a turn after a long gap or a new day. */
export const timeAgainLine = (at: number, zone: string): string => `(It is now ${localTimeWords(at, zone)} on the person's computer.)`

/** When and in which zone a session was last told the time. */
export interface TimeTold {
  readonly at: number
  readonly zone: string
}

/**
 * Whether a session is told the time again as its turn begins: it never was (since a compaction, say), its zone or local
 * day has changed since, or its last turn ended at least `TIME_AGAIN_AFTER` ago.
 */
export const timeAgain = (told: TimeTold | undefined, lastEnded: number | null, now: number, zone: string): boolean =>
  told === undefined ||
  told.zone !== zone ||
  localOf(told.at, zone).slice(0, 10) !== localOf(now, zone).slice(0, 10) ||
  (lastEnded !== null && now - lastEnded >= Duration.toMillis(TIME_AGAIN_AFTER))
