import { useSyncExternalStore } from 'react'

import type { makeRouter } from '../../src/renderer/router'

/*
 * What the lab's pieces share: which direction ⌘K opens, the words typed
 * (kept across directions, so one search can be compared in each), whether
 * the window is drawn at the app's narrowest, what was opened from search
 * and how often (the ranking's habit), and a line saying what an action
 * would have done, since nothing here acts. The direction and the window's
 * width live in the address's query, beside the app's place in its hash.
 */

export const DIRECTIONS = ['today', 'a', 'b', 'c'] as const
export type Direction = (typeof DIRECTIONS)[number]

export const NAMES: Readonly<Record<Direction, string>> = {
  today: 'Today',
  a: 'A · One box',
  b: 'B · Scopes',
  c: 'C · What was said',
}

export const LINES: Readonly<Record<Direction, string>> = {
  today: 'Tasks only, by the words they hold; waits for typing to pause.',
  a: 'Everything in one ranked list, grouped by kind, every row acts. → for its actions, Tab to narrow.',
  b: 'Goes to things by name; a prefix or Tab scopes it: > actions, # pull requests and issues, / files, " what was said, ! notes, @ a project.',
  c: 'Searches what was said, shows the passage, opens the thread at it; ask the coordinator when search can’t answer.',
}

const store = <A>(initial: A) => {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: (next: A | ((now: A) => A)) => {
      const was = value
      value = typeof next === 'function' ? (next as (now: A) => A)(value) : next
      if (value !== was) for (const listener of listeners) listener()
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
  }
}

const query = new URLSearchParams(window.location.search)
const asked = (query.get('d') ?? '').toLowerCase()

export const direction = store<Direction>(DIRECTIONS.find((one) => one === asked) ?? 'a')
export const narrow = store(query.get('narrow') === '1')
/** The words in the box, kept while it is closed and across directions. */
export const words = store(query.get('q') ?? '')
/** Whether the box is open, as the app's TabsFrame says (it mounts it). */
export const opened = store(false)
/** What an action would have done, for a moment. */
export const said = store<string | null>(null)

const toAddress = () => {
  const next = new URLSearchParams(window.location.search)
  next.set('d', direction.get().toUpperCase())
  if (narrow.get()) next.set('narrow', '1')
  else next.delete('narrow')
  window.history.replaceState(window.history.state, '', `${window.location.pathname}?${next.toString()}${window.location.hash}`)
}
direction.subscribe(toAddress)
narrow.subscribe(toAddress)

export const useStore = <A>(one: { get: () => A; subscribe: (listener: () => void) => () => void }) =>
  useSyncExternalStore(one.subscribe, one.get)

let saying: ReturnType<typeof setTimeout> | undefined
/** Says what an action would have done, for a few seconds. */
export const say = (line: string) => {
  said.set(line)
  clearTimeout(saying)
  saying = setTimeout(() => said.set(null), 3200)
}

/** The app's router, for opening what search finds. */
export const router: { current: ReturnType<typeof makeRouter> | null } = { current: null }

/** Opens the box, as ⌘K does. */
export const openSearch = () => {
  const isMac = /Mac/.test(navigator.platform)
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', metaKey: isMac, ctrlKey: !isMac, bubbles: true }))
}

/* The habit: what was opened from search, how often and when last. Seeded so Recent reads like a week of use. */
const USED = 'search-lab.used'
export interface Use {
  readonly n: number
  readonly at: number
}
const seeded: Record<string, Use> = {
  'task:prototype-search-across-althar': { n: 6, at: Date.now() - 5 * 60_000 },
  'task:make-small-changes-fast': { n: 9, at: Date.now() - 40 * 60_000 },
  'task:cap-parallel-agents-per-machine': { n: 4, at: Date.now() - 2 * 3600_000 },
  'conversation:p_althar': { n: 14, at: Date.now() - 30 * 60_000 },
  'action:settings': { n: 3, at: Date.now() - 26 * 3600_000 },
  'action:run': { n: 7, at: Date.now() - 3 * 3600_000 },
  'pull:845': { n: 2, at: Date.now() - 3 * 3600_000 },
  'issue:DEV-236': { n: 1, at: Date.now() - 4 * 24 * 3600_000 },
  'note:n_rebase': { n: 2, at: Date.now() - 2 * 24 * 3600_000 },
  'task:show-refund-status-on-receipts': { n: 3, at: Date.now() - 6 * 3600_000 },
}
const readUsed = (): Record<string, Use> => {
  try {
    return { ...seeded, ...(JSON.parse(window.localStorage.getItem(USED) ?? '{}') as Record<string, Use>) }
  } catch {
    return seeded
  }
}
export const used = store<Record<string, Use>>(readUsed())
export const remember = (id: string) => {
  used.set((now) => ({ ...now, [id]: { n: (now[id]?.n ?? 0) + 1, at: Date.now() } }))
  try {
    window.localStorage.setItem(USED, JSON.stringify(used.get()))
  } catch {
    // Kept for this page only.
  }
}
