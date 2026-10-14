// Scrappy: what the page shows (which direction, which message, how the address reads), kept in its URL.
import { useSyncExternalStore } from 'react'

/** T is today's app; A to E the directions. */
export type Direction = 'T' | 'A' | 'B' | 'C' | 'D' | 'E'

/** The directions in the switcher's order, with the short name it shows and the whole name its tooltip says. */
export const DIRECTIONS: ReadonlyArray<{ readonly value: Direction; readonly short: string; readonly name: string }> = [
  { value: 'T', short: 'Today', name: 'Today: the card under the stamp, across the thread' },
  { value: 'A', short: 'A · In the bubble', name: 'In the bubble, under the words; the address becomes its key' },
  { value: 'B', short: 'B · Above', name: 'Above the bubble, at its width, as what was sent with it' },
  { value: 'C', short: 'C · Under', name: 'Under the bubble, part of the message, before its time' },
  { value: 'D', short: 'D · Chip', name: 'A chip in the words; its card opens on pointing or pressing' },
  { value: 'E', short: 'E · Foot line', name: 'One line per link along the bubble’s foot' },
]

/** The message the person sent: short with one link, long with one link, two links, or short with the agent's reply holding a link. */
export type Scenario = 'short' | 'long' | 'two' | 'agent'

const SCENARIOS: ReadonlyArray<Scenario> = ['short', 'long', 'two', 'agent']

export interface Proto {
  readonly direction: Direction
  readonly scenario: Scenario
  /** B and C: the raw address in the text reads as its key, as A does. */
  readonly keys: boolean
  /** No switcher under the window: for screenshots. */
  readonly bare: boolean
}

/** What the URL says: ?d=C&s=two&keys, with the screen in its hash. */
const fromUrl = (): Proto => {
  const params = new URLSearchParams(window.location.search)
  const d = params.get('d')?.toUpperCase()
  const s = params.get('s')
  return {
    direction: DIRECTIONS.find((one) => one.value === d)?.value ?? 'T',
    scenario: SCENARIOS.find((one) => one === s) ?? 'short',
    keys: params.has('keys'),
    bare: params.has('bare'),
  }
}

/** The URL again, from what the page shows, keeping the screen in its hash and the router's history state. */
const toUrl = (next: Proto) => {
  const params = new URLSearchParams(window.location.search)
  params.set('d', next.direction)
  params.set('s', next.scenario)
  if (next.keys) params.set('keys', '')
  else params.delete('keys')
  const search = params.toString().replace(/=(?=&|$)/g, '')
  window.history.replaceState(window.history.state, '', `${window.location.pathname}?${search}${window.location.hash}`)
}

let state: Proto = fromUrl()
const listeners = new Set<() => void>()

export const proto = {
  get: () => state,
  set: (next: Partial<Proto>) => {
    state = { ...state, ...next }
    toUrl(state)
    for (const listener of listeners) listener()
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  /** The direction `by` places on, round the ends. */
  step: (by: -1 | 1) => {
    const at = DIRECTIONS.findIndex((one) => one.value === state.direction)
    proto.set({ direction: DIRECTIONS[(at + by + DIRECTIONS.length) % DIRECTIONS.length]!.value })
  },
}

export const useProto = () => useSyncExternalStore(proto.subscribe, proto.get)
