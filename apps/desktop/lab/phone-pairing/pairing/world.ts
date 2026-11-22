import { useEffect, useState, useSyncExternalStore } from 'react'

import { type HomeKey, lab, type PhoneCount, useLab } from '../state'
import { printSeed, wordsOf } from './print'

/*
 * The phones side of the lab's made-up world: each home as a phone would see
 * it (its id, its key's pin, where it answers), the phones each has paired,
 * and the one pairing code each may have out, with its five minutes. The
 * bar's "Phone pairs" stands in for the phone pressing Pair; "Run out" for
 * the five minutes passing.
 */

export const LIFETIME = 5 * 60_000

export interface LabHome {
  readonly key: HomeKey
  /** As the window names it. */
  readonly name: string
  readonly homeId: string
  readonly tlsKeyPin: string
  /** Where a phone reaches it. */
  readonly origin: string
}

export const HOMES: Readonly<Record<HomeKey, LabHome>> = {
  mac: {
    key: 'mac',
    name: 'This Mac',
    homeId: 'home_5c1e0a7d93b24f6e8a01c2d3e4f5a6b7',
    tlsKeyPin: '3f2a9c4d1e8b7a6f5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b',
    origin: 'https://macbook.tail4a2b.ts.net:6769',
  },
  studio: {
    key: 'studio',
    name: 'studio',
    homeId: 'home_8e2b41c07a9d4e3f9b6c5d4e3f2a1b0c',
    tlsKeyPin: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9',
    origin: 'https://studio.tail4a2b.ts.net:6769',
  },
}

export const seedOf = (home: LabHome) => printSeed(home.homeId, home.tlsKeyPin)
export const wordsOfHome = (home: LabHome) => wordsOf(seedOf(home))

export interface Phone {
  readonly id: string
  /** As it named itself pairing: iPhone, or Android phone, until the person renames it there. */
  readonly name: string
  readonly paired: string
  /** `now` while connected; else when it last was. */
  readonly seen: string
  /** Paired this minute, in the lab. */
  readonly fresh?: boolean
}

const PHONES: Readonly<Record<PhoneCount, ReadonlyArray<Phone>>> = {
  none: [],
  two: [
    { id: 'dev_1a2b3c4d5e6f708192a3b4c5d6e7f809', name: 'iPhone', paired: '3 Nov', seen: 'now' },
    { id: 'dev_9f8e7d6c5b4a39281706f5e4d3c2b1a0', name: 'Android phone', paired: '12 Oct', seen: '2 days ago' },
  ],
  many: [
    { id: 'dev_1a2b3c4d5e6f708192a3b4c5d6e7f809', name: 'iPhone', paired: '3 Nov', seen: 'now' },
    { id: 'dev_9f8e7d6c5b4a39281706f5e4d3c2b1a0', name: 'Android phone', paired: '12 Oct', seen: '2 days ago' },
    { id: 'dev_2b3c4d5e6f708192a3b4c5d6e7f8091a', name: 'iPhone', paired: '1 Oct', seen: '3 weeks ago' },
    {
      id: 'dev_3c4d5e6f708192a3b4c5d6e7f8091a2b',
      name: 'The old iPhone 13 mini kept in the kitchen drawer for testing builds',
      paired: '14 Aug',
      seen: '2 months ago',
    },
    { id: 'dev_4d5e6f708192a3b4c5d6e7f8091a2b3c', name: 'Pixel tablet', paired: '2 Aug', seen: '2 months ago' },
  ],
}

/** A pairing code out for a home: waiting for a phone, run out, or used by the phone it paired. */
export interface Invitation {
  readonly token: string
  readonly expiresAt: number
  readonly state: 'waiting' | 'paired' | 'expired'
  /** The phone it paired. */
  readonly phone?: Phone
}

interface World {
  /** The phones each home has paired, as the lab's bar last set them, with what was done since. */
  readonly phones: Readonly<Record<HomeKey, ReadonlyArray<Phone>>>
  readonly invitations: Readonly<Partial<Record<HomeKey, Invitation>>>
  /** This Mac lets phones in, once the person said so; studio, once its host listens. */
  readonly count: PhoneCount
}

const token = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[b % 64])
    .join('')
    .slice(0, 43)

const fresh = (count: PhoneCount): World => ({
  phones: { mac: PHONES[count], studio: PHONES[count].slice(0, count === 'two' ? 1 : undefined) },
  invitations: {},
  count,
})

let world = fresh(lab.get().phones)
const listeners = new Set<() => void>()
const set = (next: World) => {
  world = next
  for (const listener of listeners) listener()
}
lab.subscribe(() => {
  if (lab.get().phones !== world.count) set(fresh(lab.get().phones))
})

const at = (home: HomeKey, change: Partial<Invitation> | null) => {
  const was = world.invitations[home]
  return { ...world.invitations, [home]: change === null ? undefined : ({ ...was, ...change } as Invitation) }
}

export const phones = {
  get: () => world,
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  /** A new code, at once: the token is made here, its hash goes to the home. */
  issue: (home: HomeKey) =>
    set({ ...world, invitations: at(home, { token: token(), expiresAt: Date.now() + LIFETIME, state: 'waiting' }) }),
  /** The code put away: closing the sheet or the dialog, or Done. */
  drop: (home: HomeKey) => set({ ...world, invitations: at(home, null) }),
  /** The phone pressed Pair: the home registers it, and the code is spent. */
  pairs: (home: HomeKey) => {
    const out = world.invitations[home]
    if (out === undefined || out.state !== 'waiting') return
    const phone: Phone = {
      id: `dev_${token()
        .slice(0, 32)
        .toLowerCase()
        .replace(/[^0-9a-f]/g, 'a')}`,
      name: 'iPhone',
      paired: 'Today',
      seen: 'now',
      fresh: true,
    }
    set({
      ...world,
      phones: { ...world.phones, [home]: [phone, ...world.phones[home]] },
      invitations: at(home, { state: 'paired', phone }),
    })
  },
  runOut: (home: HomeKey) => {
    const out = world.invitations[home]
    if (out === undefined || out.state !== 'waiting') return
    set({ ...world, invitations: at(home, { state: 'expired', expiresAt: Date.now() }) })
  },
  /** Taken off at once; its key is no longer accepted. */
  remove: (home: HomeKey, id: string) =>
    set({ ...world, phones: { ...world.phones, [home]: world.phones[home].filter((one) => one.id !== id) } }),
}

export const usePhones = () => {
  const { home } = useLab()
  const now = useSyncExternalStore(phones.subscribe, phones.get)
  return { home: HOMES[home], list: now.phones[home], invitation: now.invitations[home] ?? null }
}

/** What's left of a code's five minutes, a second at a time; it runs out by itself at none. */
export const useLeft = (home: HomeKey, invitation: Invitation | null) => {
  const [now, setNow] = useState(Date.now)
  const waiting = invitation?.state === 'waiting'
  useEffect(() => {
    if (!waiting) return
    const tick = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(tick)
  }, [waiting])
  const left = invitation === null ? 0 : Math.min(LIFETIME, Math.max(0, invitation.expiresAt - now))
  useEffect(() => {
    if (waiting && left === 0) phones.runOut(home)
  }, [waiting, left, home])
  return left
}

export const mmss = (ms: number) => {
  const s = Math.ceil(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
