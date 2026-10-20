// Scrappy: plan usage read the way every direction needs it: an account's tightest window, the account Althar would take for an agent (its route), and the words for windows and times.
import type { AccountUsage, PlanUsage, UsageWindow } from '@althar/contracts'

/** One window of an account, as the share left. */
export interface Room {
  readonly kind: UsageWindow['kind']
  readonly label: string | null
  /** 0 to 100. */
  readonly left: number
  readonly resetsAt: string | null
}

export const roomOf = (window: UsageWindow): Room => ({
  kind: window.kind,
  label: window.label,
  left: Math.max(0, Math.min(100, Math.round(100 - window.usedPercent))),
  resetsAt: window.resetsAt,
})

/** Whether Althar has numbers for it: a sign-in with windows, read, not a fault with nothing. */
export const readable = (account: AccountUsage): boolean => account.windows.length > 0

/** A model's own window counts for it alone: Opus's week for Opus. */
const counts = (window: UsageWindow, model: string | null | undefined) =>
  window.label === null || (model != null && model.toLowerCase().includes(window.label.toLowerCase()))

/** The window that runs out first for this account, for a model where one is named. */
export const tightestOf = (account: AccountUsage, model?: string | null): Room | null => {
  const rooms = account.windows.filter((window) => counts(window, model)).map(roomOf)
  return rooms.length === 0 ? null : rooms.reduce((low, room) => (room.left < low.left ? room : low))
}

/** The account Althar would start an agent's step on: the one with most room in its tightest window. Null where none can be read. */
export const routeOf = (
  usage: PlanUsage | null,
  agentId: string,
  model?: string | null,
): { readonly account: AccountUsage; readonly room: Room; readonly several: boolean } | null => {
  const accounts = (usage?.accounts ?? []).filter((account) => account.agentId === agentId)
  const read = accounts.flatMap((account) => {
    const room = tightestOf(account, model)
    return room === null ? [] : [{ account, room }]
  })
  if (read.length === 0) return null
  const best = read.reduce((most, one) => (one.room.left > most.room.left ? one : most))
  return { ...best, several: accounts.length > 1 }
}

/** The agents with nothing to read, by name, in the order listed. */
export const unreadOf = (usage: PlanUsage | null): ReadonlyArray<string> => {
  const names = new Map<string, boolean>()
  for (const account of usage?.accounts ?? []) names.set(account.agentName, (names.get(account.agentName) ?? false) || readable(account))
  return [...names].filter(([, read]) => !read).map(([name]) => name)
}

/** "GitHub Copilot, Junie and Mistral Vibe". */
export const listed = (names: ReadonlyArray<string>): string =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`

/** A window as a sentence names it: "five-hour limit", "weekly Opus limit". */
export const limitWords = (room: Pick<Room, 'kind' | 'label'>): string => {
  const length = { five_hour: 'five-hour', weekly: 'weekly', monthly: 'monthly', other: '' }[room.kind]
  return [length, room.label, 'limit'].filter((word) => word !== null && word !== '').join(' ')
}

/** A window as a row names it: 5 hours, Week, Opus week. */
export const windowLabel = (room: Pick<Room, 'kind' | 'label'>): string => {
  const kind = { five_hour: '5 hours', weekly: 'Week', monthly: 'Month', other: '' }[room.kind]
  if (room.label === null) return kind
  return room.kind === 'other' ? room.label : `${room.label} ${kind.toLowerCase()}`
}

/** A window as a sentence ends: the five hours, the week, the Opus week. */
export const windowPhrase = (room: Pick<Room, 'kind' | 'label'>): string => {
  const kind = { five_hour: 'five hours', weekly: 'week', monthly: 'month', other: 'window' }[room.kind]
  return room.label === null ? `the ${kind}` : room.kind === 'other' ? `the ${room.label} window` : `the ${room.label} ${kind}`
}

const time = (at: Date) => at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

/** When, in a sentence: 14:00 today, else Monday 09:00 within the week, else 3 November 09:00. */
export const whenWords = (iso: string, now: Date = new Date()): string => {
  const at = new Date(iso)
  if (at.toDateString() === now.toDateString()) return time(at)
  const soon = at.getTime() - now.getTime() < 6 * 24 * 60 * 60 * 1000
  return `${at.toLocaleDateString('en-GB', soon ? { weekday: 'long' } : { day: 'numeric', month: 'long' })} ${time(at)}`
}

/** When, on a chip: 14:00 today, else Mon 09:00. */
export const whenShort = (iso: string, now: Date = new Date()): string => {
  const at = new Date(iso)
  if (at.toDateString() === now.toDateString()) return time(at)
  const soon = at.getTime() - now.getTime() < 6 * 24 * 60 * 60 * 1000
  return `${at.toLocaleDateString('en-GB', soon ? { weekday: 'short' } : { day: 'numeric', month: 'short' })} ${time(at)}`
}

/** An account as words name it: its agent, and its own name only where the agent has several. */
export const whoOf = (account: Pick<AccountUsage, 'agentName' | 'accountName'>, several: boolean): string =>
  several ? `${account.agentName} ${account.accountName}` : account.agentName

/** How long ago, in a few words. */
export const agoWords = (iso: string, now: Date = new Date()): string => {
  const minutes = Math.round((now.getTime() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  return hours === 1 ? 'an hour ago' : `${hours} hours ago`
}
