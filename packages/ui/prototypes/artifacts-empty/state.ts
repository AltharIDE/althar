// Scrappy: what the page shows, kept in the URL so a reload or a screenshot lands on the same view.
import { useSyncExternalStore } from 'react'

export const DIRECTIONS = ['now', 'A', 'B', 'C', 'D'] as const
export type Direction = (typeof DIRECTIONS)[number]
export type Shown = 'empty' | 'one' | 'both'
export type Theme = 'light' | 'dark'
export type Width = 'wide' | 'narrow'

export interface Proto {
  readonly d: Direction
  readonly s: Shown
  readonly t: Theme
  readonly w: Width
  readonly bare: boolean
}

const read = (): Proto => {
  const q = new URLSearchParams(location.search)
  const d = q.get('d')
  return {
    d: (DIRECTIONS as ReadonlyArray<string>).includes(d ?? '') ? (d as Direction) : 'A',
    s: q.get('s') === 'one' ? 'one' : q.get('s') === 'both' ? 'both' : 'empty',
    t: q.get('t') === 'dark' ? 'dark' : 'light',
    w: q.get('w') === 'narrow' ? 'narrow' : 'wide',
    bare: q.has('bare'),
  }
}

let now = read()
const listeners = new Set<() => void>()

export const set = (change: Partial<Proto>) => {
  now = { ...now, ...change }
  const q = new URLSearchParams()
  q.set('d', now.d)
  q.set('s', now.s)
  q.set('t', now.t)
  q.set('w', now.w)
  if (now.bare) q.set('bare', '')
  history.replaceState(null, '', `?${q}`)
  for (const one of listeners) one()
}

export const useProto = () =>
  useSyncExternalStore(
    (on) => (listeners.add(on), () => listeners.delete(on)),
    () => now,
  )

/** Where C and D send the person: the coordinator's conversation, with what they asked for in its composer. */
let asked: string | null = null
const askers = new Set<() => void>()
export const ask = (words: string | null) => {
  asked = words
  for (const one of askers) one()
}
export const useAsked = () =>
  useSyncExternalStore(
    (on) => (askers.add(on), () => askers.delete(on)),
    () => asked,
  )
