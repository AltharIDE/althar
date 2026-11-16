import { createMemoryHistory } from '@tanstack/react-router'

import { hostForHome } from '../../src/renderer/data/homeConnection'
import { follow } from '../../src/renderer/data/feed'
import { makeQueryClient } from '../../src/renderer/data/reads'
import type { Services } from '../../src/renderer/data/services'
import { makeRouter } from '../../src/renderer/router'
import { fakeHost } from '../../tests/fixtures'
import { firstProjectOf, makeClient, tabsOf } from './data'
import { lab } from './state'
import { homesFor, stateOf } from './world'

/*
 * Each window of the lab, as each is in the app: its own client, query
 * cache, router and storage, so a home's window keeps its own tabs and
 * drafts, as its storage partition does. Made the first time it comes to the
 * front and kept, so going back to it shows it as it was.
 */

// Each window's storage of its own: keys go under the window in front.
const real = window.localStorage
const keyOf = (key: string) => `homes-lab:${lab.get().w}:${key}`
const scoped: Storage = {
  getItem: (key) => real.getItem(keyOf(key)),
  setItem: (key, value) => real.setItem(keyOf(key), value),
  removeItem: (key) => real.removeItem(keyOf(key)),
  clear: () => real.clear(),
  key: (index) => real.key(index),
  get length() {
    return real.length
  },
}
for (const key of Object.keys(real)) if (key.startsWith('homes-lab:')) real.removeItem(key)
Object.defineProperty(window, 'localStorage', { value: scoped, configurable: true })

export interface LabWindow {
  readonly id: string
  readonly services: Services
  readonly router: ReturnType<typeof makeRouter>
}

const made = new Map<string, LabWindow>()

export const windowOf = (id: string): LabWindow => {
  const kept = made.get(id)
  if (kept !== undefined) return kept
  real.setItem(`homes-lab:${id}:althar.tabs`, JSON.stringify(tabsOf(id)))
  const client = makeClient(id)
  const host = hostForHome(fakeHost({ homes: homesFor(id) }), stateOf(id))
  const cache = makeQueryClient()
  const services: Services = { client, host, cache, feed: follow(client, cache) }
  // This computer's window opens on althar's board and conversation; a home's, on its Home. The address's
  // `at` opens the window in front elsewhere for a screenshot: `home`, or `project` (its first).
  const at = id === lab.get().w ? new URLSearchParams(window.location.search).get('at') : null
  const first = firstProjectOf(id)
  const start =
    at === 'home' ? '/' : at === 'project' && first !== null ? `/projects/${first}` : id === 'local' ? '/projects/p_althar' : '/'
  const router = makeRouter({ client, cache }, createMemoryHistory({ initialEntries: [start] }))
  const one = { id, services, router }
  made.set(id, one)
  return one
}

/** A window closed: opened again, it starts afresh. */
export const forgetWindow = (id: string) => made.delete(id)

/** "Empty" changes what a home has: its windows read again. */
export const rereadAll = () => {
  for (const one of made.values()) void one.services.cache.invalidateQueries()
}
