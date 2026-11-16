import { useCallback, useState, useSyncExternalStore } from 'react'

/*
 * Times as the thread says them: "just now", "4m ago", "2h ago", then the
 * date. The kit's components take them already written. A time that isn't
 * one, such as an empty one, says nothing: never "Invalid Date" or "NaN".
 */

/** Whether each is a time a date can be read from. */
const known = (...isos: ReadonlyArray<string>) => isos.every((iso) => !Number.isNaN(new Date(iso).getTime()))

/**
 * A day and its month (12 Oct), as the date's `toLocaleDateString` says it, from one formatter made once: making one
 * for each date, as that does, takes a fifth of a millisecond, and a project's thread and board say a hundred at once.
 * It keeps the time zone and the language it found when made: where the system's time zone changes while the app runs,
 * a date near midnight can say the day before or after, and where its language changes, the month keeps the old one's
 * name, until the app is reloaded, where `toLocaleDateString` would follow either change.
 */
let dayMonth: Intl.DateTimeFormat | undefined
const dayAndMonth = (at: Date) => (dayMonth ??= new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })).format(at)

export const ago = (iso: string, now: Date = new Date()): string => {
  if (!known(iso)) return ''
  const then = new Date(iso)
  const seconds = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000))
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return dayAndMonth(then)
}

/** When something comes back, as a clock says it: the time, and the day where it isn't today. */
export const clock = (iso: string, now: Date = new Date()): string => {
  if (!known(iso)) return ''
  const at = new Date(iso)
  const time = at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (at.toDateString() === now.toDateString()) return time
  const soon = at.getTime() - now.getTime() < 6 * 24 * 60 * 60 * 1000
  return `${at.toLocaleDateString(undefined, soon ? { weekday: 'short' } : { day: 'numeric', month: 'short' })} ${time}`
}

/** How long something took, from two instants: "12s", "3m 5s", "1h 4m". */
export const took = (from: string, to: string): string => {
  if (!known(from, to)) return ''
  const seconds = Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** How long something has run, as a board's card says it: "40s", "6m", "1h 4m", "6d 3h". */
export const running = (from: string, now: string): string => {
  if (!known(from, now)) return ''
  const minutes = Math.floor(Math.max(0, new Date(now).getTime() - new Date(from).getTime()) / 60_000)
  if (minutes < 1) return took(from, now)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

/**
 * How long something has run, for a place meant to be glanced at, as the board: "just now" for its first minute, then as
 * `running` says it, so the words change once a minute rather than with every second.
 */
export const runningCalmly = (from: string, now: string): string => {
  if (!known(from, now)) return ''
  return new Date(now).getTime() - new Date(from).getTime() < 60_000 ? 'just now' : running(from, now)
}

/** The paces the time is read at: each second, for how long something has worked; each minute, for how long ago it was. */
export const SECOND = 1000
export const MINUTE = 60_000

/*
 * One clock for the window: each pace has one timer, however many places read
 * it, so what says the time moves on in the same frame, drawn once, and only
 * where it is read. One that starts reading it reads it from now.
 */
interface Pace {
  /** The time it last said: null before anything read it. */
  now: string | null
  readonly listeners: Set<() => void>
  timer: ReturnType<typeof setInterval> | undefined
  /** Said again from now at once, for a place that starts reading it. */
  soon: ReturnType<typeof setTimeout> | undefined
}

const paces = new Map<number, Pace>()

const paceOf = (every: number): Pace => {
  const known = paces.get(every)
  if (known !== undefined) return known
  const pace: Pace = { now: null, listeners: new Set(), timer: undefined, soon: undefined }
  paces.set(every, pace)
  return pace
}

const fresh = () => new Date().toISOString()

const tick = (pace: Pace) => {
  clearTimeout(pace.soon)
  pace.soon = undefined
  pace.now = new Date().toISOString()
  for (const listener of pace.listeners) listener()
}

/** Reads a pace: it ticks while anything does, and says the time from now to each place that starts. */
const listen = (every: number, listener: () => void) => {
  const pace = paceOf(every)
  pace.listeners.add(listener)
  if (pace.timer === undefined) {
    pace.now = fresh()
    pace.timer = setInterval(() => tick(pace), every)
  } else {
    // A screen kept hidden a while (`KeptScreens`) says how long ago from now as it shows again, not from the last tick.
    pace.soon ??= setTimeout(() => tick(pace), 0)
  }
  return () => {
    pace.listeners.delete(listener)
    if (pace.listeners.size > 0) return
    clearInterval(pace.timer)
    clearTimeout(pace.soon)
    pace.timer = undefined
    pace.soon = undefined
  }
}

/** Not ticking: nothing to hear. */
const idle = () => () => {}

/** The later of two times, as ISO strings say them; the second where the first is unknown. */
const later = (one: string | null, other: string) => (one !== null && one > other ? one : other)

/**
 * The time now, as an ISO string, again each second while `ticking`: for how
 * long a running turn has worked. `every` slows it, for what only says how
 * many minutes or hours ago something was. While it ticks it reads its pace's
 * one clock (above); stopped, it keeps the time it last said, and before it
 * ever ticked, the time it was first drawn.
 */
export const useNow = (ticking: boolean, every = SECOND): string => {
  const [held, setHeld] = useState(fresh)
  const [was, setWas] = useState({ ticking, every })
  /** What a pace says, while it runs: one that doesn't says the time from now as something starts reading it. */
  const said = (at: number) => {
    const pace = paceOf(at)
    return pace.timer === undefined ? null : pace.now
  }
  if (was.ticking !== ticking || was.every !== every) {
    setWas({ ticking, every })
    // Stopping, or reading another pace, it keeps what the one it read says now, which it is still reading.
    if (was.ticking) setHeld(later(said(was.every), held))
  }
  const subscribe = useCallback((listener: () => void) => (ticking ? listen(every, listener) : idle()), [ticking, every])
  return useSyncExternalStore(subscribe, () => (ticking ? later(said(every), held) : held))
}
