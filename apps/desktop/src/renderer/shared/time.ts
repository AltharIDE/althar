import { useEffect, useState } from 'react'

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
  // A weekday names a coming day; a past one would read as the next such day, so it gets its date.
  const ahead = at.getTime() - now.getTime()
  const soon = ahead >= 0 && ahead < 6 * 24 * 60 * 60 * 1000
  return `${at.toLocaleDateString(undefined, soon ? { weekday: 'short' } : { day: 'numeric', month: 'short' })} ${time}`
}

/**
 * How long until a time, as a plan window's reset says it: "in 45m", "in 2h 10m", "in 1d 3h". Whole minutes, rounded up so
 * it never says 0 before it arrives; from a day, days and hours. Null for a time that isn't one or has passed.
 */
export const timeLeft = (iso: string, now: Date = new Date()): string | null => {
  if (!known(iso)) return null
  const ms = new Date(iso).getTime() - now.getTime()
  if (ms <= 0) return null
  const minutes = Math.ceil(ms / 60_000)
  if (minutes < 60) return `in ${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours < 24) return rest === 0 ? `in ${hours}h` : `in ${hours}h ${rest}m`
  const days = Math.floor(hours / 24)
  const more = hours % 24
  return more === 0 ? `in ${days}d` : `in ${days}d ${more}h`
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

/**
 * The time now, as an ISO string, again each second while `ticking`: for how
 * long a running turn has worked. `every` slows it, for what only says how
 * many minutes or hours ago something was.
 */
export const useNow = (ticking: boolean, every = 1000): string => {
  const [now, setNow] = useState(() => new Date().toISOString())
  useEffect(() => {
    if (!ticking) return
    const tick = () => setNow(new Date().toISOString())
    // A screen kept hidden a while (`KeptScreens`) says how long ago from now as it shows again, not from when it hid.
    const again = setTimeout(tick, 0)
    const id = setInterval(tick, every)
    return () => {
      clearTimeout(again)
      clearInterval(id)
    }
  }, [ticking, every])
  return now
}
